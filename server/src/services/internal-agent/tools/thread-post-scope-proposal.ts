// server/src/services/internal-agent/tools/thread-post-scope-proposal.ts
//
// Task C2 batch 1 — `thread.postScopeProposal` (action tool, D9 transactional).
//
// Posts a `scope_proposal` entry to a thread AND populates `thread_plan_steps`
// in ONE transaction. If either side fails, both roll back — we never leave
// the thread with an entry whose plan never materialized (or vice versa).
//
// Why a single tool instead of two: callers (Planner/Adjutant crews) should
// never see a partial state where the entry is visible but the Plan column
// is empty. The transaction is the only place this invariant can be enforced
// reliably.
//
// P1-T7 (A): The proposal's rawContent JSON now includes `proposalCursorSeq`
// — the thread's current `entrySeq` at the moment the proposal was posted.
// The Approve handler (thread-deliverables.ts) reads this back to detect
// whether newer entries arrived after the proposal was made (stale check).

import { eq, sql } from "drizzle-orm";
import { discussionEntries, discussions, threadPlanSteps } from "@armyofagents/db";
import type { AgentTool } from "../types.js";
import { publishLiveEvent } from "../../live-events.js";

interface ProposedTaskInput {
  title: string;
  [key: string]: unknown;
}

interface ScopeProposalInput {
  summary: string;
  proposedTasks: ProposedTaskInput[];
  autoAdvanceAt?: string;
}

export const threadPostScopeProposalTool: AgentTool = {
  name: "thread.postScopeProposal",
  description:
    "Post a scope_proposal entry to a thread and populate thread_plan_steps (single transaction).",
  parameters: {
    type: "object",
    properties: {
      threadId: { type: "string", description: "The thread (discussion) ID" },
      proposal: {
        type: "object",
        description: "Scope proposal payload",
        properties: {
          summary: {
            type: "string",
            description: "Plain-text summary of the proposal",
          },
          proposedTasks: {
            type: "array",
            description: "Ordered list of proposed tasks (each has at least a title)",
            items: { type: "object" },
          },
          autoAdvanceAt: {
            type: "string",
            description:
              "ISO-8601 timestamp when this proposal should auto-advance if unchanged",
          },
        },
        required: ["summary", "proposedTasks"],
      },
    },
    required: ["threadId", "proposal"],
  },
  category: "action",
  requiredRole: "team_member",
  requiresConfirmation: false,
  async execute(params, ctx) {
    const { threadId, proposal } = (params ?? {}) as {
      threadId?: string;
      proposal?: ScopeProposalInput;
    };
    if (!threadId || typeof threadId !== "string") {
      return {
        success: false,
        data: null,
        summary: "threadId is required",
        error: "INVALID_PARAMS",
      };
    }
    if (!proposal || typeof proposal !== "object") {
      return {
        success: false,
        data: null,
        summary: "proposal is required",
        error: "INVALID_PARAMS",
      };
    }
    if (typeof proposal.summary !== "string" || proposal.summary.length === 0) {
      return {
        success: false,
        data: null,
        summary: "proposal.summary is required",
        error: "INVALID_PARAMS",
      };
    }
    if (!Array.isArray(proposal.proposedTasks)) {
      return {
        success: false,
        data: null,
        summary: "proposal.proposedTasks must be an array",
        error: "INVALID_PARAMS",
      };
    }

    // D9: insert entry + plan-steps in ONE transaction so partial state is
    // never visible to readers. Drizzle's `.transaction(async tx => ...)`
    // throws on rollback — wrap to surface a tool-style error result.
    try {
      // P1-T7 (A): Read the thread's current entrySeq BEFORE the transaction.
      // This stamps "what the thread looked like when the proposal was made".
      // The slight race (an entry could arrive between this read and the TX start)
      // only makes the stale check at approve-time marginally conservative — it
      // cannot silently skip a staleness that genuinely exists. Fall back to 0
      // when the thread row is not found (conservative: stale check will accept,
      // not reject, a 0-stamped proposal against a fresh thread).
      let proposalCursorSeq = 0;
      try {
        const threadRows = await ctx.db
          .select({ entrySeq: discussions.entrySeq })
          .from(discussions)
          .where(eq(discussions.id, threadId));
        proposalCursorSeq = threadRows[0]?.entrySeq ?? 0;
      } catch {
        // Non-fatal — use 0 (conservative)
      }

      const rawContent = JSON.stringify({ ...proposal, proposalCursorSeq });

      const result = await ctx.db.transaction(async (tx: any) => {
        // Bump entrySeq + entryCount atomically (same as requestParticipation pattern)
        const [{ entrySeq, companyId: threadCompanyId }] = await tx
          .update(discussions)
          .set({
            entrySeq: sql`${discussions.entrySeq} + 1`,
            entryCount: sql`${discussions.entryCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(discussions.id, threadId))
          .returning({
            entrySeq: discussions.entrySeq,
            companyId: discussions.companyId,
          });

        const inserted = await tx
          .insert(discussionEntries)
          .values({
            discussionId: threadId,
            inputType: "scope_proposal",
            rawContent,
            authorAgentId: ctx.agentId ?? null,
            createdBy: ctx.agentId ?? "aoa-agent",
            // P1-T7: a scope_proposal is NOT prose for the LLM extractor. Mark
            // extractionStatus "skipped" (same guard discussions.addEntry uses)
            // so neither the autonomous Scribe drain (dispatcher.ts pending
            // sweep) nor reprocessAllEntries ever claims it and corrupts the
            // approval state. The approval lifecycle lives in proposalStatus.
            extractionStatus: "skipped",
            // P1-T7: the purpose-built approval-lifecycle field. Starts pending;
            // the Approve handler claims pending -> approved atomically.
            proposalStatus: "pending",
            seq: entrySeq,   // assign the monotonic seq
          })
          .returning();

        const entry = Array.isArray(inserted) ? inserted[0] : inserted;
        if (!entry || !entry.id) {
          throw new Error("scope_proposal entry insert returned no row");
        }

        const stepRows = (proposal.proposedTasks ?? [])
          .map((t, i) => {
            if (!t || typeof t.title !== "string" || t.title.length === 0) {
              throw new Error(
                `proposedTasks[${i}] requires a non-empty title (got ${JSON.stringify(t)})`,
              );
            }
            return {
              threadId,
              stepOrder: i,
              title: t.title,
              linkedItemId: null,
            };
          });

        if (stepRows.length > 0) {
          await tx.insert(threadPlanSteps).values(stepRows);
        }
        return { entry, companyId: threadCompanyId };
      });

      // Publish live events so the UI receives the new entry in real time.
      const { entry, companyId } = result;
      publishLiveEvent({
        companyId,
        type: "discussion.entry.created",
        payload: {
          discussionId: threadId,
          entryId: entry.id,
          inputType: "scope_proposal",
        },
      });
      publishLiveEvent({
        companyId,
        type: "thread.entry.created",
        payload: {
          threadId,
          entryId: entry.id,
          seq: entry.seq ?? 0,
        },
      });

      return {
        success: true,
        data: { entryId: entry.id, proposalCursorSeq },
        summary: `Scope proposal posted with ${proposal.proposedTasks.length} step(s)`,
      };
    } catch (err: any) {
      // Any throw inside the transaction triggers a full rollback — both the
      // entry and any partially inserted plan-step rows are reverted.
      return {
        success: false,
        data: null,
        summary: `Failed to post scope proposal: ${err?.message ?? "unknown error"}`,
        error: "TRANSACTION_FAILED",
      };
    }
  },
};
