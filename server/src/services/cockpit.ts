/**
 * cockpitService — Phase 3b batched, RBAC-scoped cockpit data engine.
 *
 * GET /companies/:cid/cockpit returns ONE payload: Promise.all of 5 queries
 * (Running / Review / MyTasks / Today / Discussions). Mirrors the
 * sidebar-badges + home batching pattern.
 *
 * Security model:
 *   - resolveCockpitScope() drives every per-card scope decision.
 *   - Running: company-wide live runs (crew scoping is a 3c refinement).
 *   - Review: taskScope:"all" (Codex #2 — crew in_review must appear).
 *     Translates ReviewFilter from cockpit-scope:
 *       {}: founder — no extra filter
 *       {projectIds}: team_lead — loop per dept, dedupe by id (bounded)
 *       {assigneeUserId}: member — scoped to own assigned tasks
 *   - MyTasks: assigneeUserId=scope.userId, default taskScope (org).
 *   - Today: reminders (userId=scope.userId, pending, triggerAt <= EOD)
 *     + dueTasks (assigneeUserId=scope.userId, dueDate <= EOD, non-terminal).
 *   - Discussions: canonical threadService.list visibility (Codex #3).
 *     Then filter to needs-me: pendingItemCount > 0 OR a failed/pending
 *     extraction entry over the visible ids. Map to CockpitDiscussionItem.
 */

import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  discussionEntries,
  internalAgentReminders,
  issues,
} from "@armyofagents/db";
import type { CockpitData, CockpitTaskItem } from "@armyofagents/shared";
import { issueService } from "./issues.js";
import { threadService } from "./threads.js";
import { liveRunsForCompany } from "../routes/agents-live-runs.js";
import { resolveCockpitScope, reviewFilterFor } from "./cockpit-scope.js";
import type { ActorLike } from "./cockpit-scope.js";

// Terminal statuses excluded from active task lists.
const TERMINAL_STATUSES = new Set(["done", "cancelled"]);

/** End-of-today (23:59:59.999 local time on the server). */
function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Map a raw issues row to a CockpitTaskItem (minimal shape for the card). */
function toTaskItem(row: {
  id: string;
  identifier?: string | null;
  title: string;
  status: string;
  assigneeUserId?: string | null;
  assigneeAgentId?: string | null;
  dueDate?: Date | null;
}): CockpitTaskItem {
  return {
    id: row.id,
    identifier: row.identifier ?? null,
    title: row.title,
    status: row.status,
    assigneeUserId: row.assigneeUserId ?? null,
    assigneeAgentId: row.assigneeAgentId ?? null,
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
  };
}

export function cockpitService(db: Db) {
  return {
    async get(companyId: string, actor: ActorLike): Promise<CockpitData> {
      const scope = await resolveCockpitScope(db, companyId, actor);
      const issueSvc = issueService(db);
      const threadSvc = threadService(db);

      // Build the threadService Actor from scope (canonical visibility — Codex #3).
      const threadActor = {
        userId: scope.userId,
        role: scope.role,
        isHuman: true,
      };

      const eod = endOfToday();

      const [runRows, reviewRows, myTaskRows, remindersRows, dueTodayRows, visibleThreads] =
        await Promise.all([
          // ── 1. Running ────────────────────────────────────────────────────
          // Company-wide live runs (heartbeat + crew internal_agent runs).
          // Per-user scoping for crew is a 3c refinement (note in plan §13).
          liveRunsForCompany(db, companyId),

          // ── 2. Review ────────────────────────────────────────────────────
          // taskScope:"all" is REQUIRED (Codex #2) — default "org" scope
          // hides crew agent tasks via notCrewAssigned; Review IS crew work.
          (async () => {
            const filter = reviewFilterFor(scope);
            if ("projectIds" in filter) {
              // team_lead: loop per dept, dedupe by id (bounded N = dept count).
              const perDeptResults = await Promise.all(
                filter.projectIds.map((pid) =>
                  issueSvc.list(companyId, {
                    status: "in_review",
                    taskScope: "all",
                    projectId: pid,
                  }),
                ),
              );
              // Flatten + dedupe by issue id.
              const seen = new Set<string>();
              return perDeptResults.flat().filter((row) => {
                if (seen.has(row.id)) return false;
                seen.add(row.id);
                return true;
              });
            }
            if ("assigneeUserId" in filter) {
              // member: own assigned in-review tasks only (no cross-dept leak).
              return issueSvc.list(companyId, {
                status: "in_review",
                taskScope: "all",
                assigneeUserId: filter.assigneeUserId,
              });
            }
            // founder: all in_review tasks.
            return issueSvc.list(companyId, {
              status: "in_review",
              taskScope: "all",
            });
          })(),

          // ── 3. My Tasks ───────────────────────────────────────────────────
          // The human's own assigned tasks, excluding terminal ones.
          // Default org-scope is correct — My tasks = the human's own tasks.
          issueSvc.list(companyId, {
            assigneeUserId: scope.userId,
          }),

          // ── 4a. Today: pending reminders for this user ────────────────────
          db
            .select({
              id: internalAgentReminders.id,
              content: internalAgentReminders.content,
              triggerAt: internalAgentReminders.triggerAt,
            })
            .from(internalAgentReminders)
            .where(
              and(
                eq(internalAgentReminders.companyId, companyId),
                eq(internalAgentReminders.userId, scope.userId),
                eq(internalAgentReminders.status, "pending"),
                lte(internalAgentReminders.triggerAt, eod),
              ),
            ),

          // ── 4b. Today: due tasks for this user ────────────────────────────
          db
            .select({
              id: issues.id,
              identifier: issues.identifier,
              title: issues.title,
              status: issues.status,
              assigneeUserId: issues.assigneeUserId,
              assigneeAgentId: issues.assigneeAgentId,
              dueDate: issues.dueDate,
            })
            .from(issues)
            .where(
              and(
                eq(issues.companyId, companyId),
                eq(issues.assigneeUserId, scope.userId),
                lte(issues.dueDate, eod),
                sql`${issues.status} NOT IN ('done', 'cancelled')`,
                sql`${issues.hiddenAt} IS NULL`,
              ),
            ),

          // ── 5. Discussions: canonical visibility ──────────────────────────
          // threadService.list handles participant + dept-role access internally.
          // Do NOT hand-roll owner/dept scoping (Codex #3).
          threadSvc.list(companyId, threadActor),
        ]);

      // ── Map running ───────────────────────────────────────────────────────
      const running = (
        runRows as Array<{
          id: string;
          agentName?: string | null;
          status: string;
          startedAt?: Date | string | null;
          issueId?: string | null;
        }>
      )
        .filter((r) => r.status === "running" || r.status === "queued")
        .map((r) => ({
        id: r.id,
        agentName: r.agentName ?? null,
        status: r.status,
        startedAt: r.startedAt
          ? typeof r.startedAt === "string"
            ? r.startedAt
            : (r.startedAt as Date).toISOString()
          : null,
        issueId: r.issueId ?? null,
      }));

      // ── Map review ────────────────────────────────────────────────────────
      const review = reviewRows.map(toTaskItem);

      // ── Map myTasks (exclude terminal) ───────────────────────────────────
      const myTasks = myTaskRows
        .filter((r) => !TERMINAL_STATUSES.has(r.status))
        .map(toTaskItem);

      // ── Map today ────────────────────────────────────────────────────────
      const reminders = remindersRows.map((r) => ({
        id: r.id,
        content: r.content,
        triggerAt: r.triggerAt.toISOString(),
      }));
      const dueTasks = dueTodayRows.map(toTaskItem);

      // ── Map discussions: filter to needs-me ──────────────────────────────
      // "needs me" = pendingItemCount > 0 OR a pending/failed extraction entry.
      const visibleIds = visibleThreads.map((t) => t.id);

      let needsMeIds = new Set<string>();

      // Quick pass: threads with pendingItemCount already populated.
      const alreadyPending = visibleThreads.filter(
        (t) => (t.pendingItemCount ?? 0) > 0,
      );
      for (const t of alreadyPending) needsMeIds.add(t.id);

      // Batch query: find any visible thread with a pending/failed entry.
      if (visibleIds.length > 0) {
        const entryRows = await db
          .select({ discussionId: discussionEntries.discussionId })
          .from(discussionEntries)
          .where(
            and(
              inArray(discussionEntries.discussionId, visibleIds),
              inArray(discussionEntries.extractionStatus, ["pending", "failed"]),
            ),
          );
        for (const e of entryRows) needsMeIds.add(e.discussionId);
      }

      const threadById = new Map(visibleThreads.map((t) => [t.id, t]));

      // Determine the reason per discussion (prefer pending_items over extraction_failed
      // since pendingItemCount is the higher-signal indicator).
      const discussionItems = [...needsMeIds].map((id) => {
        const t = threadById.get(id)!;
        const hasPending = (t.pendingItemCount ?? 0) > 0;
        return {
          id: t.id,
          title: t.title ?? null,
          pendingItemCount: t.pendingItemCount ?? 0,
          reason: hasPending
            ? ("pending_items" as const)
            : ("extraction_failed" as const),
        };
      });

      return {
        running,
        review,
        myTasks,
        today: { reminders, dueTasks },
        discussions: discussionItems,
      };
    },
  };
}
