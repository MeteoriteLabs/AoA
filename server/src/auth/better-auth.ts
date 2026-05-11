import type { Request, RequestHandler } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { toNodeHandler } from "better-auth/node";
import type { Db } from "@armyofagents/db";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
} from "@armyofagents/db";
import type { Config } from "../config.js";
import { logger } from "../middleware/logger.js";

const DEV_FALLBACK_SECRET = "aoa-dev-secret";

export type BetterAuthSessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
};

export type BetterAuthSessionResult = {
  session: { id: string; userId: string } | null;
  user: BetterAuthSessionUser | null;
};

type BetterAuthInstance = ReturnType<typeof betterAuth>;

function headersFromNodeHeaders(rawHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, raw] of Object.entries(rawHeaders)) {
    if (!raw) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(key, value);
      continue;
    }
    headers.set(key, raw);
  }
  return headers;
}

function headersFromExpressRequest(req: Request): Headers {
  return headersFromNodeHeaders(req.headers);
}

/**
 * Resolves the better-auth HMAC signing secret with a deployment-mode-aware
 * fail-closed gate.
 *
 * - `local_trusted` mode: if neither env var is set, returns a constant dev
 *   fallback and logs a prominent WARN telling the operator to set
 *   `BETTER_AUTH_SECRET`. Loopback-only deployments are the only place this
 *   constant is acceptable.
 * - Any other deployment mode (e.g. `authenticated`, future `cloud_auth`):
 *   throws a clear startup error if neither `BETTER_AUTH_SECRET` nor
 *   `AOA_AGENT_JWT_SECRET` is set. Refusing to boot with a publicly-knowable
 *   signing secret is intentional — anyone with the source could otherwise
 *   forge session cookies.
 *
 * Whitespace-only values are treated as unset.
 */
export function resolveBetterAuthSigningSecret(config: Config): string {
  const fromPrimary = process.env.BETTER_AUTH_SECRET?.trim();
  const fromFallback = process.env.AOA_AGENT_JWT_SECRET?.trim();
  const configured = (fromPrimary && fromPrimary.length > 0)
    ? fromPrimary
    : (fromFallback && fromFallback.length > 0)
      ? fromFallback
      : null;

  if (configured) return configured;

  // Default-deny: only `local_trusted` is allowed to use the dev fallback.
  if (config.deploymentMode === "local_trusted") {
    logger.warn(
      "BETTER_AUTH_SECRET is unset; using insecure dev fallback. " +
        "Set BETTER_AUTH_SECRET in your environment for any non-loopback deployment.",
    );
    return DEV_FALLBACK_SECRET;
  }

  throw new Error(
    `BETTER_AUTH_SECRET must be set when AOA_DEPLOYMENT_MODE="${String(
      config.deploymentMode,
    )}". Set BETTER_AUTH_SECRET (preferred) or AOA_AGENT_JWT_SECRET to a strong random value before starting the server.`,
  );
}

export function deriveAuthTrustedOrigins(config: Config, opts?: { listenPort?: number }): string[] {
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const trustedOrigins = new Set<string>();
  const port = opts?.listenPort ?? config.port;
  const needsPortVariants = port !== 80 && port !== 443;

  if (baseUrl) {
    try {
      trustedOrigins.add(new URL(baseUrl).origin);
    } catch {
      // Better Auth will surface invalid base URL separately.
    }
  }
  for (const hostname of config.allowedHostnames ?? []) {
    const trimmed = hostname.trim().toLowerCase();
    if (!trimmed) continue;
    trustedOrigins.add(`https://${trimmed}`);
    if (needsPortVariants) {
      trustedOrigins.add(`https://${trimmed}:${port}`);
    }
    if (config.deploymentMode === "local_trusted") {
      trustedOrigins.add(`http://${trimmed}`);
    }
  }

  return Array.from(trustedOrigins);
}

export function createBetterAuthInstance(db: Db, config: Config, trustedOrigins?: string[]): BetterAuthInstance {
  const baseUrl = config.authBaseUrlMode === "explicit" ? config.authPublicBaseUrl : undefined;
  const secret = resolveBetterAuthSigningSecret(config);
  const effectiveTrustedOrigins = trustedOrigins ?? deriveAuthTrustedOrigins(config);

  const authConfig = {
    baseURL: baseUrl,
    secret,
    trustedOrigins: effectiveTrustedOrigins,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
  };

  if (!baseUrl) {
    delete (authConfig as { baseURL?: string }).baseURL;
  }

  return betterAuth(authConfig);
}

export function createBetterAuthHandler(auth: BetterAuthInstance): RequestHandler {
  const handler = toNodeHandler(auth);
  return (req, res, next) => {
    void Promise.resolve(handler(req, res)).catch(next);
  };
}

export async function resolveBetterAuthSessionFromHeaders(
  auth: BetterAuthInstance,
  headers: Headers,
): Promise<BetterAuthSessionResult | null> {
  const api = (auth as unknown as { api?: { getSession?: (input: unknown) => Promise<unknown> } }).api;
  if (!api?.getSession) return null;

  const sessionValue = await api.getSession({
    headers,
  });
  if (!sessionValue || typeof sessionValue !== "object") return null;

  const value = sessionValue as {
    session?: { id?: string; userId?: string } | null;
    user?: { id?: string; email?: string | null; name?: string | null } | null;
  };
  const session = value.session?.id && value.session.userId
    ? { id: value.session.id, userId: value.session.userId }
    : null;
  const user = value.user?.id
    ? {
        id: value.user.id,
        email: value.user.email ?? null,
        name: value.user.name ?? null,
      }
    : null;

  if (!session || !user) return null;
  return { session, user };
}

export async function resolveBetterAuthSession(
  auth: BetterAuthInstance,
  req: Request,
): Promise<BetterAuthSessionResult | null> {
  return resolveBetterAuthSessionFromHeaders(auth, headersFromExpressRequest(req));
}
