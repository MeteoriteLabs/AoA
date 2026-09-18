// server/src/services/internal-agent/aoa-agents/crew-handoff-marker.ts
//
// MIG-006 slice 1 — the durable handoff marker for a CREW run whose execution transferred to a
// worker attempt. The crew analogue of heartbeat's CLI-006 marker write, extracted as a pure
// function so it is unit-testable independent of the runAoaAgent integration (the same reason
// `shouldSuppressLegacyExecution` and `resolveCrewDistributedGate` are named functions).

import { buildHandoffRunPatch, type RunExecutionOwner } from "../../run-execution-owner.js";

/**
 * Build the durable `internal_agent_runs` handoff marker for a distributed crew run.
 *
 * Reuses the proven pure `buildHandoffRunPatch` — which THROWS on a legacy owner (writing a
 * marker for a run the legacy adapter is about to execute would strand it: the reaper stands
 * down, cancel routes to a job that never terminalizes, and nothing finalizes it) — and strips
 * its `updatedAt` key, because `internal_agent_runs` has NO `updatedAt` column (only `createdAt`
 * / `completedAt`), unlike `heartbeat_runs`. Deliberately does NOT touch `status`: the attempt is
 * the terminal authority from here on, and latching a terminal at handoff time would make the
 * crew terminal projector's later terminal a no-op and throw away the distributed evidence.
 */
export function buildCrewHandoffMarkerPatch(
  owner: RunExecutionOwner,
  now: Date,
): {
  executionOwner: "distributed";
  distributedJobId: string;
  distributedAttemptId: string;
} {
  // STUB (RED phase): does NOT reuse buildHandoffRunPatch's throw-on-legacy, and does NOT strip
  // the `updatedAt` key internal_agent_runs cannot store. `crew-seam-suppression.test.ts` asserts
  // both; the GREEN commit delegates to buildHandoffRunPatch and strips `updatedAt`.
  return {
    executionOwner: "distributed",
    distributedJobId: owner.owner === "distributed" ? owner.jobId : "",
    distributedAttemptId: owner.owner === "distributed" ? owner.attemptId : "",
    updatedAt: now,
  } as { executionOwner: "distributed"; distributedJobId: string; distributedAttemptId: string };
}
