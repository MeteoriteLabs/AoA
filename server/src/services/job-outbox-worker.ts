import { randomUUID } from "node:crypto";
import type { Db } from "@armyofagents/db";
import { runInTenant } from "../db/tenant-context.js";
import type { JobReadyScheduler, JobReadySignal } from "./job-ready-scheduler.js";

export interface AdmittedOrganizationPageInput {
  afterOrganizationId: string | null;
  limit: number;
  statementTimeoutMs: number;
}

export interface JobOutboxTickResult {
  organizations: number;
  claimed: number;
  delivered: number;
}

function isStatementTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error
    && (error as { code?: unknown }).code === "57014";
}

export function createJobOutboxWorker(input: {
  appDb: Db;
  scheduler: JobReadyScheduler;
  listAdmittedOrganizationIds: (input: AdmittedOrganizationPageInput) => Promise<string[]>;
  publishHint?: (signal: JobReadySignal) => Promise<void>;
  visibilityTimeoutMs?: number;
  maxOrganizationShards?: number;
  maxRowsPerShard?: number;
  tickBudgetMs?: number;
  monotonicNow?: () => number;
}) {
  const maxOrganizations = Math.max(1, Math.min(32, Math.floor(input.maxOrganizationShards ?? 32)));
  const maxRows = Math.max(1, Math.min(128, Math.floor(input.maxRowsPerShard ?? 32)));
  const visibilityTimeoutMs = Math.max(1, Math.floor(input.visibilityTimeoutMs ?? 30_000));
  const tickBudgetMs = Math.max(1, Math.min(750, Math.floor(input.tickBudgetMs ?? 750)));
  const monotonicNow = input.monotonicNow ?? (() => performance.now());
  const publish = input.publishHint ?? (async (signal: JobReadySignal) => {
    if (!input.scheduler.signal(signal)) throw new Error("job_ready_scheduler_full");
  });
  type PendingClaim = {
    claimToken: string;
    rows: Array<{ id: string; organizationId: string; targetId: string }>;
  };
  // Retain only the current bounded rotation window. This permits prompt
  // same-process retry after publication rejection; eviction or process loss
  // is harmless because the durable visibility-timeout claim remains canonical.
  const pendingClaims = new Map<string, PendingClaim>();
  let cursor: string | null = null;
  let inFlight: Promise<JobOutboxTickResult> | null = null;

  function remainingBudget(deadline: number): number {
    return Math.max(0, Math.floor(deadline - monotonicNow()));
  }

  async function listPage(
    afterOrganizationId: string | null,
    limit: number,
    deadline: number,
  ): Promise<string[] | null> {
    const remaining = remainingBudget(deadline);
    if (remaining < 1) return null;
    const rows = await input.listAdmittedOrganizationIds({
      afterOrganizationId,
      limit,
      statementTimeoutMs: remaining,
    });
    return [...new Set(rows)]
      .sort()
      .filter((organizationId) => (
        afterOrganizationId === null || organizationId > afterOrganizationId
      ))
      .slice(0, limit);
  }

  async function admittedWindow(deadline: number): Promise<string[]> {
    const startCursor = cursor;
    const tail = await listPage(startCursor, maxOrganizations, deadline);
    if (tail === null) return [];
    if (startCursor === null || tail.length >= maxOrganizations) return tail;

    const remainingSlots = maxOrganizations - tail.length;
    const head = await listPage(null, remainingSlots, deadline);
    if (head === null) return tail;
    const seen = new Set(tail);
    return [...tail, ...head.filter((organizationId) => !seen.has(organizationId))]
      .slice(0, maxOrganizations);
  }

  async function runTick(): Promise<JobOutboxTickResult> {
    const deadline = monotonicNow() + tickBudgetMs;
    const organizationIds = await admittedWindow(deadline);
    let organizationsVisited = 0;
    let claimedCount = 0;
    let deliveredCount = 0;

    for (const organizationId of organizationIds) {
      const claimBudget = remainingBudget(deadline);
      if (claimBudget < 1) break;

      // Cursor progress records launch admission, not successful publication.
      // A slow or full shard therefore cannot pin the fair rotation.
      cursor = organizationId;
      organizationsVisited += 1;
      let pending = pendingClaims.get(organizationId);
      if (pending) claimedCount += pending.rows.length;
      if (!pending) {
        const claimToken = randomUUID();
        let claimed: Array<{
          id: string;
          organizationId: string;
          targetId: string;
          attemptId: string;
        }>;
        try {
          claimed = await runInTenant(input.appDb, organizationId, async (repos) => {
            await repos.jobControl.setLocalStatementTimeout(claimBudget);
            const claimTime = await repos.jobControl.currentDatabaseTime();
            return repos.jobControl.claimReadyOutbox({
              claimToken,
              now: claimTime,
              staleBefore: new Date(claimTime.getTime() - visibilityTimeoutMs),
              limit: maxRows,
            });
          });
        } catch (error) {
          if (isStatementTimeout(error)) continue;
          throw error;
        }

        claimedCount += claimed.length;
        if (claimed.length === 0) continue;
        if (pendingClaims.size >= maxOrganizations) {
          const oldest = pendingClaims.keys().next().value as string | undefined;
          if (oldest !== undefined) pendingClaims.delete(oldest);
        }
        pending = {
          claimToken,
          rows: claimed.map(({ id, organizationId: rowOrganizationId, targetId }) => ({
            id,
            organizationId: rowOrganizationId,
            targetId,
          })),
        };
        pendingClaims.set(organizationId, pending);
      }

      let allPublished = true;
      for (const row of pending.rows) {
        if (remainingBudget(deadline) < 1) {
          allPublished = false;
          break;
        }
        await publish({
          organizationId: row.organizationId,
          targetId: row.targetId,
        });
      }
      if (!allPublished) continue;

      const deliveryBudget = remainingBudget(deadline);
      if (deliveryBudget < 1) continue;
      deliveredCount += await runInTenant(input.appDb, organizationId, async (repos) => {
        await repos.jobControl.setLocalStatementTimeout(deliveryBudget);
        const deliveredAt = await repos.jobControl.currentDatabaseTime();
        return repos.jobControl.deliverReadyOutbox({
          claimToken: pending.claimToken,
          ids: pending.rows.map((row) => row.id),
          now: deliveredAt,
        });
      });
      pendingClaims.delete(organizationId);
    }

    return {
      organizations: organizationsVisited,
      claimed: claimedCount,
      delivered: deliveredCount,
    };
  }

  return {
    tick(): Promise<JobOutboxTickResult> {
      if (inFlight) return inFlight;
      const current = runTick();
      inFlight = current;
      current.finally(() => {
        if (inFlight === current) inFlight = null;
      }).catch(() => {
        // The caller observes the original rejection. This handles only the
        // promise returned by finally so it cannot become an unhandled branch.
      });
      return current;
    },
  };
}
