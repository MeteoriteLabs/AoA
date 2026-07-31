import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import {
  generatePkce,
  signOAuthState,
  verifyOAuthState,
  type OAuthStatePayload,
  discoverOAuthServer,
} from "../mcp-connector-oauth.js";

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

function stubFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url in routes) return new Response(JSON.stringify(routes[url]), { status: 200 });
    return new Response("nf", { status: 404 });
  }) as typeof fetch;
}

describe("discoverOAuthServer", () => {
  const CONN = "https://mcp.notion.com/mcp";
  const f = stubFetch({
    "https://mcp.notion.com/.well-known/oauth-protected-resource/mcp": {
      resource: CONN, authorization_servers: ["https://mcp.notion.com"], scopes_supported: ["default"],
    },
    "https://mcp.notion.com/.well-known/oauth-authorization-server": {
      issuer: "https://mcp.notion.com", authorization_endpoint: "https://mcp.notion.com/authorize",
      token_endpoint: "https://mcp.notion.com/token", registration_endpoint: "https://mcp.notion.com/register",
      code_challenge_methods_supported: ["S256"], scopes_supported: ["default"],
    },
  });

  it("resolves endpoints via PRM then AS metadata", async () => {
    const d = await discoverOAuthServer(CONN, f);
    expect(d.authorizationEndpoint).toBe("https://mcp.notion.com/authorize");
    expect(d.tokenEndpoint).toBe("https://mcp.notion.com/token");
    expect(d.registrationEndpoint).toBe("https://mcp.notion.com/register");
    expect(d.codeChallengeMethods).toContain("S256");
  });

  it("throws a clear error when the AS omits S256", async () => {
    const noPkce = stubFetch({
      "https://mcp.notion.com/.well-known/oauth-protected-resource/mcp": { authorization_servers: ["https://as"] },
      "https://as/.well-known/oauth-authorization-server": {
        authorization_endpoint: "https://as/a", token_endpoint: "https://as/t", code_challenge_methods_supported: ["plain"],
      },
    });
    await expect(discoverOAuthServer(CONN, noPkce)).rejects.toThrow(/S256/);
  });
});
