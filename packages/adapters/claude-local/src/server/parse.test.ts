import { describe, expect, it } from "vitest";
import { detectClaudeLoginRequired } from "./parse.js";

describe("detectClaudeLoginRequired — expired credentials (regression)", () => {
  const REVOKED_401 =
    'Failed to authenticate. API Error: 401 {"type":"error","error":' +
    '{"type":"authentication_error","message":"OAuth access token has been revoked."},"request_id":null}';

  it("treats a revoked token as requiring login", () => {
    const r = detectClaudeLoginRequired({ parsed: null, stdout: REVOKED_401, stderr: "" });
    expect(r.requiresLogin).toBe(true);
  });

  it("reports kind=expired for a revoked token, not signed_out", () => {
    const r = detectClaudeLoginRequired({ parsed: null, stdout: REVOKED_401, stderr: "" });
    expect(r.kind).toBe("expired");
  });

  it("still reports kind=signed_out when never signed in", () => {
    const r = detectClaudeLoginRequired({
      parsed: null,
      stdout: "You are not logged in. Please run `claude login`.",
      stderr: "",
    });
    expect(r.requiresLogin).toBe(true);
    expect(r.kind).toBe("signed_out");
  });

  it("does not flag a rate limit as a login problem", () => {
    const r = detectClaudeLoginRequired({
      parsed: null,
      stdout: "API Error: 429 rate limit exceeded",
      stderr: "",
    });
    expect(r.requiresLogin).toBe(false);
    expect(r.kind).toBe("none");
  });
});
