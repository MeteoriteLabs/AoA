// server/src/services/run-execution-owner.ts
//
// CLI-006 (D3) — the SINGLE ownership decision.
//
// This is the crux of the ticket. CLI-006 is the first moment the distributed path
// can actually execute a run, so it is the first moment a *double execution* is
// possible. The mitigation is structural rather than test-only:
//
//   ONE function decides who executes, and BOTH consumers read that one value.
//
// The heartbeat stores the result; the legacy-suppression guard at
// `heartbeat.ts:5147` reads *that stored value* and never re-derives the condition.
// Two independent predicates could drift apart under a config change mid-run, a
// replayed convert, or a partial deployment; one value cannot.
//
// Invariant 1 — exactly one executor: `adapter.execute` runs XOR a leasable
// distributed attempt exists.
// Invariant 2 — the fail-safe direction is ALWAYS legacy: every short-circuit and
// every throw resolves to `{owner:"legacy", reason}`. Never "neither" (a silently
// dropped run), never "both".
//
// ORDERING IS LOAD-BEARING. Placement is the LAST step, because placement is what
// makes an attempt leasable. Nothing that can fail back to legacy may run after
// that point — otherwise the worker could lease an attempt for a run the heartbeat
// has already handed to the legacy adapter. A failure at or before placement leaves
// exactly CLI-005's proven inert state: a durable, non-leasable job with the legacy
// adapter as the sole executor.

import type { SubmitJobSource } from "@armyofagents/shared";
import type { BridgeActor } from "./job-admission-bridge.js";
import type { CanaryPreflight } from "./canary-preflight.js";
import type { JobConvertOrchestrator } from "./job-convert-orchestrator.js";
import type { RunRolloutState } from "../config/distributed-execution-rollout-source.js";

/** The minimal placement surface this decision needs (E3-owned service, injected). */
export interface RunExecutionPlacement {
  place(input: {
    jobId: string;
    attemptId: string;
    organizationId: string;
    companyId: string;
  }): Promise<{ disposition: string; leaseEligible?: boolean }>;
}

/**
 * Adapt the E3 placement SERVICE to {@link RunExecutionPlacement}.
 *
 * This adapter is MANDATORY, not stylistic. `JobPlacementServiceInput` additionally
 * requires `now` and `maxHeartbeatAgeMs`, which `RunExecutionPlacement.place` does
 * not supply. Because `place` is declared with method-shorthand syntax, TypeScript's
 * parameter bivariance lets a DIRECT assignment (`placement: placementService`)
 * compile with no error — and then hand `decideJobPlacement` `now: undefined` at
 * runtime, where it fails the `input.now instanceof Date` validation and returns
 * `invalid_placement_input`. Every canary transfer would silently fall back to
 * legacy with no type error anywhere.
 *
 * Verified: substituting the direct assignment in the composition root typechecks
 * clean. That is why this exists as a named, tested function rather than an inline
 * object literal a future refactor could "simplify" away.
 *
 * `DEFAULT_PLACEMENT_MAX_HEARTBEAT_AGE_MS` matches the established sibling default
 * (`job-control-ack.ts`, `artifact-commit.ts`, `artifact-transfer-grant.ts`).
 */
export const DEFAULT_PLACEMENT_MAX_HEARTBEAT_AGE_MS = 300_000;

export function toRunExecutionPlacement(
  service: {
    place(input: Record<string, unknown>): Promise<{ disposition: string; leaseEligible?: boolean }>;
  },
  options?: { now?: () => Date; maxHeartbeatAgeMs?: number },
): RunExecutionPlacement {
  const now = options?.now ?? (() => new Date());
  const maxHeartbeatAgeMs = options?.maxHeartbeatAgeMs ?? DEFAULT_PLACEMENT_MAX_HEARTBEAT_AGE_MS;
  return {
    place: (input) => service.place({ ...input, now: now(), maxHeartbeatAgeMs }),
  };
}

export interface RunExecutionOwnerDeps {
  resolveRunRolloutState(input: {
    organizationId: string;
    workloadType: string;
  }): RunRolloutState;
  preflight: CanaryPreflight;
  convert: JobConvertOrchestrator;
  placement: RunExecutionPlacement;
  /**
   * Release the org concurrency slot the CONVERT claimed, when the run ends up legacy anyway.
   *
   * The convert's submit claims a slot (`job-submission.ts` -> `admitAttemptCapacity`, which
   * sets `job_attempts.capacity_claim_state = 'held'`). If placement then declines — a NORMAL
   * outcome: no worker enrolled yet, requirements mismatch, capacity — the attempt is inert
   * forever: never leased, so never terminalized, so never released by the attempt-terminal or
   * cancel-finalize paths, and the lease reaper that would catch it has no production caller.
   *
   * The org's cap counts `capacity_claim_state = 'held'`, and the LEGACY heartbeat claims
   * against that same budget, so each leaked slot permanently throttles the Organization's
   * ordinary work. Arming a canary before enrolling a worker leaks one per run.
   *
   * Optional: a deployment that has not composed it behaves exactly as before.
   */
  releaseCapacity?(input: { attemptId: string; organizationId: string }): Promise<unknown>;
}

export type LegacyOwnerReason =
  /** Not a canary Organization/workload — the overwhelmingly common case. */
  | "rollout_not_canary"
  /** MIG-008 reconciliation / credential authority is not complete (D2). */
  | "preflight_refused"
  /** No durable job was produced, so there is nothing to place. */
  | "convert_failed"
  /** A job exists but never became leasable — the CLI-005 inert state. */
  | "placement_not_leasable"
  /** Something threw. An unreadable decision is a legacy decision. */
  | "transfer_error";

export type RunExecutionOwner =
  | { readonly owner: "distributed"; readonly jobId: string; readonly attemptId: string }
  | { readonly owner: "legacy"; readonly reason: LegacyOwnerReason; readonly detail?: string };

/**
 * CLI-006 (D4) — the suppression predicate. The seam reads THIS, never a
 * re-derivation of the canary condition: Invariant 1 is that one value is
 * computed once and every consumer reads it, so placement and suppression cannot
 * disagree.
 *
 * `null`/`undefined` means no decision was made — the overwhelmingly common
 * non-canary case, and also what a partially-deployed control plane sees. Absence
 * reads as legacy, which is what makes the safe default structural rather than
 * remembered (D4).
 */
export function shouldSuppressLegacyExecution(
  owner: RunExecutionOwner | null | undefined,
): boolean {
  return owner?.owner === "distributed";
}

/**
 * The durable handoff marker for a run whose execution transferred.
 *
 * Deliberately does NOT touch `status`. The attempt is the terminal authority
 * from here on; latching a terminal at handoff time would make the projector's
 * later terminal a no-op and throw away the distributed evidence.
 *
 * Throws on a legacy decision rather than returning a partial patch. The marker
 * is what the reaper, the five cancel writers, and the projector all read to
 * learn the attempt owns this run — writing it for a run the legacy adapter is
 * about to execute strands that run permanently: the reaper stands down, cancel
 * routes to a job that never terminalizes, and nothing finalizes it.
 */
export function buildHandoffRunPatch(
  owner: RunExecutionOwner,
  now: Date,
): {
  executionOwner: "distributed";
  distributedJobId: string;
  distributedAttemptId: string;
  updatedAt: Date;
} {
  if (owner.owner !== "distributed") {
    throw new Error(
      `buildHandoffRunPatch requires a distributed owner; refusing to mark a legacy run (reason=${owner.reason})`,
    );
  }
  return {
    executionOwner: "distributed",
    distributedJobId: owner.jobId,
    distributedAttemptId: owner.attemptId,
    updatedAt: now,
  };
}

export interface RunExecutionOwnerResolver {
  resolve(input: {
    source: SubmitJobSource;
    actor: BridgeActor;
    organizationId: string;
    workloadType: string;
    idempotencyKey: string;
    jobInput?: Record<string, unknown>;
    /**
     * The rollout state, when the caller has ALREADY resolved it for this run.
     * The heartbeat seam resolves it once (to choose between CLI-005's inert
     * convert and the canary transfer) and passes it here, so the predicate is
     * derived exactly once per run rather than twice. Omitted → derived here.
     */
    rolloutState?: RunRolloutState;
  }): Promise<RunExecutionOwner>;
}

function legacy(reason: LegacyOwnerReason, detail?: string): RunExecutionOwner {
  return { owner: "legacy", reason, detail };
}

export function createRunExecutionOwnerResolver(
  deps: RunExecutionOwnerDeps,
): RunExecutionOwnerResolver {
  const { resolveRunRolloutState, preflight, convert, placement, releaseCapacity } = deps;

  return {
    async resolve({
      source,
      actor,
      organizationId,
      workloadType,
      idempotencyKey,
      jobInput,
      rolloutState,
    }) {
      // Set once the convert has claimed a capacity slot, so every later legacy exit — the
      // placement decline AND the catch-all — can hand it back. Declared out here because the
      // catch cannot see the try's block scope, the same reason `outcomeAgentName` exists in
      // the heartbeat runner.
      let claimedAttemptId: string | null = null;
      /** Best-effort: the ownership decision is already made and must not change. */
      const releaseClaimedCapacity = async (): Promise<void> => {
        if (!claimedAttemptId || !releaseCapacity) return;
        try {
          await releaseCapacity({ attemptId: claimedAttemptId, organizationId });
        } catch {
          // A capacity-table hiccup must never fail a run that is already going to legacy.
        }
      };
      try {
        // 1. Canary only. A non-canary run does not even consult the gate — no
        //    extra query, no behavioral difference (Invariant 4). The caller may
        //    hand in the state it already resolved so the predicate is derived
        //    exactly once per run.
        const state = rolloutState ?? resolveRunRolloutState({ organizationId, workloadType });
        if (state !== "canary") {
          return legacy("rollout_not_canary", `rollout state is ${state}`);
        }

        // 2. MIG-008 preflight. Nothing may become leasable behind a refused gate.
        const gate = await preflight.check({ organizationId });
        if (!gate.ok) {
          return legacy("preflight_refused", `${gate.reason}: ${gate.detail}`);
        }

        // 3. Durable convert (CLI-005). Produces the job↔run identity to place.
        const converted = await convert.convertRunToJob({
          source,
          actor,
          idempotencyKey,
          input: jobInput,
        });
        const jobId = converted.response?.jobId;
        const attemptId = converted.response?.attemptId;
        if (!converted.converted || !jobId || !attemptId) {
          // No attempt, so no slot was claimed — nothing to release.
          return legacy("convert_failed", `convert reason ${converted.reason}`);
        }
        claimedAttemptId = attemptId;

        // 4. Placement — LAST, because it is what makes the attempt leasable.
        //    A `canary` Organization is presented to placement as `active`
        //    (see distributed-execution-rollout-source.ts), which is what yields
        //    `leaseEligible: true` without editing the E3-owned placement module.
        const decision = await placement.place({
          jobId,
          attemptId,
          organizationId,
          companyId: actor.companyId,
        });
        if (decision.disposition !== "selected" || decision.leaseEligible !== true) {
          // The run goes legacy, so the slot this convert claimed must go back — otherwise the
          // inert attempt throttles the Organization's legacy work forever.
          await releaseClaimedCapacity();
          return legacy(
            "placement_not_leasable",
            `placement disposition ${decision.disposition}, leaseEligible ${String(decision.leaseEligible)}`,
          );
        }

        // Selected and leasable: the attempt WILL execute, so it keeps its slot. Releasing here
        // would let the Organization over-subscribe its cap — the inverse defect, and worse.
        return { owner: "distributed", jobId, attemptId };
      } catch (error) {
        // Fail safe. The run still executes — on the legacy path. If the convert had already
        // claimed a slot before the throw, hand it back for the same reason as above.
        await releaseClaimedCapacity();
        return legacy(
          "transfer_error",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  };
}
