import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { activityLog, heartbeatRuns, issueComments, issues } from "@armyofagents/db";
import { RECOVERY_ORIGIN_KINDS } from "@armyofagents/shared";
import { withRecoveryModelProfileHint } from "./recovery/model-profile-hint.js";
import { issueService } from "./issues.js";

export const DEFAULT_PRODUCTIVITY_REVIEW_LIMITS = {
  noCommentStreakRuns: 10,
  longActiveMs: 6 * 60 * 60 * 1000,
  highChurnHourly: 10,
  highChurnSixHours: 30,
  resolvedSnoozeMs: 6 * 60 * 60 * 1000,
  refreshIntervalMs: 60 * 60 * 1000,
  maxRefreshComments: 3,
  creationWindowMs: 24 * 60 * 60 * 1000,
  maxCreationsPerWindow: 3,
} as const;

type ProductivityTrigger = "no_comment_streak" | "long_active" | "high_churn";

export function clampIssueRequestDepth(value: number) {
  return Math.max(0, Math.min(8, Math.floor(value)));
}

export function shouldCreateProductivityReview(input: {
  noCommentRunStreak: number;
  activeSince: Date | null;
  churnLastHour: number;
  churnLastSixHours: number;
  openReviewIssue: { id: string; lastRefreshedAt?: Date | null; refreshCount?: number | null } | null;
  recentResolvedReviewAt: Date | null;
  creationsInWindow: number;
  now: Date;
}) {
  if (input.openReviewIssue) return { create: false as const, reason: "open_review_exists" };
  if (
    input.recentResolvedReviewAt &&
    input.now.getTime() - input.recentResolvedReviewAt.getTime() < DEFAULT_PRODUCTIVITY_REVIEW_LIMITS.resolvedSnoozeMs
  ) {
    return { create: false as const, reason: "recently_resolved_snooze" };
  }
  if (input.creationsInWindow >= DEFAULT_PRODUCTIVITY_REVIEW_LIMITS.maxCreationsPerWindow) {
    return { create: false as const, reason: "creation_window_cap" };
  }
  if (input.noCommentRunStreak >= DEFAULT_PRODUCTIVITY_REVIEW_LIMITS.noCommentStreakRuns) {
    return { create: true as const, trigger: "no_comment_streak" as ProductivityTrigger };
  }
  if (
    input.activeSince &&
    input.now.getTime() - input.activeSince.getTime() > DEFAULT_PRODUCTIVITY_REVIEW_LIMITS.longActiveMs
  ) {
    return { create: true as const, trigger: "long_active" as ProductivityTrigger };
  }
  if (
    input.churnLastHour >= DEFAULT_PRODUCTIVITY_REVIEW_LIMITS.highChurnHourly ||
    input.churnLastSixHours >= DEFAULT_PRODUCTIVITY_REVIEW_LIMITS.highChurnSixHours
  ) {
    return { create: true as const, trigger: "high_churn" as ProductivityTrigger };
  }
  return { create: false as const, reason: "below_threshold" };
}

export function buildProductivityReviewIssueInput(input: {
  sourceIssue: {
    id: string;
    companyId: string;
    title: string;
    assigneeAgentId: string | null;
    projectId: string | null;
    goalId: string | null;
    requestDepth: number;
  };
  trigger: ProductivityTrigger;
}) {
  return {
    issue: {
      title: `Review productivity for: ${input.sourceIssue.title}`,
      description: `Recovery review triggered by ${input.trigger.replace(/_/g, " ")}.`,
      status: "todo" as const,
      priority: "medium" as const,
      workMode: "standard" as const,
      assigneeAgentId: input.sourceIssue.assigneeAgentId,
      projectId: input.sourceIssue.projectId,
      goalId: input.sourceIssue.goalId,
      originKind: RECOVERY_ORIGIN_KINDS.issueProductivityReview,
      originId: input.sourceIssue.id,
      requestDepth: clampIssueRequestDepth(input.sourceIssue.requestDepth + 1),
    },
    wakePayload: withRecoveryModelProfileHint({
      issueId: input.sourceIssue.id,
      sourceIssueId: input.sourceIssue.id,
      wakeReason: RECOVERY_ORIGIN_KINDS.issueProductivityReview,
      trigger: input.trigger,
    }),
  };
}

export function shouldHoldProductivityReviewContinuation(input: { openReviewIssueId: string | null }) {
  return Boolean(input.openReviewIssueId);
}

export function productivityReviewService(db: Db) {
  const issuesSvc = issueService(db);

  async function isProductivityReviewContinuationHoldActive(input: {
    companyId: string;
    issueId: string;
    agentId?: string | null;
  }) {
    const openReview = await db
      .select({ id: issues.id })
      .from(issues)
      .where(
        and(
          eq(issues.companyId, input.companyId),
          eq(issues.originKind, RECOVERY_ORIGIN_KINDS.issueProductivityReview),
          eq(issues.originId, input.issueId),
          sql`${issues.status} not in ('done', 'cancelled')`,
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return shouldHoldProductivityReviewContinuation({ openReviewIssueId: openReview?.id ?? null });
  }

  async function reconcileCompany(companyId: string, opts: { now?: Date } = {}) {
    const now = opts.now ?? new Date();
    const activeIssues = await db
      .select()
      .from(issues)
      .where(and(eq(issues.companyId, companyId), eq(issues.status, "in_progress")))
      .limit(100);
    let created = 0;

    for (const sourceIssue of activeIssues) {
      if (!sourceIssue.assigneeAgentId) continue;
      const windowStart = new Date(now.getTime() - DEFAULT_PRODUCTIVITY_REVIEW_LIMITS.creationWindowMs);
      const creationsInWindow = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            eq(issues.originKind, RECOVERY_ORIGIN_KINDS.issueProductivityReview),
            gte(issues.createdAt, windowStart),
          ),
        )
        .then((rows) => rows[0]?.count ?? 0);
      const openReview = await db
        .select({ id: issues.id })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            eq(issues.originKind, RECOVERY_ORIGIN_KINDS.issueProductivityReview),
            eq(issues.originId, sourceIssue.id),
            sql`${issues.status} not in ('done', 'cancelled')`,
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);
      const recentResolved = await db
        .select({ updatedAt: issues.updatedAt })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            eq(issues.originKind, RECOVERY_ORIGIN_KINDS.issueProductivityReview),
            eq(issues.originId, sourceIssue.id),
            sql`${issues.status} in ('done', 'cancelled')`,
          ),
        )
        .orderBy(desc(issues.updatedAt))
        .limit(1)
        .then((rows) => rows[0]?.updatedAt ?? null);
      const recentComments = await db
        .select({ id: issueComments.id })
        .from(issueComments)
        .where(and(eq(issueComments.companyId, companyId), eq(issueComments.issueId, sourceIssue.id)))
        .limit(1);
      const recentRuns = await db
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(and(eq(heartbeatRuns.companyId, companyId), sql`${heartbeatRuns.contextSnapshot} ->> 'issueId' = ${sourceIssue.id}`))
        .orderBy(desc(heartbeatRuns.createdAt))
        .limit(DEFAULT_PRODUCTIVITY_REVIEW_LIMITS.noCommentStreakRuns);

      const decision = shouldCreateProductivityReview({
        noCommentRunStreak: recentComments.length === 0 ? recentRuns.length : 0,
        activeSince: sourceIssue.startedAt ?? sourceIssue.createdAt,
        churnLastHour: 0,
        churnLastSixHours: 0,
        openReviewIssue: openReview ? { id: openReview.id } : null,
        recentResolvedReviewAt: recentResolved,
        creationsInWindow,
        now,
      });
      if (!decision.create) continue;

      const reviewInput = buildProductivityReviewIssueInput({ sourceIssue, trigger: decision.trigger });
      const createdIssue = await issuesSvc.create(companyId, reviewInput.issue);
      if (createdIssue) {
        created += 1;
        await db.insert(activityLog).values({
          companyId,
          actorType: "system",
          actorId: "recovery",
          action: "issue.productivity_review_created",
          entityType: "issue",
          entityId: sourceIssue.id,
          details: { reviewIssueId: createdIssue.id, trigger: decision.trigger },
        });
      }
    }

    return { checked: activeIssues.length, created };
  }

  return {
    isProductivityReviewContinuationHoldActive,
    reconcileCompany,
  };
}
