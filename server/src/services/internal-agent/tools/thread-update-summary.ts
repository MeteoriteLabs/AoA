// server/src/services/internal-agent/tools/thread-update-summary.ts
//
// Task C2 batch 1 — `thread.updateSummary` (action tool, per D4).
//
// Updates `discussions.summary_text` and bumps `summary_updated_at`, then
// best-effort enqueues a summary embedding regeneration via the embedding
// service. The embedding step is non-fatal — if the service is not wired in
// (e.g. in tests, or before the worker starts), we still save the summary.

import { eq } from "drizzle-orm";
import { discussions } from "@armyofagents/db";
import type { AgentTool } from "../types.js";

export const threadUpdateSummaryTool: AgentTool = {
  name: "thread.updateSummary",
  description:
    "Update a thread's summary text + queue embedding regeneration.",
  parameters: {
    type: "object",
    properties: {
      threadId: { type: "string", description: "The thread (discussion) ID" },
      summary: {
        type: "string",
        description: "1-3 sentence summary of current thread state",
      },
    },
    required: ["threadId", "summary"],
  },
  category: "action",
  requiredRole: "team_member",
  requiresConfirmation: false,
  async execute(params, ctx) {
    const { threadId, summary } = (params ?? {}) as {
      threadId?: string;
      summary?: string;
    };
    if (!threadId || typeof threadId !== "string") {
      return {
        success: false,
        data: null,
        summary: "threadId is required",
        error: "INVALID_PARAMS",
      };
    }
    if (typeof summary !== "string") {
      return {
        success: false,
        data: null,
        summary: "summary must be a string",
        error: "INVALID_PARAMS",
      };
    }

    const summaryUpdatedAt = new Date();
    await ctx.db
      .update(discussions)
      .set({ summaryText: summary, summaryUpdatedAt })
      .where(eq(discussions.id, threadId));

    // Best-effort: queue summary embedding regeneration. The embedding
    // service may be absent in tests / pre-worker startup — that's fine;
    // the summary text is still persisted and the embedding can be
    // backfilled later by a separate scan.
    let embeddingQueued = false;
    try {
      if (ctx.services?.embeddings?.enqueue) {
        await ctx.services.embeddings.enqueue({
          targetTable: "discussions",
          targetId: threadId,
          targetColumn: "summary_embedding",
          inputText: summary,
        });
        embeddingQueued = true;
      }
    } catch {
      // Non-fatal — summary already saved above.
      embeddingQueued = false;
    }

    return {
      success: true,
      data: { threadId, summaryUpdatedAt: summaryUpdatedAt.toISOString(), embeddingQueued },
      summary: embeddingQueued
        ? "Summary updated; embedding queued"
        : "Summary updated (embedding not queued — service unavailable)",
    };
  },
};
