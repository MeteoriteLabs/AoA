// server/src/__tests__/gvisor-sandbox-config.test.ts
import { describe, expect, it } from "vitest";
import { resolveGvisorSandboxTarget } from "../services/environment-runtime.js";

describe("resolveGvisorSandboxTarget", () => {
  it("maps a gvisor environment config to a hardened sandbox-docker target", () => {
    const target = resolveGvisorSandboxTarget({
      provider: "gvisor",
      image: "aoa/agent-base:latest",
      isolation: { user: "1000:1000", capDropAll: true, readOnlyRootfs: true, memory: "2g", cpus: "2", pidsLimit: 512 },
    });
    expect(target.type).toBe("sandbox-docker");
    expect(target.runtime).toBe("runsc");
    expect(target.network).toBe("none");            // egress default
    expect(target.allowHostGateway).toBe(false);
    expect(target.isolation?.user).toBe("1000:1000");
    expect(target.isolation?.noNewPrivileges).toBe(true); // default-on for gvisor
    expect(target.isolation?.tmpfs?.length).toBeGreaterThan(0);
  });
  it("throws when a gvisor config has no image", () => {
    expect(() => resolveGvisorSandboxTarget({ provider: "gvisor" })).toThrow(/image/);
  });
});
