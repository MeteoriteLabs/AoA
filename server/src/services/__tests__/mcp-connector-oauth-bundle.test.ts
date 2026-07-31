import { describe, it, expect } from "vitest";
import {
  OAUTH_BUNDLE_VERSION, encodeOAuthBundle, decodeOAuthBundle, isOAuthBundle, isBundleExpired,
  type OAuthTokenBundle,
} from "../mcp-connector-oauth-bundle.js";

const bundle: OAuthTokenBundle = {
  v: OAUTH_BUNDLE_VERSION, accessToken: "at", refreshToken: "rt", expiresAt: 1_000_000,
  tokenEndpoint: "https://as/token", clientId: "cid", scopes: ["default"], resource: "https://mcp/x",
};

describe("oauth bundle codec", () => {
  it("round-trips", () => {
    expect(decodeOAuthBundle(encodeOAuthBundle(bundle))).toEqual(bundle);
  });
  it("decode returns null for a plain token string", () => {
    expect(decodeOAuthBundle("ntn_plain_token")).toBeNull();
    expect(isOAuthBundle("ntn_plain_token")).toBe(false);
  });
  it("decode returns null for JSON without our version tag", () => {
    expect(decodeOAuthBundle(JSON.stringify({ accessToken: "x" }))).toBeNull();
  });
  it("round-trips a bundle with a null refresh token", () => {
    const b: OAuthTokenBundle = { ...bundle, refreshToken: null };
    expect(decodeOAuthBundle(encodeOAuthBundle(b))).toEqual(b);
  });
  it("decode returns null for a non-object JSON payload", () => {
    expect(decodeOAuthBundle("5")).toBeNull();
    expect(decodeOAuthBundle("true")).toBeNull();
    expect(decodeOAuthBundle("[]")).toBeNull();
  });
  it("isBundleExpired respects the margin (expiresAt=1_000_000; expired iff now >= expiresAt - margin)", () => {
    expect(isBundleExpired(bundle, 800_000)).toBe(false);          // 200s before expiry, 120s margin -> fresh
    expect(isBundleExpired(bundle, 900_000)).toBe(true);           // 100s before expiry, within 120s margin -> refresh
    expect(isBundleExpired(bundle, 900_000, 60_000)).toBe(false);  // 100s before, 60s margin -> fresh
    expect(isBundleExpired(bundle, 999_000)).toBe(true);           // 1s before expiry -> refresh
    expect(isBundleExpired(bundle, 1_200_000)).toBe(true);         // past expiry -> expired
  });
});
