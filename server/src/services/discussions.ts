import { and, eq, desc, sql, inArray, asc } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  discussions,
  discussionEntries,
  discussionExtractedItems,
  discussionAnnotations,
  agents,
  projects,
  goals,
  threadPlanSteps,
} from "@armyofagents/db";
import { badRequest, notFound } from "../errors.js";
import { logActivity } from "./activity-log.js";
import { publishLiveEvent } from "./live-events.js";
import { issueService } from "./issues.js";
import { memoryService } from "./memory.js";

export interface DiscussionFilters {
  status?: string;
  scopeType?: string;
  scopeId?: string;
  hasPendingItems?: boolean;
  inputType?: string;
}

/**
 * Validate that scopeId references the correct table based on scopeType.
 * Gotcha 1.1: Polymorphic scope — Drizzle/PostgreSQL can't enforce polymorphic FKs.
 */
async function validateScope(
  db: Db,
  scopeType: string | null | undefined,
  scopeId: string | null | undefined,
) {
  if (!scopeType && !scopeId) return;
  if (scopeType && !scopeId) {
    throw badRequest("scopeId is required when scopeType is set");
  }
  if (!scopeType && scopeId) {
    throw badRequest("scopeType is required when scopeId is set");
  }

  if (scopeType === "department" || scopeType === "project") {
    const row = await db
      .select({ id: projects.id, type: projects.type })
      .from(projects)
      .where(eq(projects.id, scopeId!))
      .then((rows) => rows[0] ?? null);
    if (!row) {
      throw badRequest(`${scopeType} with id '${scopeId}' not found`);
    }
    if (scopeType === "department" && row.type !== "department") {
      throw badRequest(`Scope references a project, not a department`);
    }
    if (scopeType === "project" && row.type !== "project") {
      throw badRequest(`Scope references a department, not a project`);
    }
  } else if (scopeType === "goal") {
    const row = await db
      .select({ id: goals.id })
      .from(goals)
      .where(eq(goals.id, scopeId!))
      .then((rows) => rows[0] ?? null);
    if (!row) {
      throw badRequest(`Goal with id '${scopeId}' not found`);
    }
  } else {
    throw badRequest(`Invalid scopeType '${scopeType}'`);
  }
}

function isMemoryType(
  type: string,
): type is "decision" | "insight" | "context" | "reference" | "preference" {
  return ["decision", "insight", "context", "reference", "preference"].includes(
    type,
  );
}

export function discussionService(db: Db) {
  const issues = issueService(db);
  const memory = memoryService(db);

  return {
    /**
     * List discussions with optional filters.
     */
    list: async (companyId: string, filters: DiscussionFilters = {}) => {
      const conditions = [eq(discussions.companyId, companyId)];

      if (filters.status) {
        conditions.push(eq(discussions.status, filters.status));
      }
      if (filters.scopeType) {
        conditions.push(eq(discussions.scopeType, filters.scopeType));
      }
      if (filters.scopeId) {
        conditions.push(eq(discussions.scopeId, filters.scopeId));
      }
      if (filters.hasPendingItems === true) {
        conditions.push(sql`${discussions.pendingItemCount} > 0`);
      }
      if (filters.hasPendingItems === false) {
        conditions.push(sql`${discussions.pendingItemCount} = 0`);
      }

      // If inputType filter is set, join with entries to filter
      if (filters.inputType) {
        const rows = await db
          .selectDistinctOn([discussions.id])
          .from(discussions)
          .innerJoin(
            discussionEntries,
            eq(discussions.id, discussionEntries.discussionId),
          )
          .where(
            and(
              ...conditions,
              eq(discussionEntries.inputType, filters.inputType),
            ),
          )
          .orderBy(discussions.id, desc(discussions.lastEntryAt));

        return rows.map((r) => r.discussions);
      }

      return db
        .select()
        .from(discussions)
        .where(and(...conditions))
        .orderBy(desc(discussions.lastEntryAt));
    },

    /**
     * Get a discussion by ID with entries and extracted items.
     */
    getById: async (companyId: string, id: string) => {
      const discussion = await db
        .select()
        .from(discussions)
        .where(and(eq(discussions.id, id), eq(discussions.companyId, companyId)))
        .then((rows) => rows[0] ?? null);

      if (!discussion) return null;

      const entryRows = await db
        .select({
          entry: discussionEntries,
          authorAgentName: agents.name,
          authorAgentAvatar: agents.icon,
        })
        .from(discussionEntries)
        .leftJoin(agents, eq(discussionEntries.authorAgentId, agents.id))
        .where(eq(discussionEntries.discussionId, id))
        .orderBy(discussionEntries.createdAt);

      const entries = entryRows.map((r: { entry: typeof discussionEntries.$inferSelect; authorAgentName: string | null; authorAgentAvatar: string | null }) => ({
        ...r.entry,
        authorAgentName: r.authorAgentName ?? null,
        authorAgentAvatar: r.authorAgentAvatar ?? null,
      }));

      const entryIds = entries.map((e) => e.id);

      let items: (typeof discussionExtractedItems.$inferSelect)[] = [];
      let annotations: (typeof discussionAnnotations.$inferSelect)[] = [];

      if (entryIds.length > 0) {
        items = await db
          .select()
          .from(discussionExtractedItems)
          .where(inArray(discussionExtractedItems.discussionEntryId, entryIds));

        annotations = await db
          .select()
          .from(discussionAnnotations)
          .where(inArray(discussionAnnotations.discussionEntryId, entryIds));
      }

      // Group items and annotations by entry for the frontend
      const itemsByEntry = new Map<string, typeof items>();
      for (const item of items) {
        const list = itemsByEntry.get(item.discussionEntryId) ?? [];
        list.push(item);
        itemsByEntry.set(item.discussionEntryId, list);
      }

      const annotationsByEntry = new Map<string, typeof annotations>();
      for (const ann of annotations) {
        const list = annotationsByEntry.get(ann.discussionEntryId) ?? [];
        list.push(ann);
        annotationsByEntry.set(ann.discussionEntryId, list);
      }

      const enrichedEntries = entries.map((e) => ({
        ...e,
        extractedItems: itemsByEntry.get(e.id) ?? [],
        annotations: annotationsByEntry.get(e.id) ?? [],
      }));

      const planSteps = await db
        .select()
        .from(threadPlanSteps)
        .where(eq(threadPlanSteps.threadId, id))
        .orderBy(asc(threadPlanSteps.stepOrder))
        .then((rows: typeof threadPlanSteps.$inferSelect[]) => rows);

      return { ...discussion, entries: enrichedEntries, planSteps };
    },

    /**
     * Create a new discussion, optionally with a first entry.
     * Gotcha 1.1: validates scope if provided.
     * Gotcha 1.2: increments denormalized counts in same transaction.
     */
    create: async (
      companyId: string,
      data: {
        title?: string | null;
        scopeType?: string | null;
        scopeId?: string | null;
        tags?: string[];
        entry?: {
          inputType: string;
          rawContent: string;
          title?: string | null;
          departmentId?: string | null;
          projectId?: string | null;
          goalId?: string | null;
          sourceInfo?: Record<string, unknown> | null;
        };
      },
      actorId: string,
    ) => {
      await validateScope(db, data.scopeType, data.scopeId);

      const now = new Date();
      const hasEntry = !!data.entry;

      // Wrap in transaction to keep discussion + entry atomic (Gotcha 1.2)
      const result = await db.transaction(async (tx) => {
        const [discussion] = await tx
          .insert(discussions)
          .values({
            companyId,
            title: data.title ?? null,
            scopeType: data.scopeType ?? null,
            scopeId: data.scopeId ?? null,
            tags: data.tags ?? [],
            entryCount: hasEntry ? 1 : 0,
            lastEntryAt: hasEntry ? now : null,
            createdBy: actorId,
          })
          .returning();

        let entry: typeof discussionEntries.$inferSelect | null = null;

        if (data.entry) {
          [entry] = await tx
            .insert(discussionEntries)
            .values({
              discussionId: discussion.id,
              inputType: data.entry.inputType,
              rawContent: data.entry.rawContent,
              title: data.entry.title ?? null,
              departmentId: data.entry.departmentId ?? null,
              projectId: data.entry.projectId ?? null,
              goalId: data.entry.goalId ?? null,
              sourceInfo: data.entry.sourceInfo ?? null,
              extractionStatus: "pending",
              createdBy: actorId,
            })
            .returning();
        }

        return { ...discussion, entry };
      });

      // Side effects outside transaction
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId,
        action: "discussion.created",
        entityType: "discussion",
        entityId: result.id,
        details: { title: result.title, hasEntry },
      });

      if (data.entry && result.entry) {
        publishLiveEvent({
          companyId,
          type: "discussion.entry.created",
          payload: {
            discussionId: result.id,
            entryId: result.entry.id,
            inputType: data.entry.inputType,
          },
        });
      }

      return result;
    },

    /**
     * Update a discussion's title, status, scope, or tags.
     * Validates scope if changed. Follows goals.ts update pattern.
     */
    update: async (
      companyId: string,
      id: string,
      data: {
        title?: string | null;
        status?: string;
        scopeType?: string | null;
        scopeId?: string | null;
        tags?: string[];
        autonomyLevel?: number | null;
      },
    ) => {
      // Validate scope if being changed
      if (data.scopeType !== undefined || data.scopeId !== undefined) {
        // Need to merge with existing values for validation
        const existing = await db
          .select({
            scopeType: discussions.scopeType,
            scopeId: discussions.scopeId,
          })
          .from(discussions)
          .where(and(eq(discussions.id, id), eq(discussions.companyId, companyId)))
          .then((rows) => rows[0] ?? null);

        if (!existing) {
          throw notFound("Discussion not found");
        }

        const newScopeType = data.scopeType !== undefined ? data.scopeType : existing.scopeType;
        const newScopeId = data.scopeId !== undefined ? data.scopeId : existing.scopeId;
        await validateScope(db, newScopeType, newScopeId);
      }

      const [updated] = await db
        .update(discussions)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(discussions.id, id), eq(discussions.companyId, companyId)))
        .returning();

      return updated ?? null;
    },

    /**
     * Add an entry to an existing discussion.
     * Entry is created with extractionStatus='pending'. The durable extraction sweeper
     * (server/src/index.ts, 45 s tick, M2 atomic claim) picks it up automatically.
     * "Reprocess" in the UI is a manual fast-path that bypasses the sweeper interval.
     * Updates lastEntryAt, publishes discussion.entry.created LiveEvent.
     * Gotcha 1.2: increments entryCount in same operation.
     */
    addEntry: async (
      companyId: string,
      discussionId: string,
      data: {
        inputType: string;
        rawContent: string;
        title?: string | null;
        departmentId?: string | null;
        projectId?: string | null;
        goalId?: string | null;
        sourceInfo?: Record<string, unknown> | null;
        parentEntryId?: string | null;
        authorAgentId?: string | null;
      },
      actorId: string,
    ) => {
      if (data.authorAgentId && data.inputType !== "agent") {
        throw badRequest(
          "inputType must be 'agent' when authorAgentId is set",
        );
      }

      // Verify discussion exists and belongs to company
      const discussion = await db
        .select()
        .from(discussions)
        .where(
          and(
            eq(discussions.id, discussionId),
            eq(discussions.companyId, companyId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!discussion) {
        throw notFound("Discussion not found");
      }

      if (data.parentEntryId) {
        const parent = await db
          .select({ id: discussionEntries.id })
          .from(discussionEntries)
          .where(
            and(
              eq(discussionEntries.id, data.parentEntryId),
              eq(discussionEntries.discussionId, discussionId),
            ),
          )
          .then((rows) => rows[0] ?? null);
        if (!parent) {
          throw badRequest(
            "parentEntryId must reference an entry in the same discussion",
          );
        }
      }

      const now = new Date();

      // Plan 7 (D1): assign a per-thread monotonic seq for catch-up. We bump the
      // atomic discussions.entrySeq counter with UPDATE ... RETURNING (atomic per
      // row, so concurrent inserts serialize on the discussions row) instead of
      // max(seq)+1, which races. The counter bump also carries the denormalized
      // count update (Gotcha 1.2) so both land in one statement.
      const entry = await db.transaction(async (tx) => {
        const [{ entrySeq }] = await tx
          .update(discussions)
          .set({
            entrySeq: sql`${discussions.entrySeq} + 1`,
            entryCount: sql`${discussions.entryCount} + 1`,
            lastEntryAt: now,
            updatedAt: now,
          })
          .where(eq(discussions.id, discussionId))
          .returning({ entrySeq: discussions.entrySeq });

        const [inserted] = await tx
          .insert(discussionEntries)
          .values({
            discussionId,
            inputType: data.inputType,
            rawContent: data.rawContent,
            title: data.title ?? null,
            departmentId: data.departmentId ?? null,
            projectId: data.projectId ?? null,
            goalId: data.goalId ?? null,
            sourceInfo: data.sourceInfo ?? null,
            parentEntryId: data.parentEntryId ?? null,
            authorAgentId: data.authorAgentId ?? null,
            extractionStatus: "pending",
            seq: entrySeq,
            createdBy: actorId,
          })
          .returning();
        return inserted;
      });

      publishLiveEvent({
        companyId,
        type: "discussion.entry.created",
        payload: {
          discussionId,
          entryId: entry.id,
          inputType: data.inputType,
        },
      });

      // Plan 7: thread-scoped poke for the live thread view. Carries threadId so
      // the WS envelope-RBAC fan-out only delivers it to viewers who can see the
      // thread. The frontend refetches the thread (refetch-on-poke) using seq.
      publishLiveEvent({
        companyId,
        type: "thread.entry.created",
        payload: {
          threadId: discussionId,
          entryId: entry.id,
          seq: entry.seq,
        },
      });

      // Trigger extraction directly (fire-and-forget) so the UI sees items within
      // seconds rather than waiting up to 45 s for the durable sweeper interval.
      // The sweeper remains as a durability backstop for entries that slip through
      // (e.g. server restart immediately after insert).
      import("./extraction.js")
        .then(({ extractionService }) => {
          extractionService(db)
            .extractFromDiscussionEntry(companyId, entry.id)
            .catch(() => {}); // errors surfaced internally via extractionStatus='failed'
        })
        .catch(() => {}); // module load error — swallow; sweeper will pick it up

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId,
        action: "discussion.entry.added",
        entityType: "discussion_entry",
        entityId: entry.id,
        details: { discussionId, inputType: data.inputType },
      });

      return entry;
    },

    /**
     * Approve extracted items — atomic transaction.
     * For task items: creates issue. For memory items: creates memoryItem.
     * Sets status='approved', links resultTaskId/resultMemoryId.
     * Decrements pendingItemCount.
     */
    approveItems: async (
      companyId: string,
      discussionId: string,
      itemIds: string[],
      actorId: string,
    ) => {
      if (itemIds.length === 0) {
        throw badRequest("No items to approve");
      }

      // Verify discussion exists
      const discussion = await db
        .select()
        .from(discussions)
        .where(
          and(
            eq(discussions.id, discussionId),
            eq(discussions.companyId, companyId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!discussion) {
        throw notFound("Discussion not found");
      }

      const result = await db.transaction(async (tx) => {
        const itemRows = await tx
          .select()
          .from(discussionExtractedItems)
          .where(inArray(discussionExtractedItems.id, itemIds));

        if (itemRows.length !== itemIds.length) {
          throw badRequest("Some item IDs not found");
        }

        // Verify all items belong to entries in this discussion
        const entryIds = [...new Set(itemRows.map((i) => i.discussionEntryId))];
        const entries = await tx
          .select({ id: discussionEntries.id })
          .from(discussionEntries)
          .where(
            and(
              inArray(discussionEntries.id, entryIds),
              eq(discussionEntries.discussionId, discussionId),
            ),
          );

        if (entries.length !== entryIds.length) {
          throw badRequest(
            "Some items do not belong to this discussion",
          );
        }

        const createdTaskIds: string[] = [];
        const createdMemoryIds: string[] = [];
        let approvedCount = 0;

        for (const item of itemRows) {
          if (item.status === "approved") continue; // already approved

          if (item.type === "task") {
            const task = await issues.create(
              companyId,
              {
                title: item.title,
                description: item.description,
                priority: item.priority ?? item.suggestedPriority ?? "medium",
                source: "discussion",
                projectId:
                  item.suggestedDepartmentId ??
                  item.suggestedProjectId ??
                  undefined,
                goalId: item.suggestedGoalId ?? undefined,
                assigneeAgentId: item.suggestedAssigneeId ?? undefined,
                status: item.suggestedAssigneeId ? "todo" : "backlog",
              },
              tx,
            );

            if (task) {
              createdTaskIds.push(task.id);
              await tx
                .update(discussionExtractedItems)
                .set({
                  status: "approved",
                  resultTaskId: task.id,
                  updatedAt: new Date(),
                })
                .where(eq(discussionExtractedItems.id, item.id));
              approvedCount++;
            }
          } else if (isMemoryType(item.type)) {
            const layer = item.layer ?? item.suggestedLayer ?? "domain";
            const content = item.mergedContent?.trim() || item.description?.trim() || item.title;

            const memoryItem = await memory.create(
              companyId,
              {
                title: item.title,
                content,
                category: item.type,
                source: "discussion",
                status: "approved",
                departmentId: item.suggestedDepartmentId ?? null,
                projectId: item.suggestedProjectId ?? null,
                createdBy: actorId,
                layer,
                goalId: item.suggestedGoalId ?? null,
              },
              tx,
            );

            if (memoryItem) {
              createdMemoryIds.push(memoryItem.id);
              await tx
                .update(discussionExtractedItems)
                .set({
                  status: "approved",
                  resultMemoryId: memoryItem.id,
                  updatedAt: new Date(),
                })
                .where(eq(discussionExtractedItems.id, item.id));
              approvedCount++;
            }
          }
        }

        // Gotcha 1.2: decrement pendingItemCount
        if (approvedCount > 0) {
          await tx
            .update(discussions)
            .set({
              pendingItemCount: sql`GREATEST(${discussions.pendingItemCount} - ${approvedCount}, 0)`,
              updatedAt: new Date(),
            })
            .where(eq(discussions.id, discussionId));
        }

        return { createdTaskIds, createdMemoryIds, approvedCount };
      });

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId,
        action: "discussion.items.approved",
        entityType: "discussion",
        entityId: discussionId,
        details: { approvedCount: result.approvedCount, createdTaskIds: result.createdTaskIds, createdMemoryIds: result.createdMemoryIds },
      });

      return result;
    },

    /**
     * Reject extracted items. Sets status='rejected', decrements pendingItemCount.
     */
    rejectItems: async (
      companyId: string,
      discussionId: string,
      itemIds: string[],
      actorId: string,
    ) => {
      if (itemIds.length === 0) {
        throw badRequest("No items to reject");
      }

      // Verify discussion
      const discussion = await db
        .select()
        .from(discussions)
        .where(
          and(
            eq(discussions.id, discussionId),
            eq(discussions.companyId, companyId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      if (!discussion) {
        throw notFound("Discussion not found");
      }

      // Verify items belong to this discussion
      const itemRows = await db
        .select({
          id: discussionExtractedItems.id,
          entryId: discussionExtractedItems.discussionEntryId,
        })
        .from(discussionExtractedItems)
        .where(inArray(discussionExtractedItems.id, itemIds));

      if (itemRows.length > 0) {
        const entryIds = [...new Set(itemRows.map((i) => i.entryId))];
        const entries = await db
          .select({ id: discussionEntries.id })
          .from(discussionEntries)
          .where(
            and(
              inArray(discussionEntries.id, entryIds),
              eq(discussionEntries.discussionId, discussionId),
            ),
          );
        if (entries.length !== entryIds.length) {
          throw badRequest("Some items do not belong to this discussion");
        }
      }

      const updated = await db
        .update(discussionExtractedItems)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(
          and(
            inArray(discussionExtractedItems.id, itemIds),
            eq(discussionExtractedItems.status, "pending"),
          ),
        )
        .returning();

      const rejectedCount = updated.length;

      if (rejectedCount > 0) {
        await db
          .update(discussions)
          .set({
            pendingItemCount: sql`GREATEST(${discussions.pendingItemCount} - ${rejectedCount}, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(discussions.id, discussionId));
      }

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId,
        action: "discussion.items.rejected",
        entityType: "discussion",
        entityId: discussionId,
        details: { rejectedCount, itemIds },
      });

      return { rejectedCount };
    },

    /**
     * Update an extracted item's fields (founder edits during review).
     * Gotcha 1.4: sets status to 'edited' so it's included in "Confirm All".
     */
    updateItem: async (
      companyId: string,
      itemId: string,
      data: Partial<
        Pick<
          typeof discussionExtractedItems.$inferInsert,
          | "title"
          | "description"
          | "type"
          | "priority"
          | "layer"
          | "dedupAction"
          | "selectedMemoryId"
          | "mergedContent"
          | "suggestedAssigneeId"
          | "suggestedDepartmentId"
          | "suggestedProjectId"
          | "suggestedGoalId"
        >
      >,
    ) => {
      // Verify item exists and belongs to company's discussion
      const item = await db
        .select({
          id: discussionExtractedItems.id,
          discussionEntryId: discussionExtractedItems.discussionEntryId,
        })
        .from(discussionExtractedItems)
        .where(eq(discussionExtractedItems.id, itemId))
        .then((rows) => rows[0] ?? null);

      if (!item) {
        throw notFound("Extracted item not found");
      }

      // Verify entry's discussion belongs to this company
      const entry = await db
        .select({ discussionId: discussionEntries.discussionId })
        .from(discussionEntries)
        .where(eq(discussionEntries.id, item.discussionEntryId))
        .then((rows) => rows[0] ?? null);

      if (entry) {
        const disc = await db
          .select({ companyId: discussions.companyId })
          .from(discussions)
          .where(eq(discussions.id, entry.discussionId))
          .then((rows) => rows[0] ?? null);

        if (!disc || disc.companyId !== companyId) {
          throw notFound("Extracted item not found");
        }
      }

      // Gotcha 1.4: editing sets status to 'edited'
      const [updated] = await db
        .update(discussionExtractedItems)
        .set({ ...data, status: "edited", updatedAt: new Date() })
        .where(eq(discussionExtractedItems.id, itemId))
        .returning();

      return updated;
    },

    /**
     * Reprocess an entry: reset extraction status, delete extracted items, trigger re-extraction.
     */
    reprocessEntry: async (companyId: string, entryId: string) => {
      // Verify entry belongs to company
      const entry = await db
        .select()
        .from(discussionEntries)
        .where(eq(discussionEntries.id, entryId))
        .then((rows) => rows[0] ?? null);

      if (!entry) {
        throw notFound("Entry not found");
      }

      const disc = await db
        .select({ companyId: discussions.companyId })
        .from(discussions)
        .where(eq(discussions.id, entry.discussionId))
        .then((rows) => rows[0] ?? null);

      if (!disc || disc.companyId !== companyId) {
        throw notFound("Entry not found");
      }

      // Check for approved items that would be orphaned
      const approvedItems = await db
        .select({ id: discussionExtractedItems.id })
        .from(discussionExtractedItems)
        .where(
          and(
            eq(discussionExtractedItems.discussionEntryId, entryId),
            eq(discussionExtractedItems.status, "approved"),
          ),
        );

      if (approvedItems.length > 0) {
        throw badRequest(
          "Cannot reprocess entry with approved items. Approved items have linked tasks/memory that would be orphaned.",
        );
      }

      // Count pending items being deleted to update discussion count
      const pendingItems = await db
        .select({ id: discussionExtractedItems.id })
        .from(discussionExtractedItems)
        .where(
          and(
            eq(discussionExtractedItems.discussionEntryId, entryId),
            eq(discussionExtractedItems.status, "pending"),
          ),
        );

      // Delete non-approved extracted items (pending, rejected, edited)
      await db
        .delete(discussionExtractedItems)
        .where(eq(discussionExtractedItems.discussionEntryId, entryId));

      // Reset extraction status
      await db
        .update(discussionEntries)
        .set({ extractionStatus: "pending", extractionRunId: null })
        .where(eq(discussionEntries.id, entryId));

      // Update pending count on discussion
      if (pendingItems.length > 0) {
        await db
          .update(discussions)
          .set({
            pendingItemCount: sql`GREATEST(${discussions.pendingItemCount} - ${pendingItems.length}, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(discussions.id, entry.discussionId));
      }

      // Trigger re-extraction via the event pipeline
      publishLiveEvent({
        companyId,
        type: "discussion.entry.created",
        payload: { discussionId: entry.discussionId, entryId },
      });

      // Trigger extraction directly (fire-and-forget)
      import("./extraction.js")
        .then(({ extractionService }) => {
          extractionService(db)
            .extractFromDiscussionEntry(companyId, entryId)
            .catch(() => {}); // errors handled internally
        })
        .catch(() => {}); // module load error — swallow

      return { entryId, extractionStatus: "pending" as const };
    },

    /**
     * Reprocess all failed/pending/skipped entries in a discussion.
     */
    reprocessAllEntries: async (companyId: string, discussionId: string) => {
      // Verify discussion belongs to company
      const disc = await db
        .select({ id: discussions.id, companyId: discussions.companyId })
        .from(discussions)
        .where(and(eq(discussions.id, discussionId), eq(discussions.companyId, companyId)))
        .then((rows) => rows[0] ?? null);

      if (!disc) {
        throw notFound("Discussion not found");
      }

      // Fetch entries that need reprocessing
      const entries = await db
        .select()
        .from(discussionEntries)
        .where(eq(discussionEntries.discussionId, discussionId));

      const reprocessable = entries.filter(
        (e) => e.extractionStatus === "failed" || e.extractionStatus === "pending" || e.extractionStatus === "skipped",
      );

      let reprocessedCount = 0;
      let skippedCount = 0;
      let deletedPendingCount = 0;

      for (const entry of reprocessable) {
        // Check for approved items — skip if any
        const approvedItems = await db
          .select({ id: discussionExtractedItems.id })
          .from(discussionExtractedItems)
          .where(
            and(
              eq(discussionExtractedItems.discussionEntryId, entry.id),
              eq(discussionExtractedItems.status, "approved"),
            ),
          );

        if (approvedItems.length > 0) {
          skippedCount++;
          continue;
        }

        // Count pending items being deleted
        const pendingItems = await db
          .select({ id: discussionExtractedItems.id })
          .from(discussionExtractedItems)
          .where(
            and(
              eq(discussionExtractedItems.discussionEntryId, entry.id),
              eq(discussionExtractedItems.status, "pending"),
            ),
          );
        deletedPendingCount += pendingItems.length;

        // Delete non-approved extracted items
        await db
          .delete(discussionExtractedItems)
          .where(eq(discussionExtractedItems.discussionEntryId, entry.id));

        // Reset extraction status
        await db
          .update(discussionEntries)
          .set({ extractionStatus: "pending", extractionRunId: null })
          .where(eq(discussionEntries.id, entry.id));

        // Trigger extraction
        publishLiveEvent({
          companyId,
          type: "discussion.entry.created",
          payload: { discussionId, entryId: entry.id },
        });

        // Trigger extraction directly (fire-and-forget)
        import("./extraction.js")
          .then(({ extractionService }) => {
            extractionService(db)
              .extractFromDiscussionEntry(companyId, entry.id)
              .catch(() => {}); // errors handled internally
          })
          .catch(() => {}); // module load error — swallow

        reprocessedCount++;
      }

      // Update pending count on discussion
      if (deletedPendingCount > 0) {
        await db
          .update(discussions)
          .set({
            pendingItemCount: sql`GREATEST(${discussions.pendingItemCount} - ${deletedPendingCount}, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(discussions.id, discussionId));
      }

      return { reprocessedCount, skippedCount };
    },

    /**
     * Add an annotation to an entry.
     */
    addAnnotation: async (
      companyId: string,
      entryId: string,
      data: {
        content: string;
        anchorStart?: number | null;
        anchorEnd?: number | null;
      },
      actorId: string,
    ) => {
      // Verify entry belongs to company
      const entry = await db
        .select({ discussionId: discussionEntries.discussionId })
        .from(discussionEntries)
        .where(eq(discussionEntries.id, entryId))
        .then((rows) => rows[0] ?? null);

      if (!entry) {
        throw notFound("Entry not found");
      }

      const disc = await db
        .select({ companyId: discussions.companyId })
        .from(discussions)
        .where(eq(discussions.id, entry.discussionId))
        .then((rows) => rows[0] ?? null);

      if (!disc || disc.companyId !== companyId) {
        throw notFound("Entry not found");
      }

      const [annotation] = await db
        .insert(discussionAnnotations)
        .values({
          discussionEntryId: entryId,
          content: data.content,
          anchorStart: data.anchorStart ?? null,
          anchorEnd: data.anchorEnd ?? null,
          createdBy: actorId,
        })
        .returning();

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId,
        action: "discussion.annotation.added",
        entityType: "discussion_annotation",
        entityId: annotation.id,
        details: { entryId, discussionId: entry.discussionId },
      });

      return annotation;
    },

    /**
     * Link an entry to a different discussion (move between threads).
     */
    linkEntry: async (
      companyId: string,
      entryId: string,
      targetDiscussionId: string,
    ) => {
      // Verify entry exists
      const entry = await db
        .select()
        .from(discussionEntries)
        .where(eq(discussionEntries.id, entryId))
        .then((rows) => rows[0] ?? null);

      if (!entry) {
        throw notFound("Entry not found");
      }

      const sourceDiscussionId = entry.discussionId;
      if (sourceDiscussionId === targetDiscussionId) {
        throw badRequest("Entry already belongs to this discussion");
      }

      // Verify both discussions belong to company
      const [sourceDisc, targetDisc] = await Promise.all([
        db
          .select()
          .from(discussions)
          .where(
            and(
              eq(discussions.id, sourceDiscussionId),
              eq(discussions.companyId, companyId),
            ),
          )
          .then((rows) => rows[0] ?? null),
        db
          .select()
          .from(discussions)
          .where(
            and(
              eq(discussions.id, targetDiscussionId),
              eq(discussions.companyId, companyId),
            ),
          )
          .then((rows) => rows[0] ?? null),
      ]);

      if (!sourceDisc) throw notFound("Source discussion not found");
      if (!targetDisc) throw notFound("Target discussion not found");

      return db.transaction(async (tx) => {
        // Count pending items for this entry to move counts
        const pendingItems = await tx
          .select({ id: discussionExtractedItems.id })
          .from(discussionExtractedItems)
          .where(
            and(
              eq(discussionExtractedItems.discussionEntryId, entryId),
              eq(discussionExtractedItems.status, "pending"),
            ),
          );
        const pendingCount = pendingItems.length;

        // Move entry
        await tx
          .update(discussionEntries)
          .set({ discussionId: targetDiscussionId })
          .where(eq(discussionEntries.id, entryId));

        const now = new Date();

        // Update source discussion counts
        await tx
          .update(discussions)
          .set({
            entryCount: sql`GREATEST(${discussions.entryCount} - 1, 0)`,
            pendingItemCount: sql`GREATEST(${discussions.pendingItemCount} - ${pendingCount}, 0)`,
            updatedAt: now,
          })
          .where(eq(discussions.id, sourceDiscussionId));

        // Update target discussion counts
        await tx
          .update(discussions)
          .set({
            entryCount: sql`${discussions.entryCount} + 1`,
            pendingItemCount: sql`${discussions.pendingItemCount} + ${pendingCount}`,
            lastEntryAt: now,
            updatedAt: now,
          })
          .where(eq(discussions.id, targetDiscussionId));

        return { entryId, sourceDiscussionId, targetDiscussionId };
      });
    },
  };
}
