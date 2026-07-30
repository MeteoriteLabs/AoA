// server/src/__tests__/gvisor-sandbox-config.test.ts
import { describe, expect, it } from "vitest";
import { buildDockerRunArgs } from "@armyofagents/adapter-utils";
import { resolveDockerSandboxConfig, resolveGvisorSandboxTarget } from "../services/environment-runtime.js";
import { resolveEnvironmentExecutionTarget } from "../services/environment-execution-target.js";

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

describe("gvisor end-to-end config resolution", () => {
  it("resolveDockerSandboxConfig no longer throws for gvisor and carries the hardened profile", () => {
    const resolved = resolveDockerSandboxConfig({
      config: { provider: "gvisor", image: "aoa/agent-base:latest" },
    });
    expect(resolved.provider).toBe("sandbox-docker"); // routes down the docker acquire path
    expect(resolved.type).toBe("sandbox-docker");
    expect(resolved.runtime).toBe("runsc");
    expect(resolved.network).toBe("none");
    expect(resolved.allowHostGateway).toBe(false);
    expect((resolved.isolation as Record<string, unknown>).noNewPrivileges).toBe(true);
  });

  it("a gvisor environment resolves end-to-end to a hardened docker target whose args carry --runtime runsc and omit --add-host by default", () => {
    const target = resolveEnvironmentExecutionTarget({
      environment: {
        driver: "sandbox",
        target: null,
        config: {
          provider: "gvisor",
          image: "aoa/agent-base:latest",
          isolation: { user: "1000:1000", capDropAll: true, readOnlyRootfs: true, memory: "2g", cpus: "2", pidsLimit: 512 },
        },
      },
      adapterType: "claude_local",
    });
    expect(target).not.toBeNull();
    if (!target || target.type !== "sandbox-docker") throw new Error("expected sandbox-docker target");
    expect(target.runtime).toBe("runsc");
    expect(target.network).toBe("none");
    expect(target.isolation?.noNewPrivileges).toBe(true);
    expect(target.isolation?.user).toBe("1000:1000");

    const args = buildDockerRunArgs({
      target,
      localCwd: "/repo",
      command: "claude",
      args: ["-p", "hi"],
      env: {},
    });
    const joined = args.join(" ");
    expect(joined).toContain("--runtime runsc");
    expect(joined).toContain("--network none");
    expect(joined).toContain("--cap-drop ALL");
    expect(joined).toContain("--read-only");
    expect(joined).toContain("--pids-limit 512");
    // Default-OFF SSRF guard: no callback bridge active here -> no host-gateway route.
    expect(args).not.toContain("--add-host");
  });

  it("default-off: a plain sandbox-docker environment emits NO runtime/isolation flags (byte-identical legacy args)", () => {
    const target = resolveEnvironmentExecutionTarget({
      environment: { driver: "sandbox", target: null, config: { provider: "sandbox-docker", image: "node:22" } },
      adapterType: "claude_local",
    });
    if (!target || target.type !== "sandbox-docker") throw new Error("expected sandbox-docker target");
    expect(target.runtime ?? null).toBeNull();
    expect(target.isolation ?? null).toBeNull();
    const args = buildDockerRunArgs({ target, localCwd: "/repo", command: "node", args: [], env: {} });
    const joined = args.join(" ");
    expect(joined).not.toContain("--runtime");
    expect(joined).not.toContain("--cap-drop");
    expect(joined).not.toContain("--read-only");
    expect(args).not.toContain("--add-host");
  });
});
