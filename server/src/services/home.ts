import { and, eq, gte, lte, sql, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  briefs,
  issues,
  memoryItems,
  memoryItemVersions,
  suggestions,
  activityLog,
  goals,
  companies,
  projects,
  agents,
} from "@paperclipai/db";
import type { HomeSummary, GoalProgress, GoalGapNudge, RecentActivityItem, SetupStatus } from "@paperclipai/shared";

const TERMINAL_STATUSES = ["done", "cancelled"];

export function homeService(db: Db) {
  return {
    summary: async (companyId: string, userId?: string): Promise<HomeSummary> => {
      // Run independent queries in parallel
      const [
        briefsCount,
        reviewCount,
        blockedCount,
        pendingMemoryCount,
        dueTodayTasks,
        recentActivityRows,
        goalData,
        setupStatus,
      ] = await Promise.all([
        // 1. Briefs awaiting review (status = 'ready')
        db
          .select({ count: sql<number>`count(*)` })
          .from(briefs)
          .where(and(eq(briefs.companyId, companyId), eq(briefs.status, "ready")))
          .then((rows) => Number(rows[0]?.count ?? 0)),

        // 2. Tasks in review (status = 'in_review')
        db
          .select({ count: sql<number>`count(*)` })
          .from(issues)
          .where(and(eq(issues.companyId, companyId), eq(issues.status, "in_review")))
          .then((rows) => Number(rows[0]?.count ?? 0)),

        // 3. Blocked tasks
        db
          .select({ count: sql<number>`count(*)` })
          .from(issues)
          .where(and(eq(issues.companyId, companyId), eq(issues.status, "blocked")))
          .then((rows) => Number(rows[0]?.count ?? 0)),

        // 4. Pending memory items
        Promise.all([
          db
            .select({ count: sql<number>`count(*)` })
            .from(memoryItems)
            .where(and(eq(memoryItems.companyId, companyId), eq(memoryItems.status, "pending")))
            .then((rows) => Number(rows[0]?.count ?? 0)),
          db
            .select({ count: sql<number>`count(*)` })
            .from(memoryItemVersions)
            .innerJoin(memoryItems, eq(memoryItemVersions.memoryItemId, memoryItems.id))
            .where(
              and(
                eq(memoryItems.companyId, companyId),
                eq(memoryItems.status, "approved"),
                eq(memoryItemVersions.status, "pending"),
              ),
            )
            .then((rows) => Number(rows[0]?.count ?? 0)),
          db
            .select({ count: sql<number>`count(*)` })
            .from(suggestions)
            .where(
              and(
                eq(suggestions.companyId, companyId),
                eq(suggestions.category, "agent_proposal"),
                eq(suggestions.actionType, "archive_memory"),
                eq(suggestions.status, "pending"),
              ),
            )
            .then((rows) => Number(rows[0]?.count ?? 0)),
        ]).then(([itemCount, versionCount, archiveCount]) => itemCount + versionCount + archiveCount),

        // 5. Tasks due today or overdue assigned to current user
        (() => {
          const today = new Date();
          today.setHours(23, 59, 59, 999);
          const conditions = [
            eq(issues.companyId, companyId),
            lte(issues.dueDate, today),
            sql`${issues.status} NOT IN ('done', 'cancelled')`,
          ];
          if (userId) {
            conditions.push(eq(issues.assigneeUserId, userId));
          }
          return db
            .select({
              id: issues.id,
              title: issues.title,
              status: issues.status,
              priority: issues.priority,
              dueDate: issues.dueDate,
              assigneeAgentId: issues.assigneeAgentId,
              assigneeUserId: issues.assigneeUserId,
            })
            .from(issues)
            .where(and(...conditions));
        })(),

        // 6. Recent activity (last 24h, limit 20)
        (() => {
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          return db
            .select({
              id: activityLog.id,
              actorType: activityLog.actorType,
              actorId: activityLog.actorId,
              action: activityLog.action,
              entityType: activityLog.entityType,
              entityId: activityLog.entityId,
              details: activityLog.details,
              createdAt: activityLog.createdAt,
            })
            .from(activityLog)
            .where(
              and(
                eq(activityLog.companyId, companyId),
                gte(activityLog.createdAt, oneDayAgo),
              ),
            )
            .orderBy(sql`${activityLog.createdAt} DESC`)
            .limit(20);
        })(),

        // 7. Goal progress + gap nudges — active goals with task counts
        (async (): Promise<{ progress: GoalProgress[]; nudges: GoalGapNudge[] }> => {
          const activeGoals = await db
            .select({ id: goals.id, title: goals.title, status: goals.status })
            .from(goals)
            .where(
              and(
                eq(goals.companyId, companyId),
                inArray(goals.status, ["active", "at_risk"]),
              ),
            );

          if (activeGoals.length === 0) return { progress: [], nudges: [] };

          const goalIds = activeGoals.map((g) => g.id);
          const taskCounts = await db
            .select({
              goalId: issues.goalId,
              status: issues.status,
              count: sql<number>`count(*)`,
            })
            .from(issues)
            .where(
              and(
                eq(issues.companyId, companyId),
                inArray(issues.goalId, goalIds),
              ),
            )
            .groupBy(issues.goalId, issues.status);

          const countMap = new Map<string, Record<string, number>>();
          for (const row of taskCounts) {
            if (!row.goalId) continue;
            const entry = countMap.get(row.goalId) ?? {};
            entry[row.status] = Number(row.count);
            countMap.set(row.goalId, entry);
          }

          const progress: GoalProgress[] = [];
          const nudges: GoalGapNudge[] = [];

          for (const g of activeGoals) {
            const counts = countMap.get(g.id) ?? {};
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            const done = counts["done"] ?? 0;
            const cancelled = counts["cancelled"] ?? 0;
            const inProgress = counts["in_progress"] ?? 0;
            const blocked = counts["blocked"] ?? 0;

            progress.push({
              id: g.id,
              title: g.title,
              status: g.status,
              totalTasks: total,
              doneTasks: done,
              inProgressTasks: inProgress,
              blockedTasks: blocked,
              progressPercent: total > 0 ? Math.round((done / total) * 100) : 0,
            });

            // Gap: zero tasks in non-terminal statuses
            const nonTerminalCount = total - done - cancelled;
            if (nonTerminalCount === 0) {
              nudges.push({
                type: "goal_gap",
                goalId: g.id,
                goalTitle: g.title,
                message: "This goal has no active tasks — consider creating some.",
              });
            }
          }

          return { progress, nudges };
        })(),

        // 8. Setup status for onboarding flow
        (async (): Promise<SetupStatus> => {
          const [company, deptCount, agentCount, goalCount] = await Promise.all([
            db
              .select({ vision: companies.vision, mission: companies.mission })
              .from(companies)
              .where(eq(companies.id, companyId))
              .then((rows) => rows[0] ?? null),
            db
              .select({ count: sql<number>`count(*)` })
              .from(projects)
              .where(and(eq(projects.companyId, companyId), eq(projects.type, "department")))
              .then((rows) => Number(rows[0]?.count ?? 0)),
            db
              .select({ count: sql<number>`count(*)` })
              .from(agents)
              .where(eq(agents.companyId, companyId))
              .then((rows) => Number(rows[0]?.count ?? 0)),
            db
              .select({ count: sql<number>`count(*)` })
              .from(goals)
              .where(eq(goals.companyId, companyId))
              .then((rows) => Number(rows[0]?.count ?? 0)),
          ]);
          return {
            hasVisionMission: !!(company?.vision?.trim() || company?.mission?.trim()),
            hasDepartment: deptCount > 0,
            hasAgent: agentCount > 0,
            hasGoal: goalCount > 0,
          };
        })(),
      ]);

      return {
        companyId,
        setupStatus,
        briefsAwaitingReview: briefsCount,
        tasksInReview: reviewCount,
        myTasksDueToday: dueTodayTasks.map((t) => ({
          ...t,
          dueDate: t.dueDate?.toISOString() ?? null,
        })),
        blockedTasks: blockedCount,
        pendingMemoryItems: pendingMemoryCount,
        recentActivity: recentActivityRows.map((a): RecentActivityItem => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
        })),
        goalProgress: goalData.progress,
        nudges: goalData.nudges,
      };
    },
  };
}
