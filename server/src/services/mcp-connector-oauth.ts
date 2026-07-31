import { createHash, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { resolveConsentSecret } from "./mcp-connector-consent.js";

const FETCH_TIMEOUT_MS = 15_000;

function assertHttps(url: string, label: string): void {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`OAuth discovery: invalid ${label} URL`); }
  if (u.protocol !== "https:") {
    throw new Error(`OAuth discovery: ${label} must use https (got ${u.protocol}) — refusing to send credentials in cleartext`);
  }
}

export function generatePkce(): { verifier: string; challenge: string } {
  // 32 random bytes -> 43-char base64url verifier (RFC 7636 §4.1)
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export interface OAuthStatePayload {
  connectorId: string;
  companyId: string;
  nonce: string;
  exp: number; // epoch ms
}

export function signOAuthState(p: OAuthStatePayload): string {
  const secret = resolveConsentSecret();
  const encoded = Buffer.from(JSON.stringify(p)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

/**
 * Verify a signed state. Proves AUTHENTICITY + FRESHNESS (unexpired) only — NOT single-use.
 * Replay within the `exp` window is prevented by the caller's atomic flow-claim, not here.
 */
export function verifyOAuthState(token: string, nowMs: number): OAuthStatePayload | null {
  const secret = resolveConsentSecret();
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || nowMs >= payload.exp) return null;
  if (typeof payload.connectorId !== "string" || typeof payload.companyId !== "string" || typeof payload.nonce !== "string") return null;
  return payload;
}

export interface DiscoveredOAuth {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  scopesSupported: string[];
  codeChallengeMethods: string[];
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OAuth discovery failed: ${url} -> HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function discoverOAuthServer(
  connectorUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredOAuth> {
  // Fix 4 (final-review follow-up): the AS base and every endpoint DISCOVERED
  // from it were already https-asserted below, but the initial PRM fetch derived
  // straight from `connectorUrl` was not — an http connector URL would still
  // send the well-known PRM request in cleartext before this function ever
  // reaches an https check. Assert first, before any network call.
  assertHttps(connectorUrl, "connector URL");
  const u = new URL(connectorUrl);
  // RFC 9728: protected-resource-metadata is served with the resource path suffixed.
  const prmUrl = `${u.origin}/.well-known/oauth-protected-resource${u.pathname}`;
  const prm = await fetchJson(prmUrl, fetchImpl);
  const servers = Array.isArray(prm.authorization_servers) ? (prm.authorization_servers as unknown[]) : [];
  const asBase = servers[0];
  if (typeof asBase !== "string" || !asBase) throw new Error(`OAuth discovery: no authorization_servers at ${prmUrl}`);
  assertHttps(asBase, "authorization server");
  // RFC 8414: AS metadata at the issuer origin.
  const asUrl = `${new URL(asBase).origin}/.well-known/oauth-authorization-server`;
  const md = await fetchJson(asUrl, fetchImpl);
  const authorizationEndpoint = md.authorization_endpoint;
  const tokenEndpoint = md.token_endpoint;
  if (typeof authorizationEndpoint !== "string" || typeof tokenEndpoint !== "string") {
    throw new Error(`OAuth discovery: AS metadata missing endpoints at ${asUrl}`);
  }
  assertHttps(authorizationEndpoint, "authorization_endpoint");
  assertHttps(tokenEndpoint, "token_endpoint");
  const registrationEndpoint = typeof md.registration_endpoint === "string" ? md.registration_endpoint : null;
  if (registrationEndpoint) assertHttps(registrationEndpoint, "registration_endpoint");
  const codeChallengeMethods = Array.isArray(md.code_challenge_methods_supported)
    ? (md.code_challenge_methods_supported as string[])
    : [];
  if (!codeChallengeMethods.includes("S256")) {
    throw new Error(`OAuth discovery: authorization server does not support PKCE S256 (${asUrl})`);
  }
  return {
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    scopesSupported: Array.isArray(md.scopes_supported) ? (md.scopes_supported as string[]) : [],
    codeChallengeMethods,
  };
}

export async function registerOAuthClient(
  registrationEndpoint: string,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ clientId: string }> {
  const res = await fetchImpl(registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: "Army of Agents",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none", // public client (PKCE)
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OAuth client registration failed: HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const clientId = body.client_id;
  if (typeof clientId !== "string") throw new Error("OAuth client registration: no client_id in response");
  return { clientId };
}

export interface AuthorizeUrlParams {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  resource: string;
  state: string;
  codeChallenge: string;
}

export function buildAuthorizeUrl(p: AuthorizeUrlParams): string {
  const url = new URL(p.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  if (p.scopes.length > 0) url.searchParams.set("scope", p.scopes.join(" "));
  url.searchParams.set("resource", p.resource);
  url.searchParams.set("state", p.state);
  url.searchParams.set("code_challenge", p.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
}
export interface ExchangeParams {
  tokenEndpoint: string; code: string; codeVerifier: string;
  clientId: string; redirectUri: string; resource: string;
}
export interface RefreshParams {
  tokenEndpoint: string; refreshToken: string; clientId: string; resource: string;
}

async function postToken(tokenEndpoint: string, form: URLSearchParams, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const res = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: form.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`OAuth token request failed: HTTP ${res.status} ${String(body.error ?? "")}`.trim());
  const accessToken = body.access_token;
  const expiresIn = body.expires_in;
  if (typeof accessToken !== "string" || typeof expiresIn !== "number") {
    throw new Error("OAuth token response missing access_token/expires_in");
  }
  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresIn,
  };
}

export function exchangeAuthorizationCode(p: ExchangeParams, fetchImpl: typeof fetch = fetch): Promise<TokenResponse> {
  const form = new URLSearchParams({
    grant_type: "authorization_code", code: p.code, code_verifier: p.codeVerifier,
    client_id: p.clientId, redirect_uri: p.redirectUri, resource: p.resource,
  });
  return postToken(p.tokenEndpoint, form, fetchImpl);
}

export function refreshOAuthToken(p: RefreshParams, fetchImpl: typeof fetch = fetch): Promise<TokenResponse> {
  const form = new URLSearchParams({
    grant_type: "refresh_token", refresh_token: p.refreshToken, client_id: p.clientId, resource: p.resource,
  });
  return postToken(p.tokenEndpoint, form, fetchImpl);
}
