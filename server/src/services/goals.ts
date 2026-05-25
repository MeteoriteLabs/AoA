import { eq, and, inArray } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { goals, projectGoals, projects, goalParents, issues } from "@armyofagents/db";
import type { GoalStatus } from "@armyofagents/shared";
import { badRequest } from "../errors.js";

const GOAL_TRANSITIONS: Record<string, GoalStatus[]> = {
  planned: ["active", "cancelled"],
  active: ["at_risk", "achieved", "cancelled"],
  at_risk: ["active", "achieved", "cancelled"],
  achieved: [],
  cancelled: [],
};

/* ─── Goals DAG: pure helpers (multi-parent, scope, roll-up) ─── */

/**
 * True when a child goal's scope sits within a parent goal's scope.
 * - A company-wide parent (no projects) allows any child.
 * - A company-wide child (no projects) cannot sit under a scoped parent.
 * - Otherwise the child's projects must be a subset of the parent's.
 */
export function isScopeWithinParent(
  childProjectIds: string[],
  parentProjectIds: string[],
): boolean {
  if (parentProjectIds.length === 0) return true;
  if (childProjectIds.length === 0) return false;
  const parentSet = new Set(parentProjectIds);
  return childProjectIds.every((id) => parentSet.has(id));
}

/**
 * Returns the first parent id that would create a cycle (the goal itself or one
 * of its descendants), or null if all parents are safe. Pure — caller supplies
 * the precomputed descendant set.
 */
export function findCycleParent(
  goalId: string,
  parentIds: string[],
  descendants: ReadonlySet<string>,
): string | null {
  for (const pid of parentIds) {
    if (pid === goalId || descendants.has(pid)) return pid;
  }
  return null;
}

/** Roll-up counts from a flat list of issue statuses. `cancelled` is excluded from the total. */
export function computeGoalProgress(statuses: string[]): {
  done: number;
  total: number;
  percent: number;
} {
  const total = statuses.filter((s) => s !== "cancelled").length;
  const done = statuses.filter((s) => s === "done").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, percent };
}

/**
 * Non-binding status nudge (founder confirms). Only suggests transitions that
 * are legal from `current`:
 * - all work done → `achieved` (from active / at_risk)
 * - risk present (blocked / overdue) → `at_risk` (from active)
 * Returns null when there is nothing to suggest.
 */
export function suggestGoalStatus(
  current: GoalStatus,
  args: { total: number; done: number; atRisk: number },
): GoalStatus | null {
  if (args.total > 0 && args.done === args.total) {
    return current === "active" || current === "at_risk" ? "achieved" : null;
  }
  if (args.atRisk > 0 && current === "active") return "at_risk";
  return null;
}

/* ─── Goals DAG: db helpers ─── */

/** A goal's scope = the set of project ids it is linked to (empty = company-wide). */
async function getGoalProjectIds(db: Db, goalId: string): Promise<string[]> {
  const rows = await db
    .select({ projectId: projectGoals.projectId })
    .from(projectGoals)
    .where(eq(projectGoals.goalId, goalId));
  return rows.map((r) => r.projectId);
}

/**
 * All goals reachable downward from `rootId` via goal_parents (descendants,
 * excludes root). Level-batched BFS — one query per depth; the visited-set
 * dedupes the DAG and backstops any residual cycle.
 */
async function collectDescendants(db: Db, rootId: string): Promise<Set<string>> {
  const seen = new Set<string>();
  let frontier: string[] = [rootId];
  while (frontier.length > 0) {
    const rows = await db
      .select({ child: goalParents.goalId })
      .from(goalParents)
      .where(inArray(goalParents.parentId, frontier));
    const next: string[] = [];
    for (const r of rows) {
      if (r.child !== rootId && !seen.has(r.child)) {
        seen.add(r.child);
        next.push(r.child);
      }
    }
    frontier = next;
  }
  return seen;
}

/**
 * D3: reject cycles + child-scope-not-⊆-parent before writing goal_parents.
 * `goalId` is omitted for a not-yet-created goal (no descendants, cannot
 * self-parent) so the same check guards creation and re-parenting.
 */
async function assertParentsValid(
  db: Db,
  opts: { goalId?: string; parentIds: string[]; childProjectIds: string[] },
): Promise<void> {
  const { goalId, parentIds, childProjectIds } = opts;
  if (parentIds.length === 0) return;
  if (goalId) {
    const descendants = await collectDescendants(db, goalId);
    const cycle = findCycleParent(goalId, parentIds, descendants);
    if (cycle) {
      throw badRequest(
        "A goal cannot be its own parent or ancestor (would create a cycle)",
      );
    }
  }
  for (const pid of parentIds) {
    const parentProjectIds = await getGoalProjectIds(db, pid);
    if (!isScopeWithinParent(childProjectIds, parentProjectIds)) {
      throw badRequest("Child goal scope must be within the parent goal's scope");
    }
  }
}

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
      data: Omit<typeof goals.$inferInsert, "companyId"> & {
        projectIds?: string[];
        parentIds?: string[];
      },
    ) => {
      const { projectIds, parentIds, ...goalData } = data;
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

      // Multi-parent DAG edges (D3: validate cycle + child⊆parent scope on write).
      if (parentIds && parentIds.length > 0) {
        await assertParentsValid(db, {
          goalId: goal.id,
          parentIds,
          childProjectIds: projectIds ?? [],
        });
        await db
          .insert(goalParents)
          .values(parentIds.map((parentId) => ({ goalId: goal.id, parentId })))
          .onConflictDoNothing();
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

    /* ── Goals DAG (multi-parent, scope, roll-up) ── */

    getParents: async (goalId: string): Promise<string[]> => {
      const rows = await db
        .select({ parentId: goalParents.parentId })
        .from(goalParents)
        .where(eq(goalParents.goalId, goalId));
      return rows.map((r) => r.parentId);
    },

    getChildren: async (parentId: string): Promise<string[]> => {
      const rows = await db
        .select({ childId: goalParents.goalId })
        .from(goalParents)
        .where(eq(goalParents.parentId, parentId));
      return rows.map((r) => r.childId);
    },

    /** Validate parents without writing — used before creating a brand-new goal. */
    assertParentsValid: (opts: {
      goalId?: string;
      parentIds: string[];
      childProjectIds: string[];
    }) => assertParentsValid(db, opts),

    /** Replace this goal's parent edges (D3: cycle + scope enforced on write). */
    setGoalParents: async (goalId: string, parentIds: string[]) => {
      const childProjectIds = await getGoalProjectIds(db, goalId);
      await assertParentsValid(db, { goalId, parentIds, childProjectIds });
      await db.delete(goalParents).where(eq(goalParents.goalId, goalId));
      if (parentIds.length > 0) {
        await db
          .insert(goalParents)
          .values(parentIds.map((parentId) => ({ goalId, parentId })))
          .onConflictDoNothing();
      }
    },

    /** Task-based progress rolled up over this goal + all descendant goals (DAG-safe). */
    getProgress: async (goalId: string) => {
      const ids = new Set<string>([goalId]);
      for (const d of await collectDescendants(db, goalId)) ids.add(d);
      const rows = await db
        .select({ status: issues.status, dueDate: issues.dueDate })
        .from(issues)
        .where(inArray(issues.goalId, [...ids]));
      const progress = computeGoalProgress(rows.map((r) => r.status));
      const now = Date.now();
      const atRisk = rows.filter(
        (r) =>
          r.status === "blocked" ||
          (r.dueDate != null &&
            r.dueDate.getTime() < now &&
            r.status !== "done" &&
            r.status !== "cancelled"),
      ).length;
      return { ...progress, atRisk };
    },
  };
}
