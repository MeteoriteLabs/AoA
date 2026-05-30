/**
 * crew-task-service.ts — Tasks 2.2+2.3 (Crew Work-as-Tasks)
 *
 * The single autonomy-gated chokepoint for creating crew work (Decision D11).
 *
 * Every piece of crew work flows through `proposeWork`. The unified model means
 * L2/Drive doesn't get a separate code path — it writes the same inline scope
 * card and then auto-approves it through the EXISTING approveProposal handler
 * (which is already idempotent, stamps provenance, writes plan steps, and gives
 * the audit trail).
 *
 * Key invariants (Codex #14, #16, #19):
 *   - Codex #14: companyId validation lives inside writeScopeProposal — we rely on
 *     it throwing COMPANY_MISMATCH if the thread doesn't belong to this company.
 *   - Codex #16: Budget gates DISPATCH (heartbeat wakeup + approval), never the
 *     card write. The human-approvable card is ALWAYS written first regardless of
 *     budget state so the founder can manually approve if needed.
 *   - Codex #19: activity_log entries written for proposal creation and for
 *     auto-approval so there is a full audit trail.
 *
 * Auto-approval uses the real `threadDeliverablesService.approveProposal` path,
 * which is:
 *   1. Atomic claim-first (pending → approved UPDATE ... RETURNING)
 *   2. createDeliverableTasks (stamps originKind='crew_thread')
 *   3. Returns taskIds + createdTasks with assigneeAgentId per task
 *
 * Dispatch: heartbeat.wakeup fired once per DISTINCT assigneeAgentId across
 * all created tasks. Null/missing assignees are skipped.
 */

import type { Db } from "@armyofagents/db";
import { writeScopeProposal } from "./scope-proposal-writer.js";
import { preflightCrewDispatch } from "./crew-budget.js";
import { threadDeliverablesService } from "./thread-deliverables.js";
import { heartbeatService } from "./heartbeat.js";
import { logActivity } from "./activity-log.js";

// ─── Pure gate ────────────────────────────────────────────────────────────────

/**
 * Resolve the creation gate based on the caller's autonomy level.
 *
 * - autonomy >= 2 → "auto_approve" (L2/Drive: write card AND immediately approve)
 * - anything else (0, 1, null, undefined) → "await_human" (fail closed)
 *
 * This is a pure function — no I/O, trivially testable.
 */
export function resolveCreationGate(
  autonomy: number | null | undefined,
): "auto_approve" | "await_human" {
  return typeof autonomy === "number" && autonomy >= 2 ? "auto_approve" : "await_human";
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProposeWorkArgs {
  threadId: string;
  companyId: string;
  /** Caller's autonomy level. 0/1/null/undefined → await_human; ≥2 → auto_approve. */
  autonomy: number | null;
  summary: string;
  proposedTasks: Array<{ title: string; assigneeRole?: string; [k: string]: unknown }>;
  /** Who is making the proposal — at least one of userId/agentId should be set. */
  createdBy: { userId?: string | null; agentId?: string | null };
}

export interface ProposeWorkResult {
  /** The discussion_entries row id of the scope_proposal card. */
  proposalId: string;
  /** true when gate was auto_approve and the proposal was approved + tasks created. */
  autoApproved: boolean;
  /** true when a pending proposal already existed (idempotency path — no new work). */
  existing: boolean;
  /** Task ids created from the proposal, only present when autoApproved=true. */
  createdIssueIds?: string[];
  /**
   * reasonCode from preflightCrewDispatch when budget blocked dispatch.
   * The card was written but the proposal stays pending for human approval.
   */
  blockedReason?: string;
}

// ─── Service factory ──────────────────────────────────────────────────────────

export function crewTaskService(db: Db) {
  const hb = heartbeatService(db);
  const deliverables = threadDeliverablesService(db);

  return {
    /**
     * The unified proposal chokepoint (D11).
     *
     * Steps:
     *   1. ALWAYS write the scope card via writeScopeProposal (idempotent).
     *      Write activity_log for the proposal creation.
     *      If existing:true → return immediately (no duplicate work).
     *   2. Compute gate = resolveCreationGate(autonomy).
     *   3. await_human → return (human approves the card later).
     *   4. auto_approve:
     *      a. preflightCrewDispatch (budget gate — blocks dispatch, never card).
     *         If NOT allowed → return with blockedReason (card stays pending).
     *      b. Approve via approveProposal (claim-first + createDeliverableTasks).
     *         Write activity_log for the auto-approval.
     *      c. heartbeat.wakeup once per distinct assigneeAgentId.
     *      d. Return { proposalId, autoApproved:true, createdIssueIds }.
     */
    async proposeWork(args: ProposeWorkArgs): Promise<ProposeWorkResult> {
      const { threadId, companyId, autonomy, summary, proposedTasks, createdBy } = args;

      const agentId = createdBy.agentId ?? null;
      const actorId = agentId ?? createdBy.userId ?? "system";
      const actorType: "agent" | "user" | "system" = agentId
        ? "agent"
        : createdBy.userId
          ? "user"
          : "system";

      // ── Step 1: ALWAYS write the scope card ─────────────────────────────────
      // Codex #16: budget never blocks the card write. The human must always be
      // able to see and manually approve a pending proposal even when budget is
      // exhausted or autonomy is low.
      const writeResult = await writeScopeProposal(db, {
        threadId,
        companyId,
        proposal: { summary, proposedTasks },
        agentId,
      });

      const proposalId = writeResult.entryId;

      // Codex #19: activity log for proposal creation
      await logActivity(db, {
        companyId,
        actorType,
        actorId,
        action: "crew.proposal.created",
        entityType: "discussion_entry",
        entityId: proposalId,
        agentId,
        details: {
          threadId,
          summary,
          taskCount: proposedTasks.length,
          existing: writeResult.existing,
        },
      });

      // ── Idempotency: a pending proposal already existed ──────────────────────
      if (writeResult.existing) {
        return { proposalId, autoApproved: false, existing: true };
      }

      // ── Step 2: Resolve gate ─────────────────────────────────────────────────
      const gate = resolveCreationGate(autonomy);

      if (gate === "await_human") {
        // Human will approve the inline card later. Nothing else to do.
        return { proposalId, autoApproved: false, existing: false };
      }

      // ── Step 4: auto_approve path ────────────────────────────────────────────

      // Step 4a: Budget pre-flight (gates dispatch, not card)
      const preflight = await preflightCrewDispatch(db, {
        companyId,
        agentId: actorId,
        threadId,
      });

      if (!preflight.allowed) {
        // Card stays pending for human approval. Surface the reason.
        return {
          proposalId,
          autoApproved: false,
          existing: false,
          blockedReason: preflight.reasonCode,
        };
      }

      // Step 4b: Approve via the existing approval handler.
      // approveProposal does: claim pending→approved (atomic), then
      // createDeliverableTasks (stamps originKind='crew_thread').
      // We provide a synthetic approver userId; using the actorId from createdBy
      // when it's a user, or a system-sentinel when agent-only.
      const approverUserId = createdBy.userId ?? `system:agent:${actorId}`;

      const approvalResult = await deliverables.approveProposal({
        threadId,
        companyId,
        proposalEntryId: proposalId,
        approver: { userId: approverUserId },
      });

      if (!approvalResult.ok) {
        // Unexpected failure from the approval handler (stale, rejected, etc.).
        // Return a non-approved result; do NOT dispatch.
        return { proposalId, autoApproved: false, existing: false };
      }

      if (approvalResult.alreadyApproved) {
        // Race: someone else already approved this proposal.
        return { proposalId, autoApproved: false, existing: true };
      }

      const taskIds = approvalResult.taskIds;
      const createdTasks = approvalResult.createdTasks;

      // Codex #19: activity log for auto-approval
      await logActivity(db, {
        companyId,
        actorType,
        actorId,
        action: "crew.proposal.auto_approved",
        entityType: "discussion_entry",
        entityId: proposalId,
        agentId,
        details: {
          threadId,
          taskIds,
          autonomy,
        },
      });

      // Step 4c: Dispatch — once per DISTINCT assigneeAgentId.
      // Null assignees are skipped (no agent to dispatch).
      const distinctAssignees = new Set<string>(
        createdTasks
          .map((t: { id: string; assigneeAgentId: string | null; workMode: string | null }) => t.assigneeAgentId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      );

      for (const assigneeAgentId of distinctAssignees) {
        await hb.wakeup(assigneeAgentId, {
          source: "automation",
          triggerDetail: "system",
          reason: "crew_task_auto_approved",
        });
      }

      return {
        proposalId,
        autoApproved: true,
        existing: false,
        createdIssueIds: taskIds,
      };
    },
  };
}
