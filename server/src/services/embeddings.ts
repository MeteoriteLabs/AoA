import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import fs from "node:fs";
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

// ─── Resilience helpers (Task 11) ─────────────────────────────────────────────

export type EmbeddingErrorClass = "transient" | "row_permanent" | "systemic";

/**
 * Classify an embedding error into one of three categories:
 *
 *   - "systemic"      — bad API key, exhausted quota, 401/403. The whole
 *                       company's key is broken; a circuit breaker should
 *                       pause that company's rows so we don't burn their
 *                       backlog to 'failed'.
 *   - "row_permanent" — the input is fundamentally bad (400/422). Retrying
 *                       will never help; mark the row failed immediately.
 *   - "transient"     — rate-limit (429), server error (5xx), network
 *                       timeout, or unknown. Retry with exponential backoff.
 */
export function classifyEmbeddingError(err: unknown): EmbeddingErrorClass {
  const status = (err as Record<string, unknown>)?.status as number | undefined;
  const type = (
    (err as Record<string, unknown>)?.error as Record<string, unknown>
  )?.type as string | undefined;
  const code = (
    (err as Record<string, unknown>)?.error as Record<string, unknown>
  )?.code as string | undefined;
  const message =
    (err instanceof Error ? err.message : String(err)) ?? "";

  // Systemic: auth failure or quota exhausted
  if (status === 401 || status === 403) return "systemic";
  if (type === "insufficient_quota") return "systemic";
  if (code === "insufficient_quota") return "systemic";
  if (
    typeof message === "string" &&
    message.toLowerCase().includes("insufficient_quota")
  )
    return "systemic";

  // Row-permanent: bad input that will always fail for this row
  if (status === 400 || status === 422) return "row_permanent";

  // Transient: rate-limit, server errors, network failures
  if (status === 429) return "transient";
  if (typeof status === "number" && status >= 500) return "transient";
  if (type === "rate_limit_exceeded") return "transient";
  if (code === "rate_limit_exceeded") return "transient";
  if (typeof message === "string") {
    const lower = message.toLowerCase();
    if (
      lower.includes("econnreset") ||
      lower.includes("etimedout") ||
      lower.includes("fetch failed") ||
      lower.includes("network") ||
      lower.includes("timeout")
    )
      return "transient";
  }

  // Unknown → treat as transient (bounded by maxAttempts)
  return "transient";
}

/** Exponential backoff base in ms. */
export const BACKOFF_BASE_MS = 2000;
/** Exponential backoff cap in ms (5 minutes). */
export const BACKOFF_CAP_MS = 300_000;

/**
 * Full-jitter exponential backoff.
 *
 *   raw = min(CAP, BASE * 2^(attempt-1))
 *   result = floor(rng() * raw)   // uniform in [0, raw)
 *
 * @param attempt  1-based attempt number (1 = first retry after first failure).
 * @param rng      Random number generator in [0,1). Defaults to Math.random.
 */
export function computeBackoffMs(
  attempt: number,
  rng: () => number = Math.random,
): number {
  const raw = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, attempt - 1));
  return Math.floor(rng() * raw);
}

/** Circuit-breaker state for a single company. */
export interface CircuitEntry {
  reason: string;
  /** Absolute epoch-ms when the circuit resets (auto-closes). */
  until: number;
}

/** TTL for an open circuit breaker (60 seconds). */
export const CIRCUIT_TTL_MS = 60_000;

const queueLog = logger.child({ service: "embedding-queue" });

export interface LlmEmbedder {
  embed(text: string): Promise<number[]>;
}

const DEFAULT_EMBED_MODEL = "text-embedding-3-small";

/**
 * Check whether the fake embedder seam is active.
 *
 * Active iff ALL of:
 *   - AOA_E2E_FAKE_EMBEDDER === "1"   (explicit opt-in)
 *   - NODE_ENV !== "production"        (defense-in-depth: NEVER active in prod)
 *
 * Mirrors the pattern in fake-crew-llm.ts (isFakeCrewLlmEnabled).
 */
export function isFakeEmbedderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AOA_E2E_FAKE_EMBEDDER === "1" && env.NODE_ENV !== "production";
}

/**
 * Build the fake LlmEmbedder for CI/e2e use.
 *
 * Success path: returns a deterministic 1536-length vector derived from
 * the text (no network call, no API key needed).
 *
 * Forced-error path: reads an optional JSON control file at
 * AOA_E2E_FAKE_EMBEDDER_CONTROL. If it contains { fail: "systemic" },
 * { fail: "transient" }, or { fail: "row_permanent" }, throws an error
 * shaped so that classifyEmbeddingError returns the matching class.
 *
 * @internal — exported for the unit test only; callers should use
 *   createOpenAiEmbedder (which returns this automatically when the guard fires).
 */
export function createFakeEmbedder(env: NodeJS.ProcessEnv = process.env): LlmEmbedder {
  return {
    async embed(text: string): Promise<number[]> {
      // Read optional control file
      const controlPath = env.AOA_E2E_FAKE_EMBEDDER_CONTROL;
      if (controlPath) {
        try {
          const raw = fs.readFileSync(controlPath, "utf8");
          const ctrl = JSON.parse(raw) as { fail?: string };
          if (ctrl.fail === "systemic") {
            throw Object.assign(new Error("fake systemic embedding error"), { status: 401 });
          }
          if (ctrl.fail === "transient") {
            throw Object.assign(new Error("fake transient embedding error"), { status: 429 });
          }
          if (ctrl.fail === "row_permanent") {
            throw Object.assign(new Error("fake row_permanent embedding error"), { status: 400 });
          }
        } catch (err: unknown) {
          // Re-throw controlled errors; swallow file-read / JSON parse errors
          const e = err as { status?: number };
          if (typeof e.status === "number") throw err;
        }
      }

      // Success: deterministic 1536-dim vector.
      // Each element is a small value derived from the char code at that position
      // (wrapping with modulo so all 1536 slots are filled). All values are finite
      // floats — ranking quality is irrelevant in e2e, we only assert the vector
      // is stored as a non-null row.
      const vector = new Array<number>(EMBEDDING_DIMENSIONS);
      const len = text.length || 1;
      for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) {
        vector[i] = (text.charCodeAt(i % len) / 256) * (1 / (i + 1));
      }
      return vector;
    },
  };
}

/**
 * Single chokepoint for creating an OpenAI-backed LlmEmbedder.
 *
 * All production embedder creation (worker + sync path) goes through here.
 * Task T15: if the fake-embedder seam is active (AOA_E2E_FAKE_EMBEDDER=1 and
 * NODE_ENV !== "production"), returns a deterministic fake that never touches
 * the network, making embedding flows fully deterministic in CI/e2e.
 *
 * The OpenAI SDK constructor throws on a blank key, so we pass a placeholder
 * when `apiKey` is empty/missing — the auth error will surface at embed time
 * rather than at construction time. This preserves the "register even without
 * a key" boot behavior in the worker.
 */
export function createOpenAiEmbedder(apiKey: string): LlmEmbedder {
  // T15: fake embedder seam — active iff env opt-in AND not production.
  if (isFakeEmbedderEnabled()) {
    return createFakeEmbedder();
  }

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
  /**
   * Per-company circuit breaker map. Owned by the caller (typically
   * `startEmbeddingWorker`) and persisted across ticks so a systemic error
   * (bad key / quota exhausted) suppresses that company's rows for CIRCUIT_TTL_MS
   * without marking them 'failed'. Tests can inject their own empty Map.
   *
   * When omitted, a fresh Map is created per processQueue() call (safe for
   * single-tick / test scenarios).
   */
  circuit?: Map<string, CircuitEntry>;
}

export interface ProcessQueueResult {
  processed: number;
  failed: number;
  remaining: number;
  /** Rows skipped because no key was resolved for their company. */
  skipped: number;
}

/**
 * Parse an optional `Retry-After` header from an API error's response headers.
 * Returns milliseconds to wait, or 0 if the header is absent / unparseable.
 * Supports both delta-seconds ("30") and HTTP-date formats.
 */
function parseRetryAfterHeader(headers: Record<string, string>): number {
  const raw =
    headers?.["retry-after"] ?? headers?.["Retry-After"] ?? "";
  if (!raw) return 0;
  const seconds = Number(raw);
  if (!Number.isNaN(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
  // HTTP-date format
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }
  return 0;
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
     * Resilience (Task 11):
     *   - Eligibility filter: only picks rows where next_retry_at IS NULL OR
     *     next_retry_at <= now(). Rows in backoff delay are naturally skipped.
     *   - Atomic claim: uses SELECT FOR UPDATE SKIP LOCKED (via raw SQL) so
     *     concurrent worker instances don't double-process the same row.
     *   - Per-error classification: transient → backoff+retry; row_permanent →
     *     immediate 'failed'; systemic → circuit-break (restore row to pending
     *     without bumping attempts, skip remaining company rows this tick).
     *   - Circuit breaker: systemic errors open a per-company circuit for
     *     CIRCUIT_TTL_MS. Rows for open-circuit companies are left pending
     *     without embedding attempts until the TTL expires.
     */
    async processQueue(opts: ProcessQueueOpts = {}): Promise<ProcessQueueResult> {
      const batchSize = opts.batchSize ?? 50;
      const maxAttempts = opts.maxAttempts ?? 6;
      const resolveCompanyKey = opts.resolveCompanyKey;
      // Circuit map: persisted across ticks when caller provides it; fresh per
      // call otherwise (safe for single-tick / legacy / test scenarios).
      const circuit = opts.circuit ?? new Map<string, CircuitEntry>();
      let processed = 0;
      let failed = 0;
      let skipped = 0;

      // Claim eligible rows atomically. We use a raw SQL CTE so that
      // SELECT FOR UPDATE SKIP LOCKED and the WHERE on next_retry_at are
      // expressed as a single statement — Drizzle's query builder does not
      // expose SKIP LOCKED natively, so we fall back to sql.raw here.
      //
      // Pattern:
      //   WITH claimed AS (
      //     SELECT id FROM embedding_queue
      //     WHERE status = 'pending'
      //       AND (next_retry_at IS NULL OR next_retry_at <= now())
      //     ORDER BY created_at
      //     LIMIT $batchSize
      //     FOR UPDATE SKIP LOCKED
      //   )
      //   UPDATE embedding_queue
      //   SET status = 'processing', updated_at = now()
      //   WHERE id IN (SELECT id FROM claimed)
      //   RETURNING *
      //
      // This is an atomic claim: the rows are marked 'processing' in the same
      // round-trip that selects them, so two concurrent workers cannot both
      // claim the same row. Workers that read a 'processing' row on a normal
      // SELECT will skip it via the WHERE status='pending' filter.
      let pending: Array<typeof embeddingQueue.$inferSelect>;
      // True when rows were already marked 'processing' by the atomic CTE claim.
      // False when the fallback plain-select was used — in that case the loop must
      // mark each row 'processing' before embedding (and must NOT issue a restore
      // update for skipped/circuit rows, since they're still 'pending').
      let rowsAlreadyClaimed = false;
      try {
        const rows = await db.execute(sql.raw(`
          WITH claimed AS (
            SELECT id FROM embedding_queue
            WHERE status = 'pending'
              AND (next_retry_at IS NULL OR next_retry_at <= now())
            ORDER BY created_at
            LIMIT ${batchSize}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE embedding_queue
          SET status = 'processing', updated_at = now()
          WHERE id IN (SELECT id FROM claimed)
          RETURNING *
        `));
        // Drizzle's db.execute returns an iterable result; the raw rows are
        // accessible via the array itself (RowList is array-like).
        pending = (rows as unknown as Array<typeof embeddingQueue.$inferSelect>);
        rowsAlreadyClaimed = true;
      } catch (skipLockedErr) {
        // Fallback for test environments / mocked DBs that don't support
        // raw SQL execution: degrade gracefully to a plain select with
        // the eligibility filter. The per-row mark-processing step inside
        // the loop handles single-worker correctness in those scenarios.
        queueLog.debug(
          { err: skipLockedErr },
          "SKIP LOCKED claim failed — falling back to plain select (expected in mocked test environments)",
        );
        pending = await db
          .select()
          .from(embeddingQueue)
          .where(
            and(
              eq(embeddingQueue.status, "pending"),
              or(
                isNull(embeddingQueue.nextRetryAt),
                lte(embeddingQueue.nextRetryAt, new Date()),
              ),
            ),
          )
          .limit(batchSize) as Array<typeof embeddingQueue.$inferSelect>;
        // rowsAlreadyClaimed remains false: loop will mark processing + skip without restore
      }

      if (pending.length === 0) {
        return { processed, failed, remaining: 0, skipped };
      }

      // Per-tick embedder cache: key → LlmEmbedder.
      // Avoids rebuilding the OpenAI SDK (+ keepalive agent) for each row when
      // multiple rows from the same company land in the same batch.
      const embedderByKey = new Map<string, LlmEmbedder>();
      // Track which companyIds have been logged "no key" this tick so we
      // don't spam the log for every row in the batch.
      const loggedNoKey = new Set<string>();
      // Companies that tripped the circuit breaker this tick — their remaining
      // rows are skipped without embedding.
      const circuitOpenedThisTick = new Set<string>();

      for (const item of pending) {
        const companyKey = item.companyId ?? "__null__";

        // ── Circuit breaker: skip if company's circuit is open ────────────
        const circuitEntry = circuit.get(companyKey);
        if (circuitEntry && circuitEntry.until > Date.now()) {
          if (rowsAlreadyClaimed) {
            // Row was claimed as 'processing' by the CTE; restore to 'pending'.
            await db
              .update(embeddingQueue)
              .set({ status: "pending", updatedAt: new Date() })
              .where(eq(embeddingQueue.id, item.id));
          }
          // If fallback plain-select path: row is still 'pending' — just skip it.
          skipped++;
          continue;
        } else if (circuitEntry) {
          // TTL expired — remove stale entry so the next attempt proceeds.
          circuit.delete(companyKey);
        }

        // Also skip if this company tripped the circuit earlier in this tick
        if (circuitOpenedThisTick.has(companyKey)) {
          if (rowsAlreadyClaimed) {
            await db
              .update(embeddingQueue)
              .set({ status: "pending", updatedAt: new Date() })
              .where(eq(embeddingQueue.id, item.id));
          }
          skipped++;
          continue;
        }

        // ── Per-company key resolution ────────────────────────────────────
        let embedder: LlmEmbedder;
        if (resolveCompanyKey) {
          const key = await resolveCompanyKey(item.companyId ?? null);
          if (!key) {
            // No key for this company — leave the row pending this tick.
            // CTE path: row is 'processing' → restore to 'pending'.
            // Fallback path: row is still 'pending' → no update needed.
            if (rowsAlreadyClaimed) {
              await db
                .update(embeddingQueue)
                .set({ status: "pending", updatedAt: new Date() })
                .where(eq(embeddingQueue.id, item.id));
            }
            if (!loggedNoKey.has(companyKey)) {
              loggedNoKey.add(companyKey);
              queueLog.warn(
                { companyId: item.companyId, queueId: item.id },
                "no OpenAI key resolved for company — leaving queue rows pending (configure llm:openai in Settings or set OPENAI_API_KEY)",
              );
            }
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

        // ── Mark processing (fallback plain-select path only) ─────────────
        // In the CTE path rows are already 'processing'. In the fallback path
        // we mark here — after key resolution — so skipped (no-key) rows never
        // get marked processing, preserving the T10 contract of zero updates
        // for keyless-skipped rows.
        if (!rowsAlreadyClaimed) {
          await db
            .update(embeddingQueue)
            .set({ status: "processing", updatedAt: new Date() })
            .where(eq(embeddingQueue.id, item.id));
        }

        // ── Embed + write vector ──────────────────────────────────────────
        try {
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
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(embeddingQueue.id, item.id));
          processed++;
        } catch (err) {
          const errClass = classifyEmbeddingError(err);
          const errMsg = err instanceof Error ? err.message : String(err);
          const currentAttempts = (item.attempts ?? 0);

          if (errClass === "systemic") {
            // Open the circuit for this company — don't burn rows to 'failed'.
            // Restore this row to pending WITHOUT bumping attempts.
            const reason = errMsg;
            circuit.set(companyKey, {
              reason,
              until: Date.now() + CIRCUIT_TTL_MS,
            });
            circuitOpenedThisTick.add(companyKey);
            await db
              .update(embeddingQueue)
              .set({
                status: "pending",
                error: errMsg,
                updatedAt: new Date(),
              })
              .where(eq(embeddingQueue.id, item.id));
            queueLog.warn(
              {
                queueId: item.id,
                companyId: item.companyId,
                error: errMsg,
                circuitUntil: new Date(circuit.get(companyKey)!.until).toISOString(),
              },
              "systemic embedding error — circuit opened for company, row restored to pending",
            );
          } else if (errClass === "row_permanent") {
            // Bad input — will never succeed. Mark failed immediately.
            await db
              .update(embeddingQueue)
              .set({
                status: "failed",
                attempts: currentAttempts + 1,
                error: errMsg,
                updatedAt: new Date(),
              })
              .where(eq(embeddingQueue.id, item.id));
            failed++;
            queueLog.warn(
              {
                queueId: item.id,
                targetTable: item.targetTable,
                targetId: item.targetId,
                error: errMsg,
              },
              "row_permanent embedding error — row marked failed immediately (bad input)",
            );
          } else {
            // transient — retry with exponential backoff + jitter.
            const nextAttempts = currentAttempts + 1;
            const finalFailed = nextAttempts >= maxAttempts;

            // Honor Retry-After header if the error carries one.
            const retryAfterMs =
              typeof (err as Record<string, unknown>)?.headers === "object"
                ? parseRetryAfterHeader(
                    (err as Record<string, unknown>).headers as Record<string, string>,
                  )
                : 0;
            const backoffMs = Math.max(
              computeBackoffMs(nextAttempts),
              retryAfterMs,
            );
            const nextRetryAt = finalFailed
              ? null
              : new Date(Date.now() + backoffMs);

            await db
              .update(embeddingQueue)
              .set({
                status: finalFailed ? "failed" : "pending",
                attempts: nextAttempts,
                nextRetryAt,
                error: errMsg,
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
                backoffMs: finalFailed ? null : backoffMs,
                error: errMsg,
              },
              finalFailed
                ? "embedding queue row marked failed after exhausting attempts"
                : "embedding queue row re-queued with backoff",
            );
          }
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
