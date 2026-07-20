import { describe, it, expect } from "vitest";
import { detectAuthFailure } from "./auth-failure-detector.js";

// The exact 401 observed on a live instance with a revoked Claude token.
const REVOKED_401 =
  'Failed to authenticate. API Error: 401 {"type":"error","error":' +
  '{"type":"authentication_error","message":"OAuth access token has been revoked."},"request_id":null}';

describe("detectAuthFailure — expired/revoked credentials", () => {
  it("classifies the observed revoked-token 401 as expired", () => {
    expect(detectAuthFailure(REVOKED_401).kind).toBe("expired");
  });

  it("classifies an expired OAuth token as expired", () => {
    expect(detectAuthFailure("OAuth token expired, please re-authenticate").kind).toBe("expired");
  });

  it("classifies a bare 401 as expired", () => {
    expect(detectAuthFailure("API Error: 401").kind).toBe("expired");
  });

  it("classifies 403 as expired", () => {
    expect(detectAuthFailure("API Error: 403 Forbidden").kind).toBe("expired");
  });
});

describe("detectAuthFailure — never signed in", () => {
  it("classifies claude's not-logged-in message as signed_out", () => {
    expect(detectAuthFailure("You are not logged in. Please run `claude login`.").kind).toBe(
      "signed_out",
    );
  });

  it("classifies codex's login prompt as signed_out", () => {
    expect(detectAuthFailure("Not logged in. Please run `codex login`.").kind).toBe("signed_out");
  });

  it("classifies a generic login-required message as signed_out", () => {
    expect(detectAuthFailure("login required").kind).toBe("signed_out");
  });
});

describe("detectAuthFailure — bad key", () => {
  it("classifies an invalid API key as invalid_key", () => {
    expect(detectAuthFailure("Invalid API key provided").kind).toBe("invalid_key");
  });

  it("classifies a missing OPENAI_API_KEY as invalid_key", () => {
    expect(detectAuthFailure("OPENAI_API_KEY is missing").kind).toBe("invalid_key");
  });
});

// False positives send the founder to a sign-in screen that cannot help them,
// so non-auth failures MUST stay `none`.
describe("detectAuthFailure — must NOT over-match", () => {
  it("ignores rate limits", () => {
    expect(detectAuthFailure("API Error: 429 rate limit exceeded").kind).toBe("none");
  });

  it("ignores max-turns exhaustion", () => {
    expect(detectAuthFailure("Run stopped: maximum turns reached").kind).toBe("none");
  });

  it("ignores a 500", () => {
    expect(detectAuthFailure("API Error: 500 internal server error").kind).toBe("none");
  });

  it("ignores prose that merely discusses authorization", () => {
    expect(
      detectAuthFailure("The task is to add an authorization header to the request handler."),
    ).toMatchObject({ kind: "none" });
  });

  it("returns none for empty input", () => {
    expect(detectAuthFailure("").kind).toBe("none");
  });
});

describe("detectAuthFailure — login URL", () => {
  it("extracts a verification URL when present", () => {
    const r = detectAuthFailure("Please log in at https://claude.ai/device/ABC-123 to continue");
    expect(r.kind).toBe("signed_out");
    expect(r.loginUrl).toBe("https://claude.ai/device/ABC-123");
  });

  it("returns null loginUrl when absent", () => {
    expect(detectAuthFailure("not logged in").loginUrl).toBeNull();
  });
});
