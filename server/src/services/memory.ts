import { and, eq, ilike, or, sql, desc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { memoryItems, memoryItemVersions } from "@paperclipai/db";

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

    create: (companyId: string, data: Omit<typeof memoryItems.$inferInsert, "companyId">, tx?: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
      // Critical rule #6: Founder-created items are auto-approved; all others default to pending
      // Respect explicit status when provided (e.g. from brief approval where founder has already approved)
      const status = data.status ?? (data.source === "founder" ? "approved" : "pending");
      return (tx ?? db)
        .insert(memoryItems)
        .values({ ...data, companyId, status })
        .returning()
        .then((rows) => rows[0]);
    },

    update: (companyId: string, id: string, data: Partial<typeof memoryItems.$inferInsert>) =>
      db
        .update(memoryItems)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .returning()
        .then((rows) => rows[0] ?? null),

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

    // ── Version management ──────────────────────────────────────────────

    getVersionHistory: (memoryItemId: string) =>
      db
        .select()
        .from(memoryItemVersions)
        .where(eq(memoryItemVersions.memoryItemId, memoryItemId))
        .orderBy(desc(memoryItemVersions.versionNumber)),

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

    listPending: (companyId: string) =>
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

    touchAccessedAt: (companyId: string, id: string) =>
      db
        .update(memoryItems)
        .set({ accessedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .returning()
        .then((rows) => rows[0] ?? null),
  };
}
