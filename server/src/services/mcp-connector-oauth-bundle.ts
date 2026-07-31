export const OAUTH_BUNDLE_VERSION = "aoa-oauth-1" as const;

export interface OAuthTokenBundle {
  v: typeof OAUTH_BUNDLE_VERSION;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  tokenEndpoint: string;
  clientId: string;
  scopes: string[];
  resource: string;
}

export function encodeOAuthBundle(b: OAuthTokenBundle): string {
  return JSON.stringify(b);
}

export function decodeOAuthBundle(s: string): OAuthTokenBundle | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (o.v !== OAUTH_BUNDLE_VERSION) return null;
  if (typeof o.accessToken !== "string") return null;
  if (typeof o.expiresAt !== "number") return null;
  if (typeof o.tokenEndpoint !== "string" || typeof o.clientId !== "string") return null;
  return {
    v: OAUTH_BUNDLE_VERSION,
    accessToken: o.accessToken,
    refreshToken: typeof o.refreshToken === "string" ? o.refreshToken : null,
    expiresAt: o.expiresAt,
    tokenEndpoint: o.tokenEndpoint,
    clientId: o.clientId,
    scopes: Array.isArray(o.scopes) ? (o.scopes as string[]) : [],
    resource: typeof o.resource === "string" ? o.resource : "",
  };
}

export function isOAuthBundle(s: string): boolean {
  return decodeOAuthBundle(s) !== null;
}

export function isBundleExpired(b: OAuthTokenBundle, nowMs: number, marginMs = 120_000): boolean {
  return nowMs >= b.expiresAt - marginMs;
}
