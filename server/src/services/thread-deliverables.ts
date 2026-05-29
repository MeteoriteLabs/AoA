/**
 * Thread deliverables service (P1-T1 skeleton)
 *
 * Creates one "deliverable task" per scope-proposal acceptance for a discussion
 * thread. Each created issue is linked back to its source thread via
 * `issues.sourceDiscussionId = threadId`.
 *
 * Intentionally minimal — NO authorization checks, NO stale-proposal guard,
 * NO heartbeat dispatch. Those concerns belong to later tasks (P1-T7 and
 * beyond). This module is the write-path foundation.
 *
 * Pattern: follows `server/src/services/goals.ts` — pure functions + a factory
 * that closes over `db` and returns methods.
 */

import type { Db } from "@armyofagents/db";
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

// ─── Service factory ──────────────────────────────────────────────────────────

export function threadDeliverablesService(db: Db) {
  const issues = issueService(db);

  return {
    /**
     * Create one issue per proposal, all linked to `threadId` via
     * `sourceDiscussionId`. Returns the created issues in the same order as
     * `proposals`.
     *
     * Scope: P1-T1 only — no authz, no stale check, no dispatch wakeup.
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
  };
}

// Convenience re-export matching the codebase pattern (named factory only)
export { threadDeliverablesService as default };
