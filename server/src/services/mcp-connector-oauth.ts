import { createHash, randomBytes } from "node:crypto";

export function generatePkce(): { verifier: string; challenge: string } {
  // 32 random bytes -> 43-char base64url verifier (RFC 7636 §4.1)
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
