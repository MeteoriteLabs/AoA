import { describe, it, expect } from "vitest";
import { resolveRuntimeHookBaseUrl } from "../services/heartbeat.js";

// U2e: the claude_local PreToolUse runtime-permission hook needs a base URL to
// call back to the control plane. `http://127.0.0.1:${PORT}` is unreachable
// from inside an E2B sandbox VM — for a brokered (sandboxed) run the base URL
// MUST be a routable control-plane URL (AOA_API_URL). The `127.0.0.1` fallback
// stays valid ONLY for host-local (desktop/unsandboxed) runs.
describe("resolveRuntimeHookBaseUrl", () => {
  it("sandbox run: returns AOA_API_URL when set", () => {
    expect(
      resolveRuntimeHookBaseUrl({ apiUrl: "https://cp.example", port: "3100", brokered: true }),
    ).toBe("https://cp.example");
  });

  it("sandbox run: MUST NOT fall back to loopback — throws when AOA_API_URL is empty", () => {
    expect(() =>
      resolveRuntimeHookBaseUrl({ apiUrl: "", port: "3100", brokered: true }),
    ).toThrow(/AOA_API_URL required for sandboxed runtime hook/);
  });

  it("host-local run: loopback fallback preserved when AOA_API_URL is empty (desktop unchanged)", () => {
    expect(
      resolveRuntimeHookBaseUrl({ apiUrl: "", port: "3100", brokered: false }),
    ).toBe("http://127.0.0.1:3100");
  });

  it("host-local run: AOA_API_URL still takes precedence over loopback when set (matches today's `||` precedence)", () => {
    expect(
      resolveRuntimeHookBaseUrl({ apiUrl: "https://cp.example", port: "3100", brokered: false }),
    ).toBe("https://cp.example");
  });

  it("uses the port value verbatim in the loopback fallback", () => {
    expect(
      resolveRuntimeHookBaseUrl({ apiUrl: "", port: "4200", brokered: false }),
    ).toBe("http://127.0.0.1:4200");
  });
});
