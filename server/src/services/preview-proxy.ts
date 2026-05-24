import type { Request, Response } from "express";
import type { Db } from "@armyofagents/db";
import { workspaceRuntimeServices } from "@armyofagents/db";
import { eq } from "drizzle-orm";
import httpProxy from "http-proxy";
import { assertCompanyAccess } from "../routes/authz.js";
import { isAllowedPreviewUpstream } from "./preview-url.js";

const STRIPPED_UPSTREAM_HEADERS = [
  "cookie",
  "authorization",
  "x-aoa-auth",
  "x-openclaw-auth",
] as const;

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

export async function resolvePreviewRuntimeService(
  db: Db,
  req: Request,
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

  assertCompanyAccess(req, row.companyId);

  if (!row.executionWorkspaceId) {
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
  upstream.search = requestUrl.search;
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
