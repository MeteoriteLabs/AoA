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
