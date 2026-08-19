// server/src/services/job-distributed-drain.ts
//
// CLI-005 (D4) — the flag-disable drain: the per-org active-attempt iterator that,
// on disable/rollback, cancels every non-terminal distributed attempt so no active
// attempt is left executing (or executable) after the rollout is turned off.
//
// It reuses the org enumerator (`listAdmittedOrganizationIds`, index.ts) and, per org,
// enumerates the non-terminal attempts and cancels each ONE-BY-ONE through the
// fence-revoking `requestCancellation` (JOB-006). It is NOT a bulk UPDATE: a late worker
// result for a revoked fence is rejected `stale_fence` by the guarded mutators.
//
// Rollback safety (Invariant 6/7): before draining an org it consults `assertRollbackSafe`
// — if an authoritative-cost receipt is still pending for the org, that org's drain step
// is REFUSED (skipped), so a committed charge can never be erased by the disable pass.
//
// Given the static flag model, disable is env+restart-driven with this explicit drain
// pass at teardown/admin trigger (a runtime toggle that drains without a bounce is a
// documented follow-up).

import type {
  CancellationOutcome,
  CancellationStatus,
} from "@armyofagents/db";

/** One non-terminal distributed attempt to cancel, keyed by its job identity. */
export interface DistributedExecutionActiveAttempt {
  readonly organizationId: string;
  readonly companyId: string;
  readonly jobId: string;
}

export interface DistributedExecutionDrainDeps {
  /** Page through admitted organizations (reuses index.ts:listAdmittedOrganizationIds). */
  listAdmittedOrganizationIds(input: {
    afterOrganizationId: string | null;
    limit: number;
    statementTimeoutMs: number;
  }): Promise<string[]>;
  /** Enumerate the non-terminal attempts for ONE org (the missing per-org iterator). */
  listActiveAttempts(organizationId: string): Promise<DistributedExecutionActiveAttempt[]>;
  /** Fence-revoking graceful cancel of ONE job (JOB-006 requestCancellation). */
  requestCancellation(input: {
    organizationId: string;
    companyId: string;
    jobId: string;
    reason: string;
    graceful: boolean;
  }): Promise<CancellationOutcome>;
  /** Refuse (throw) the org's drain step while an authoritative-cost receipt is pending. */
  assertRollbackSafe(organizationId: string): Promise<void>;
}

export interface DistributedExecutionDrainResult {
  readonly organizationsScanned: number;
  readonly cancelled: number;
  readonly skippedOrganizations: string[];
  readonly perOrganization: Array<{
    readonly organizationId: string;
    readonly skipped: boolean;
    readonly reason?: string;
    readonly cancelled: number;
  }>;
}

export interface DistributedExecutionDrain {
  drainAll(options?: {
    pageSize?: number;
    statementTimeoutMs?: number;
    reason?: string;
  }): Promise<DistributedExecutionDrainResult>;
}

/** A cancellation request that reached a requested/cancelled state counts as drained.
 * `not_found` / `job_terminal` are already-terminal → nothing to drain. */
const DRAINED_STATUSES: ReadonlySet<CancellationStatus> = new Set<CancellationStatus>([
  "queued",
  "already_requested",
  "cancelled",
  "no_active_lease",
]);

const DEFAULT_PAGE_SIZE = 32;
const DEFAULT_STATEMENT_TIMEOUT_MS = 750;
const DEFAULT_REASON = "distributed_execution_disabled";

export function createDistributedExecutionDrain(
  deps: DistributedExecutionDrainDeps,
): DistributedExecutionDrain {
  return {
    async drainAll(options = {}) {
      const pageSize = Math.max(1, Math.min(32, Math.floor(options.pageSize ?? DEFAULT_PAGE_SIZE)));
      const statementTimeoutMs = Math.max(
        1,
        Math.min(750, Math.floor(options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS)),
      );
      const reason = options.reason ?? DEFAULT_REASON;

      let afterOrganizationId: string | null = null;
      let organizationsScanned = 0;
      let cancelled = 0;
      const skippedOrganizations: string[] = [];
      const perOrganization: DistributedExecutionDrainResult["perOrganization"] = [];

      for (;;) {
        const organizationIds = await deps.listAdmittedOrganizationIds({
          afterOrganizationId,
          limit: pageSize,
          statementTimeoutMs,
        });
        if (organizationIds.length === 0) break;

        for (const organizationId of organizationIds) {
          organizationsScanned += 1;

          // Rollback-safety gate: an org with a pending authoritative-cost receipt is
          // refused — do NOT enumerate or cancel any of its attempts.
          try {
            await deps.assertRollbackSafe(organizationId);
          } catch {
            skippedOrganizations.push(organizationId);
            perOrganization.push({
              organizationId,
              skipped: true,
              reason: "rollback_pending",
              cancelled: 0,
            });
            continue;
          }

          // Enumeration + per-attempt cancellation are wrapped so a single transient
          // failure (statement timeout, tenant-resolution error) skips that attempt/org
          // and the sweep CONTINUES to the rest — it never aborts mid-fleet. Mirrors the
          // assertRollbackSafe skip-and-continue above. requestCancellation is idempotent,
          // so a later drain re-run resumes past already-terminal attempts.
          let attempts: DistributedExecutionActiveAttempt[];
          try {
            attempts = await deps.listActiveAttempts(organizationId);
          } catch {
            perOrganization.push({ organizationId, skipped: true, reason: "enumerate_error", cancelled: 0 });
            continue;
          }
          let orgCancelled = 0;
          for (const attempt of attempts) {
            try {
              const outcome = await deps.requestCancellation({
                organizationId: attempt.organizationId,
                companyId: attempt.companyId,
                jobId: attempt.jobId,
                reason,
                graceful: true,
              });
              if (DRAINED_STATUSES.has(outcome.status)) {
                orgCancelled += 1;
                cancelled += 1;
              }
            } catch {
              // This attempt could not be cancelled now (transient) — leave it for the next
              // drain pass and continue; a surviving non-leasable attempt causes no effect.
            }
          }
          perOrganization.push({ organizationId, skipped: false, cancelled: orgCancelled });
        }

        // Advance the cursor; termination is an EMPTY page (not a short page), so a
        // full final page still triggers one more empty-returning probe.
        afterOrganizationId = organizationIds[organizationIds.length - 1]!;
      }

      return { organizationsScanned, cancelled, skippedOrganizations, perOrganization };
    },
  };
}
