import { randomUUID } from "node:crypto";
import type { Db } from "@armyofagents/db";
import { runInTenant } from "../db/tenant-context.js";
import type { JobReadyHint, JobReadyScheduler } from "./job-ready-scheduler.js";

export function createJobOutboxWorker(input: {
  appDb: Db;
  scheduler: JobReadyScheduler;
  listAdmittedOrganizationIds: () => Promise<string[]>;
  publishHint?: (hint: JobReadyHint) => Promise<void>;
  visibilityTimeoutMs?: number;
  maxOrganizationShards?: number;
  maxRowsPerShard?: number;
}) {
  const maxOrganizations = Math.max(1, Math.min(32, input.maxOrganizationShards ?? 32));
  const maxRows = Math.max(1, Math.min(128, input.maxRowsPerShard ?? 32));
  const visibilityTimeoutMs = Math.max(1, input.visibilityTimeoutMs ?? 30_000);
  const publish = input.publishHint ?? (async (hint: JobReadyHint) => {
    input.scheduler.hint(hint);
  });

  return {
    async tick(): Promise<{ organizations: number; claimed: number; delivered: number }> {
      const organizationIds = [...new Set(await input.listAdmittedOrganizationIds())]
        .slice(0, maxOrganizations);
      let claimedCount = 0;
      let deliveredCount = 0;
      for (const organizationId of organizationIds) {
        const claimToken = randomUUID();
        const claimed = await runInTenant(input.appDb, organizationId, async (repos) => {
          const claimTime = await repos.jobControl.currentDatabaseTime();
          return repos.jobControl.claimReadyOutbox({
            claimToken,
            now: claimTime,
            staleBefore: new Date(claimTime.getTime() - visibilityTimeoutMs),
            limit: maxRows,
          });
        });
        claimedCount += claimed.length;
        if (claimed.length === 0) continue;

        // This publication is deliberately after commit. A crash leaves the
        // durable claim for visibility-timeout replay; the hint itself carries
        // no job data and can never authorize a lease.
        for (const row of claimed) {
          await publish({ organizationId: row.organizationId, attemptId: row.attemptId });
        }
        deliveredCount += await runInTenant(input.appDb, organizationId, async (repos) => {
          const deliveredAt = await repos.jobControl.currentDatabaseTime();
          return repos.jobControl.deliverReadyOutbox({
            claimToken,
            ids: claimed.map((row) => row.id),
            now: deliveredAt,
          });
        });
      }
      return { organizations: organizationIds.length, claimed: claimedCount, delivered: deliveredCount };
    },
  };
}
