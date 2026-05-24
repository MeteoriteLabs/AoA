import { describe, it, expect, beforeAll, afterAll } from "vitest";

// signInstallState / verifyInstallState are pure crypto helpers with no DB dependency.
// We set the secret env var before importing so the module picks it up.
const TEST_SECRET = "test-secret";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = TEST_SECRET;
});

afterAll(() => {
  delete process.env.BETTER_AUTH_SECRET;
});

// Dynamic import so the module initialises after env is set.
const { signInstallState, verifyInstallState } = await import("../services/github-app.js");

describe("signInstallState / verifyInstallState", () => {
  it("round-trips: sign → verify returns the original companyId", () => {
    const token = signInstallState("company-abc");
    const result = verifyInstallState(token);
    expect(result).toBe("company-abc");
  });

  it("returns null for a tampered payload (flipped char in payload segment)", () => {
    const token = signInstallState("company-xyz");
    const dot = token.indexOf(".");
    const tampered = token.slice(0, dot) + (token[dot + 1] === "A" ? "B" : "A") + token.slice(dot + 2);
    expect(verifyInstallState(tampered)).toBeNull();
  });

  it("returns null for a tampered signature (flipped char in sig segment)", () => {
    const token = signInstallState("company-xyz");
    const lastDot = token.lastIndexOf(".");
    const payload = token.slice(0, lastDot);
    const sig = token.slice(lastDot + 1);
    const tamperedSig = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyInstallState(`${payload}.${tamperedSig}`)).toBeNull();
  });

  it("returns null for an expired token (issued 11 minutes ago)", () => {
    const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
    const token = signInstallState("company-expired", elevenMinutesAgo);
    expect(verifyInstallState(token)).toBeNull();
  });

  it("returns null for a garbage string", () => {
    expect(verifyInstallState("xxx")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(verifyInstallState("")).toBeNull();
  });

  it("returns null for a token with no dot separator", () => {
    expect(verifyInstallState("nodothere")).toBeNull();
  });
});
