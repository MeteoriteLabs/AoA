// DE-04 + DE-18, audit clauses — the governed-fence denial audit, end to end against real
// embedded PostgreSQL under the non-owner `aoa_app` role.
//
// Drives the REAL wired governed mutator `completeAttempt` (job-control.ts), whose
// `guardActiveFence` (job-fence.ts `classifyFence`) is the ONE fence chokepoint, through its
// REAL service owner `jobOutputBridge.projectTerminalWinner` — the SAME path a worker's
// terminal-winner submission takes. NOT a re-implementation (D7): the drain under test is the
// `.catch` this unit added to that owner, and the row it writes is
// `recordSecurityDenial` → `activity_log`.
//
// Each of the three closed refusal codes is provoked through the real mutator:
//   * stale_fence      → the fence's lease ROW is deleted (a superseded/never-issued fence).
//   * target_revoked   → the target's live device_generation is bumped past the lease's pin.
//   * attempt_terminal → a genuine LOSER submits a terminal winner for an already-terminal
//                        attempt (a DIFFERENT terminal event, so no receipt replays it).
// The POSITIVE CONTROL (a genuine winner SUCCEEDS and writes NO denial row) kills the
// "record on the success path" mutant; the per-case reason/crossing assertions kill the
// "stamp a constant reason" mutant; and the actor assertion (`actor_id = workerId`, never the
// organization) kills the "attribute to the tenant" mutant. Deleting the drain leaves every
// refusal case with ZERO rows — observed RED-first.
//
// Windows CI can't start embedded-postgres on the runneradmin runner (Issue #114) — gated;
// opt in with AOA_RUN_WIN_INTEGRATION=1. The Linux `verify` gate runs it unconditionally.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SubmitJobSource } from "@armyofagents/shared";
import type { ActiveFenceRequest } from "@armyofagents/db";
import {
  setupJobControlFixture,
  COMPANY,
  ORG,
  TARGET,
  WORKER,
  type JobControlFixture,
} from "./helpers/job-control-fixture.js";
import { jobOutputBridge, type BridgeActor } from "../services/job-output-bridge.js";

const ENABLED_ENV = { AOA_DISTRIBUTED_EXECUTION_ENABLED: "true" } as const;
const USER = "de0418-user";
const DIGEST = "d".repeat(64);
const actor: BridgeActor = { kind: "user", id: USER, companyId: COMPANY };
// A null-issue source: the terminal winner still runs completeAttempt and replay-guards via a
// job_attempts receipt, but skips the run-summary comment, so no issue/agent row is needed.
const SOURCE: SubmitJobSource = { kind: "one_shot", operationId: randomUUID(), operationKind: "extraction" };

let fixture: JobControlFixture | null = null;
let setupError: unknown = null;

function bridge() {
  return jobOutputBridge(fixture!.app.db, { env: ENABLED_ENV });
}
function guard(): void {
  if (setupError) throw new Error(`fixture setup failed: ${String(setupError)}`);
}

interface DenialRow {
  company_id: string | null;
  organization_id: string | null;
  actor_type: string;
  actor_id: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown>;
}

async function fenceGuardRows(): Promise<DenialRow[]> {
  return (await fixture!.admin`
    SELECT company_id, organization_id, actor_type, actor_id, entity_type, entity_id, details
    FROM activity_log WHERE action = 'security.denied.fence_guard'
    ORDER BY created_at ASC
  `) as unknown as DenialRow[];
}

function winnerInput(fence: ActiveFenceRequest, terminalEventId = randomUUID()) {
  return {
    source: SOURCE,
    actor,
    fence,
    terminalEventId,
    eventDigest: DIGEST,
    attemptTerminalStatus: "succeeded" as const,
    summaryOutcome: "succeeded" as const,
    issueId: null,
  };
}

beforeAll(async () => {
  try {
    fixture = await setupJobControlFixture("de0418-fence");
  } catch (error) {
    setupError = error;
  }
}, 180_000);

afterAll(async () => {
  await fixture?.teardown().catch(() => {});
}, 60_000);

beforeEach(async () => {
  if (!fixture) return;
  // Isolate each case: the denial namespace is the unit under test.
  await fixture.admin`DELETE FROM activity_log WHERE action = 'security.denied.fence_guard'`;
});

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "DE-04 + DE-18 governed-fence denial audit (real completeAttempt / jobOutputBridge)",
  () => {
    it("POSITIVE CONTROL: a genuine winner SUCCEEDS and writes NO fence_guard row", async () => {
      guard();
      const { identity } = await fixture!.activateLease(4_101);
      const out = await bridge().projectTerminalWinner(winnerInput(identity));
      expect(out.status).toBe("recorded");
      expect(await fenceGuardRows()).toHaveLength(0);
    }, 90_000);

    it("stale_fence → DE-04: a fence whose lease row is gone is refused and audited", async () => {
      guard();
      const { identity } = await fixture!.activateLease(4_102);
      // The lease no longer exists — guardActiveFence's locked read finds no row.
      await fixture!.admin`DELETE FROM leases WHERE id = ${identity.leaseId}`;
      await expect(bridge().projectTerminalWinner(winnerInput(identity))).rejects.toMatchObject({
        code: "stale_fence",
      });

      const rows = await fenceGuardRows();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.details.reason).toBe("stale_fence");
      expect(row.details.crossing).toBe("DE-04");
      // WHO is the refused WORKER, never the tenant (kills the actor=org mutant).
      expect(row.actor_type).toBe("system");
      expect(row.actor_id).toBe(WORKER);
      expect(row.actor_id).not.toBe(ORG);
      // Company-scoped attribution — both axes present.
      expect(row.company_id).toBe(COMPANY);
      expect(row.organization_id).toBe(ORG);
      expect(row.entity_type).toBe("job_lease");
      expect(row.entity_id).toBe(identity.leaseId);
      expect(row.details.operation).toBe("attempt_complete");
    }, 90_000);

    it("target_revoked → DE-18: a fence pinned to a superseded target generation is refused and audited", async () => {
      guard();
      const { identity } = await fixture!.activateLease(4_103);
      // A re-enrollment bumps the live device generation past the one the lease pinned.
      await fixture!.admin`UPDATE execution_targets SET device_generation = 2 WHERE id = ${TARGET}`;
      await expect(bridge().projectTerminalWinner(winnerInput(identity))).rejects.toMatchObject({
        code: "target_revoked",
      });

      const rows = await fenceGuardRows();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.details.reason).toBe("target_revoked");
      // target_revoked is DE-18's fence arm, NOT DE-04.
      expect(row.details.crossing).toBe("DE-18");
      expect(row.actor_type).toBe("system");
      expect(row.actor_id).toBe(WORKER);
      expect(row.company_id).toBe(COMPANY);
      expect(row.organization_id).toBe(ORG);
      expect(row.details.targetGeneration).toBe(identity.targetGeneration);
    } , 90_000);

    it("attempt_terminal → DE-04: a genuine loser on an already-terminal attempt is refused and audited", async () => {
      guard();
      const { identity } = await fixture!.activateLease(4_104);
      // A genuine winner terminates the attempt first (writes its own receipt, NO denial).
      const winner = await bridge().projectTerminalWinner(winnerInput(identity, randomUUID()));
      expect(winner.status).toBe("recorded");
      expect(await fenceGuardRows()).toHaveLength(0);
      // A DIFFERENT terminal event on the now-terminal attempt: guardActiveFence classifies
      // attempt_terminal, no receipt replays this event, so it is a genuine loser and throws.
      await expect(bridge().projectTerminalWinner(winnerInput(identity, randomUUID()))).rejects.toMatchObject({
        code: "attempt_terminal",
      });

      const rows = await fenceGuardRows();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.details.reason).toBe("attempt_terminal");
      expect(row.details.crossing).toBe("DE-04");
      expect(row.actor_id).toBe(WORKER);
      expect(row.company_id).toBe(COMPANY);
    }, 90_000);

    it("a benign winner-REPLAY (same terminal event) is NOT recorded as a denial", async () => {
      guard();
      const { identity } = await fixture!.activateLease(4_105);
      const terminalEventId = randomUUID();
      const first = await bridge().projectTerminalWinner(winnerInput(identity, terminalEventId));
      expect(first.status).toBe("recorded");
      // Same terminal event: the receipt replays it — a legitimate retry, not a refusal.
      const second = await bridge().projectTerminalWinner(winnerInput(identity, terminalEventId));
      expect(second.status).toBe("replayed");
      expect(await fenceGuardRows()).toHaveLength(0);
    }, 90_000);
  },
);
