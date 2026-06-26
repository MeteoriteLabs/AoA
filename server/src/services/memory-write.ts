/**
 * memory-write.ts — Shared write+index path for memory items (Task W3).
 *
 * Every memory write (create, content/title update, approve) routes through
 * `enqueueMemoryEmbedding` to ensure coverage of the embedding queue. The
 * shared helper:
 *   - guards on pgvector availability (no-op when vector support is absent),
 *   - deduplicates against live ('pending'|'processing') queue rows so
 *     multiple write events on the same item don't pile up queue entries,
 *   - is best-effort: enqueue failure is caught and logged, never thrown to
 *     the caller (the memory write must succeed regardless of queue health).
 *
 * `writeMemoryAndIndex` is the public entry point for Task 9 crew/MCP tools —
 * it calls `memoryService(db).create(...)` then enqueues, returning the row.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { embeddingQueue, memoryItems } from "@armyofagents/db";
import { getDbCapabilities } from "./db-capabilities.js";
import { memoryService } from "./memory.js";
import { logger } from "../middleware/logger.js";

const log = logger.child({ service: "memory-write" });

/** Minimal shape of a memory item needed to build the embedding input text. */
interface MemoryItemLike {
  id: string;
  title?: string | null;
  content?: string | null;
}

/**
 * Enqueue an embedding job for a memory item.
 *
 * Best-effort: never throws into the caller. Returns silently on any guard
 * hit (no vector support, empty text, duplicate live row) or error.
 *
 * @param db  Database connection (or transaction handle)
 * @param companyId  Company that owns the memory item
 * @param item  The memory item row (at minimum {id, title?, content?})
 * @param tx  Optional Drizzle transaction handle — use when called inside a
 *            transaction so the dedup SELECT and INSERT are on the same
 *            connection and see the correct isolation snapshot.
 */
export async function enqueueMemoryEmbedding(
  db: Db,
  companyId: string,
  item: MemoryItemLike,
  tx?: Db,
): Promise<void> {
  const handle = tx ?? db;

  try {
    // Guard 1: pgvector must be present (the embedding column only exists on
    // installations that ran migration 0038 on a vector-capable PG).
    if (!getDbCapabilities().hasVectorSupport) {
      return;
    }

    // Guard 2: compose input text; skip if nothing to embed.
    const inputText = [item.title, item.content].filter(Boolean).join("\n");
    if (!inputText) {
      return;
    }

    // Guard 3: dedup — if a live queue row already exists for this target,
    // REFRESH its inputText instead of inserting a duplicate (P2, Codex).
    // A memory title/content edit while a row is still pending/processing would
    // otherwise leave the row's inputText at the pre-edit content — and since
    // memoryService.update nulls the stored embedding and relies on this helper
    // for re-indexing, the worker would complete with a stale vector and no new
    // row would ever be created. Update the live row's text and reset it to
    // pending (clearing any backoff) so the latest content is what gets embedded.
    const existing = await (handle as any)
      .select({ id: embeddingQueue.id })
      .from(embeddingQueue)
      .where(
        and(
          eq(embeddingQueue.targetTable, "memory_items"),
          eq(embeddingQueue.targetId, item.id),
          eq(embeddingQueue.targetColumn, "embedding"),
          inArray(embeddingQueue.status, ["pending", "processing"]),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await (handle as any)
        .update(embeddingQueue)
        .set({
          inputText,
          status: "pending",
          nextRetryAt: null,
          updatedAt: new Date(),
        })
        .where(eq(embeddingQueue.id, existing[0].id));
      return;
    }

    // Insert the queue row.
    await (handle as any)
      .insert(embeddingQueue)
      .values({
        companyId,
        targetTable: "memory_items",
        targetId: item.id,
        targetColumn: "embedding",
        inputText,
        status: "pending",
      });
  } catch (err: unknown) {
    // Best-effort: log the warning and swallow — enqueue failure must never
    // break the memory write that triggered this call.
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ itemId: item.id, companyId, err: msg }, "enqueueMemoryEmbedding: non-fatal enqueue failure");
  }
}

/**
 * Create a memory item and immediately enqueue it for embedding.
 *
 * This is the public entry point that Task 9 crew/MCP wrappers should call
 * instead of `memoryService(db).create(...)` directly. Using this function
 * guarantees that every newly created memory item enters the embedding queue,
 * closing the RAG coverage gap where `create` previously never enqueued.
 *
 * @param db  Database connection
 * @param companyId  Owning company
 * @param data  Memory item fields (excluding companyId — it is injected here)
 * @param tx  Optional transaction handle, forwarded to both the insert and
 *            the enqueue (dedup SELECT + INSERT share the same tx snapshot).
 */
export async function writeMemoryAndIndex(
  db: Db,
  companyId: string,
  data: Omit<typeof memoryItems.$inferInsert, "companyId">,
  tx?: Db,
): Promise<Awaited<ReturnType<ReturnType<typeof memoryService>["create"]>>> {
  const svc = memoryService(db);
  const row = await svc.create(companyId, data, tx as any);
  // enqueueMemoryEmbedding is also called inside `create` (via memory.ts wiring),
  // but the dedup guard ensures no double-insert occurs. We call it here too so
  // that callers of `writeMemoryAndIndex` that bypass the wired path still get
  // coverage — and the dedup makes this a safe no-op if create already queued it.
  if (row) {
    await enqueueMemoryEmbedding(db, companyId, row, tx);
  }
  return row;
}
