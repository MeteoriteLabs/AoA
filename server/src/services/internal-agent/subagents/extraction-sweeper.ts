import { and, eq, lt, or } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { discussionEntries, discussions } from "@armyofagents/db";
import { runExtractionConsumer } from "./extraction-consumer.js";
import { ensurePlatformAgent } from "./platform-agent.js";
import { createLimiter } from "./concurrency-limiter.js";
import { logger } from "../../../middleware/logger.js";

export interface SweepOptions {
  /** Max simultaneous extractions per sweep tick. */
  limiterMax: number;
  /** A 'processing' entry older than this is treated as orphaned (crash
   *  between the atomic claim and a terminal status) and reclaimed. */
  staleMs: number;
}

/**
 * Sub-agent #1 PRIMARY trigger — a durable poll (transactional-outbox
 * pattern), not an event listener. The committed row
 * `discussion_entries.extractionStatus='pending'` IS the work item, so no
 * event can be "lost" (spec §6.2). Each tick:
 *
 *  - drains `pending` (the normal new-entry path), AND
 *  - reclaims `processing` older than staleMs (orphaned by a crash between
 *    the atomic claim and a terminal write — spec §6.3).
 *
 * Idempotency-safe alongside the untouched reprocess direct-call path: the
 * Milestone-2 atomic claim inside extractFromDiscussionEntry guarantees
 * at-most-one extraction per entry even under concurrent pickup. Runs the
 * consumer under a bounded limiter; resolves the platform agent once per
 * company per tick.
 */
export async function runExtractionSweep(db: Db, opts: SweepOptions): Promise<void> {
  const staleCutoff = new Date(Date.now() - opts.staleMs);

  const rows: Array<{ id: string; companyId: string }> = await db
    .select({ id: discussionEntries.id, companyId: discussions.companyId })
    .from(discussionEntries)
    .innerJoin(discussions, eq(discussions.id, discussionEntries.discussionId))
    .where(
      or(
        eq(discussionEntries.extractionStatus, "pending"),
        and(
          eq(discussionEntries.extractionStatus, "processing"),
          lt(discussionEntries.createdAt, staleCutoff),
        ),
      ),
    )
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
    .info({ swept: rows.length }, "extraction sweep complete");
}
