import { eq, and, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { goals, projectGoals, projects } from "@armyofagents/db";
import type { GoalStatus } from "@armyofagents/shared";
import { badRequest } from "../errors.js";

const GOAL_TRANSITIONS: Record<string, GoalStatus[]> = {
  planned: ["active", "cancelled"],
  active: ["at_risk", "achieved", "cancelled"],
  at_risk: ["active", "achieved", "cancelled"],
  achieved: [],
  cancelled: [],
};

/** Attach project associations to a list of goals */
async function attachProjects(
  db: Db,
  goalRows: (typeof goals.$inferSelect)[],
) {
  if (goalRows.length === 0) return [];
  const goalIds = goalRows.map((g) => g.id);
  const links = await db
    .select({
      goalId: projectGoals.goalId,
      projectId: projectGoals.projectId,
      projectName: projects.name,
      projectType: projects.type,
    })
    .from(projectGoals)
    .innerJoin(projects, eq(projectGoals.projectId, projects.id))
    .where(inArray(projectGoals.goalId, goalIds));

  const map = new Map<string, { id: string; name: string; type: string }[]>();
  for (const l of links) {
    const arr = map.get(l.goalId) ?? [];
    arr.push({ id: l.projectId, name: l.projectName, type: l.projectType });
    map.set(l.goalId, arr);
  }
  return goalRows.map((g) => ({
    ...g,
    projects: map.get(g.id) ?? [],
    projectIds: (map.get(g.id) ?? []).map((p) => p.id),
  }));
}

export function goalService(db: Db) {
  return {
    list: async (companyId: string, projectId?: string) => {
      let rows: (typeof goals.$inferSelect)[];
      if (projectId) {
        // Filter by projectId via join
        rows = await db
          .select({
            id: goals.id,
            companyId: goals.companyId,
            title: goals.title,
            description: goals.description,
            level: goals.level,
            status: goals.status,
            parentId: goals.parentId,
            ownerAgentId: goals.ownerAgentId,
            createdAt: goals.createdAt,
            updatedAt: goals.updatedAt,
          })
          .from(goals)
          .innerJoin(projectGoals, eq(goals.id, projectGoals.goalId))
          .where(
            and(eq(goals.companyId, companyId), eq(projectGoals.projectId, projectId)),
          );
      } else {
        rows = await db.select().from(goals).where(eq(goals.companyId, companyId));
      }
      return attachProjects(db, rows);
    },

    getById: async (id: string) => {
      const row = await db
        .select()
        .from(goals)
        .where(eq(goals.id, id))
        .then((rows) => rows[0] ?? null);
      if (!row) return null;
      const [enriched] = await attachProjects(db, [row]);
      return enriched;
    },

    create: async (
      companyId: string,
      data: Omit<typeof goals.$inferInsert, "companyId"> & { projectIds?: string[] },
    ) => {
      const { projectIds, ...goalData } = data;
      const [goal] = await db
        .insert(goals)
        .values({ ...goalData, companyId })
        .returning();

      // Create project_goals entries
      if (projectIds && projectIds.length > 0) {
        await db.insert(projectGoals).values(
          projectIds.map((pid) => ({
            projectId: pid,
            goalId: goal.id,
            companyId,
          })),
        );
      }

      const [enriched] = await attachProjects(db, [goal]);
      return enriched;
    },

    update: async (
      id: string,
      data: Partial<typeof goals.$inferInsert> & { projectIds?: string[] },
    ) => {
      // Validate status transition if status is being changed
      if (data.status) {
        const existing = await db
          .select({ status: goals.status })
          .from(goals)
          .where(eq(goals.id, id))
          .then((rows) => rows[0] ?? null);
        if (existing && existing.status !== data.status) {
          const allowed = GOAL_TRANSITIONS[existing.status] ?? [];
          if (!allowed.includes(data.status as GoalStatus)) {
            throw badRequest(`Invalid goal status transition from '${existing.status}' to '${data.status}'`);
          }
        }
      }

      const { projectIds, ...goalData } = data;
      const goal = await db
        .update(goals)
        .set({ ...goalData, updatedAt: new Date() })
        .where(eq(goals.id, id))
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!goal) return null;

      // Sync project_goals if projectIds provided
      if (projectIds !== undefined) {
        await db.delete(projectGoals).where(eq(projectGoals.goalId, id));
        if (projectIds.length > 0) {
          await db.insert(projectGoals).values(
            projectIds.map((pid) => ({
              projectId: pid,
              goalId: id,
              companyId: goal.companyId,
            })),
          );
        }
      }

      const [enriched] = await attachProjects(db, [goal]);
      return enriched;
    },

    remove: (id: string) =>
      db
        .delete(goals)
        .where(eq(goals.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),
  };
}
