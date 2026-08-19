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

export interface RunExecutionOwnerDeps {
  resolveRunRolloutState(input: {
    organizationId: string;
    workloadType: string;
  }): RunRolloutState;
  preflight: CanaryPreflight;
  convert: JobConvertOrchestrator;
  placement: RunExecutionPlacement;
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

export interface RunExecutionOwnerResolver {
  resolve(input: {
    source: SubmitJobSource;
    actor: BridgeActor;
    organizationId: string;
    workloadType: string;
    idempotencyKey: string;
    jobInput?: Record<string, unknown>;
  }): Promise<RunExecutionOwner>;
}

function legacy(reason: LegacyOwnerReason, detail?: string): RunExecutionOwner {
  return { owner: "legacy", reason, detail };
}

export function createRunExecutionOwnerResolver(
  deps: RunExecutionOwnerDeps,
): RunExecutionOwnerResolver {
  const { resolveRunRolloutState, preflight, convert, placement } = deps;

  return {
    async resolve({ source, actor, organizationId, workloadType, idempotencyKey, jobInput }) {
      try {
        // 1. Canary only. A non-canary run does not even consult the gate — no
        //    extra query, no behavioral difference (Invariant 4).
        const state = resolveRunRolloutState({ organizationId, workloadType });
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
          return legacy("convert_failed", `convert reason ${converted.reason}`);
        }

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
          return legacy(
            "placement_not_leasable",
            `placement disposition ${decision.disposition}, leaseEligible ${String(decision.leaseEligible)}`,
          );
        }

        return { owner: "distributed", jobId, attemptId };
      } catch (error) {
        // Fail safe. The run still executes — on the legacy path.
        return legacy(
          "transfer_error",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  };
}
