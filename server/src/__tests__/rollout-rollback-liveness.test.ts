/**
 * Wave-3→4 gate, clause 3 — the rollback path's LIMITS, pinned.
 *
 * CLI-006's rollback instruction reads "removing the Organization's key from
 * AOA_DISTRIBUTED_EXECUTION_ROLLOUT … a config edit, with no code change and no migration."
 * True, and it omits "and a restart": the rollout source captures its parsed map AND the
 * deployment flag once at construction, and `index.ts` builds it once at boot.
 *
 * The test that appears to cover rollback (`cli-006-canary-rollout-mode.test.ts`) constructs a
 * FRESH source from a new env bag — something a running process cannot do — so it proves the
 * decision function, not a live rollback.
 *
 * These are PINNING tests: they assert today's behaviour so the runbook cannot silently become
 * wrong. G1 is deliberately the inverse of the obvious test. It is SUPPOSED to fail the day
 * someone makes the map live — that is precisely when the runbook needs updating, and the
 * failure message says so.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDistributedExecutionRolloutSource } from "../config/distributed-execution-rollout-source.js";
import { createHeartbeatDistributedRolloutHook } from "../services/heartbeat-distributed-rollout.js";

const ORG = "11111111-1111-4111-8111-111111111111";

function rolloutJson(mode: string | null): string {
  return JSON.stringify(mode === null ? { organizations: {} } : {
    organizations: { [ORG]: { mode, workloads: ["batch"] } },
  });
}

function resolve(source: ReturnType<typeof createDistributedExecutionRolloutSource>): string {
  return source.resolveRunRolloutState({
    deploymentMode: "cloud_auth",
    organizationId: ORG,
    workloadType: "batch",
  });
}

// ─── G1 ──────────────────────────────────────────────────────────────────────
describe("G1 — the rollout map is captured at construction, so rollback needs a restart", () => {
  it("ignores an Organization being REMOVED from the map after construction", () => {
    const env: Record<string, string | undefined> = {
      AOA_DISTRIBUTED_EXECUTION_ENABLED: "1",
      AOA_DISTRIBUTED_EXECUTION_ROLLOUT: rolloutJson("canary"),
    };
    const source = createDistributedExecutionRolloutSource(env);
    expect(resolve(source)).toBe("canary");

    // The documented rollback, performed on a LIVE process.
    env.AOA_DISTRIBUTED_EXECUTION_ROLLOUT = rolloutJson(null);

    expect(
      resolve(source),
      "The rollout map is parsed ONCE in createDistributedExecutionRolloutSource, so a live " +
        "process cannot observe this edit. If this assertion now fails, the map has been made " +
        "live — which is an improvement, but the rollback runbook (docs/deploy/" +
        "environment-variables.md and CLI-006-result.md) says a restart is required and must " +
        "be corrected in the same change.",
    ).toBe("canary");
  });

  it("ignores a mode DOWNGRADE after construction", () => {
    const env: Record<string, string | undefined> = {
      AOA_DISTRIBUTED_EXECUTION_ENABLED: "1",
      AOA_DISTRIBUTED_EXECUTION_ROLLOUT: rolloutJson("canary"),
    };
    const source = createDistributedExecutionRolloutSource(env);
    env.AOA_DISTRIBUTED_EXECUTION_ROLLOUT = rolloutJson("shadow");
    expect(resolve(source)).toBe("canary");
  });

  it("ignores the deployment flag being unset after construction", () => {
    // The source's OWN flag read is captured too — only the hook re-reads (G2).
    const env: Record<string, string | undefined> = {
      AOA_DISTRIBUTED_EXECUTION_ENABLED: "1",
      AOA_DISTRIBUTED_EXECUTION_ROLLOUT: rolloutJson("canary"),
    };
    const source = createDistributedExecutionRolloutSource(env);
    env.AOA_DISTRIBUTED_EXECUTION_ENABLED = "0";
    expect(resolve(source)).toBe("canary");
  });

  it("a FRESHLY constructed source does see the edit — i.e. a restart is what applies it", () => {
    const rolledBack = createDistributedExecutionRolloutSource({
      AOA_DISTRIBUTED_EXECUTION_ENABLED: "1",
      AOA_DISTRIBUTED_EXECUTION_ROLLOUT: rolloutJson(null),
    });
    expect(resolve(rolledBack)).toBe("off");
  });
});

// ─── G2 ──────────────────────────────────────────────────────────────────────
describe("G2 — the deployment flag IS live at the heartbeat hook", () => {
  function hook(env: Record<string, string | undefined>) {
    return createHeartbeatDistributedRolloutHook({
      env,
      deploymentMode: "cloud_auth",
      rolloutSource: createDistributedExecutionRolloutSource(env),
      resolveOrganizationId: async () => ORG,
      convertOrchestrator: { convertRunToJob: async () => ({ converted: false, reason: "disabled" }) },
      comparator: { compare: () => ({}) as never },
    });
  }

  it("returns off on the NEXT call after the flag is unset, with no restart", async () => {
    const env: Record<string, string | undefined> = {
      AOA_DISTRIBUTED_EXECUTION_ENABLED: "1",
      AOA_DISTRIBUTED_EXECUTION_ROLLOUT: rolloutJson("canary"),
    };
    const h = hook(env);
    expect((await h.resolveRunRolloutState({ companyId: "c-1" })).state).toBe("canary");

    env.AOA_DISTRIBUTED_EXECUTION_ENABLED = "0";

    // THIS is the live lever, and it is the only one. The hook checks the flag itself,
    // before consulting the source whose own copy is stale (G1).
    const after = await h.resolveRunRolloutState({ companyId: "c-1" });
    expect(after.state).toBe("off");
    // Flag-first: no Organization is resolved when the flag is off.
    expect(after.organizationId).toBeNull();
  });

  it("the two levers are therefore NOT interchangeable", async () => {
    // The distinction the runbook has to carry: same env bag, same edit shape, different
    // latency. Conflating them is how an operator throws a lever that has not fired.
    const env: Record<string, string | undefined> = {
      AOA_DISTRIBUTED_EXECUTION_ENABLED: "1",
      AOA_DISTRIBUTED_EXECUTION_ROLLOUT: rolloutJson("canary"),
    };
    const h = hook(env);
    const source = createDistributedExecutionRolloutSource(env);

    env.AOA_DISTRIBUTED_EXECUTION_ROLLOUT = rolloutJson(null); // map edit: NOT live
    expect((await h.resolveRunRolloutState({ companyId: "c-1" })).state).toBe("canary");
    expect(resolve(source)).toBe("canary");

    env.AOA_DISTRIBUTED_EXECUTION_ENABLED = "0"; // flag unset: live at the hook
    expect((await h.resolveRunRolloutState({ companyId: "c-1" })).state).toBe("off");
  });
});

// ─── G3 ──────────────────────────────────────────────────────────────────────
const APP_SRC = readFileSync(fileURLToPath(new URL("../app.ts", import.meta.url)), "utf8");

describe("G3 — unsetting the flag does not unregister the worker control plane", () => {
  it("gates the worker control routes at app construction, not per request", () => {
    // This is why the flag is NOT the headline rollback lever: it stops the control plane
    // minting new distributed work from the heartbeat, while workers keep polling and leasing
    // until a restart. The genuinely live stop for that half is the REL-004 kill switch.
    expect(APP_SRC).toMatch(/if \(opts\.distributedExecutionEnabled\) \{/);
    const gateAt = APP_SRC.indexOf("if (opts.distributedExecutionEnabled) {");
    const routesAt = APP_SRC.indexOf("api.use(workerControlRoutes({");
    expect(gateAt).toBeGreaterThan(-1);
    expect(routesAt).toBeGreaterThan(gateAt);
    // `opts.` — a value passed in at construction, never `process.env` read per request.
    expect(
      APP_SRC,
      "if the worker-control gate ever reads process.env per request, the flag becomes a real " +
        "master switch and step 2 of the rollback runbook can be simplified",
    ).not.toMatch(/workerControlRoutes[\s\S]{0,400}process\.env\.AOA_DISTRIBUTED_EXECUTION_ENABLED/);
  });
});
