import { describe, it, expect } from "vitest";
import { resolveConnectorStatus } from "../services/mcp-connector-status.js";

describe("resolveConnectorStatus", () => {
  it("local_trusted + no secret needed -> active", () => {
    expect(resolveConnectorStatus({
      deploymentMode: "local_trusted", approved: true, requiresSecret: false, hasSecret: false,
    })).toBe("active");
  });

  it("local_trusted + secret needed but unbound -> needs_credentials", () => {
    expect(resolveConnectorStatus({
      deploymentMode: "local_trusted", approved: true, requiresSecret: true, hasSecret: false,
    })).toBe("needs_credentials");
  });

  it("local_trusted + secret needed and bound -> active", () => {
    expect(resolveConnectorStatus({
      deploymentMode: "local_trusted", approved: true, requiresSecret: true, hasSecret: true,
    })).toBe("active");
  });

  it("authenticated + not yet approved -> pending_approval even with a secret", () => {
    expect(resolveConnectorStatus({
      deploymentMode: "authenticated", approved: false, requiresSecret: true, hasSecret: true,
    })).toBe("pending_approval");
  });

  it("authenticated + approved but unbound -> needs_credentials, NOT active", () => {
    expect(resolveConnectorStatus({
      deploymentMode: "authenticated", approved: true, requiresSecret: true, hasSecret: false,
    })).toBe("needs_credentials");
  });

  it("authenticated + approved + bound -> active", () => {
    expect(resolveConnectorStatus({
      deploymentMode: "authenticated", approved: true, requiresSecret: true, hasSecret: true,
    })).toBe("active");
  });

  it("never returns active when a required secret is missing (exhaustive)", () => {
    for (const deploymentMode of ["local_trusted", "authenticated", "cloud_auth"]) {
      for (const approved of [true, false]) {
        const s = resolveConnectorStatus({
          deploymentMode, approved, requiresSecret: true, hasSecret: false,
        });
        expect(s).not.toBe("active");
      }
    }
  });
});
