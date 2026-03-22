import { and, eq, ilike, or, sql, desc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, memoryItems, memoryItemVersions, suggestions } from "@paperclipai/db";
import { MEMORY_ITEM_LAYERS } from "@paperclipai/shared";
import { generateEmbedding } from "./embeddings.js";
import { resolveApiKey } from "../adapters/api-common.js";
import { logger } from "../middleware/logger.js";
import { badRequest, conflict, notFound } from "../errors.js";

const log = logger.child({ service: "memory" });

export interface MemoryFilters {
  category?: string;
  status?: string;
  source?: string;
  departmentId?: string;
  projectId?: string;
  layer?: string;
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

function isValidLayer(layer: string | null | undefined): boolean {
  return !!layer && MEMORY_ITEM_LAYERS.includes(layer as (typeof MEMORY_ITEM_LAYERS)[number]);
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
      if (filters.layer) {
        conditions.push(eq(memoryItems.layer, filters.layer));
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

    create: (
      companyId: string,
      data: Omit<typeof memoryItems.$inferInsert, "companyId">,
      tx?: Parameters<Parameters<typeof db.transaction>[0]>[0],
    ) => {
      // Critical rule #6: Founder-created items are auto-approved; all others default to pending
      // Respect explicit status when provided (e.g. from brief approval where founder has already approved)
      if (data.source === "agent") {
        if (!isValidLayer(data.layer)) {
          throw badRequest("Agent memory suggestions must include a valid layer");
        }
        if (!data.sourceContext?.trim()) {
          throw badRequest("sourceContext is required for agent memory suggestions");
        }
      }
      const status = data.source === "agent"
        ? "pending"
        : (data.status ?? (data.source === "founder" ? "approved" : "pending"));
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

    // ── Version management ──────────────────────────────────────────────

    getVersionHistory: (memoryItemId: string) =>
      db
        .select()
        .from(memoryItemVersions)
        .where(eq(memoryItemVersions.memoryItemId, memoryItemId))
        .orderBy(desc(memoryItemVersions.versionNumber)),

    suggestUpdate: async (
      companyId: string,
      memoryItemId: string,
      content: string,
      sourceContext: string,
      agentId: string,
    ) => {
      if (!content.trim()) {
        throw badRequest("content is required");
      }
      if (!sourceContext.trim()) {
        throw badRequest("sourceContext is required");
      }

      const item = await db
        .select()
        .from(memoryItems)
        .where(and(eq(memoryItems.id, memoryItemId), eq(memoryItems.companyId, companyId)))
        .then((rows) => rows[0] ?? null);

      if (!item) {
        throw notFound("Memory item not found");
      }
      if (item.status !== "approved") {
        throw conflict("Memory item must be approved before agents can suggest updates");
      }

      const existingPending = await db
        .select()
        .from(memoryItemVersions)
        .where(
          and(
            eq(memoryItemVersions.memoryItemId, memoryItemId),
            eq(memoryItemVersions.status, "pending"),
            eq(memoryItemVersions.createdBy, agentId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (existingPending) {
        return db
          .update(memoryItemVersions)
          .set({ content })
          .where(eq(memoryItemVersions.id, existingPending.id))
          .returning()
          .then((rows) => rows[0]);
      }

      const latest = await db
        .select({ versionNumber: memoryItemVersions.versionNumber })
        .from(memoryItemVersions)
        .where(eq(memoryItemVersions.memoryItemId, memoryItemId))
        .orderBy(desc(memoryItemVersions.versionNumber))
        .limit(1)
        .then((rows) => rows[0]?.versionNumber ?? 0);

      return db
        .insert(memoryItemVersions)
        .values({
          memoryItemId,
          versionNumber: latest + 1,
          content,
          status: "pending",
          createdBy: agentId,
        })
        .returning()
        .then((rows) => rows[0]);
    },

    approveSuggestedVersion: async (companyId: string, memoryItemId: string, versionId: string) => {
      const item = await db
        .select()
        .from(memoryItems)
        .where(and(eq(memoryItems.id, memoryItemId), eq(memoryItems.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!item) {
        throw notFound("Memory item not found");
      }

      const version = await db
        .select()
        .from(memoryItemVersions)
        .where(
          and(
            eq(memoryItemVersions.id, versionId),
            eq(memoryItemVersions.memoryItemId, memoryItemId),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!version) {
        throw notFound("Memory version not found");
      }
      if (version.status !== "pending") {
        throw conflict("Only pending versions can be approved");
      }

      return db.transaction(async (tx) => {
        if (item.currentVersionId && item.currentVersionId !== version.id) {
          await tx
            .update(memoryItemVersions)
            .set({ status: "archived" })
            .where(eq(memoryItemVersions.id, item.currentVersionId));
        }

        const approved = await tx
          .update(memoryItemVersions)
          .set({ status: "approved" })
          .where(eq(memoryItemVersions.id, version.id))
          .returning()
          .then((rows) => rows[0]);

        await tx
          .update(memoryItems)
          .set({
            content: version.content,
            currentVersionId: version.id,
            updatedAt: new Date(),
          })
          .where(eq(memoryItems.id, memoryItemId));

        return approved;
      });
    },

    rejectSuggestedVersion: async (companyId: string, memoryItemId: string, versionId: string) => {
      const item = await db
        .select({ id: memoryItems.id })
        .from(memoryItems)
        .where(and(eq(memoryItems.id, memoryItemId), eq(memoryItems.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!item) {
        throw notFound("Memory item not found");
      }

      const version = await db
        .update(memoryItemVersions)
        .set({ status: "rejected" })
        .where(
          and(
            eq(memoryItemVersions.id, versionId),
            eq(memoryItemVersions.memoryItemId, memoryItemId),
            eq(memoryItemVersions.status, "pending"),
          ),
        )
        .returning()
        .then((rows) => rows[0] ?? null);

      if (!version) {
        throw notFound("Pending memory version not found");
      }

      return version;
    },

    saveDraft: async (companyId: string, memoryItemId: string, content: string, createdBy: string) => {
      const item = await db
        .select()
        .from(memoryItems)
        .where(and(eq(memoryItems.id, memoryItemId), eq(memoryItems.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!item) return null;

      // Find the latest version number
      const latest = await db
        .select({ versionNumber: memoryItemVersions.versionNumber })
        .from(memoryItemVersions)
        .where(eq(memoryItemVersions.memoryItemId, memoryItemId))
        .orderBy(desc(memoryItemVersions.versionNumber))
        .limit(1)
        .then((rows) => rows[0]?.versionNumber ?? 0);

      // Check for existing draft by this user
      const existingDraft = await db
        .select()
        .from(memoryItemVersions)
        .where(
          and(
            eq(memoryItemVersions.memoryItemId, memoryItemId),
            eq(memoryItemVersions.status, "draft"),
            eq(memoryItemVersions.createdBy, createdBy),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (existingDraft) {
        // Update existing draft
        return db
          .update(memoryItemVersions)
          .set({ content })
          .where(eq(memoryItemVersions.id, existingDraft.id))
          .returning()
          .then((rows) => rows[0]);
      }

      // Create new draft version
      return db
        .insert(memoryItemVersions)
        .values({
          memoryItemId,
          versionNumber: latest + 1,
          content,
          status: "draft",
          createdBy,
        })
        .returning()
        .then((rows) => rows[0]);
    },

    publishDraft: async (companyId: string, memoryItemId: string, createdBy: string) => {
      const item = await db
        .select()
        .from(memoryItems)
        .where(and(eq(memoryItems.id, memoryItemId), eq(memoryItems.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!item) return null;

      // Find the draft version by this user
      const draft = await db
        .select()
        .from(memoryItemVersions)
        .where(
          and(
            eq(memoryItemVersions.memoryItemId, memoryItemId),
            eq(memoryItemVersions.status, "draft"),
            eq(memoryItemVersions.createdBy, createdBy),
          ),
        )
        .then((rows) => rows[0] ?? null);
      if (!draft) return null;

      // Wrap all mutations in a transaction for consistency
      return db.transaction(async (tx) => {
        // Archive the current approved version if any
        if (item.currentVersionId) {
          await tx
            .update(memoryItemVersions)
            .set({ status: "archived" })
            .where(eq(memoryItemVersions.id, item.currentVersionId));
        }

        // Publish the draft
        const published = await tx
          .update(memoryItemVersions)
          .set({ status: "approved" })
          .where(eq(memoryItemVersions.id, draft.id))
          .returning()
          .then((rows) => rows[0]);

        // Update the memory item content and currentVersionId
        await tx
          .update(memoryItems)
          .set({
            content: draft.content,
            currentVersionId: draft.id,
            updatedAt: new Date(),
          })
          .where(eq(memoryItems.id, memoryItemId));

        return published;
      });
    },

    restore: async (companyId: string, id: string) => {
      const item = await db
        .select()
        .from(memoryItems)
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!item || item.status !== "archived") return null;

      return db
        .update(memoryItems)
        .set({ status: "approved", updatedAt: new Date() })
        .where(eq(memoryItems.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    suggestArchive: async (
      companyId: string,
      memoryItemId: string,
      sourceContext: string,
      agentId: string,
    ) => {
      if (!sourceContext.trim()) {
        throw badRequest("sourceContext is required");
      }

      const item = await db
        .select()
        .from(memoryItems)
        .where(and(eq(memoryItems.id, memoryItemId), eq(memoryItems.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      if (!item) {
        throw notFound("Memory item not found");
      }
      if (item.status !== "approved") {
        throw conflict("Only approved memory items can be archived");
      }

      const agent = await db
        .select({ name: agents.name })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
      const agentName = agent?.name ?? agentId;

      const existing = await db
        .select()
        .from(suggestions)
        .where(
          and(
            eq(suggestions.companyId, companyId),
            eq(suggestions.category, "agent_proposal"),
            eq(suggestions.actionType, "archive_memory"),
            eq(suggestions.status, "pending"),
            eq(suggestions.relatedMemoryItemId, memoryItemId),
            sql`${suggestions.actionPayload}->>'agentId' = ${agentId}`,
          ),
        )
        .then((rows) => rows[0] ?? null);

      const title = `Agent ${agentName} suggests archiving '${item.title}'`;
      const actionPayload = {
        memoryItemId,
        reason: sourceContext,
        agentId,
      };

      if (existing) {
        return db
          .update(suggestions)
          .set({
            title,
            actionPayload,
            updatedAt: new Date(),
          })
          .where(eq(suggestions.id, existing.id))
          .returning()
          .then((rows) => rows[0]);
      }

      return db
        .insert(suggestions)
        .values({
          companyId,
          category: "agent_proposal",
          actionType: "archive_memory",
          actionPayload,
          title,
          relatedMemoryItemId: memoryItemId,
        })
        .returning()
        .then((rows) => rows[0]);
    },

    listPending: async (companyId: string) => {
      const [items, versionRows, archiveRows] = await Promise.all([
        db
          .select()
          .from(memoryItems)
          .where(
            and(
              eq(memoryItems.companyId, companyId),
              eq(memoryItems.status, "pending"),
              eq(memoryItems.source, "agent"),
            ),
          ),
        db
          .select({
            itemId: memoryItems.id,
            itemTitle: memoryItems.title,
            itemLayer: memoryItems.layer,
            itemCategory: memoryItems.category,
            itemSource: memoryItems.source,
            currentContent: memoryItems.content,
            currentVersionId: memoryItems.currentVersionId,
            versionId: memoryItemVersions.id,
            memoryItemId: memoryItemVersions.memoryItemId,
            versionNumber: memoryItemVersions.versionNumber,
            versionContent: memoryItemVersions.content,
            versionStatus: memoryItemVersions.status,
            versionCreatedBy: memoryItemVersions.createdBy,
            versionCreatedAt: memoryItemVersions.createdAt,
          })
          .from(memoryItemVersions)
          .innerJoin(memoryItems, eq(memoryItemVersions.memoryItemId, memoryItems.id))
          .where(
            and(
              eq(memoryItems.companyId, companyId),
              eq(memoryItemVersions.status, "pending"),
              eq(memoryItems.status, "approved"),
            ),
          )
          .orderBy(desc(memoryItemVersions.createdAt)),
        db
          .select({
            suggestionId: suggestions.id,
            suggestionCompanyId: suggestions.companyId,
            suggestionCategory: suggestions.category,
            suggestionActionType: suggestions.actionType,
            suggestionActionPayload: suggestions.actionPayload,
            suggestionTitle: suggestions.title,
            suggestionEvidence: suggestions.evidence,
            suggestionStatus: suggestions.status,
            suggestionExpiresAt: suggestions.expiresAt,
            suggestionRelatedMemoryItemId: suggestions.relatedMemoryItemId,
            suggestionCreatedAt: suggestions.createdAt,
            suggestionUpdatedAt: suggestions.updatedAt,
            itemId: memoryItems.id,
            itemCompanyId: memoryItems.companyId,
            itemTitle: memoryItems.title,
            itemContent: memoryItems.content,
            itemCategory: memoryItems.category,
            itemSource: memoryItems.source,
            itemStatus: memoryItems.status,
            itemTags: memoryItems.tags,
            itemDepartmentId: memoryItems.departmentId,
            itemProjectId: memoryItems.projectId,
            itemCreatedBy: memoryItems.createdBy,
            itemLayer: memoryItems.layer,
            itemPriority: memoryItems.priority,
            itemVisibility: memoryItems.visibility,
            itemExpiresAt: memoryItems.expiresAt,
            itemGoalId: memoryItems.goalId,
            itemTaskId: memoryItems.taskId,
            itemSourceArtifactId: memoryItems.sourceArtifactId,
            itemSourceContext: memoryItems.sourceContext,
            itemAccessedAt: memoryItems.accessedAt,
            itemCurrentVersionId: memoryItems.currentVersionId,
            itemCreatedAt: memoryItems.createdAt,
            itemUpdatedAt: memoryItems.updatedAt,
          })
          .from(suggestions)
          .innerJoin(memoryItems, eq(suggestions.relatedMemoryItemId, memoryItems.id))
          .where(
            and(
              eq(suggestions.companyId, companyId),
              eq(suggestions.category, "agent_proposal"),
              eq(suggestions.actionType, "archive_memory"),
              eq(suggestions.status, "pending"),
            ),
          )
          .orderBy(desc(suggestions.createdAt)),
      ]);

      const versions = versionRows.map((row) => ({
        itemId: row.itemId,
        itemTitle: row.itemTitle,
        itemLayer: row.itemLayer,
        itemCategory: row.itemCategory,
        itemSource: row.itemSource,
        currentContent: row.currentContent,
        currentVersionId: row.currentVersionId,
        version: {
          id: row.versionId,
          memoryItemId: row.memoryItemId,
          versionNumber: row.versionNumber,
          content: row.versionContent,
          status: row.versionStatus,
          createdBy: row.versionCreatedBy,
          createdAt: row.versionCreatedAt,
        },
      }));

      const archives = archiveRows.map((row) => ({
        item: {
          id: row.itemId,
          companyId: row.itemCompanyId,
          title: row.itemTitle,
          content: row.itemContent,
          category: row.itemCategory,
          source: row.itemSource,
          status: row.itemStatus,
          tags: row.itemTags,
          departmentId: row.itemDepartmentId,
          projectId: row.itemProjectId,
          createdBy: row.itemCreatedBy,
          layer: row.itemLayer,
          priority: row.itemPriority,
          visibility: row.itemVisibility,
          expiresAt: row.itemExpiresAt,
          goalId: row.itemGoalId,
          taskId: row.itemTaskId,
          sourceArtifactId: row.itemSourceArtifactId,
          sourceContext: row.itemSourceContext,
          accessedAt: row.itemAccessedAt,
          currentVersionId: row.itemCurrentVersionId,
          createdAt: row.itemCreatedAt,
          updatedAt: row.itemUpdatedAt,
        },
        suggestion: {
          id: row.suggestionId,
          companyId: row.suggestionCompanyId,
          category: row.suggestionCategory,
          actionType: row.suggestionActionType,
          actionPayload: row.suggestionActionPayload,
          title: row.suggestionTitle,
          evidence: row.suggestionEvidence,
          status: row.suggestionStatus,
          expiresAt: row.suggestionExpiresAt,
          relatedMemoryItemId: row.suggestionRelatedMemoryItemId,
          createdAt: row.suggestionCreatedAt,
          updatedAt: row.suggestionUpdatedAt,
        },
      }));

      return {
        items,
        versions,
        archives,
        totalCount: items.length + versions.length + archives.length,
      };
    },

    touchAccessedAt: (companyId: string, id: string) =>
      db
        .update(memoryItems)
        .set({ accessedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .returning()
        .then((rows) => rows[0] ?? null),
  };
}
