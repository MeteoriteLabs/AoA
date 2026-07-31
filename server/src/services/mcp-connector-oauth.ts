import { createHash, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { resolveConsentSecret } from "./mcp-connector-consent.js";

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
  if (typeof payload.connectorId !== "string" || typeof payload.companyId !== "string") return null;
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
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`OAuth discovery failed: ${url} -> HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function discoverOAuthServer(
  connectorUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredOAuth> {
  const u = new URL(connectorUrl);
  // RFC 9728: protected-resource-metadata is served with the resource path suffixed.
  const prmUrl = `${u.origin}/.well-known/oauth-protected-resource${u.pathname}`;
  const prm = await fetchJson(prmUrl, fetchImpl);
  const servers = Array.isArray(prm.authorization_servers) ? (prm.authorization_servers as string[]) : [];
  const asBase = servers[0];
  if (!asBase) throw new Error(`OAuth discovery: no authorization_servers at ${prmUrl}`);
  // RFC 8414: AS metadata at the issuer origin.
  const asUrl = `${new URL(asBase).origin}/.well-known/oauth-authorization-server`;
  const md = await fetchJson(asUrl, fetchImpl);
  const authorizationEndpoint = md.authorization_endpoint as string;
  const tokenEndpoint = md.token_endpoint as string;
  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new Error(`OAuth discovery: AS metadata missing endpoints at ${asUrl}`);
  }
  const codeChallengeMethods = Array.isArray(md.code_challenge_methods_supported)
    ? (md.code_challenge_methods_supported as string[])
    : [];
  if (!codeChallengeMethods.includes("S256")) {
    throw new Error(`OAuth discovery: authorization server does not support PKCE S256 (${asUrl})`);
  }
  return {
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: (md.registration_endpoint as string) ?? null,
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
  });
  if (!res.ok) throw new Error(`OAuth client registration failed: HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const clientId = body.client_id;
  if (typeof clientId !== "string") throw new Error("OAuth client registration: no client_id in response");
  return { clientId };
}
