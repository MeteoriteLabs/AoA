import { describe, it, expect } from "vitest";
import { createLoginUrlDetector } from "./login-url-detector.js";

describe("createLoginUrlDetector (Plan 3 T3)", () => {
  it("extracts a verification URL printed on a single line", () => {
    const d = createLoginUrlDetector();
    expect(d.push("Visit https://claude.ai/oauth/authorize?code=abc123 to continue\n")).toBe(
      "https://claude.ai/oauth/authorize?code=abc123",
    );
  });

  it("waits for the URL to complete when split across chunks (no premature match)", () => {
    const d = createLoginUrlDetector();
    // First chunk ends mid-URL — must NOT return a truncated URL.
    expect(d.push("Open https://chatgpt.com/device?user_c")).toBeNull();
    // The rest + a terminator arrives — now the full URL is returned.
    expect(d.push("ode=WXYZ-1234\nWaiting for you to sign in…")).toBe(
      "https://chatgpt.com/device?user_code=WXYZ-1234",
    );
  });

  it("returns null when the URL has no trailing terminator yet (still streaming)", () => {
    const d = createLoginUrlDetector();
    expect(d.push("https://claude.ai/oauth?x=1")).toBeNull(); // could still be growing
    expect(d.push("\n")).toBe("https://claude.ai/oauth?x=1");
  });

  it("returns null for output with no URL", () => {
    const d = createLoginUrlDetector();
    expect(d.push("Checking credentials…\nDone\n")).toBeNull();
  });

  it("is idempotent once found (subsequent pushes keep returning the same URL)", () => {
    const d = createLoginUrlDetector();
    expect(d.push("go to https://claude.ai/oauth?a=b \n")).toBe("https://claude.ai/oauth?a=b");
    expect(d.push("more logs\n")).toBe("https://claude.ai/oauth?a=b");
    expect(d.url).toBe("https://claude.ai/oauth?a=b");
  });

  it("does not let later log noise overwrite the login URL", () => {
    const d = createLoginUrlDetector();
    expect(d.push("Sign in at https://claude.ai/oauth?first=1\n")).toBe("https://claude.ai/oauth?first=1");
    expect(d.push("callback hit https://example.com/other?x=2\n")).toBe("https://claude.ai/oauth?first=1");
  });
});
