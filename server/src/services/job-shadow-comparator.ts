// server/src/services/job-shadow-comparator.ts
//
// CLI-005 (D2) — the effect-free shadow comparator.
//
// When a heartbeat run resolves to `shadow`, this service COMPUTES the would-be
// distributed intent for the run and DIFFS it against the legacy run's actual
// routing / provenance / policy — with NO durable submission. By construction it:
//
//   * writes NO `jobs` / `job_attempts` row (it is handed no Db/tx — it cannot),
//   * drives NO checkout, claims NO capacity, holds NO lease,
//   * emits NO `cost_events` / `activity_log` / run-summary,
//   * NEVER throws into the legacy run (every compute + sink write is wrapped).
//
// Its only output is a comparison record on an injected observable sink (in prod: the
// `job_trace_log` pino spine + count-only metrics). This is the primitive that makes
// Invariant 2 hold structurally, and its diff is Invariant 8's assertion.
//
// The would-be placement decision is NON-LEASABLE by construction: shadow-mode
// `decideJobPlacement` sets `leaseEligible = mode === "active"` → always false for
// shadow (proven against the pure primitive in job-placement.property.test.ts and the
// comparator test). We therefore record the structural shadow lease-eligibility here
// without persisting anything (the pure placement DECISION never touches the DB, but
// the shadow comparator additionally avoids constructing worker candidates — it only
// needs the diff-stable lease-eligibility + reason).

import type { SubmitJobSource } from "@armyofagents/shared";
import { batchWorkloadV1Schema, type BatchWorkloadV1 } from "@armyofagents/worker-protocol";

/**
 * A snapshot of the legacy run's ACTUAL resolved execution intent, captured at the
 * heartbeat seam AFTER routing/provenance/policy resolution. The comparator treats it as
 * read-only data; it never re-resolves anything against the database.
 */
export interface LegacyRunExecutionSnapshot {
  readonly organizationId: string;
  readonly companyId: string;
  readonly runId: string;
  readonly issueId: string;
  readonly assigneeAgentId: string;
  /** The distributed workload type this run maps to (task_run → "batch"). */
  readonly workloadType: string;
  readonly routing: { readonly executionTargetType: string };
  readonly provenance: {
    readonly executionPrincipalKind: string;
    readonly credentialKind: string | null;
  };
  readonly policy: {
    readonly model: string | null;
    readonly budgetPolicyId: string | null;
    readonly effectiveCompletionPolicy: string;
  };
  /**
   * O7 characterization of the batch workload the run would submit. Faithful,
   * worker-executable synthesis is refined at MIG-002; shadow only needs a diff-stable
   * mapping, validated against the frozen `batchWorkloadV1Schema`.
   */
  readonly workloadCharacterization: {
    readonly command: string;
    readonly args: string[];
    readonly maxRuntimeSeconds: number;
    readonly stdinArtifactId: string | null;
  };
}

/** The distributed-intent projection the comparator diffs against the legacy snapshot. */
export interface DistributedIntentProjection {
  readonly routing: { readonly executionTargetType: string };
  readonly provenance: {
    readonly executionPrincipalKind: string;
    readonly credentialKind: string | null;
  };
  readonly policy: {
    readonly model: string | null;
    readonly budgetPolicyId: string | null;
    readonly effectiveCompletionPolicy: string;
  };
}

export interface ShadowComparisonResult {
  readonly organizationId: string;
  readonly companyId: string;
  readonly runId: string;
  readonly issueId: string;
  readonly mode: "shadow";
  readonly match: boolean;
  readonly mismatchedFields: string[];
  readonly wouldBeSource: SubmitJobSource;
  readonly wouldBeWorkload: BatchWorkloadV1 | null;
  readonly workloadValid: boolean;
  /** Structurally false for shadow (leaseEligible = mode === "active"). */
  readonly placementLeaseEligible: boolean;
  readonly placementReasonCode: string;
  /** Read-only admissibility probe result, if the caller supplied one; else null. */
  readonly admissible: boolean | null;
  /** True iff the best-effort compute threw (the failure is recorded, never propagated). */
  readonly errored: boolean;
}

export interface ShadowComparisonSink {
  record(result: ShadowComparisonResult): void;
}

/**
 * The faithful (identity) mapping from the run's actuals to the distributed intent. A
 * correct CLI-005 mapping is diff-clean because active-mode jobs are inert and the
 * legacy path stays the executor — the distributed intent is DERIVED from the same
 * resolved config, so it must equal the legacy snapshot. A divergence is a mapping bug.
 */
export function identityDistributedIntent(
  snapshot: LegacyRunExecutionSnapshot,
): DistributedIntentProjection {
  return {
    routing: { executionTargetType: snapshot.routing.executionTargetType },
    provenance: {
      executionPrincipalKind: snapshot.provenance.executionPrincipalKind,
      credentialKind: snapshot.provenance.credentialKind,
    },
    policy: {
      model: snapshot.policy.model,
      budgetPolicyId: snapshot.policy.budgetPolicyId,
      effectiveCompletionPolicy: snapshot.policy.effectiveCompletionPolicy,
    },
  };
}

function diffIntent(
  snapshot: LegacyRunExecutionSnapshot,
  intent: DistributedIntentProjection,
): string[] {
  const mismatched: string[] = [];
  if (snapshot.routing.executionTargetType !== intent.routing.executionTargetType) {
    mismatched.push("routing.executionTargetType");
  }
  if (snapshot.provenance.executionPrincipalKind !== intent.provenance.executionPrincipalKind) {
    mismatched.push("provenance.executionPrincipalKind");
  }
  if (snapshot.provenance.credentialKind !== intent.provenance.credentialKind) {
    mismatched.push("provenance.credentialKind");
  }
  if (snapshot.policy.model !== intent.policy.model) mismatched.push("policy.model");
  if (snapshot.policy.budgetPolicyId !== intent.policy.budgetPolicyId) {
    mismatched.push("policy.budgetPolicyId");
  }
  if (snapshot.policy.effectiveCompletionPolicy !== intent.policy.effectiveCompletionPolicy) {
    mismatched.push("policy.effectiveCompletionPolicy");
  }
  return mismatched;
}

export interface JobShadowComparator {
  compare(
    snapshot: LegacyRunExecutionSnapshot,
    options?: { admissible?: boolean | null },
  ): ShadowComparisonResult;
}

export function createJobShadowComparator(deps: {
  sink: ShadowComparisonSink;
  deriveDistributedIntent?: (snapshot: LegacyRunExecutionSnapshot) => DistributedIntentProjection;
}): JobShadowComparator {
  const derive = deps.deriveDistributedIntent ?? identityDistributedIntent;

  return {
    compare(snapshot, options = {}) {
      const wouldBeSource: SubmitJobSource = {
        kind: "task_run",
        runId: snapshot.runId,
        issueId: snapshot.issueId,
        assigneeAgentId: snapshot.assigneeAgentId,
      };
      const parsedWorkload = batchWorkloadV1Schema.safeParse({
        command: snapshot.workloadCharacterization.command,
        args: snapshot.workloadCharacterization.args,
        stdinArtifactId: snapshot.workloadCharacterization.stdinArtifactId,
        maxRuntimeSeconds: snapshot.workloadCharacterization.maxRuntimeSeconds,
      });

      let mismatchedFields: string[] = [];
      let match = false;
      let errored = false;
      try {
        const intent = derive(snapshot);
        mismatchedFields = diffIntent(snapshot, intent);
        match = mismatchedFields.length === 0;
      } catch {
        // A faulty mapping derivation must NEVER fail the legacy run. Record it as a
        // (non-matching) errored comparison and continue.
        errored = true;
        match = false;
        mismatchedFields = ["<derivation_error>"];
      }

      const result: ShadowComparisonResult = {
        organizationId: snapshot.organizationId,
        companyId: snapshot.companyId,
        runId: snapshot.runId,
        issueId: snapshot.issueId,
        mode: "shadow",
        match,
        mismatchedFields,
        wouldBeSource,
        wouldBeWorkload: parsedWorkload.success ? parsedWorkload.data : null,
        workloadValid: parsedWorkload.success,
        // Shadow placement is non-leasable by construction (see module header).
        placementLeaseEligible: false,
        placementReasonCode: "shadow_selected",
        admissible: options.admissible ?? null,
        errored,
      };

      try {
        deps.sink.record(result);
      } catch {
        // The sink is observability only; a sink failure never fails the run.
      }
      return result;
    },
  };
}
