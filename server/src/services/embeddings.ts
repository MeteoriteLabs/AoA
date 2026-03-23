import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { memoryItems } from "@paperclipai/db";
import { resolveApiKey } from "../adapters/api-common.js";
import { logger } from "../middleware/logger.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_API_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_DIMENSIONS = 1536;
const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

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

  // Process each item individually so failures are tracked per-item
  for (const item of pending) {
    try {
      const embedding = await generateEmbedding(`${item.title}\n${item.content}`, apiKey);
      const vectorStr = toVectorString(embedding);
      await db
        .update(memoryItems)
        .set({ embedding: sql`${vectorStr}::vector`, embeddingRetries: 0 })
        .where(eq(memoryItems.id, item.id));
      processed++;
    } catch (err: any) {
      await db
        .update(memoryItems)
        .set({ embeddingRetries: sql`${memoryItems.embeddingRetries} + 1` })
        .where(eq(memoryItems.id, item.id));
      log.warn({ itemId: item.id, error: err.message }, "Embedding failed, incremented retry count");
    }
  }

  log.info({ companyId, processed, total: pending.length }, "Embedding queue processed");
  return processed;
}

/**
 * Invalidate embedding for a memory item (set to NULL).
 * Called when content is updated to trigger re-generation.
 */
export async function invalidateEmbedding(db: Db, itemId: string): Promise<void> {
  await db
    .update(memoryItems)
    .set({ embedding: sql`NULL`, embeddingRetries: 0 } as any)
    .where(eq(memoryItems.id, itemId));
}
