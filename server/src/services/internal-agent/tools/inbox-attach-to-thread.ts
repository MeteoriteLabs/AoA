// server/src/services/internal-agent/tools/inbox-attach-to-thread.ts
//
// Task C2 batch 2 — `attach_to_thread` (action tool, Navigator).
//
// Moves a thread_inbox_items row into a real thread as a new discussion entry.
// Wraps the entry insert + inbox status update in ONE transaction so we never
// leave the inbox row marked "attached" without the new entry actually existing
// (or vice versa).
//
// The `inputType` on the resulting entry maps from inboxItem.originMedium when
// present; otherwise we default to "mcp" since the unattached inbox represents
// external/un-routed inbound. Any originMedium that isn't a valid
// DiscussionEntryInputType also falls back to "mcp".

import { eq } from "drizzle-orm";
import { threadInboxItems, discussionEntries } from "@armyofagents/db";
import { DISCUSSION_ENTRY_INPUT_TYPES } from "@armyofagents/shared";
import type { AgentTool } from "../types.js";

const VALID_INPUT_TYPES = new Set<string>(DISCUSSION_ENTRY_INPUT_TYPES as readonly string[]);

export const attachToThreadTool: AgentTool = {
  name: "attach_to_thread",
  description:
    "Move a thread_inbox_items entry to a real thread as a new discussion entry.",
  parameters: {
    type: "object",
    properties: {
      inboxItemId: { type: "string", description: "The thread_inbox_items row id" },
      threadId: { type: "string", description: "Destination thread (discussion) id" },
    },
    required: ["inboxItemId", "threadId"],
  },
  category: "action",
  requiredRole: "team_member",
  requiresConfirmation: false,
  async execute(params, ctx) {
    const { inboxItemId, threadId } = (params ?? {}) as {
      inboxItemId?: string;
      threadId?: string;
    };
    if (!inboxItemId || typeof inboxItemId !== "string") {
      return {
        success: false,
        data: null,
        summary: "inboxItemId is required",
        error: "INVALID_PARAMS",
      };
    }
    if (!threadId || typeof threadId !== "string") {
      return {
        success: false,
        data: null,
        summary: "threadId is required",
        error: "INVALID_PARAMS",
      };
    }

    const rows = await ctx.db
      .select()
      .from(threadInboxItems)
      .where(eq(threadInboxItems.id, inboxItemId))
      .limit(1);
    const inboxItem = Array.isArray(rows) ? rows[0] : null;
    if (!inboxItem) {
      return {
        success: false,
        data: null,
        summary: "Inbox item not found",
        error: "NOT_FOUND",
      };
    }

    // Map originMedium → a valid DiscussionEntryInputType, falling back to "mcp"
    // for null/unknown values. originMedium uses the THREAD_ORIGIN_MEDIA enum
    // (text|voice|integration|...) which only partially overlaps the discussion
    // entry input-type enum; the mapping prevents writing a bogus value.
    const candidateInputType = inboxItem.originMedium ?? "mcp";
    const inputType = VALID_INPUT_TYPES.has(candidateInputType)
      ? candidateInputType
      : "mcp";

    try {
      const result = await ctx.db.transaction(async (tx: any) => {
        const inserted = await tx
          .insert(discussionEntries)
          .values({
            discussionId: threadId,
            inputType,
            rawContent: inboxItem.rawContent,
            sourceInfo: {
              originSource: inboxItem.originSource,
              fromInboxItem: inboxItemId,
            },
            createdBy: ctx.agentId ?? "system",
          })
          .returning();
        const entry = Array.isArray(inserted) ? inserted[0] : inserted;
        if (!entry || !entry.id) {
          throw new Error("discussion entry insert returned no row");
        }

        await tx
          .update(threadInboxItems)
          .set({ status: "attached" })
          .where(eq(threadInboxItems.id, inboxItemId));

        return entry;
      });

      return {
        success: true,
        data: { entryId: result.id },
        summary: "Inbox item attached to thread",
      };
    } catch (err: any) {
      return {
        success: false,
        data: null,
        summary: `Failed to attach inbox item: ${err?.message ?? "unknown error"}`,
        error: "TRANSACTION_FAILED",
      };
    }
  },
};
