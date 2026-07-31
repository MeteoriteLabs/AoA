import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveConnectorToken, OAuthRefreshError } from "../mcp-connector-token-refresh.js";
import { encodeOAuthBundle, OAUTH_BUNDLE_VERSION, type OAuthTokenBundle } from "../mcp-connector-oauth-bundle.js";

const freshBundle = (over: Partial<OAuthTokenBundle> = {}): OAuthTokenBundle => ({
  v: OAUTH_BUNDLE_VERSION, accessToken: "at", refreshToken: "rt", expiresAt: 10_000_000,
  tokenEndpoint: "https://as/token", clientId: "cid", scopes: ["default"], resource: "https://mcp/x", ...over,
});

describe("resolveConnectorToken", () => {
  const rotate = vi.fn();
  const getByName = vi.fn();
  const refreshOAuthToken = vi.fn();
  const deps = { secrets: { getByName, rotate }, refreshOAuthToken, now: () => 5_000_000 };
  beforeEach(() => { rotate.mockReset(); getByName.mockReset(); refreshOAuthToken.mockReset(); });

  it("passes a plain token through untouched", async () => {
    const out = await resolveConnectorToken(deps as any, "co", "mcp:notion", "ntn_plain");
    expect(out).toBe("ntn_plain");
    expect(refreshOAuthToken).not.toHaveBeenCalled();
  });

  it("returns the access token when the bundle is still fresh", async () => {
    const out = await resolveConnectorToken(deps as any, "co", "mcp:notion", encodeOAuthBundle(freshBundle()));
    expect(out).toBe("at");
    expect(refreshOAuthToken).not.toHaveBeenCalled();
  });

  it("refreshes + rotates when expired, returning the new access token", async () => {
    getByName.mockResolvedValue({ id: "sec1" });
    refreshOAuthToken.mockResolvedValue({ accessToken: "at2", refreshToken: "rt2", expiresIn: 3600 });
    const expired = encodeOAuthBundle(freshBundle({ expiresAt: 5_000_000 })); // now === expiresAt
    const out = await resolveConnectorToken(deps as any, "co", "mcp:notion", expired);
    expect(out).toBe("at2");
    expect(rotate).toHaveBeenCalledWith("sec1", expect.objectContaining({ value: expect.stringContaining("at2") }));
  });

  it("throws OAuthRefreshError when the refresh token is dead", async () => {
    getByName.mockResolvedValue({ id: "sec1" });
    refreshOAuthToken.mockRejectedValue(new Error("HTTP 400 invalid_grant"));
    const expired = encodeOAuthBundle(freshBundle({ expiresAt: 1_000 }));
    await expect(resolveConnectorToken(deps as any, "co", "mcp:notion", expired)).rejects.toBeInstanceOf(OAuthRefreshError);
  });

  it("throws OAuthRefreshError when an expired bundle has no refresh token", async () => {
    const expired = encodeOAuthBundle(freshBundle({ expiresAt: 1_000, refreshToken: null }));
    await expect(resolveConnectorToken(deps as any, "co", "mcp:notion", expired)).rejects.toBeInstanceOf(OAuthRefreshError);
  });
});
