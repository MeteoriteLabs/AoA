// server/src/__tests__/distributed-tool-surface-per-organization.test.ts
//
// CLI-016 (M1b) — the distributed tool surface is armed PER ORGANIZATION (founder ruling F10),
// not deployment-wide. Tier-1: pure functions and structural source pins, cross-platform, no
// database. The real-PostgreSQL half (the company -> Organization join, the /mcp use-side
// resolver and the DAT-007 currency resolver side by side, two tenants) is
// `distributed-tool-surface-arming.integration.test.ts`.
//
// Every "deny" row here has a same-shape "admit" row beside it (the positive control), so a
// gate that always denied could not pass the suite, and neither could one that always admitted.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DISTRIBUTED_TOOL_SURFACE_ENABLED_ENV,
  DISTRIBUTED_TOOL_SURFACE_PER_ORGANIZATION,
  HostedExecutionStartupUnsafeError,
  assertHostedExecutionStartupSafe,
  readDistributedToolSurfaceFlag,
  resolveDistributedToolSurface,
} from "../config/distributed-execution.js";
import {
  DISTRIBUTED_EXECUTION_ROLLOUT_ENV,
  createDistributedExecutionRolloutSource,
  parseDistributedExecutionRolloutMap,
} from "../config/distributed-execution-rollout-source.js";
import { createHeartbeatDistributedRolloutHook } from "../services/heartbeat-distributed-rollout.js";
import { classifyToolSurfaceAtUse } from "../mcp/distributed-tool-surface-use.js";
import type { JobConvertOrchestrator } from "../services/job-convert-orchestrator.js";
import type { JobShadowComparator } from "../services/job-shadow-comparator.js";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORG_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** Org A opted in to tools; Org B is a canary tenant WITHOUT tools; Org C sets `tools:false`. */
const TWO_TENANT_ROLLOUT = JSON.stringify({
  organizations: {
    [ORG_A]: { mode: "canary", workloads: ["*"], tools: true },
    [ORG_B]: { mode: "canary", workloads: ["*"] },
    [ORG_C]: { mode: "canary", workloads: ["*"], tools: false },
  },
});

describe("CLI-016 — the per-Organization `tools` field on OrganizationRolloutPolicy", () => {
  it("parses `tools: true`, and ABSENT means not enabled (the opposite of `sources`)", () => {
    const map = parseDistributedExecutionRolloutMap({ [DISTRIBUTED_EXECUTION_ROLLOUT_ENV]: TWO_TENANT_ROLLOUT });
    expect(map.get(ORG_A)?.tools).toBe(true);
    expect(map.get(ORG_B)?.tools).toBeUndefined();
    expect(map.get(ORG_C)?.tools).toBe(false);
  });

  it.each([["yes"], [1], [null], [["claude_local"]], [{}]])(
    "a non-boolean `tools` (%j) fails the parse LOUDLY, exactly as a malformed `mode` does",
    (tools) => {
      const raw = JSON.stringify({ organizations: { [ORG_A]: { mode: "canary", workloads: ["*"], tools } } });
      expect(() => parseDistributedExecutionRolloutMap({ [DISTRIBUTED_EXECUTION_ROLLOUT_ENV]: raw })).toThrow(
        /tools must be a boolean/,
      );
    },
  );

  it("resolveOrganizationToolSurface: A enabled; B (absent), C (false) and an unknown Org are NOT", () => {
    const source = createDistributedExecutionRolloutSource({ [DISTRIBUTED_EXECUTION_ROLLOUT_ENV]: TWO_TENANT_ROLLOUT });
    expect(source.resolveOrganizationToolSurface({ organizationId: ORG_A })).toBe(true);
    expect(source.resolveOrganizationToolSurface({ organizationId: ORG_B })).toBe(false);
    expect(source.resolveOrganizationToolSurface({ organizationId: ORG_C })).toBe(false);
    expect(source.resolveOrganizationToolSurface({ organizationId: "unknown-org" })).toBe(false);
  });

  it("re-reads per call: removing A's `tools` disarms A with no restart (per-tenant rollback)", () => {
    const env: Record<string, string | undefined> = { [DISTRIBUTED_EXECUTION_ROLLOUT_ENV]: TWO_TENANT_ROLLOUT };
    const source = createDistributedExecutionRolloutSource(env);
    expect(source.resolveOrganizationToolSurface({ organizationId: ORG_A })).toBe(true);
    env[DISTRIBUTED_EXECUTION_ROLLOUT_ENV] = JSON.stringify({
      organizations: { [ORG_A]: { mode: "canary", workloads: ["*"] } },
    });
    expect(source.resolveOrganizationToolSurface({ organizationId: ORG_A })).toBe(false);
  });

  it("a malformed rollout map at runtime fails CLOSED for tools too (every Org resolves off)", () => {
    const source = createDistributedExecutionRolloutSource({ [DISTRIBUTED_EXECUTION_ROLLOUT_ENV]: "{not json" });
    expect(source.resolveOrganizationToolSurface({ organizationId: ORG_A })).toBe(false);
  });
});

describe("CLI-016 / E7-D10 — the deployment flag's arming value is `per-organization`", () => {
  it("unset and the falsy spellings are OFF", () => {
    expect(readDistributedToolSurfaceFlag({})).toBe(false);
    for (const v of ["0", "false", "no", "off"]) {
      expect(readDistributedToolSurfaceFlag({ [DISTRIBUTED_TOOL_SURFACE_ENABLED_ENV]: v })).toBe(false);
    }
  });

  it("`per-organization` ARMS the deployment (the only arming value)", () => {
    expect(DISTRIBUTED_TOOL_SURFACE_PER_ORGANIZATION).toBe("per-organization");
    expect(readDistributedToolSurfaceFlag({ [DISTRIBUTED_TOOL_SURFACE_ENABLED_ENV]: "per-organization" })).toBe(true);
    expect(readDistributedToolSurfaceFlag({ [DISTRIBUTED_TOOL_SURFACE_ENABLED_ENV]: " Per-Organization " })).toBe(true);
  });

  it.each(["1", "true", "yes", "on", "TRUE"])(
    "★ the legacy truthy value %j is REFUSED LOUDLY — it is the value an older binary reads as 'arm every tenant'",
    (v) => {
      expect(() => readDistributedToolSurfaceFlag({ [DISTRIBUTED_TOOL_SURFACE_ENABLED_ENV]: v })).toThrow(
        /per-organization/,
      );
    },
  );

  it("an unrecognised value is refused too", () => {
    expect(() => readDistributedToolSurfaceFlag({ [DISTRIBUTED_TOOL_SURFACE_ENABLED_ENV]: "banana" })).toThrow();
  });

  it("the startup assertion REFUSES a legacy truthy value (classified), and PASSES `per-organization`", () => {
    let caught: unknown;
    try {
      assertHostedExecutionStartupSafe({
        deploymentMode: "cloud_auth",
        env: { [DISTRIBUTED_TOOL_SURFACE_ENABLED_ENV]: "true" },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HostedExecutionStartupUnsafeError);
    expect((caught as HostedExecutionStartupUnsafeError).reason).toBe("env_flag_unparseable");
    expect((caught as HostedExecutionStartupUnsafeError).envName).toBe(DISTRIBUTED_TOOL_SURFACE_ENABLED_ENV);
    // Positive control: the same assertion, the arming value, passes.
    expect(
      assertHostedExecutionStartupSafe({
        deploymentMode: "cloud_auth",
        env: { [DISTRIBUTED_TOOL_SURFACE_ENABLED_ENV]: "per-organization" },
      }).outcome,
    ).toBe("passed");
  });
});

describe("CLI-016 — resolveDistributedToolSurface: deployment kill switch AND per-Organization opt-in", () => {
  it("authorized only when BOTH are on", () => {
    expect(resolveDistributedToolSurface({ deploymentArmed: true, organizationToolsEnabled: true })).toEqual({
      authorized: true,
      reason: "enabled",
    });
  });
  it("deployment off wins (the kill switch), whatever the Organization says", () => {
    expect(resolveDistributedToolSurface({ deploymentArmed: false, organizationToolsEnabled: true })).toEqual({
      authorized: false,
      reason: "deployment_disabled",
    });
  });
  it("★ F10: deployment ARMED but this Organization not enabled → NOT authorized", () => {
    expect(resolveDistributedToolSurface({ deploymentArmed: true, organizationToolsEnabled: false })).toEqual({
      authorized: false,
      reason: "organization_not_enabled",
    });
  });
});

function hookFor(rolloutSource: unknown) {
  return createHeartbeatDistributedRolloutHook({
    env: {},
    deploymentMode: "cloud_auth",
    rolloutSource: rolloutSource as never,
    resolveOrganizationId: vi.fn(async () => ORG_A),
    convertOrchestrator: { convertRunToJob: vi.fn() } as unknown as JobConvertOrchestrator,
    comparator: { compare: vi.fn() } as unknown as JobShadowComparator,
  });
}

describe("CLI-016 — the heartbeat hook's per-Organization tool-surface read", () => {
  it("delegates to the rollout source for the run's Organization (A yes, B no)", () => {
    const hook = hookFor(createDistributedExecutionRolloutSource({ [DISTRIBUTED_EXECUTION_ROLLOUT_ENV]: TWO_TENANT_ROLLOUT }));
    expect(hook.resolveOrganizationToolSurface(ORG_A)).toBe(true);
    expect(hook.resolveOrganizationToolSurface(ORG_B)).toBe(false);
  });
  it("a null Organization, or a throwing source, is NOT enabled (fail closed, never throws into the run)", () => {
    const hook = hookFor({
      resolveOrganizationToolSurface: () => {
        throw new Error("boom");
      },
    });
    expect(hook.resolveOrganizationToolSurface(null)).toBe(false);
    expect(hook.resolveOrganizationToolSurface(ORG_A)).toBe(false);
  });
});

describe("CLI-016 — classifyToolSurfaceAtUse (the /mcp use-side per-Organization gate)", () => {
  const base = { runFound: true, runCompanyId: "co-a", executionOwner: "distributed" as string | null };
  it("ADMIT — a distributed run whose Organization is armed (positive control)", () => {
    expect(classifyToolSurfaceAtUse({ ...base, organizationArmed: true }, "co-a")).toBe("admit");
  });
  it("★ DENY — a distributed run whose Organization is NOT armed (F10: tenant B)", () => {
    expect(classifyToolSurfaceAtUse({ ...base, organizationArmed: false }, "co-a")).toBe("deny");
  });
  it("DENY — company mismatch, even when the run's Organization is armed", () => {
    expect(classifyToolSurfaceAtUse({ ...base, organizationArmed: true }, "co-b")).toBe("deny");
  });
  it("ADMIT — a LOCAL run (execution_owner NULL) is not this gate's business, armed or not", () => {
    expect(classifyToolSurfaceAtUse({ ...base, executionOwner: null, organizationArmed: false }, "co-a")).toBe("admit");
  });
  it("ADMIT — no run row (the DAT-007 fail-open class; crew and reaped runs), armed or not", () => {
    expect(
      classifyToolSurfaceAtUse({ runFound: false, runCompanyId: null, executionOwner: null, organizationArmed: false }, "co-a"),
    ).toBe("admit");
  });
});

// The dispatch seam sits inside `executeRun`, which cannot be instantiated in-process (the
// standing CLI-003/005/006 limitation). As `cli-008-unit-d-seam-wiring.test.ts` does, assert
// its shape against the SOURCE rather than assert nothing about the one call site that matters.
describe("CLI-016 — the heartbeat dispatch seam combines the flag WITH the run's Organization", () => {
  const source = readFileSync(new URL("../services/heartbeat.ts", import.meta.url), "utf8");

  it("the deployment flag alone no longer decides the tool surface", () => {
    expect(source).not.toContain("const toolSurfaceAuthorized = readDistributedToolSurfaceFlag(process.env);");
  });

  it("the decision reads the run's Organization through the hook, and that decision gates BOTH the config and the mint", () => {
    const at = source.indexOf("resolveDistributedToolSurface({");
    expect(at).toBeGreaterThan(0);
    const window = source.slice(at, at + 600);
    expect(window).toContain("deploymentArmed: readDistributedToolSurfaceFlag(process.env)");
    expect(window).toContain(
      "organizationToolsEnabled: distributedRolloutHook.resolveOrganizationToolSurface(distributedRolloutOrganizationId)",
    );
    expect(source).toContain("const toolSurfaceAuthorized = toolSurfaceDecision.authorized;");
    // The config and the run_jwt mint still consume the ONE value.
    expect(source).toContain("toolSurfaceAuthorized && runTargetsSandbox && toolSurfaceApiBaseUrl");
    expect(source).toMatch(/\n\s+toolSurfaceAuthorized,\n/);
  });
});
