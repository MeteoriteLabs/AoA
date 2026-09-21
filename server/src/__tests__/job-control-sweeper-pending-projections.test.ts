// JOB-016 / E3-D-ACC Amendment 3 — the JOB-006 sweeper runs the stale-pending detector and the
// bounded authoritative-cost re-drive on its per-Organization rotation, best-effort, and the
// composition root actually wires it.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createJobControlSweeper } from "../services/job-control-sweeper.js";

const ORG_A = "11111111-1111-4111-8111-11111111111a";
const ORG_B = "11111111-1111-4111-8111-11111111111b";

const reap = async () => ({
  scanned: 0, revoked: 0, retried: 0, deadLettered: 0, cancelled: 0, finalized: 0, terminalized: [],
});

describe("JOB-016 — sweepPendingProjections on the sweeper rotation", () => {
  it("runs once per swept Organization, with that Organization's id", async () => {
    const sweepPendingProjections = vi.fn(async () => ({}));
    const sweeper = createJobControlSweeper({
      enabled: true,
      reconciliation: { reapOrganization: reap } as never,
      listAdmittedOrganizationIds: async () => [ORG_A, ORG_B],
      sweepPendingProjections,
    });
    await sweeper.tick();
    expect(sweepPendingProjections.mock.calls.map((call) => call[0])).toEqual([ORG_A, ORG_B]);
  });

  it("is best-effort: a throwing sweep never fails the tick and never skips the next Organization", async () => {
    const sweepPendingProjections = vi.fn(async (organizationId: string) => {
      if (organizationId === ORG_A) throw new Error("boom");
      return {};
    });
    const sweeper = createJobControlSweeper({
      enabled: true,
      reconciliation: { reapOrganization: reap } as never,
      listAdmittedOrganizationIds: async () => [ORG_A, ORG_B],
      sweepPendingProjections,
    });
    const result = await sweeper.tick();
    expect(result.organizations).toBe(2);
    expect(sweepPendingProjections).toHaveBeenCalledTimes(2);
  });

  it("is not called when the sweeper is disabled", async () => {
    const sweepPendingProjections = vi.fn(async () => ({}));
    const sweeper = createJobControlSweeper({
      enabled: false,
      reconciliation: { reapOrganization: reap } as never,
      listAdmittedOrganizationIds: async () => [ORG_A],
      sweepPendingProjections,
    });
    await sweeper.tick();
    expect(sweepPendingProjections).not.toHaveBeenCalled();
  });

  it("the composition root passes the re-drive sweep to the RUNNING convergence sweeper", () => {
    const src = readFileSync(fileURLToPath(new URL("../index.ts", import.meta.url)), "utf8");
    const at = src.indexOf("const convergenceSweeper = createJobControlSweeper(");
    expect(at).toBeGreaterThan(0);
    const call = src.slice(at, src.indexOf("});", at));
    expect(call).toMatch(/sweepPendingProjections:\s*costRedrive\.sweepOrganization/);
    const built = src.slice(0, at);
    expect(built).toMatch(/const costRedrive = createAuthoritativeCostRedriveSweep\(\{[\s\S]*notifier: createHubStuckChargeNotifier\(/);
  });
});
