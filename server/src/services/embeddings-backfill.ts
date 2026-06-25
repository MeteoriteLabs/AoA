import { eq, isNull, and, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  embeddingQueue,
  memoryItems,
  discussions,
  discussionEntries,
  discussionExtractedItems,
} from "@armyofagents/db";

type Db = NodePgDatabase<Record<string, never>>;

/**
 * Backfill `embedding_queue.company_id` for rows that pre-date the keyless
 * initiative (Task 4, keyless-except-embeddings).
 *
 * For each supported targetTable value, derives the owning company by joining
 * through to the source entity. Rows that cannot resolve (orphaned, unknown
 * targetTable) are left NULL — the worker will fall back to the env-level key.
 *
 * Idempotent: only touches rows where company_id IS NULL. Safe to run on every
 * boot — second run updates 0 rows.
 */
export async function backfillQueueCompanyIds(db: Db): Promise<{ updated: number }> {
  let totalUpdated = 0;

  // -------------------------------------------------------------------------
  // 1. memory_items: embedding_queue.target_id → memory_items.id → company_id
  // -------------------------------------------------------------------------
  const miRows = await db
    .select({
      queueId: embeddingQueue.id,
      companyId: memoryItems.companyId,
    })
    .from(embeddingQueue)
    .innerJoin(memoryItems, eq(memoryItems.id, embeddingQueue.targetId))
    .where(
      and(
        isNull(embeddingQueue.companyId),
        eq(embeddingQueue.targetTable, "memory_items"),
      ),
    );

  for (const row of miRows) {
    await db
      .update(embeddingQueue)
      .set({ companyId: row.companyId })
      .where(eq(embeddingQueue.id, row.queueId));
  }
  totalUpdated += miRows.length;

  // -------------------------------------------------------------------------
  // 2. discussions: embedding_queue.target_id → discussions.id → company_id
  // -------------------------------------------------------------------------
  const discRows = await db
    .select({
      queueId: embeddingQueue.id,
      companyId: discussions.companyId,
    })
    .from(embeddingQueue)
    .innerJoin(discussions, eq(discussions.id, embeddingQueue.targetId))
    .where(
      and(
        isNull(embeddingQueue.companyId),
        eq(embeddingQueue.targetTable, "discussions"),
      ),
    );

  for (const row of discRows) {
    await db
      .update(embeddingQueue)
      .set({ companyId: row.companyId })
      .where(eq(embeddingQueue.id, row.queueId));
  }
  totalUpdated += discRows.length;

  // -------------------------------------------------------------------------
  // 3. discussion_extracted_items:
  //    embedding_queue.target_id → discussion_extracted_items.id
  //      → discussion_entries.id (via discussionEntryId)
  //        → discussions.id (via discussionId)
  //          → discussions.company_id
  // -------------------------------------------------------------------------
  const deiRows = await db
    .select({
      queueId: embeddingQueue.id,
      companyId: discussions.companyId,
    })
    .from(embeddingQueue)
    .innerJoin(
      discussionExtractedItems,
      eq(discussionExtractedItems.id, embeddingQueue.targetId),
    )
    .innerJoin(
      discussionEntries,
      eq(discussionEntries.id, discussionExtractedItems.discussionEntryId),
    )
    .innerJoin(discussions, eq(discussions.id, discussionEntries.discussionId))
    .where(
      and(
        isNull(embeddingQueue.companyId),
        eq(embeddingQueue.targetTable, "discussion_extracted_items"),
      ),
    );

  for (const row of deiRows) {
    await db
      .update(embeddingQueue)
      .set({ companyId: row.companyId })
      .where(eq(embeddingQueue.id, row.queueId));
  }
  totalUpdated += deiRows.length;

  return { updated: totalUpdated };
}
