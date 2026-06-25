import { and, eq, isNull, sql } from "drizzle-orm";
import OpenAI from "openai";
import type { Db } from "@armyofagents/db";
import {
  memoryItems,
  discussions,
  discussionExtractedItems,
  embeddingQueue,
} from "@armyofagents/db";
import { resolveApiKey } from "../adapters/api-common.js";
import { logger } from "../middleware/logger.js";
import { getDbCapabilities } from "./db-capabilities.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_API_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 10;
const MAX_RETRIES = 3;

const log = logger.child({ service: "embeddings" });

/** Validate embedding values are all finite numbers and format for pgvector. */
function toVectorString(embedding: number[]): string {
  for (let i = 0; i < embedding.length; i++) {
    if (!Number.isFinite(embedding[i])) {
      throw new Error(`Invalid embedding value at index ${i}: ${embedding[i]}`);
    }
  }
  return `[${embedding.join(",")}]`;
}

/**
 * Generate an embedding vector for the given text using OpenAI text-embedding-3-small.
 * Returns a 1536-dimension number array, or null if the API key is not configured.
 */
export async function generateEmbedding(
  text: string,
  apiKey: string,
): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Cannot generate embedding for empty text");
  }

  const response = await fetch(EMBEDDING_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: trimmed,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI Embeddings API error ${response.status}: ${body}`);
  }

  const result = (await response.json()) as {
    data?: Array<{ embedding: number[] }>;
  };

  const embedding = result.data?.[0]?.embedding;
  if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error("Invalid embedding response from OpenAI");
  }

  return embedding;
}

/**
 * Generate embeddings for multiple texts in a single API call.
 * Returns an array of 1536-dimension vectors in the same order as inputs.
 */
export async function generateEmbeddingsBatch(
  texts: string[],
  apiKey: string,
): Promise<number[][]> {
  const trimmed = texts.map((t) => t.trim()).filter(Boolean);
  if (trimmed.length === 0) return [];

  const response = await fetch(EMBEDDING_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: trimmed,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI Embeddings API error ${response.status}: ${body}`);
  }

  const result = (await response.json()) as {
    data?: Array<{ embedding: number[]; index: number }>;
  };

  if (!result.data) {
    throw new Error("Invalid batch embedding response from OpenAI");
  }

  // Sort by index to maintain input order
  return result.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

/**
 * Background worker that finds approved memory items with NULL embeddings
 * and generates embeddings for them in batches.
 */
export async function processEmbeddingQueue(db: Db, companyId: string): Promise<number> {
  // Short-circuit when pgvector is unavailable — the embedding column doesn't
  // exist and every query below would 500. Semantic search is gated at the
  // query layer; this worker has nothing to do either.
  if (!getDbCapabilities().hasVectorSupport) {
    log.debug("pgvector unavailable — skipping embedding generation");
    return 0;
  }

  let apiKey: string;
  try {
    apiKey = await resolveApiKey(companyId, "openai");
  } catch (err: any) {
    if (err?.errorCode === "missing_api_key") {
      log.debug("No OpenAI API key configured — skipping embedding generation");
      return 0;
    }
    throw err;
  }

  // Find approved items with no embedding, non-empty content, and under retry limit
  const pending = await db
    .select({ id: memoryItems.id, title: memoryItems.title, content: memoryItems.content })
    .from(memoryItems)
    .where(
      and(
        eq(memoryItems.companyId, companyId),
        eq(memoryItems.status, "approved"),
        isNull(memoryItems.embedding),
        sql`${memoryItems.content} IS NOT NULL AND ${memoryItems.content} != ''`,
        sql`${memoryItems.embeddingRetries} < ${MAX_RETRIES}`,
      ),
    )
    .limit(BATCH_SIZE);

  if (pending.length === 0) return 0;

  let processed = 0;
  const texts = pending.map((item) => `${item.title}\n${item.content}`);

  try {
    // Single batch API call for all items
    const embeddings = await generateEmbeddingsBatch(texts, apiKey);

    // Process results per-item
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      try {
        const vectorStr = toVectorString(embeddings[i]);
        await db
          .update(memoryItems)
          .set({ embedding: sql`${vectorStr}::vector`, embeddingRetries: 0 })
          .where(eq(memoryItems.id, item.id));
        processed++;
      } catch (err: any) {
        // Individual item had invalid embedding values
        await db
          .update(memoryItems)
          .set({ embeddingRetries: sql`${memoryItems.embeddingRetries} + 1` })
          .where(eq(memoryItems.id, item.id));
        log.warn({ itemId: item.id, error: err.message }, "Embedding validation failed, incremented retry count");
      }
    }
  } catch (err: any) {
    // Batch API call failed — increment retry count for all items
    for (const item of pending) {
      await db
        .update(memoryItems)
        .set({ embeddingRetries: sql`${memoryItems.embeddingRetries} + 1` })
        .where(eq(memoryItems.id, item.id));
    }
    log.warn({ companyId, error: err.message, count: pending.length }, "Batch embedding API failed, incremented retry count for all items");
  }

  log.info({ companyId, processed, total: pending.length }, "Embedding queue processed");
  return processed;
}

/**
 * Invalidate embedding for a memory item (set to NULL).
 * Called when content is updated to trigger re-generation.
 */
export async function invalidateEmbedding(db: Db, itemId: string): Promise<void> {
  if (!getDbCapabilities().hasVectorSupport) {
    // No embedding column to invalidate.
    return;
  }
  await db
    .update(memoryItems)
    .set({ embedding: sql`NULL`, embeddingRetries: 0 } as any)
    .where(eq(memoryItems.id, itemId));
}

// ─── Write-behind queue (Task B1, Decision D2) ───────────────────────────────
//
// `createEmbeddingService` is the pure factory used by the write-behind queue.
// It takes a generic `LlmEmbedder` so tests can mock the OpenAI dependency.
// `startEmbeddingWorker` in `embeddings-worker.ts` is the production wiring
// that injects an OpenAI-backed embedder.
//
// Why a separate API from `processEmbeddingQueue` above: the legacy worker
// polls `memory_items` for NULL embeddings directly — fine for memory but
// not extensible to the new thread-native targets (`discussions.summary_embedding`,
// `discussion_extracted_items.embedding`). The new queue accepts arbitrary
// (table, id, column) tuples so writers anywhere in the system can enqueue
// an embedding job without coupling the writer to embedding semantics.

const queueLog = logger.child({ service: "embedding-queue" });

export interface LlmEmbedder {
  embed(text: string): Promise<number[]>;
}

const DEFAULT_EMBED_MODEL = "text-embedding-3-small";

/**
 * Single chokepoint for creating an OpenAI-backed LlmEmbedder.
 *
 * All production embedder creation (worker + sync path) goes through here.
 * Task T15 will inject a fake at this seam for testing without real API calls.
 *
 * The OpenAI SDK constructor throws on a blank key, so we pass a placeholder
 * when `apiKey` is empty/missing — the auth error will surface at embed time
 * rather than at construction time. This preserves the "register even without
 * a key" boot behavior in the worker.
 */
export function createOpenAiEmbedder(apiKey: string): LlmEmbedder {
  const openai = new OpenAI({ apiKey: apiKey || "missing-openai-api-key" });
  return {
    async embed(text: string): Promise<number[]> {
      const r = await openai.embeddings.create({
        model: DEFAULT_EMBED_MODEL,
        input: text,
      });
      const embedding = r.data[0]?.embedding;
      if (!embedding) {
        throw new Error("OpenAI returned no embedding data");
      }
      return embedding as number[];
    },
  };
}

export type EmbeddingTargetTable =
  | "memory_items"
  | "discussions"
  | "discussion_extracted_items";

export interface EnqueueParams {
  targetTable: EmbeddingTargetTable;
  targetId: string;
  /** snake_case vector column name, e.g. 'embedding' or 'summary_embedding' */
  targetColumn: string;
  inputText: string;
  /** Company that owns this row — used by the worker to resolve a per-company key. */
  companyId?: string | null;
}

export interface ProcessQueueOpts {
  batchSize?: number;
  maxAttempts?: number;
  /**
   * Per-company key resolver. Called once per unique company per processQueue()
   * tick. Resolution order: company Settings secret `llm:openai` → env
   * `OPENAI_API_KEY` → null.
   *
   * When null is returned for a company, all rows for that company are LEFT
   * PENDING (not failed, attempts not bumped). This preserves the row for the
   * next tick when a key may have been configured.
   *
   * When omitted (legacy / test path), `processQueue` falls back to a single
   * `llm` embedder (the one passed to `createEmbeddingService`).
   */
  resolveCompanyKey?: (companyId: string | null) => Promise<string | null>;
}

export interface ProcessQueueResult {
  processed: number;
  failed: number;
  remaining: number;
  /** Rows skipped because no key was resolved for their company. */
  skipped: number;
}

const TARGET_TABLE_MAP = {
  memory_items: memoryItems,
  discussions: discussions,
  discussion_extracted_items: discussionExtractedItems,
} as const;

function isValidTargetTable(value: string): value is EmbeddingTargetTable {
  return value in TARGET_TABLE_MAP;
}

/**
 * Write the generated vector to the target row's vector column.
 *
 * The columns referenced here are pgvector custom types. The Drizzle
 * `customType.toDriver` converts a `number[]` to the pgvector literal
 * `[v1,v2,...]` string at the driver layer. We pass the array straight
 * through via dynamic key access; the schema declares it as `vector(1536)`.
 */
async function updateVectorColumn(
  db: Db,
  targetTable: EmbeddingTargetTable,
  targetId: string,
  targetColumn: string,
  vector: number[],
): Promise<void> {
  const table = TARGET_TABLE_MAP[targetTable];
  if (!table) {
    throw new Error(`Unknown target table: ${targetTable}`);
  }
  await db
    .update(table)
    .set({ [targetColumn]: vector } as any)
    .where(eq(table.id as any, targetId));
}

export function createEmbeddingService(db: Db, llm: LlmEmbedder) {
  return {
    /**
     * Synchronous embedding generation. Calls the underlying LLM embedder
     * directly without queueing — useful for query-time use cases like
     * `find_similar_threads` where the caller needs the vector immediately
     * to feed a cosine-similarity ORDER BY clause.
     *
     * This is distinct from `enqueue` + `processQueue` (which is the
     * write-behind path for storing embeddings on rows). The sync path
     * does NOT touch `embedding_queue`.
     *
     * Cost note: each call costs one OpenAI API request. Callers should
     * avoid calling this in hot loops; for batch use cases, batch via
     * `generateEmbeddingsBatch` directly.
     *
     * @param text       - Query text to embed.
     * @param _companyId - Company context (used by service-container to resolve
     *                     the right per-company key before calling embed). The
     *                     base service ignores this because `llm` is already
     *                     bound to the correct key by the caller. Present here
     *                     so the interface is uniform with the container wrapper.
     */
    async embedSync(text: string, _companyId?: string | null): Promise<number[]> {
      const trimmed = text.trim();
      if (!trimmed) {
        throw new Error("Cannot generate embedding for empty text");
      }
      return await llm.embed(trimmed);
    },

    /**
     * Enqueue a row for the background worker to process. Synchronous —
     * returns as soon as the row is in `embedding_queue` with status='pending'.
     * The actual embedding happens in `processQueue` on the worker tick.
     */
    async enqueue(params: EnqueueParams): Promise<{ id: string }> {
      if (!isValidTargetTable(params.targetTable)) {
        throw new Error(`Unknown target table: ${params.targetTable}`);
      }
      const [row] = await db
        .insert(embeddingQueue)
        .values({
          targetTable: params.targetTable,
          targetId: params.targetId,
          targetColumn: params.targetColumn,
          inputText: params.inputText,
          companyId: params.companyId ?? null,
          status: "pending",
        })
        .returning({ id: embeddingQueue.id });
      return row;
    },

    /**
     * Pull a batch of pending rows, embed each, and UPDATE the target
     * vector column. Failures bump `attempts` and either re-queue or mark
     * 'failed' once `maxAttempts` is reached.
     *
     * Per-company key resolution (Task 10):
     *   When `opts.resolveCompanyKey` is provided, this function resolves a
     *   key for each row's `companyId` before embedding. Embedders are
     *   built and cached per resolved key within a single tick (i.e., two
     *   rows from the same company share one OpenAI SDK instance). Rows whose
     *   company has no key are LEFT PENDING — attempts are NOT bumped — so
     *   they'll be picked up again on the next tick once a key is configured.
     *
     * Worker loop guarantees:
     *   - Per-row: marks row 'processing' before embedding so a concurrent
     *     worker reading the same batch will not double-process it. (The
     *     'processing' marker is the single concurrency primitive — pair
     *     with a SELECT FOR UPDATE SKIP LOCKED in a future hardening pass
     *     if multiple workers are deployed.)
     *   - Per-batch: returns counts so callers can log/observe backpressure.
     */
    async processQueue(opts: ProcessQueueOpts = {}): Promise<ProcessQueueResult> {
      const batchSize = opts.batchSize ?? 50;
      const maxAttempts = opts.maxAttempts ?? 3;
      const resolveCompanyKey = opts.resolveCompanyKey;
      let processed = 0;
      let failed = 0;
      let skipped = 0;

      const pending = await db
        .select()
        .from(embeddingQueue)
        .where(eq(embeddingQueue.status, "pending"))
        .limit(batchSize);

      // Per-tick embedder cache: key → LlmEmbedder.
      // Avoids rebuilding the OpenAI SDK (+ keepalive agent) for each row when
      // multiple rows from the same company land in the same batch.
      const embedderByKey = new Map<string, LlmEmbedder>();
      // Track which companyIds have been logged "no key" this tick so we
      // don't spam the log for every row in the batch.
      const loggedNoKey = new Set<string>();

      for (const item of pending) {
        // ── Per-company key resolution ────────────────────────────────────
        let embedder: LlmEmbedder;
        if (resolveCompanyKey) {
          const key = await resolveCompanyKey(item.companyId ?? null);
          if (!key) {
            // No key for this company — leave the row pending this tick.
            const logId = item.companyId ?? "__null__";
            if (!loggedNoKey.has(logId)) {
              loggedNoKey.add(logId);
              queueLog.warn(
                { companyId: item.companyId, queueId: item.id },
                "no OpenAI key resolved for company — leaving queue rows pending (configure llm:openai in Settings or set OPENAI_API_KEY)",
              );
            }
            // Reset status to pending (it hasn't been marked processing yet).
            skipped++;
            continue;
          }
          // Cache by resolved key (not companyId) so two companies with the
          // same env-fallback key share one SDK instance.
          let cached = embedderByKey.get(key);
          if (!cached) {
            cached = createOpenAiEmbedder(key);
            embedderByKey.set(key, cached);
          }
          embedder = cached;
        } else {
          // Legacy path: use the single llm embedder injected at construction.
          embedder = llm;
        }

        try {
          // Mark processing so concurrent workers don't pick it up.
          await db
            .update(embeddingQueue)
            .set({
              status: "processing",
              updatedAt: new Date(),
            })
            .where(eq(embeddingQueue.id, item.id));

          if (!isValidTargetTable(item.targetTable)) {
            throw new Error(`Unknown target table: ${item.targetTable}`);
          }

          const vector = await embedder.embed(item.inputText);

          await updateVectorColumn(
            db,
            item.targetTable,
            item.targetId,
            item.targetColumn,
            vector,
          );

          await db
            .update(embeddingQueue)
            .set({
              status: "completed",
              updatedAt: new Date(),
            })
            .where(eq(embeddingQueue.id, item.id));
          processed++;
        } catch (err) {
          const nextAttempts = (item.attempts ?? 0) + 1;
          const finalFailed = nextAttempts >= maxAttempts;
          await db
            .update(embeddingQueue)
            .set({
              status: finalFailed ? "failed" : "pending",
              attempts: nextAttempts,
              error: err instanceof Error ? err.message : String(err),
              updatedAt: new Date(),
            })
            .where(eq(embeddingQueue.id, item.id));
          if (finalFailed) failed++;
          queueLog.warn(
            {
              queueId: item.id,
              targetTable: item.targetTable,
              targetId: item.targetId,
              attempts: nextAttempts,
              maxAttempts,
              finalFailed,
              error: err instanceof Error ? err.message : String(err),
            },
            finalFailed
              ? "embedding queue row marked failed after exhausting attempts"
              : "embedding queue row re-queued for retry",
          );
        }
      }

      return {
        processed,
        failed,
        remaining: pending.length - processed - failed - skipped,
        skipped,
      };
    },
  };
}

export type EmbeddingService = ReturnType<typeof createEmbeddingService>;
