import { describe, expect, it } from "vitest";
import { resolveAdapterExecutionTarget } from "./execution-target.js";

describe("resolveAdapterExecutionTarget sandbox-docker hardening", () => {
  it("parses runtime, isolation, and allowHostGateway", () => {
    const t = resolveAdapterExecutionTarget({
      type: "sandbox-docker",
      image: "aoa/agent-base:latest",
      network: "none",
      runtime: "runsc",
      allowHostGateway: false,
      isolation: {
        user: "1000:1000",
        capDropAll: true,
        readOnlyRootfs: true,
        tmpfs: ["/tmp:rw,noexec,nosuid,size=64m"],
        memory: "2g",
        cpus: "2",
        pidsLimit: 512,
        noNewPrivileges: true,
      },
    });
    if (t.type !== "sandbox-docker") throw new Error("expected sandbox-docker");
    expect(t.runtime).toBe("runsc");
    expect(t.allowHostGateway).toBe(false);
    expect(t.isolation?.user).toBe("1000:1000");
    expect(t.isolation?.pidsLimit).toBe(512);
  });

  it("defaults are back-compat: no runtime, no isolation, no host-gateway opt-in", () => {
    const t = resolveAdapterExecutionTarget({ type: "sandbox-docker", image: "node:22" });
    if (t.type !== "sandbox-docker") throw new Error("expected sandbox-docker");
    expect(t.runtime ?? null).toBeNull();
    expect(t.isolation ?? null).toBeNull();
    expect(t.allowHostGateway ?? false).toBe(false);
  });
});
