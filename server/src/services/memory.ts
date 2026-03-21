import { and, eq, ilike, or, sql, desc, max } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { memoryItems, memoryItemVersions } from "@paperclipai/db";

export interface MemoryFilters {
  category?: string;
  status?: string;
  source?: string;
  departmentId?: string;
  projectId?: string;
  tags?: string[];
  search?: string;
  layer?: string;
}

type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function memoryService(db: Db) {
  // Helper: get next version number within a transaction
  async function nextVersionNumber(txn: DbTx | Db, itemId: string): Promise<number> {
    const rows = await txn
      .select({ maxVer: max(memoryItemVersions.versionNumber) })
      .from(memoryItemVersions)
      .where(eq(memoryItemVersions.memoryItemId, itemId));
    return (rows[0]?.maxVer ?? 0) + 1;
  }

  return {
    // 1. create
    async create(
      companyId: string,
      data: Omit<typeof memoryItems.$inferInsert, "companyId" | "createdBy">,
      createdBy: string,
      isFounder: boolean,
      tx?: Parameters<Parameters<typeof db.transaction>[0]>[0],
    ) {
      const run = async (txn: DbTx | Db) => {
        const versionStatus = isFounder ? "approved" : "pending";
        const itemStatus = data.status ?? (isFounder ? "approved" : "pending");

        // Insert item first (no currentVersionId yet)
        const [item] = await txn
          .insert(memoryItems)
          .values({ ...data, companyId, createdBy, status: itemStatus, currentVersionId: null })
          .returning();

        // Insert first version
        const [version] = await txn
          .insert(memoryItemVersions)
          .values({
            memoryItemId: item.id,
            versionNumber: 1,
            content: data.content,
            status: versionStatus,
            createdBy,
          })
          .returning();

        if (isFounder) {
          // Point item at the approved version and cache content
          const [updated] = await txn
            .update(memoryItems)
            .set({ currentVersionId: version.id, updatedAt: new Date() })
            .where(eq(memoryItems.id, item.id))
            .returning();
          return updated;
        }

        return item;
      };

      if (tx) return run(tx as unknown as DbTx);
      return db.transaction(async (txn) => run(txn as unknown as DbTx));
    },

    // 2. update
    async update(
      companyId: string,
      id: string,
      data: Partial<typeof memoryItems.$inferInsert>,
      editedBy: string,
      isFounder: boolean,
    ) {
      return db.transaction(async (tx) => {
        // Verify item belongs to company
        const existing = await tx
          .select()
          .from(memoryItems)
          .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
          .then((rows) => rows[0] ?? null);

        if (!existing) return null;

        const hasContentChange = data.content !== undefined && data.content !== existing.content;

        // No content change + agent → nothing to do
        if (!hasContentChange && !isFounder) return null;

        // No content change + founder → just update metadata
        if (!hasContentChange && isFounder) {
          const [updated] = await tx
            .update(memoryItems)
            .set({ ...data, updatedAt: new Date() })
            .where(eq(memoryItems.id, id))
            .returning();
          return updated;
        }

        // Content changed → insert new immutable version
        const nextVer = await nextVersionNumber(tx, id);
        const versionStatus = isFounder ? "approved" : "pending";

        const [version] = await tx
          .insert(memoryItemVersions)
          .values({
            memoryItemId: id,
            versionNumber: nextVer,
            content: data.content as string,
            status: versionStatus,
            createdBy: editedBy,
          })
          .returning();

        if (isFounder) {
          // Update currentVersionId + denormalized content + any metadata
          const [updated] = await tx
            .update(memoryItems)
            .set({ ...data, currentVersionId: version.id, updatedAt: new Date() })
            .where(eq(memoryItems.id, id))
            .returning();
          return updated;
        }

        // Agent: update only metadata (not content or currentVersionId)
        const { content: _content, ...metaOnly } = data;
        const [updated] = await tx
          .update(memoryItems)
          .set({ ...metaOnly, updatedAt: new Date() })
          .where(eq(memoryItems.id, id))
          .returning();
        return updated;
      });
    },

    // 3. list
    list(companyId: string, filters: MemoryFilters = {}) {
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
        for (const tag of filters.tags) {
          conditions.push(sql`${memoryItems.tags} @> ${JSON.stringify([tag])}::jsonb`);
        }
      }

      return db.select().from(memoryItems).where(and(...conditions));
    },

    // 4. getById
    getById(companyId: string, id: string) {
      return db
        .select()
        .from(memoryItems)
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .then((rows) => rows[0] ?? null);
    },

    // 5. approve
    async approve(companyId: string, id: string) {
      return db.transaction(async (tx) => {
        const item = await tx
          .select()
          .from(memoryItems)
          .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
          .then((rows) => rows[0] ?? null);

        if (!item) return null;

        // Find the pending version (may not exist for V1-era items)
        const pendingVersion = await tx
          .select()
          .from(memoryItemVersions)
          .where(
            and(
              eq(memoryItemVersions.memoryItemId, id),
              eq(memoryItemVersions.status, "pending"),
            ),
          )
          .orderBy(desc(memoryItemVersions.versionNumber))
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (pendingVersion) {
          // Approve the pending version
          await tx
            .update(memoryItemVersions)
            .set({ status: "approved" })
            .where(eq(memoryItemVersions.id, pendingVersion.id));

          // Archive any previously approved versions (other than the one we just approved)
          await tx
            .update(memoryItemVersions)
            .set({ status: "archived" })
            .where(
              and(
                eq(memoryItemVersions.memoryItemId, id),
                eq(memoryItemVersions.status, "approved"),
                sql`${memoryItemVersions.id} != ${pendingVersion.id}`,
              ),
            );

          // Update item: status=approved, currentVersionId, denormalized content
          const [updated] = await tx
            .update(memoryItems)
            .set({
              status: "approved",
              currentVersionId: pendingVersion.id,
              content: pendingVersion.content,
              updatedAt: new Date(),
            })
            .where(eq(memoryItems.id, id))
            .returning();
          return updated;
        }

        // Graceful fallback for V1-era items without versions: just approve the item
        const [updated] = await tx
          .update(memoryItems)
          .set({ status: "approved", updatedAt: new Date() })
          .where(eq(memoryItems.id, id))
          .returning();
        return updated;
      });
    },

    // 6. reject
    async reject(companyId: string, id: string) {
      return db.transaction(async (tx) => {
        // Archive any pending versions
        await tx
          .update(memoryItemVersions)
          .set({ status: "archived" })
          .where(
            and(
              eq(memoryItemVersions.memoryItemId, id),
              eq(memoryItemVersions.status, "pending"),
            ),
          );

        const [updated] = await tx
          .update(memoryItems)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
          .returning();
        return updated ?? null;
      });
    },

    // 7. remove
    remove(companyId: string, id: string) {
      return db
        .delete(memoryItems)
        .where(and(eq(memoryItems.id, id), eq(memoryItems.companyId, companyId)))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    // 8. getVersionHistory
    async getVersionHistory(companyId: string, itemId: string) {
      // Verify item belongs to company
      const item = await db
        .select({ id: memoryItems.id })
        .from(memoryItems)
        .where(and(eq(memoryItems.id, itemId), eq(memoryItems.companyId, companyId)))
        .then((rows) => rows[0] ?? null);

      if (!item) return null;

      return db
        .select()
        .from(memoryItemVersions)
        .where(eq(memoryItemVersions.memoryItemId, itemId))
        .orderBy(desc(memoryItemVersions.versionNumber));
    },

    // 9. saveDraft
    async saveDraft(companyId: string, itemId: string, content: string, founderId: string) {
      return db.transaction(async (tx) => {
        // Verify item belongs to company
        const item = await tx
          .select()
          .from(memoryItems)
          .where(and(eq(memoryItems.id, itemId), eq(memoryItems.companyId, companyId)))
          .then((rows) => rows[0] ?? null);

        if (!item) return null;

        // Check for existing draft
        const existingDraft = await tx
          .select()
          .from(memoryItemVersions)
          .where(
            and(
              eq(memoryItemVersions.memoryItemId, itemId),
              eq(memoryItemVersions.status, "draft"),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (existingDraft) {
          // Update existing draft content (note: versions are immutable once approved,
          // but drafts are mutable until published)
          const [updated] = await tx
            .update(memoryItemVersions)
            .set({ content })
            .where(eq(memoryItemVersions.id, existingDraft.id))
            .returning();
          return updated;
        }

        // Insert new draft at next version number
        const nextVer = await nextVersionNumber(tx, itemId);
        const [draft] = await tx
          .insert(memoryItemVersions)
          .values({
            memoryItemId: itemId,
            versionNumber: nextVer,
            content,
            status: "draft",
            createdBy: founderId,
          })
          .returning();
        return draft;
      });
    },

    // 10. publishDraft
    async publishDraft(companyId: string, itemId: string, founderId: string) {
      return db.transaction(async (tx) => {
        // Verify item belongs to company
        const item = await tx
          .select()
          .from(memoryItems)
          .where(and(eq(memoryItems.id, itemId), eq(memoryItems.companyId, companyId)))
          .then((rows) => rows[0] ?? null);

        if (!item) return null;

        // Find the draft
        const draft = await tx
          .select()
          .from(memoryItemVersions)
          .where(
            and(
              eq(memoryItemVersions.memoryItemId, itemId),
              eq(memoryItemVersions.status, "draft"),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (!draft) return null;

        // Archive the currently approved version (if any)
        await tx
          .update(memoryItemVersions)
          .set({ status: "archived" })
          .where(
            and(
              eq(memoryItemVersions.memoryItemId, itemId),
              eq(memoryItemVersions.status, "approved"),
            ),
          );

        // Set draft to approved
        await tx
          .update(memoryItemVersions)
          .set({ status: "approved" })
          .where(eq(memoryItemVersions.id, draft.id));

        // Update item: currentVersionId + denormalized content
        const [updated] = await tx
          .update(memoryItems)
          .set({
            currentVersionId: draft.id,
            content: draft.content,
            status: "approved",
            updatedAt: new Date(),
          })
          .where(eq(memoryItems.id, itemId))
          .returning();
        return updated;
      });
    },

    // 11. discardDraft
    async discardDraft(companyId: string, itemId: string) {
      return db.transaction(async (tx) => {
        // Verify item belongs to company
        const item = await tx
          .select({ id: memoryItems.id })
          .from(memoryItems)
          .where(and(eq(memoryItems.id, itemId), eq(memoryItems.companyId, companyId)))
          .then((rows) => rows[0] ?? null);

        if (!item) return null;

        // Find and delete the draft
        const draft = await tx
          .select()
          .from(memoryItemVersions)
          .where(
            and(
              eq(memoryItemVersions.memoryItemId, itemId),
              eq(memoryItemVersions.status, "draft"),
            ),
          )
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (!draft) return null;

        await tx
          .delete(memoryItemVersions)
          .where(eq(memoryItemVersions.id, draft.id));

        return draft;
      });
    },

    // 12. suggestUpdate
    async suggestUpdate(
      companyId: string,
      itemId: string,
      content: string,
      sourceContext: string | null,
      agentId: string,
    ) {
      return db.transaction(async (tx) => {
        // Verify item belongs to company
        const item = await tx
          .select()
          .from(memoryItems)
          .where(and(eq(memoryItems.id, itemId), eq(memoryItems.companyId, companyId)))
          .then((rows) => rows[0] ?? null);

        if (!item) return null;

        const nextVer = await nextVersionNumber(tx, itemId);

        const [version] = await tx
          .insert(memoryItemVersions)
          .values({
            memoryItemId: itemId,
            versionNumber: nextVer,
            content,
            status: "pending",
            createdBy: agentId,
          })
          .returning();

        // Do NOT update currentVersionId or item content (Rule #6)
        // Do NOT modify sourceContext on the item
        return version;
      });
    },

    // 13. approveVersion
    async approveVersion(companyId: string, itemId: string, versionId: string) {
      return db.transaction(async (tx) => {
        // Verify version is pending and belongs to item
        const version = await tx
          .select()
          .from(memoryItemVersions)
          .where(
            and(
              eq(memoryItemVersions.id, versionId),
              eq(memoryItemVersions.memoryItemId, itemId),
              eq(memoryItemVersions.status, "pending"),
            ),
          )
          .then((rows) => rows[0] ?? null);

        if (!version) return null;

        // Verify item belongs to company
        const item = await tx
          .select()
          .from(memoryItems)
          .where(and(eq(memoryItems.id, itemId), eq(memoryItems.companyId, companyId)))
          .then((rows) => rows[0] ?? null);

        if (!item) return null;

        // Archive the currently approved version (if any)
        await tx
          .update(memoryItemVersions)
          .set({ status: "archived" })
          .where(
            and(
              eq(memoryItemVersions.memoryItemId, itemId),
              eq(memoryItemVersions.status, "approved"),
            ),
          );

        // Approve this version
        await tx
          .update(memoryItemVersions)
          .set({ status: "approved" })
          .where(eq(memoryItemVersions.id, versionId));

        // Update item: currentVersionId + denormalized content
        const [updated] = await tx
          .update(memoryItems)
          .set({
            currentVersionId: versionId,
            content: version.content,
            status: "approved",
            updatedAt: new Date(),
          })
          .where(eq(memoryItems.id, itemId))
          .returning();
        return updated;
      });
    },

    // 14. rejectVersion
    async rejectVersion(companyId: string, itemId: string, versionId: string) {
      return db.transaction(async (tx) => {
        // Verify version is pending and belongs to item
        const version = await tx
          .select()
          .from(memoryItemVersions)
          .where(
            and(
              eq(memoryItemVersions.id, versionId),
              eq(memoryItemVersions.memoryItemId, itemId),
              eq(memoryItemVersions.status, "pending"),
            ),
          )
          .then((rows) => rows[0] ?? null);

        if (!version) return null;

        // Verify item belongs to company
        const item = await tx
          .select({ id: memoryItems.id })
          .from(memoryItems)
          .where(and(eq(memoryItems.id, itemId), eq(memoryItems.companyId, companyId)))
          .then((rows) => rows[0] ?? null);

        if (!item) return null;

        // Archive this version — do NOT change currentVersionId
        const [archived] = await tx
          .update(memoryItemVersions)
          .set({ status: "archived" })
          .where(eq(memoryItemVersions.id, versionId))
          .returning();
        return archived;
      });
    },

    // 15. restore
    async restore(companyId: string, id: string) {
      return db.transaction(async (tx) => {
        // Verify item is archived and belongs to company
        const item = await tx
          .select()
          .from(memoryItems)
          .where(
            and(
              eq(memoryItems.id, id),
              eq(memoryItems.companyId, companyId),
              eq(memoryItems.status, "archived"),
            ),
          )
          .then((rows) => rows[0] ?? null);

        if (!item) return null;

        // If currentVersionId points to an archived version, un-archive it
        if (item.currentVersionId) {
          const currentVersion = await tx
            .select()
            .from(memoryItemVersions)
            .where(eq(memoryItemVersions.id, item.currentVersionId))
            .then((rows) => rows[0] ?? null);

          if (currentVersion?.status === "archived") {
            await tx
              .update(memoryItemVersions)
              .set({ status: "approved" })
              .where(eq(memoryItemVersions.id, item.currentVersionId));
          }

          const [updated] = await tx
            .update(memoryItems)
            .set({ status: "approved", updatedAt: new Date() })
            .where(eq(memoryItems.id, id))
            .returning();
          return updated;
        }

        // No currentVersionId: find the latest version and set it
        const latestVersion = await tx
          .select()
          .from(memoryItemVersions)
          .where(eq(memoryItemVersions.memoryItemId, id))
          .orderBy(desc(memoryItemVersions.versionNumber))
          .limit(1)
          .then((rows) => rows[0] ?? null);

        if (latestVersion) {
          await tx
            .update(memoryItemVersions)
            .set({ status: "approved" })
            .where(eq(memoryItemVersions.id, latestVersion.id));

          const [updated] = await tx
            .update(memoryItems)
            .set({
              status: "approved",
              currentVersionId: latestVersion.id,
              content: latestVersion.content,
              updatedAt: new Date(),
            })
            .where(eq(memoryItems.id, id))
            .returning();
          return updated;
        }

        // No versions at all (V1-era): just restore the item
        const [updated] = await tx
          .update(memoryItems)
          .set({ status: "approved", updatedAt: new Date() })
          .where(eq(memoryItems.id, id))
          .returning();
        return updated;
      });
    },

    // 16. listPending
    async listPending(companyId: string) {
      // Items with status=pending
      const pendingItems = await db
        .select()
        .from(memoryItems)
        .where(
          and(
            eq(memoryItems.companyId, companyId),
            eq(memoryItems.status, "pending"),
          ),
        );

      // Items that have pending versions (scoped by company via join)
      const itemsWithPendingVersions = await db
        .select({ id: memoryItems.id })
        .from(memoryItemVersions)
        .innerJoin(memoryItems, eq(memoryItemVersions.memoryItemId, memoryItems.id))
        .where(
          and(
            eq(memoryItems.companyId, companyId),
            eq(memoryItemVersions.status, "pending"),
          ),
        );

      if (itemsWithPendingVersions.length === 0) return pendingItems;

      const pendingVersionItemIds = new Set(itemsWithPendingVersions.map((r) => r.id));
      const pendingItemIds = new Set(pendingItems.map((r) => r.id));

      // Fetch items that have pending versions but aren't already in pendingItems
      const additionalIds = [...pendingVersionItemIds].filter((id) => !pendingItemIds.has(id));

      if (additionalIds.length === 0) return pendingItems;

      const additionalItems = await db
        .select()
        .from(memoryItems)
        .where(
          and(
            eq(memoryItems.companyId, companyId),
            sql`${memoryItems.id} = ANY(${sql.raw(`ARRAY[${additionalIds.map((id) => `'${id}'`).join(",")}]::uuid[]`)})`,
          ),
        );

      return [...pendingItems, ...additionalItems];
    },
  };
}
