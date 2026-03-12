import { and, eq, gte, lte, sql, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { briefs, issues, memoryItems, activityLog, goals } from "@paperclipai/db";
import type { HomeSummary, GoalProgress, RecentActivityItem } from "@paperclipai/shared";

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
        goalProgressData,
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
        db
          .select({ count: sql<number>`count(*)` })
          .from(memoryItems)
          .where(and(eq(memoryItems.companyId, companyId), eq(memoryItems.status, "pending")))
          .then((rows) => Number(rows[0]?.count ?? 0)),

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

        // 7. Goal progress — active goals with task counts
        (async () => {
          const activeGoals = await db
            .select({ id: goals.id, title: goals.title, status: goals.status })
            .from(goals)
            .where(
              and(
                eq(goals.companyId, companyId),
                inArray(goals.status, ["active", "at_risk"]),
              ),
            );

          if (activeGoals.length === 0) return [];

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

          return activeGoals.map((g): GoalProgress => {
            const counts = countMap.get(g.id) ?? {};
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            const done = counts["done"] ?? 0;
            const inProgress = counts["in_progress"] ?? 0;
            const blocked = counts["blocked"] ?? 0;
            return {
              id: g.id,
              title: g.title,
              status: g.status,
              totalTasks: total,
              doneTasks: done,
              inProgressTasks: inProgress,
              blockedTasks: blocked,
              progressPercent: total > 0 ? Math.round((done / total) * 100) : 0,
            };
          });
        })(),
      ]);

      return {
        companyId,
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
        goalProgress: goalProgressData,
      };
    },
  };
}
