/**
 * Just-in-time OAuth token refresh for MCP connectors (Task 13).
 *
 * `loadEnabledConnectorRows` resolves a connector's secret via
 * `secrets.resolveByName`, which for a static token returns the token string
 * unchanged, and for an OAuth-broker-managed connector returns the ENCODED
 * `OAuthTokenBundle` (see `mcp-connector-oauth-bundle.ts`). A bundle's access
 * token expires; this module is the single place that notices, refreshes it
 * against the authorization server, rotates the stored secret to the new
 * bundle, and hands back the live access token the loader injects into the
 * run's env.
 *
 * Kept as its own module (not inlined into the loader) so it stays
 * independently unit-testable with injected deps and carries zero `drizzle-orm`
 * / `@armyofagents/db` imports of its own — the loader still owns all I/O
 * wiring (real `secretService`, real `refreshOAuthToken`).
 */

import { decodeOAuthBundle, encodeOAuthBundle, isBundleExpired, type OAuthTokenBundle } from "./mcp-connector-oauth-bundle.js";
import { refreshOAuthToken as realRefresh } from "./mcp-connector-oauth.js";

export class OAuthRefreshError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "OAuthRefreshError";
  }
}

export interface RefreshDeps {
  secrets: {
    getByName(companyId: string, name: string): Promise<{ id: string } | null>;
    rotate(secretId: string, input: { value: string }): Promise<unknown>;
  };
  refreshOAuthToken?: typeof realRefresh;
  now?: () => number;
}

// In-process single-flight: concurrent runs in this process share one refresh
// per secret, so two agent runs racing on the same expired connector don't
// both spend the (single-use, rotating) refresh token. Multi-process
// deployments need a DB advisory lock keyed on the secret to close this the
// rest of the way — tracked as a follow-up for the hosted rollout, not built
// here.
const inFlight = new Map<string, Promise<string>>();

/**
 * Resolve the effective token to inject for a connector's already-resolved
 * secret value. Plain static tokens pass through untouched; OAuth bundles are
 * refreshed when near expiry (rotating the secret) and the live access token
 * is returned.
 *
 * Throws `OAuthRefreshError` when an expired bundle cannot be refreshed (dead
 * refresh token, refresh request rejected, or the secret vanished mid-refresh)
 * — the caller (the loader) is expected to drop that connector and flip its
 * status to `needs_credentials` rather than fail the whole run.
 */
export async function resolveConnectorToken(
  deps: RefreshDeps,
  companyId: string,
  secretName: string,
  resolvedValue: string,
): Promise<string> {
  const bundle = decodeOAuthBundle(resolvedValue);
  if (!bundle) return resolvedValue; // plain static token — unchanged

  const now = (deps.now ?? Date.now)();
  if (!isBundleExpired(bundle, now)) return bundle.accessToken;

  const key = `${companyId}:${secretName}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const p = doRefresh(deps, companyId, secretName, bundle).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function doRefresh(
  deps: RefreshDeps,
  companyId: string,
  secretName: string,
  bundle: OAuthTokenBundle,
): Promise<string> {
  if (!bundle.refreshToken) throw new OAuthRefreshError("OAuth token expired and no refresh token is available");
  const refresh = deps.refreshOAuthToken ?? realRefresh;
  let token;
  try {
    token = await refresh({
      tokenEndpoint: bundle.tokenEndpoint,
      refreshToken: bundle.refreshToken,
      clientId: bundle.clientId,
      resource: bundle.resource,
    });
  } catch (err) {
    throw new OAuthRefreshError("OAuth token refresh failed", err);
  }
  const row = await deps.secrets.getByName(companyId, secretName);
  if (!row) throw new OAuthRefreshError("OAuth secret vanished during refresh");
  const next: OAuthTokenBundle = {
    ...bundle,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? bundle.refreshToken,
    expiresAt: (deps.now ?? Date.now)() + token.expiresIn * 1000,
  };
  await deps.secrets.rotate(row.id, { value: encodeOAuthBundle(next) });
  return next.accessToken;
}
