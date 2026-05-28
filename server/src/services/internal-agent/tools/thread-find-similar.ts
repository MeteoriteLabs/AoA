// server/src/services/internal-agent/tools/thread-find-similar.ts
//
// Task C2 batch 1 — `find_similar_threads` (query tool, HNSW).
//
// Embeds the query text synchronously via the embedding service's
// `embedSync` (added in C2 to the existing embedding service), then runs a
// pgvector cosine-distance (`<=>`) ORDER BY against `discussions.summary_embedding`.
//
// Graceful fallbacks:
//   - If the embedding service isn't wired into the ServiceContainer (e.g.
//     tests, pre-worker startup): return `EMBEDDINGS_UNAVAILABLE`.
//   - If pgvector isn't available (embedded-postgres): the column-NULL
//     filter ensures no rows are returned without crashing.

import { sql, and, eq } from "drizzle-orm";
import { discussions } from "@armyofagents/db";
import type { AgentTool } from "../types.js";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 25;

export const findSimilarThreadsTool: AgentTool = {
  name: "find_similar_threads",
  description:
    "Find threads similar to a text query via embedding cosine similarity (HNSW).",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Query text to find semantically similar threads",
      },
      limit: {
        type: "number",
        description: `Max results (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`,
      },
    },
    required: ["text"],
  },
  category: "query",
  requiredRole: "team_member",
  requiresConfirmation: false,
  async execute(params, ctx) {
    const { text, limit } = (params ?? {}) as {
      text?: string;
      limit?: number;
    };
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return {
        success: false,
        data: null,
        summary: "text is required",
        error: "INVALID_PARAMS",
      };
    }
    const cappedLimit = Math.min(
      typeof limit === "number" && limit > 0 ? limit : DEFAULT_LIMIT,
      MAX_LIMIT,
    );

    const embedSync = ctx.services?.embeddings?.embedSync;
    if (typeof embedSync !== "function") {
      return {
        success: false,
        data: [],
        summary:
          "Embedding service unavailable — find_similar_threads requires a configured embedding service",
        error: "EMBEDDINGS_UNAVAILABLE",
      };
    }

    let vector: number[];
    try {
      vector = await embedSync(text);
    } catch (err: any) {
      return {
        success: false,
        data: [],
        summary: `Embedding failed: ${err?.message ?? "unknown error"}`,
        error: "EMBEDDING_FAILED",
      };
    }

    // pgvector cosine distance via the `<=>` operator. ORDER BY ASC because
    // distance is small-is-similar; LIMIT pulls from the HNSW index when
    // pgvector is available. The summary_embedding IS NOT NULL guard keeps
    // un-embedded rows out of the result set.
    const vectorLiteral = `[${vector.join(",")}]`;
    const rows = await ctx.db
      .select({
        id: discussions.id,
        title: discussions.title,
        summaryText: discussions.summaryText,
        visibility: discussions.visibility,
        phase: discussions.phase,
      })
      .from(discussions)
      .where(
        and(
          eq(discussions.companyId, ctx.companyId),
          sql`${discussions.summaryEmbedding} IS NOT NULL`,
        ),
      )
      .orderBy(sql`${discussions.summaryEmbedding} <=> ${vectorLiteral}::vector`)
      .limit(cappedLimit);
    const list = Array.isArray(rows) ? rows : [];
    return {
      success: true,
      data: list,
      summary: `Found ${list.length} similar thread(s)`,
    };
  },
};
