// server/src/services/job-reconciliation.ts
//
// JOB-006 — the reaper/reconciliation service + the durable cancellation entrypoint.
//
// This is SERVER authority (operator/system), not a worker-fenced path. It runs the
// two convergence transactions inside `runInTenant`:
//
//   * requestCancellation — marks the requested state and queues ONE monotonically-
//     sequenced E1 cancel command bound to the current lease fence (idempotent per
//     lease). The worker learns of it on renew and through the control-ACK path.
//
//   * reapOrganization — the reaper. Under the authoritative job/attempt/lease locks
//     it PERMANENTLY revokes each expired lease's fence and converges the work to
//     exactly one of: a NEW retry attempt (attempt N+1 + its attempt-ready outbox
//     row, immutable backoff), a terminal result (succeeded/cancelled finalized), or
//     a dead-letter (retry exhausted). Bounded batch; every step is idempotent so a
//     duplicate sweep is a no-op and two concurrent creators still produce one N+1
//     attempt + one ready row (the tenant repository's job-lock + unique constraints).
//
// A late result from a disconnected worker can NEVER overwrite the winner: its fence
// is revoked, so the guarded mutators reject it as stale_fence. Reviving an expired
// fence is a non-goal — retry always mints a NEW attempt/fence (CAV-003).
//
// Ordering (cancel/expire/retry winner) inline comments live in the tenant repository
// (`repositories/tenant/job-control.ts`), the sole locker of the authoritative rows.

import { randomUUID } from "node:crypto";
import type {
  CancellationOutcome,
  Db,
  ReapExpiredLeasesResult,
} from "@armyofagents/db";
import { runInTenant } from "../db/tenant-context.js";

/** Server retry backoff policy. The reaper writes an immutable per-attempt backoff
 * (exponential: base * 2^(N-1), capped at max) so retry N+1 is not dispatched before
 * it. Both bounds are configurable; the defaults are conservative. */
export const DEFAULT_RETRY_BASE_BACKOFF_MS = 5_000;
export const DEFAULT_RETRY_MAX_BACKOFF_MS = 300_000;
/** Bounded reaper batch per organization tick (mirrors the outbox worker's bound). */
export const DEFAULT_REAP_BATCH_LIMIT = 32;

export interface RequestCancellationServiceInput {
  organizationId: string;
  companyId: string;
  jobId: string;
  reason: string;
  graceful: boolean;
  /** Optional stable command id for an idempotent retry of the SAME cancellation. */
  commandId?: string;
}

export interface JobReconciliationService {
  requestCancellation(input: RequestCancellationServiceInput): Promise<CancellationOutcome>;
  reapOrganization(
    organizationId: string,
    options?: { limit?: number },
  ): Promise<ReapExpiredLeasesResult>;
}

export function createJobReconciliationService(input: {
  appDb: Db;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  reapBatchLimit?: number;
}): JobReconciliationService {
  const baseBackoffMs = Math.max(0, Math.floor(input.baseBackoffMs ?? DEFAULT_RETRY_BASE_BACKOFF_MS));
  const maxBackoffMs = Math.max(
    baseBackoffMs,
    Math.floor(input.maxBackoffMs ?? DEFAULT_RETRY_MAX_BACKOFF_MS),
  );
  const reapBatchLimit = Math.max(1, Math.min(128, Math.floor(input.reapBatchLimit ?? DEFAULT_REAP_BATCH_LIMIT)));

  return {
    async requestCancellation(cancelInput) {
      return runInTenant(input.appDb, cancelInput.organizationId, async (repos) => {
        const now = await repos.jobControl.currentDatabaseTime();
        return repos.jobControl.requestCancellation({
          organizationId: cancelInput.organizationId,
          companyId: cancelInput.companyId,
          jobId: cancelInput.jobId,
          reason: cancelInput.reason,
          graceful: cancelInput.graceful,
          commandId: cancelInput.commandId ?? randomUUID(),
          now,
        });
      });
    },

    async reapOrganization(organizationId, options) {
      const limit = Math.max(1, Math.min(128, Math.floor(options?.limit ?? reapBatchLimit)));
      return runInTenant(input.appDb, organizationId, async (repos) => {
        // A FRESH database clock anchors the immutable backoff (never JavaScript time).
        const now = await repos.jobControl.currentDatabaseTime();
        return repos.jobControl.reapExpiredLeases({
          organizationId,
          now,
          limit,
          baseBackoffMs,
          maxBackoffMs,
        });
      });
    },
  };
}
