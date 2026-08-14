// server/src/services/job-control-sweeper.ts
//
// JOB-006 — the bounded reconciliation sweeper.
//
// A process-local driver over {@link JobReconciliationService.reapOrganization}. It
// mirrors the JOB-001 outbox worker's discipline:
//
//   * ONE in-flight tick per process — a re-entrant `tick()` returns the running
//     promise, so overlapping timers never double-sweep.
//   * BOUNDED batches — at most `maxOrganizationShards` organizations per tick and a
//     bounded reaper batch per organization, with a fair rotating cursor and a wall-
//     clock tick budget so one busy shard can never starve the rotation.
//   * BACKOFF — `nextDelayMs()` returns a short delay after a productive tick and a
//     longer idle delay after an empty one, so a quiet instance sweeps cheaply.
//   * FLAG-OFF STOPS IT — when `enabled` is false, `tick()` is a no-op returning zero
//     counts and touches no database, so the distributed-execution flag gates the
//     whole reaper.
//
// It holds no lease authority and never revokes a fence itself — every convergence
// happens inside the tenant repository's authoritative locks via the reconciliation
// service.

import type { JobReconciliationService } from "./job-reconciliation.js";

export interface AdmittedOrganizationPage {
  afterOrganizationId: string | null;
  limit: number;
}

export interface JobControlSweeperTickResult {
  organizations: number;
  scanned: number;
  revoked: number;
  retried: number;
  deadLettered: number;
  cancelled: number;
  finalized: number;
}

const ZERO_TICK: JobControlSweeperTickResult = {
  organizations: 0, scanned: 0, revoked: 0, retried: 0, deadLettered: 0, cancelled: 0, finalized: 0,
};

export interface JobControlSweeper {
  tick(): Promise<JobControlSweeperTickResult>;
  nextDelayMs(result: JobControlSweeperTickResult): number;
}

export function createJobControlSweeper(input: {
  reconciliation: JobReconciliationService;
  listAdmittedOrganizationIds: (page: AdmittedOrganizationPage) => Promise<string[]>;
  enabled?: boolean;
  maxOrganizationShards?: number;
  reapBatchLimit?: number;
  tickBudgetMs?: number;
  idleDelayMs?: number;
  activeDelayMs?: number;
  monotonicNow?: () => number;
}): JobControlSweeper {
  const enabled = input.enabled ?? true;
  const maxOrganizations = Math.max(1, Math.min(64, Math.floor(input.maxOrganizationShards ?? 32)));
  const reapBatchLimit = Math.max(1, Math.min(128, Math.floor(input.reapBatchLimit ?? 32)));
  const tickBudgetMs = Math.max(1, Math.min(5_000, Math.floor(input.tickBudgetMs ?? 1_000)));
  const idleDelayMs = Math.max(1, Math.floor(input.idleDelayMs ?? 15_000));
  const activeDelayMs = Math.max(1, Math.floor(input.activeDelayMs ?? 1_000));
  const monotonicNow = input.monotonicNow ?? (() => performance.now());

  let cursor: string | null = null;
  let inFlight: Promise<JobControlSweeperTickResult> | null = null;

  function remaining(deadline: number): number {
    return Math.max(0, Math.floor(deadline - monotonicNow()));
  }

  async function admittedWindow(): Promise<string[]> {
    // Rotate from the cursor; wrap once from the head to fill the window fairly.
    const tail = [...new Set(await input.listAdmittedOrganizationIds({
      afterOrganizationId: cursor,
      limit: maxOrganizations,
    }))].sort().filter((id) => cursor === null || id > cursor).slice(0, maxOrganizations);
    if (cursor === null || tail.length >= maxOrganizations) return tail;
    const head = [...new Set(await input.listAdmittedOrganizationIds({
      afterOrganizationId: null,
      limit: maxOrganizations - tail.length,
    }))].sort();
    const seen = new Set(tail);
    return [...tail, ...head.filter((id) => !seen.has(id))].slice(0, maxOrganizations);
  }

  async function runTick(): Promise<JobControlSweeperTickResult> {
    if (!enabled) return { ...ZERO_TICK };
    const deadline = monotonicNow() + tickBudgetMs;
    const organizationIds = await admittedWindow();
    const result: JobControlSweeperTickResult = { ...ZERO_TICK };
    for (const organizationId of organizationIds) {
      if (remaining(deadline) < 1) break;
      // Cursor advances on admission (not completion) so a slow shard cannot pin the
      // rotation; the durable expiry claim is canonical, so a skipped shard retries.
      cursor = organizationId;
      const outcome = await input.reconciliation.reapOrganization(organizationId, {
        limit: reapBatchLimit,
      });
      result.organizations += 1;
      result.scanned += outcome.scanned;
      result.revoked += outcome.revoked;
      result.retried += outcome.retried;
      result.deadLettered += outcome.deadLettered;
      result.cancelled += outcome.cancelled;
      result.finalized += outcome.finalized;
    }
    return result;
  }

  return {
    tick() {
      if (inFlight) return inFlight;
      const current = runTick();
      inFlight = current;
      current.finally(() => {
        if (inFlight === current) inFlight = null;
      }).catch(() => {
        // The caller observes the original rejection; this only handles the promise
        // returned by finally so it cannot become an unhandled branch.
      });
      return current;
    },
    nextDelayMs(result) {
      return result.revoked > 0 ? activeDelayMs : idleDelayMs;
    },
  };
}
