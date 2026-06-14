/**
 * cockpitService — Phase 3b/3c batched, RBAC-scoped cockpit data engine.
 *
 * GET /companies/:cid/cockpit returns ONE payload: Promise.all of 6 queries
 * (Running / Review / MyTasks / Today / Discussions / Approvals). Mirrors the
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
 *   - Approvals (Phase 3c): founder-only; [] for all other roles (HC1).
 *     Aggregates 3 sources: approvals table + memory pending items + discussion
 *     extracted items. Non-founder short-circuits immediately — no sub-queries.
 */

import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  approvals,
  discussionEntries,
  discussionExtractedItems,
  discussions,
  internalAgentReminders,
  issues,
} from "@armyofagents/db";
import type { CockpitApprovalItem, CockpitData, CockpitTaskItem } from "@armyofagents/shared";
import { issueService } from "./issues.js";
import { threadService } from "./threads.js";
import { memoryService } from "./memory.js";
import { liveRunsForCompany } from "../routes/agents-live-runs.js";
import { resolveCockpitScope, reviewFilterFor } from "./cockpit-scope.js";
import type { ActorLike, CockpitScope } from "./cockpit-scope.js";

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

// ── Phase 3c: Approvals aggregation (founder-only) ───────────────────────────

const ACTIONABLE_APPROVAL_STATUSES = ["pending", "revision_requested"];

/**
 * List pending approvals rows for the company (status pending or revision_requested).
 * Returns minimal fields needed for the cockpit card.
 */
async function listPendingApprovals(
  db: Db,
  companyId: string,
): Promise<Array<{ id: string; type: string; status: string; payload: Record<string, unknown> }>> {
  return db
    .select({
      id: approvals.id,
      type: approvals.type,
      status: approvals.status,
      payload: approvals.payload,
    })
    .from(approvals)
    .where(
      and(
        eq(approvals.companyId, companyId),
        inArray(approvals.status, ACTIONABLE_APPROVAL_STATUSES),
      ),
    );
}

/**
 * List pending discussion extracted items for the company.
 *
 * HC3: discussionExtractedItems has discussionEntryId (NOT discussionId directly).
 * Join: discussion_extracted_items → discussion_entries (via discussionEntryId)
 *       → discussions (via discussionId) to scope by companyId.
 * Returns discussionId from discussion_entries so the UI can route to the right page.
 */
async function listPendingExtractedItems(
  db: Db,
  companyId: string,
): Promise<Array<{ id: string; discussionId: string; title: string; type: string }>> {
  return db
    .select({
      id: discussionExtractedItems.id,
      discussionId: discussionEntries.discussionId,
      title: discussionExtractedItems.title,
      type: discussionExtractedItems.type,
    })
    .from(discussionExtractedItems)
    .innerJoin(
      discussionEntries,
      eq(discussionEntries.id, discussionExtractedItems.discussionEntryId),
    )
    .innerJoin(discussions, eq(discussions.id, discussionEntries.discussionId))
    .where(
      and(
        eq(discussions.companyId, companyId),
        eq(discussionExtractedItems.status, "pending"),
      ),
    );
}

/** Build a human-readable title for an approval row from its type + payload. */
function approvalTitle(row: { type: string; payload: Record<string, unknown> }): string {
  const name =
    (row.payload?.agentName as string | undefined) ??
    (row.payload?.name as string | undefined) ??
    null;
  if (row.type === "agent_hire") return name ? `Hire ${name}` : "Agent hire request";
  return name ?? row.type.replace(/_/g, " ");
}

/** Subtitle for an approval: the type in a readable form. */
function approvalSubtitle(row: { type: string }): string {
  return row.type.replace(/_/g, " ");
}

/**
 * Aggregate the unified approvals queue (Phase 3c).
 *
 * HC1: non-founder → [] immediately, no sub-queries.
 * HC2: memory.listPending returns { items, versions, archives, totalCount } — use .items.
 * HC3: discussion join goes through discussionEntryId → discussion_entries → discussions.
 */
async function cockpitApprovals(
  db: Db,
  companyId: string,
  scope: CockpitScope,
): Promise<CockpitApprovalItem[]> {
  // HC1: founder-only display. Non-founders get []; no sub-queries run.
  if (!scope.isFounder) return [];

  const [approvalRows, memPending, discItems] = await Promise.all([
    listPendingApprovals(db, companyId),
    // HC2: listPending returns an OBJECT { items, versions, archives, totalCount }, not an array.
    // 3c uses only .items (new agent-suggested pending memory_items); versions/archives are follow-ups.
    memoryService(db).listPending(companyId),
    // HC3: join via discussionEntryId.
    listPendingExtractedItems(db, companyId),
  ]);

  return [
    ...approvalRows.map(
      (a): CockpitApprovalItem => ({
        source: "approval",
        id: a.id,
        title: approvalTitle(a),
        subtitle: approvalSubtitle(a),
      }),
    ),
    // HC2: use .items (not the whole object).
    ...memPending.items.map(
      (m): CockpitApprovalItem => ({
        source: "memory",
        id: m.id,
        title: m.title,
        subtitle: `${m.layer}${m.category ? ` · ${m.category}` : ""}`,
      }),
    ),
    ...discItems.map(
      (d): CockpitApprovalItem => ({
        source: "discussion_item",
        id: d.id,
        discussionId: d.discussionId,
        title: d.title,
        subtitle: d.type,
      }),
    ),
  ];
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

      const [runRows, reviewRows, myTaskRows, remindersRows, dueTodayRows, visibleThreads, approvalsItems] =
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

          // ── 6. Approvals (Phase 3c): founder-only unified queue ───────────
          // Non-founders: returns [] immediately without sub-queries (HC1).
          cockpitApprovals(db, companyId, scope),
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
        approvals: approvalsItems,
      };
    },
  };
}
