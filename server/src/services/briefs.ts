import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { briefs, briefItems, debriefs } from "@paperclipai/db";
import { issueService } from "./issues.js";
import { memoryService } from "./memory.js";

export interface BriefFilters {
  status?: string;
  departmentId?: string;
}

/**
 * Resolve departmentId/projectId for a brief item using fallback chain.
 * Decision #61: item-level > brief-level > null
 */
function resolveDepartment(
  item: typeof briefItems.$inferSelect,
  brief: typeof briefs.$inferSelect,
) {
  return {
    departmentId: item.suggestedDepartmentId ?? brief.departmentId ?? null,
    projectId: item.suggestedProjectId ?? brief.projectId ?? null,
  };
}

export function briefService(db: Db) {
  const issues = issueService(db);
  const memory = memoryService(db);

  return {
    list: async (companyId: string, filters: BriefFilters = {}) => {
      const conditions = [eq(briefs.companyId, companyId)];

      if (filters.status) {
        conditions.push(eq(briefs.status, filters.status));
      }
      if (filters.departmentId) {
        conditions.push(eq(briefs.departmentId, filters.departmentId));
      }

      const rows = await db
        .select({
          id: briefs.id,
          companyId: briefs.companyId,
          debriefId: briefs.debriefId,
          status: briefs.status,
          departmentId: briefs.departmentId,
          projectId: briefs.projectId,
          reviewedAt: briefs.reviewedAt,
          reviewedBy: briefs.reviewedBy,
          createdAt: briefs.createdAt,
          updatedAt: briefs.updatedAt,
          sourceType: debriefs.inputType,
          departmentName: sql<string | null>`(SELECT name FROM projects WHERE id = ${briefs.departmentId})`,
          projectName: sql<string | null>`(SELECT name FROM projects WHERE id = ${briefs.projectId})`,
          itemCount: sql<number>`(SELECT count(*)::int FROM brief_items WHERE brief_items.brief_id = ${briefs.id})`,
        })
        .from(briefs)
        .innerJoin(debriefs, eq(briefs.debriefId, debriefs.id))
        .where(and(...conditions))
        .orderBy(sql`${briefs.createdAt} DESC`);

      return rows;
    },

    getById: async (companyId: string, id: string) => {
      const brief = await db
        .select()
        .from(briefs)
        .where(and(eq(briefs.id, id), eq(briefs.companyId, companyId)))
        .then((rows) => rows[0] ?? null);

      if (!brief) return null;

      const items = await db
        .select()
        .from(briefItems)
        .where(eq(briefItems.briefId, brief.id));

      return { ...brief, items };
    },

    updateItemStatus: async (
      companyId: string,
      briefId: string,
      itemId: string,
      status: string,
      edits?: { title?: string; description?: string | null },
    ) => {
      // Verify brief belongs to company
      const brief = await db
        .select()
        .from(briefs)
        .where(and(eq(briefs.id, briefId), eq(briefs.companyId, companyId)))
        .then((rows) => rows[0] ?? null);

      if (!brief) return null;

      const patch: Partial<typeof briefItems.$inferInsert> = {
        status,
        updatedAt: new Date(),
      };
      if (edits?.title) patch.title = edits.title;
      if (edits?.description !== undefined) patch.description = edits.description;

      return db
        .update(briefItems)
        .set(patch)
        .where(and(eq(briefItems.id, itemId), eq(briefItems.briefId, briefId)))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    approveBrief: async (companyId: string, briefId: string, reviewedBy: string) => {
      // Fetch brief
      const brief = await db
        .select()
        .from(briefs)
        .where(and(eq(briefs.id, briefId), eq(briefs.companyId, companyId)))
        .then((rows) => rows[0] ?? null);

      if (!brief) return null;

      // Fetch all items
      const items = await db
        .select()
        .from(briefItems)
        .where(eq(briefItems.briefId, briefId));

      const createdTaskIds: string[] = [];
      const createdMemoryIds: string[] = [];
      let approvedCount = 0;
      let rejectedCount = 0;

      for (const item of items) {
        // Treat 'edited' as approved (founder modified it, so it's accepted)
        const isApproved = item.status === "approved" || item.status === "edited";
        const isRejected = item.status === "rejected";

        if (isRejected) {
          rejectedCount++;
          continue;
        }

        if (!isApproved) {
          // pending items — skip, not yet decided
          continue;
        }

        approvedCount++;
        const { departmentId, projectId } = resolveDepartment(item, brief);

        if (item.type === "task") {
          // Create a real task (issue)
          const task = await issues.create(companyId, {
            title: item.title,
            description: item.description,
            priority: item.suggestedPriority ?? "medium",
            source: "brief",
            projectId: departmentId ?? projectId ?? undefined,
            assigneeAgentId: item.suggestedAssigneeId,
            status: item.suggestedAssigneeId ? "todo" : "backlog",
          });

          if (task) {
            createdTaskIds.push(task.id);
            await db
              .update(briefItems)
              .set({ resultTaskId: task.id, updatedAt: new Date() })
              .where(eq(briefItems.id, item.id));
          }
        } else {
          // decision, insight, context → create memory item
          const memoryItem = await memory.create(companyId, {
            title: item.title,
            content: item.description ?? item.title,
            category: item.type as "decision" | "insight" | "context",
            source: "brief",
            status: "approved",
            departmentId,
            projectId,
            createdBy: reviewedBy,
          });

          if (memoryItem) {
            createdMemoryIds.push(memoryItem.id);
            await db
              .update(briefItems)
              .set({ resultMemoryId: memoryItem.id, updatedAt: new Date() })
              .where(eq(briefItems.id, item.id));
          }
        }
      }

      // Determine final brief status
      let finalStatus: string;
      if (approvedCount > 0 && rejectedCount === 0) {
        finalStatus = "approved";
      } else if (approvedCount === 0 && rejectedCount > 0) {
        finalStatus = "rejected";
      } else {
        finalStatus = "partially_approved";
      }

      const [updatedBrief] = await db
        .update(briefs)
        .set({
          status: finalStatus,
          reviewedAt: new Date(),
          reviewedBy,
          updatedAt: new Date(),
        })
        .where(eq(briefs.id, briefId))
        .returning();

      return {
        brief: updatedBrief,
        createdTaskIds,
        createdMemoryIds,
      };
    },
  };
}
