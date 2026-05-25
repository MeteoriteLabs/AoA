import type { Request, Response } from "express";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Db } from "@armyofagents/db";
import { workspaceRuntimeServices } from "@armyofagents/db";
import type { DeploymentMode } from "@armyofagents/shared";
import { eq } from "drizzle-orm";
import httpProxy from "http-proxy";
import type { BetterAuthSessionResult } from "../auth/better-auth.js";
import { assertCompanyAccess } from "../routes/authz.js";
import { authorizeCompanyUpgrade } from "./upgrade-auth.js";
import { isAllowedPreviewUpstream } from "./preview-url.js";

const STRIPPED_UPSTREAM_HEADERS = [
  "cookie",
  "authorization",
  "x-aoa-auth",
  "x-openclaw-auth",
] as const;

const PREVIEW_SANDBOX_CSP =
  "sandbox allow-scripts allow-forms allow-popups allow-downloads";

export const previewProxy = httpProxy.createProxyServer({
  changeOrigin: true,
  secure: false,
  ws: true,
});

previewProxy.on("proxyReq", (proxyReq) => {
  for (const header of STRIPPED_UPSTREAM_HEADERS) {
    proxyReq.removeHeader(header);
  }
  proxyReq.setHeader("x-aoa-preview", "1");
});

previewProxy.on("proxyReqWs", (proxyReq) => {
  for (const header of STRIPPED_UPSTREAM_HEADERS) {
    proxyReq.removeHeader(header);
  }
  proxyReq.setHeader("x-aoa-preview", "1");
  proxyReq.on("response", (proxyRes) => {
    hardenPreviewResponseHeaders(proxyRes.headers, { applySandbox: true });
  });
  proxyReq.on("upgrade", (proxyRes) => {
    hardenPreviewResponseHeaders(proxyRes.headers, { applySandbox: false });
  });
});

function hardenPreviewResponseHeaders(
  headers: IncomingHttpHeaders,
  opts: { applySandbox: boolean },
) {
  delete headers["set-cookie"];
  delete headers["set-cookie2"];
  if (opts.applySandbox) {
    headers["content-security-policy"] = PREVIEW_SANDBOX_CSP;
  }
}

previewProxy.on("proxyRes", (proxyRes) => {
  hardenPreviewResponseHeaders(proxyRes.headers, { applySandbox: true });
});

async function resolvePreviewRuntimeServiceRow(
  db: Db,
  serviceId: string,
) {
  const [row] = await db
    .select()
    .from(workspaceRuntimeServices)
    .where(eq(workspaceRuntimeServices.id, serviceId))
    .limit(1);

  if (!row) {
    return { ok: false as const, status: 404, error: "Preview service not found" };
  }

  if (!row.executionWorkspaceId && !row.projectWorkspaceId) {
    return { ok: false as const, status: 409, error: "Preview service is not linked to a workspace" };
  }

  if (row.status !== "running" || row.healthStatus === "unhealthy") {
    return { ok: false as const, status: 409, error: "Preview service is not available" };
  }

  if (!isAllowedPreviewUpstream(row.url)) {
    return { ok: false as const, status: 422, error: "Preview target is not allowed" };
  }

  return { ok: true as const, row };
}

export async function resolvePreviewRuntimeService(
  db: Db,
  req: Request,
  serviceId: string,
) {
  const resolved = await resolvePreviewRuntimeServiceRow(db, serviceId);
  if (!resolved.ok) return resolved;
  assertCompanyAccess(req, resolved.row.companyId);
  return resolved;
}

export function buildPreviewTargetUrl(input: {
  serviceUrl: string;
  serviceId: string;
  originalUrl: string;
}): string {
  const upstream = new URL(input.serviceUrl);
  const requestUrl = new URL(input.originalUrl, "http://aoa.local");
  const prefix = `/preview/services/${encodeURIComponent(input.serviceId)}`;
  const suffix = requestUrl.pathname.startsWith(prefix)
    ? requestUrl.pathname.slice(prefix.length) || "/"
    : "/";
  const upstreamBasePath = upstream.pathname.endsWith("/")
    ? upstream.pathname.slice(0, -1)
    : upstream.pathname;
  upstream.pathname = `${upstreamBasePath}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
  requestUrl.searchParams.delete("token");
  upstream.search = requestUrl.searchParams.toString();
  return upstream.href;
}

export async function proxyPreviewHttp(
  db: Db,
  req: Request,
  res: Response,
  serviceId: string,
) {
  const resolved = await resolvePreviewRuntimeService(db, req, serviceId);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }

  const target = buildPreviewTargetUrl({
    serviceUrl: resolved.row.url!,
    serviceId,
    originalUrl: req.originalUrl,
  });

  previewProxy.web(req, res, { target, ignorePath: true }, (err) => {
    if (!res.headersSent) {
      res.status(502).json({
        error: "Preview proxy failed",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function rejectPreviewUpgrade(socket: Duplex, status: number, message: string) {
  const safe = message.replace(/[\r\n]+/g, " ").trim();
  socket.write(`HTTP/1.1 ${status} ${safe}\r\nConnection: close\r\nContent-Type: text/plain\r\n\r\n${safe}`);
  socket.destroy();
}

function parsePreviewServiceId(pathname: string): string | null {
  const match = pathname.match(/^\/preview\/services\/([^/]+)(?:\/.*)?$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export async function handlePreviewProxyUpgrade(
  db: Db,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  opts: {
    deploymentMode: DeploymentMode;
    resolveSessionFromHeaders?: (headers: Headers) => Promise<BetterAuthSessionResult | null>;
  },
): Promise<boolean> {
  if (!req.url?.startsWith("/preview/services/")) return false;

  const parsed = new URL(req.url, "http://aoa.local");
  const serviceId = parsePreviewServiceId(parsed.pathname);
  if (!serviceId) {
    rejectPreviewUpgrade(socket, 400, "Bad Request");
    return true;
  }

  const resolved = await resolvePreviewRuntimeServiceRow(db, serviceId);
  if (!resolved.ok) {
    rejectPreviewUpgrade(socket, resolved.status, "Preview Unavailable");
    return true;
  }

  const actor = await authorizeCompanyUpgrade(db, req, resolved.row.companyId, parsed, opts);
  if (!actor) {
    rejectPreviewUpgrade(socket, 403, "Forbidden");
    return true;
  }

  const target = buildPreviewTargetUrl({
    serviceUrl: resolved.row.url!,
    serviceId,
    originalUrl: req.url,
  });

  previewProxy.ws(req, socket, head, { target, ignorePath: true }, (err) => {
    rejectPreviewUpgrade(
      socket,
      502,
      err instanceof Error ? err.message : "Preview proxy failed",
    );
  });
  return true;
}
