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
  /** A 'processing' entry whose LINKED run has been 'running' (non-terminal)
   *  longer than this is treated as orphaned (crash between the M2 atomic
   *  claim and a terminal status). Must be conservatively larger than the
   *  longest legitimate extraction so healthy in-flight is never reset. */
  staleMs: number;
}

/**
 * Sub-agent #1 PRIMARY trigger — a durable poll (transactional-outbox
 * pattern), not an event listener. The committed row
 * `discussion_entries.extractionStatus='pending'` IS the work item, so no
 * event can be "lost" (spec §6.2). Each tick:
 *
 *  1. RECLAIM orphans (spec §6.3). Orphan = entry `processing` AND its
 *     **linked current run** (`extraction_run_id`, set by the consumer at run
 *     creation) is still `running` and older than staleMs — OR
 *     `extraction_run_id IS NULL` while `processing` (consumer crashed before
 *     linking/claim). Reclaim atomically: (a) terminalize that linked run →
 *     `failed` so it can never re-trigger reclaim (no zombie `running` rows,
 *     no perpetual re-reclaim of a healthily-reprocessing entry — the bug the
 *     prior join-on-any-running design produced); (b) reset the entry →
 *     `pending`, `extraction_run_id=null`. Both guarded so they are safe
 *     under concurrency with the consumer / the untouched reprocess path.
 *     Using the LINKED run means a stale leftover run from a *previous*
 *     attempt cannot condemn an entry that a *fresh* run is healthily
 *     processing.
 *
 *  2. DRAIN pending (incl. just-reclaimed). The Milestone-2 atomic claim
 *     inside extractFromDiscussionEntry guarantees at-most-one extraction
 *     per entry even under concurrent pickup.
 *
 * Runs the consumer under a bounded limiter; resolves the platform agent once
 * per company per tick.
 */
export async function runExtractionSweep(db: Db, opts: SweepOptions): Promise<void> {
  const staleCutoff = new Date(Date.now() - opts.staleMs);

  // ── Phase 1: reclaim orphaned 'processing' entries ─────────────────────────
  const orphanRows: Array<{ id: string; runId: string | null }> = await db
    .select({
      id: discussionEntries.id,
      runId: discussionEntries.extractionRunId,
    })
    .from(discussionEntries)
    .leftJoin(
      internalAgentRuns,
      eq(internalAgentRuns.id, discussionEntries.extractionRunId),
    )
    .where(
      // Orphan = a CONSUMER-driven 'processing' entry whose LINKED run is
      // still 'running' and older than the stale window. The consumer links
      // extraction_run_id *before* the atomic claim, so every consumer-driven
      // 'processing' entry has a non-null linked run — there is no consumer
      // path that yields (processing, run_id NULL). The only producer of
      // (processing, run_id NULL) is the untouched reprocess direct-call path
      // (Q2-b), which is HEALTHY in-flight work; a NULL-guard branch would
      // false-reclaim it and cause double extraction. Reprocess-crash
      // recovery is a deferred follow-up (spec §16.1), not in scope here.
      and(
        eq(discussionEntries.extractionStatus, "processing"),
        eq(internalAgentRuns.status, "running"),
        lt(internalAgentRuns.createdAt, staleCutoff),
      ),
    )
    .then((r: Array<{ id: string; runId: string | null }>) => r);

  if (orphanRows.length > 0) {
    const orphanIds = [...new Set(orphanRows.map((o) => o.id))];
    const staleRunIds = [
      ...new Set(
        orphanRows
          .map((o) => o.runId)
          .filter((v): v is string => typeof v === "string"),
      ),
    ];

    // (a) Terminalize the stale linked runs so they can never re-trigger
    //     reclaim. Guarded on status='running' so an already-terminal run is
    //     never clobbered.
    if (staleRunIds.length > 0) {
      await db
        .update(internalAgentRuns)
        .set({
          status: "failed",
          errorMessage: "reclaimed: orphaned (sweeper)",
          completedAt: new Date(),
        })
        .where(
          and(
            inArray(internalAgentRuns.id, staleRunIds),
            eq(internalAgentRuns.status, "running"),
          ),
        );
    }

    // (b) Reset the entries → pending. Guarded on status='processing' so it
    //     is safe even if state changed between the select and the update.
    await db
      .update(discussionEntries)
      .set({ extractionStatus: "pending", extractionRunId: null })
      .where(
        and(
          inArray(discussionEntries.id, orphanIds),
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
