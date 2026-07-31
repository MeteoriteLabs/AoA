import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import { generatePkce, signOAuthState, verifyOAuthState, type OAuthStatePayload } from "../mcp-connector-oauth.js";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET ||= "test-secret";
});

describe("generatePkce", () => {
  it("produces a URL-safe verifier and a matching S256 challenge", () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/); // base64url, no padding
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });
  it("is random per call", () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
  });
});

describe("oauth state", () => {
  const base: OAuthStatePayload = { connectorId: "c1", companyId: "co1", nonce: "n", exp: 0 };
  it("round-trips a valid unexpired state", () => {
    const token = signOAuthState({ ...base, exp: 10_000 });
    expect(verifyOAuthState(token, 5_000)).toEqual({ ...base, exp: 10_000 });
  });
  it("rejects an expired state", () => {
    const token = signOAuthState({ ...base, exp: 1_000 });
    expect(verifyOAuthState(token, 2_000)).toBeNull();
  });
  it("rejects a tampered payload (signature mismatch)", () => {
    const token = signOAuthState({ ...base, exp: 10_000 });
    const [payload] = token.split(".");
    expect(verifyOAuthState(`${payload}.deadbeef`, 5_000)).toBeNull();
  });
  it("rejects garbage", () => {
    expect(verifyOAuthState("not-a-token", 0)).toBeNull();
    expect(verifyOAuthState("", 0)).toBeNull();
  });
});
