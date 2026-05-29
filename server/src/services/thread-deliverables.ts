/**
 * Thread deliverables service (P1-T1 skeleton + P1-T7 secure Approve handler)
 *
 * Creates one "deliverable task" per scope-proposal acceptance for a discussion
 * thread. Each created issue is linked back to its source thread via
 * `issues.sourceDiscussionId = threadId`.
 *
 * Pattern: follows `server/src/services/goals.ts` — pure functions + a factory
 * that closes over `db` and returns methods.
 *
 * P1-T7: `approveProposal` adds:
 *  1. Authorization is the CALLER's responsibility (route layer uses assertRole).
 *     The service itself validates companyId ownership for defense-in-depth.
 *  2. Proposal validation — must exist, belong to threadId, and be pending.
 *  3. Stale check — compares proposalCursorSeq (stamped at post time) against
 *     the thread's current entrySeq. If the thread has newer entries, reject.
 *  4. Idempotent second-approve — returns the previously created result without
 *     creating duplicate tasks.
 *  5. Task creation via createDeliverableTasks, then mark entry approved.
 *  6. Audit log entry via the caller-provided logActivity.
 */

import { eq, and } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { discussionEntries, discussions } from "@armyofagents/db";
import { issueService } from "./issues.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A minimal description of one task to create from a scope proposal.
 * Callers can pass any additional fields that `issues.$inferInsert` accepts;
 * `sourceDiscussionId` is always overwritten to `threadId`.
 */
export interface DeliverableProposal {
  title: string;
  description?: string | null;
  priority?: string | null;
  status?: string;
  projectId?: string | null;
  goalId?: string | null;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  [key: string]: unknown;
}

export interface CreateDeliverableTasksInput {
  threadId: string;
  companyId: string;
  proposals: DeliverableProposal[];
  createdBy: { userId?: string; agentId?: string };
}

/**
 * Input to `approveProposal`.
 * Authorization (assertRole) must be performed by the caller BEFORE calling this.
 */
export interface ApproveProposalInput {
  /** The thread (discussion) the proposal belongs to. */
  threadId: string;
  /** The company — used to verify the thread belongs here. */
  companyId: string;
  /** The discussion_entries row id of the scope_proposal entry. */
  proposalEntryId: string;
  /** The authenticated user who is approving (for audit + task createdBy). */
  approver: { userId: string };
}

/**
 * Outcome of `approveProposal`.
 *
 * - `ok: true, alreadyApproved: false` — fresh approval; tasks created.
 * - `ok: true, alreadyApproved: true` — idempotent no-op; tasks already exist.
 * - `ok: false, reason: ...` — validation failure; tasks NOT created.
 */
export type ApproveProposalResult =
  | { ok: true; alreadyApproved: false; taskIds: string[] }
  | { ok: true; alreadyApproved: true }
  | { ok: false; reason: "not_found" | "wrong_thread" | "rejected" | "stale"; message: string };

// ─── Pure helper ─────────────────────────────────────────────────────────────

/**
 * Build the Drizzle insert payload for a single deliverable task.
 * Pure function — no I/O, easy to unit-test.
 */
export function buildDeliverableInsert(
  companyId: string,
  threadId: string,
  proposal: DeliverableProposal,
  createdBy: { userId?: string; agentId?: string },
): Record<string, unknown> {
  return {
    ...proposal,
    companyId,
    sourceDiscussionId: threadId,
    status: proposal.status ?? "todo",
    createdByUserId: createdBy.userId ?? null,
    createdByAgentId: createdBy.agentId ?? null,
  };
}

/**
 * Parse the `rawContent` of a scope_proposal entry.
 * Returns null if the content is not valid JSON or missing required fields.
 */
export function parseScopeProposalContent(rawContent: string): {
  summary: string;
  proposedTasks: Array<{ title: string; [key: string]: unknown }>;
  autoAdvanceAt?: string;
  proposalCursorSeq: number;
} | null {
  try {
    const parsed = JSON.parse(rawContent);
    if (
      typeof parsed.summary !== "string" ||
      !Array.isArray(parsed.proposedTasks)
    ) {
      return null;
    }
    return {
      summary: parsed.summary,
      proposedTasks: parsed.proposedTasks,
      autoAdvanceAt: parsed.autoAdvanceAt,
      // Legacy proposals (pre-T7) have no stamp — treat as 0 (stale check passes
      // for any thread, which is safe: worst case we create tasks for an old proposal,
      // which the human consciously clicked Approve on).
      proposalCursorSeq: typeof parsed.proposalCursorSeq === "number" ? parsed.proposalCursorSeq : 0,
    };
  } catch {
    return null;
  }
}

// ─── Service factory ──────────────────────────────────────────────────────────

export function threadDeliverablesService(db: Db) {
  const issues = issueService(db);

  return {
    /**
     * Create one issue per proposal, all linked to `threadId` via
     * `sourceDiscussionId`. Returns the created issues in the same order as
     * `proposals`.
     */
    createDeliverableTasks: async ({
      threadId,
      companyId,
      proposals,
      createdBy,
    }: CreateDeliverableTasksInput) => {
      const created = [];
      for (const proposal of proposals) {
        const payload = buildDeliverableInsert(companyId, threadId, proposal, createdBy);
        const issue = await issues.create(companyId, payload as any);
        created.push(issue);
      }
      return created;
    },

    /**
     * P1-T7: Securely approve a scope proposal.
     *
     * Authorization is NOT performed here — the HTTP route layer MUST call
     * `assertRole(db, req, companyId, "founder", "team_lead")` before invoking
     * this method. This service validates only data integrity and business rules.
     *
     * Steps:
     *  1. Load the proposal entry and verify it belongs to the given threadId + companyId.
     *  2. If already approved (`extractionStatus = "completed"`) → idempotent no-op.
     *  3. If rejected (`extractionStatus = "skipped"`) → 4xx (not_found treated as error).
     *  4. Read thread's current `entrySeq`; compare to `proposalCursorSeq` stamped
     *     at post time. If `currentSeq > proposalCursorSeq` → stale, reject.
     *  5. Call `createDeliverableTasks` for the proposal's tasks.
     *  6. Mark entry `extractionStatus = "completed"` (approved).
     *  7. Return task IDs for the route to log activity.
     */
    approveProposal: async ({
      threadId,
      companyId,
      proposalEntryId,
      approver,
    }: ApproveProposalInput): Promise<ApproveProposalResult> => {
      // ── Step 1: Load proposal entry ──────────────────────────────────────────
      // Join to discussions to confirm the thread belongs to this company.
      const [entry] = await db
        .select({
          id: discussionEntries.id,
          discussionId: discussionEntries.discussionId,
          inputType: discussionEntries.inputType,
          rawContent: discussionEntries.rawContent,
          extractionStatus: discussionEntries.extractionStatus,
        })
        .from(discussionEntries)
        .innerJoin(discussions, eq(discussionEntries.discussionId, discussions.id))
        .where(
          and(
            eq(discussionEntries.id, proposalEntryId),
            eq(discussions.companyId, companyId),
          ),
        );

      if (!entry) {
        return {
          ok: false,
          reason: "not_found",
          message: "Proposal not found or does not belong to this company",
        };
      }

      // ── Step 2: Verify it belongs to the specified thread ────────────────────
      if (entry.discussionId !== threadId) {
        return {
          ok: false,
          reason: "wrong_thread",
          message: "Proposal belongs to a different thread",
        };
      }

      // ── Step 3: Check proposal status ────────────────────────────────────────
      // extractionStatus semantics for scope_proposal entries:
      //   "pending"   = awaiting approval
      //   "completed" = already approved (tasks created)
      //   "skipped"   = rejected
      if (entry.extractionStatus === "completed") {
        // Idempotent: already approved — no-op.
        return { ok: true, alreadyApproved: true };
      }
      if (entry.extractionStatus === "skipped") {
        return {
          ok: false,
          reason: "rejected",
          message: "Proposal has already been rejected and cannot be approved",
        };
      }

      // ── Step 4: Parse proposal content + stale check ─────────────────────────
      const proposalContent = parseScopeProposalContent(entry.rawContent);
      if (!proposalContent) {
        return {
          ok: false,
          reason: "not_found",
          message: "Proposal entry has invalid or missing content",
        };
      }

      // Read the thread's current entrySeq.
      const [threadRow] = await db
        .select({ entrySeq: discussions.entrySeq })
        .from(discussions)
        .where(
          and(
            eq(discussions.id, threadId),
            eq(discussions.companyId, companyId),
          ),
        );

      const currentSeq: number = threadRow?.entrySeq ?? 0;
      const stampedSeq: number = proposalContent.proposalCursorSeq;

      // STALE CHECK: if newer entries arrived after the proposal was made,
      // reject with a clear "re-propose or reconfirm" message.
      if (currentSeq > stampedSeq) {
        return {
          ok: false,
          reason: "stale",
          message:
            `Proposal is out of date — the thread has ${currentSeq - stampedSeq} new ` +
            "entry(ies) since this proposal was made. Re-propose or ask the Adjutant " +
            "to reconfirm before approving.",
        };
      }

      // ── Step 5: Create deliverable tasks ─────────────────────────────────────
      const deliverableProposals: DeliverableProposal[] = proposalContent.proposedTasks.map(
        (t) => ({
          title: t.title,
          description: (t.description as string | undefined) ?? null,
          priority: (t.priority as string | undefined) ?? null,
          assigneeAgentId: (t.assigneeAgentId as string | undefined) ?? null,
          assigneeUserId: (t.assigneeUserId as string | undefined) ?? null,
          projectId: (t.projectId as string | undefined) ?? null,
          goalId: (t.goalId as string | undefined) ?? null,
        }),
      );

      const created = await threadDeliverablesService(db).createDeliverableTasks({
        threadId,
        companyId,
        proposals: deliverableProposals,
        createdBy: { userId: approver.userId },
      });

      const taskIds = created.map((issue: { id: string }) => issue.id);

      // ── Step 6: Mark proposal as approved ────────────────────────────────────
      // `extractionStatus = "completed"` signals to a second approve call that
      // the proposal was already processed (idempotency guard).
      await db
        .update(discussionEntries)
        .set({ extractionStatus: "completed" })
        .where(eq(discussionEntries.id, proposalEntryId));

      return { ok: true, alreadyApproved: false, taskIds };
    },
  };
}

// Convenience re-export matching the codebase pattern (named factory only)
export { threadDeliverablesService as default };
