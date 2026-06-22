/**
 * Write-behind embedding worker (Task B1, Decision D2).
 *
 * Thin wrapper around OpenAI's embeddings API + the `createEmbeddingService`
 * factory. Sets up the ticking loop that drains the `embedding_queue` table.
 *
 * Design notes:
 *   - The first tick is delayed via `setTimeout` so app startup is never
 *     blocked by a slow OpenAI call.
 *   - Missing `OPENAI_API_KEY` is a soft warning — we still register the
 *     worker so that any rows already enqueued surface as auth errors via
 *     the normal failure path. (Alternatively a caller can pass `apiKey`
 *     explicitly when wiring the worker.)
 *   - `stop()` is racy with an in-flight `processQueue()`; we set the flag
 *     then trust the tick to exit at its next checkpoint. Callers that need
 *     hard shutdown should drain the queue first.
 */

import OpenAI from "openai";
import type { Db } from "@armyofagents/db";
import { logger } from "../middleware/logger.js";
import { createEmbeddingService, type EmbeddingService } from "./embeddings.js";

const log = logger.child({ service: "embedding-worker" });

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_INITIAL_DELAY_MS = 1000;

export interface EmbeddingWorkerConfig {
  /** Interval between worker ticks once the queue is drained. */
  intervalMs: number;
  /** Max rows to process per tick. Default 50. */
  batchSize?: number;
  /** OpenAI embedding model. Default 'text-embedding-3-small'. */
  model?: string;
  /**
   * OpenAI API key. If omitted, reads `process.env.OPENAI_API_KEY`. When
   * neither is present, the worker is registered but every tick will fail
   * with an auth error — the queue rows surface as 'failed' after the usual
   * retry exhaustion.
   */
  apiKey?: string;
  /** Initial delay before the first tick. Default 1000ms. */
  initialDelayMs?: number;
}

export interface EmbeddingWorkerHandle {
  /** Best-effort stop — the current in-flight tick will still finish. */
  stop(): void;
  /** Direct access to the service (useful for tests / route handlers). */
  service: EmbeddingService;
}

/**
 * Start the embedding worker. Returns immediately with a handle; the first
 * tick fires after `initialDelayMs` so app startup is non-blocking.
 *
 * Callers should `stop()` on graceful shutdown.
 */
export function startEmbeddingWorker(
  db: Db,
  config: EmbeddingWorkerConfig,
): EmbeddingWorkerHandle {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.warn(
      "OPENAI_API_KEY is not set — embedding worker will run but every tick will fail with an auth error. " +
        "Set OPENAI_API_KEY in the server environment to enable write-behind embeddings.",
    );
  }

  // The OpenAI SDK constructor THROWS on a missing key ("Missing credentials.
  // Please pass an `apiKey`…"), which would crash server boot since this worker
  // starts unconditionally (index.ts). The worker is intentionally registered
  // even without a key (see header) so enqueued rows surface auth errors at
  // tick time — pass a placeholder so construction succeeds and the auth
  // failure lands inside the guarded tick instead of taking down the process.
  const openai = new OpenAI({ apiKey: apiKey ?? "missing-openai-api-key" });
  const model = config.model ?? DEFAULT_MODEL;
  const batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
  const initialDelayMs = config.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;

  const service = createEmbeddingService(db, {
    async embed(text: string) {
      const r = await openai.embeddings.create({ model, input: text });
      const embedding = r.data[0]?.embedding;
      if (!embedding) {
        throw new Error("OpenAI returned no embedding data");
      }
      return embedding as number[];
    },
  });

  let stopped = false;
  let nextTimer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const result = await service.processQueue({ batchSize });
      // Don't spam logs on quiet ticks. Only log on activity or failure.
      if (result.failed > 0) {
        log.warn(
          {
            processed: result.processed,
            failed: result.failed,
            remaining: result.remaining,
          },
          "embedding worker tick produced failures",
        );
      } else if (result.processed > 0) {
        log.debug(
          {
            processed: result.processed,
            remaining: result.remaining,
          },
          "embedding worker tick drained queue rows",
        );
      }
    } catch (err) {
      log.error({ err }, "embedding worker tick failed");
    }
    if (!stopped) {
      nextTimer = setTimeout(() => void tick(), config.intervalMs);
    }
  };

  // Defer the first tick so app startup isn't blocked.
  nextTimer = setTimeout(() => void tick(), initialDelayMs);

  return {
    stop() {
      stopped = true;
      if (nextTimer) {
        clearTimeout(nextTimer);
        nextTimer = null;
      }
    },
    service,
  };
}
