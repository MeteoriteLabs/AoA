import { and, eq, lt, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { discussionEntries, discussions, internalAgentRuns } from "@armyofagents/db";
import { runExtractionConsumer } from "./extraction-consumer.js";
import { ensurePlatformAgent } from "./platform-agent.js";
import { createLimiter } from "./concurrency-limiter.js";
import { logger } from "../../../middleware/logger.js";

export interface SweepOptions {
  /** Max simultaneous extractions per sweep tick. */
  limiterMax: number;
  /** A 'processing' entry whose run has been 'running' (non-terminal) longer
   *  than this is treated as orphaned (crash between the M2 atomic claim and
   *  a terminal status) and reclaimed. Must be conservatively larger than the
   *  longest legitimate extraction so healthy in-flight work is never reset. */
  staleMs: number;
}

/**
 * Sub-agent #1 PRIMARY trigger — a durable poll (transactional-outbox
 * pattern), not an event listener. The committed row
 * `discussion_entries.extractionStatus='pending'` IS the work item, so no
 * event can be "lost" (spec §6.2). Each tick:
 *
 *  1. RECLAIM orphans (spec §6.3): an entry stuck in 'processing' whose
 *     `internal_agent_runs` row is still 'running' and older than staleMs is
 *     atomically reset → 'pending' (extraction_run_id cleared). The run's
 *     createdAt ≈ processing start (the consumer inserts the run immediately
 *     before extraction), so this never false-reclaims healthy in-flight work.
 *     Reset is guarded (`AND extraction_status='processing'`) so it is safe
 *     even if state changed between the select and the update.
 *
 *  2. DRAIN pending (incl. just-reclaimed). The Milestone-2 atomic claim
 *     inside extractFromDiscussionEntry guarantees at-most-one extraction per
 *     entry even under concurrent pickup (sweeper vs the untouched reprocess
 *     direct-call path).
 *
 * Runs the consumer under a bounded limiter; resolves the platform agent once
 * per company per tick.
 */
export async function runExtractionSweep(db: Db, opts: SweepOptions): Promise<void> {
  const staleCutoff = new Date(Date.now() - opts.staleMs);

  // ── Phase 1: reclaim orphaned 'processing' entries ─────────────────────────
  const orphanRows: Array<{ id: string }> = await db
    .select({ id: discussionEntries.id })
    .from(discussionEntries)
    .innerJoin(
      internalAgentRuns,
      and(
        eq(internalAgentRuns.relatedEntityId, discussionEntries.id),
        eq(internalAgentRuns.relatedEntityType, "discussion"),
      ),
    )
    .where(
      and(
        eq(discussionEntries.extractionStatus, "processing"),
        eq(internalAgentRuns.status, "running"),
        lt(internalAgentRuns.createdAt, staleCutoff),
      ),
    )
    .then((r: Array<{ id: string }>) => r);

  if (orphanRows.length > 0) {
    const orphanIds = [...new Set(orphanRows.map((o) => o.id))];
    await db
      .update(discussionEntries)
      .set({ extractionStatus: "pending", extractionRunId: null })
      .where(
        and(
          inArray(discussionEntries.id, orphanIds),
          // guard: only reset rows that are still 'processing' (safe under
          // concurrency with the consumer / reprocess path)
          eq(discussionEntries.extractionStatus, "processing"),
        ),
      );
  }

  // ── Phase 2: drain pending (includes the just-reclaimed orphans) ───────────
  const rows: Array<{ id: string; companyId: string }> = await db
    .select({ id: discussionEntries.id, companyId: discussions.companyId })
    .from(discussionEntries)
    .innerJoin(discussions, eq(discussions.id, discussionEntries.discussionId))
    .where(eq(discussionEntries.extractionStatus, "pending"))
    .limit(200)
    .then((r: Array<{ id: string; companyId: string }>) => r);

  if (rows.length === 0) return;

  const limiter = createLimiter(opts.limiterMax);
  const platformByCompany = new Map<string, string>();

  await Promise.allSettled(
    rows.map((row) =>
      limiter.run(async () => {
        let platformId = platformByCompany.get(row.companyId);
        if (!platformId) {
          platformId = await ensurePlatformAgent(db, row.companyId);
          platformByCompany.set(row.companyId, platformId);
        }
        await runExtractionConsumer(db, row.companyId, row.id, platformId);
      }),
    ),
  );

  logger
    .child({ subagent: "extraction-sweeper" })
    .info(
      { reclaimed: orphanRows.length, drained: rows.length },
      "extraction sweep complete",
    );
}
