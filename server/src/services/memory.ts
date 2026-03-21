import { and, eq, ilike, or, sql, desc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { memoryItems } from "@paperclipai/db";
import { generateEmbedding } from "./embeddings.js";
import { resolveApiKey } from "../adapters/api-common.js";
import { logger } from "../middleware/logger.js";

const log = logger.child({ service: "memory" });

export interface MemoryFilters {
  category?: string;
  status?: string;
  source?: string;
  departmentId?: string;
  projectId?: string;
  tags?: string[];
  search?: string;
}

export interface SemanticSearchFilters {
  layer?: string;
  departmentId?: string;
  limit?: number;
}

export interface FindSimilarScope {
  companyId: string;
  departmentId?: string;
  layer?: string;
}

export function memoryService(db: Db) {
  return {
    list: (companyId: string, filters: MemoryFilters = {}) => {
      const conditions = [eq(memoryItems.companyId, companyId)];

      if (filters.category) {
        conditions.push(eq(memoryItems.category, filters.category));
      }
      if (filters.status) {
        conditions.push(eq(memoryItems.status, filters.status));
      }
      if (filters.source) {
        conditions.push(eq(memoryItems.source, filters.source));
      }
      if (filters.departmentId) {
        conditions.push(eq(memoryItems.departmentId, filters.departmentId));
      }
      if (filters.projectId) {
        conditions.push(eq(memoryItems.projectId, filters.projectId));
      }
      if (filters.search) {
        conditions.push(
          or(
            ilike(memoryItems.title, `%${filters.search}%`),
            ilike(memoryItems.content, `%${filters.search}%`),
          )!,
        );
      }
      if (filters.tags && filters.tags.length > 0) {
        // Check if any of the requested tags exist in the JSONB tags array
        for (const tag of filters.tags) {
          conditions.push(sql`${memoryItems.tags} @> ${JSON.stringify([tag])}::jsonb`);
        }
      }

      return db.select().from(memoryItems).where(and(...conditions));
    },

    getById: (companyId: string, id: string) =>
      db
        .select()
        .from(memoryItems)
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .then((rows) => rows[0] ?? null),

    create: (companyId: string, data: Omit<typeof memoryItems.$inferInsert, "companyId">, tx?: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
      // Critical rule #6: Founder-created items are auto-approved; all others default to pending
      // Respect explicit status when provided (e.g. from brief approval where founder has already approved)
      const status = data.status ?? (data.source === "founder" ? "approved" : "pending");
      // Embedding is always NULL on create — background worker generates it asynchronously
      return (tx ?? db)
        .insert(memoryItems)
        .values({ ...data, companyId, status, embedding: null })
        .returning()
        .then((rows) => rows[0]);
    },

    update: (companyId: string, id: string, data: Partial<typeof memoryItems.$inferInsert>) => {
      // If content or title changed, invalidate embedding so background worker regenerates it
      const hasContentChange = data.content !== undefined || data.title !== undefined;
      const setData: Record<string, unknown> = { ...data, updatedAt: new Date() };
      if (hasContentChange) {
        setData.embedding = null;
      }
      return db
        .update(memoryItems)
        .set(setData)
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    remove: (companyId: string, id: string) =>
      db
        .delete(memoryItems)
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .returning()
        .then((rows) => rows[0] ?? null),

    approve: (companyId: string, id: string) =>
      db
        .update(memoryItems)
        .set({ status: "approved", updatedAt: new Date() })
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .returning()
        .then((rows) => rows[0] ?? null),

    reject: (companyId: string, id: string) =>
      db
        .update(memoryItems)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .returning()
        .then((rows) => rows[0] ?? null),

    /**
     * Semantic search: embed the query text and find memory items by cosine similarity.
     * Falls back to text-based ilike search when embeddings are unavailable (no API key).
     */
    searchSemantic: async (
      companyId: string,
      query: string,
      filters: SemanticSearchFilters = {},
    ) => {
      const limit = filters.limit ?? 10;

      // Try to get API key for embedding generation
      let apiKey: string | null = null;
      try {
        apiKey = await resolveApiKey(companyId, "openai");
      } catch {
        // No API key — fall back to text search
      }

      if (apiKey) {
        try {
          const queryEmbedding = await generateEmbedding(query, apiKey);
          const vectorStr = `[${queryEmbedding.join(",")}]`;

          const conditions = [
            eq(memoryItems.companyId, companyId),
            eq(memoryItems.status, "approved"),
            sql`${memoryItems.embedding} IS NOT NULL`,
          ];

          if (filters.layer) {
            conditions.push(eq(memoryItems.layer, filters.layer));
          }
          if (filters.departmentId) {
            conditions.push(eq(memoryItems.departmentId, filters.departmentId));
          }

          const results = await db
            .select({
              id: memoryItems.id,
              companyId: memoryItems.companyId,
              title: memoryItems.title,
              content: memoryItems.content,
              category: memoryItems.category,
              source: memoryItems.source,
              status: memoryItems.status,
              tags: memoryItems.tags,
              departmentId: memoryItems.departmentId,
              projectId: memoryItems.projectId,
              layer: memoryItems.layer,
              priority: memoryItems.priority,
              similarity: sql<number>`1 - (${memoryItems.embedding} <=> ${vectorStr}::vector)`.as("similarity"),
              createdAt: memoryItems.createdAt,
              updatedAt: memoryItems.updatedAt,
            })
            .from(memoryItems)
            .where(and(...conditions))
            .orderBy(sql`${memoryItems.embedding} <=> ${vectorStr}::vector`)
            .limit(limit);

          return results;
        } catch (err: any) {
          log.warn({ error: err.message }, "Semantic search failed, falling back to text search");
        }
      }

      // Fallback: text-based search
      const conditions = [
        eq(memoryItems.companyId, companyId),
        eq(memoryItems.status, "approved"),
        or(
          ilike(memoryItems.title, `%${query}%`),
          ilike(memoryItems.content, `%${query}%`),
        )!,
      ];

      if (filters.layer) {
        conditions.push(eq(memoryItems.layer, filters.layer));
      }
      if (filters.departmentId) {
        conditions.push(eq(memoryItems.departmentId, filters.departmentId));
      }

      const textResults = await db
        .select({
          id: memoryItems.id,
          companyId: memoryItems.companyId,
          title: memoryItems.title,
          content: memoryItems.content,
          category: memoryItems.category,
          source: memoryItems.source,
          status: memoryItems.status,
          tags: memoryItems.tags,
          departmentId: memoryItems.departmentId,
          projectId: memoryItems.projectId,
          layer: memoryItems.layer,
          priority: memoryItems.priority,
          similarity: sql<number>`NULL`.as("similarity"),
          createdAt: memoryItems.createdAt,
          updatedAt: memoryItems.updatedAt,
        })
        .from(memoryItems)
        .where(and(...conditions))
        .orderBy(desc(memoryItems.priority), desc(memoryItems.updatedAt))
        .limit(limit);

      return textResults;
    },

    /**
     * Find memory items with cosine similarity > 0.85 to the given content.
     * Used for dedup detection by the brief pipeline and manual checks.
     * Falls back to text-based overlap when embeddings are unavailable.
     */
    findSimilarItems: async (content: string, scope: FindSimilarScope) => {
      const SIMILARITY_THRESHOLD = 0.85;

      let apiKey: string | null = null;
      try {
        apiKey = await resolveApiKey(scope.companyId, "openai");
      } catch {
        // No API key — fall back to text search
      }

      if (apiKey) {
        try {
          const contentEmbedding = await generateEmbedding(content, apiKey);
          const vectorStr = `[${contentEmbedding.join(",")}]`;

          const conditions = [
            eq(memoryItems.companyId, scope.companyId),
            eq(memoryItems.status, "approved"),
            sql`${memoryItems.embedding} IS NOT NULL`,
            sql`1 - (${memoryItems.embedding} <=> ${vectorStr}::vector) > ${SIMILARITY_THRESHOLD}`,
          ];

          if (scope.departmentId) {
            conditions.push(eq(memoryItems.departmentId, scope.departmentId));
          }
          if (scope.layer) {
            conditions.push(eq(memoryItems.layer, scope.layer));
          }

          const results = await db
            .select({
              id: memoryItems.id,
              companyId: memoryItems.companyId,
              title: memoryItems.title,
              content: memoryItems.content,
              category: memoryItems.category,
              source: memoryItems.source,
              status: memoryItems.status,
              tags: memoryItems.tags,
              departmentId: memoryItems.departmentId,
              projectId: memoryItems.projectId,
              layer: memoryItems.layer,
              priority: memoryItems.priority,
              similarity: sql<number>`1 - (${memoryItems.embedding} <=> ${vectorStr}::vector)`.as("similarity"),
              createdAt: memoryItems.createdAt,
              updatedAt: memoryItems.updatedAt,
            })
            .from(memoryItems)
            .where(and(...conditions))
            .orderBy(sql`${memoryItems.embedding} <=> ${vectorStr}::vector`)
            .limit(20);

          return results;
        } catch (err: any) {
          log.warn({ error: err.message }, "Similarity search failed, falling back to text overlap");
        }
      }

      // Fallback: text-based search using word overlap
      // Find items that share significant word overlap (>60%) with the content
      const words = content
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      if (words.length === 0) return [];

      // Use ilike to find potential matches, then filter by word overlap in-app
      const uniqueWords = [...new Set(words)];
      const searchTerms = uniqueWords.slice(0, 5); // Use top 5 unique words

      const conditions = [
        eq(memoryItems.companyId, scope.companyId),
        eq(memoryItems.status, "approved"),
      ];

      if (scope.departmentId) {
        conditions.push(eq(memoryItems.departmentId, scope.departmentId));
      }
      if (scope.layer) {
        conditions.push(eq(memoryItems.layer, scope.layer));
      }

      // Find candidates matching any search term
      const termConditions = searchTerms.map((term) =>
        or(
          ilike(memoryItems.title, `%${term}%`),
          ilike(memoryItems.content, `%${term}%`),
        )!,
      );

      const candidates = await db
        .select({
          id: memoryItems.id,
          companyId: memoryItems.companyId,
          title: memoryItems.title,
          content: memoryItems.content,
          category: memoryItems.category,
          source: memoryItems.source,
          status: memoryItems.status,
          tags: memoryItems.tags,
          departmentId: memoryItems.departmentId,
          projectId: memoryItems.projectId,
          layer: memoryItems.layer,
          priority: memoryItems.priority,
          createdAt: memoryItems.createdAt,
          updatedAt: memoryItems.updatedAt,
        })
        .from(memoryItems)
        .where(and(...conditions, or(...termConditions)))
        .limit(50);

      // Filter by word overlap > 60%
      return candidates
        .map((item) => {
          const itemWords = new Set(
            `${item.title} ${item.content}`
              .toLowerCase()
              .split(/\s+/)
              .filter((w) => w.length > 2),
          );
          const overlap = uniqueWords.filter((w) => itemWords.has(w)).length;
          const overlapRatio = overlap / uniqueWords.length;
          return { ...item, similarity: overlapRatio as number };
        })
        .filter((item) => item.similarity > 0.6)
        .sort((a, b) => b.similarity - a.similarity);
    },
  };
}
