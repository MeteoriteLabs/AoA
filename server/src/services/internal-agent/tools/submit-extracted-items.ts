// server/src/services/internal-agent/tools/submit-extracted-items.ts
//
// THE LINCHPIN: the internal-agent tool a discussion-extraction agent calls to
// persist its structured output. AoA agents do NOT have stdout parsed by the
// runner — they persist results by calling this tool through the bridge.
//
// Mirrors the exact ExtractedItem -> discussion_extracted_items value mapping
// used by server/src/services/extraction.ts (lines ~597-627) so an agent-driven
// submission produces rows indistinguishable from legacy in-process extraction.

import type { AgentTool } from "../types.js";

interface SubmitItem {
  type: string;
  content: string;
  confidence?: number;
}

/**
 * Internal-agent tool: write extracted items for a discussion entry and mark
 * the entry's extraction terminal status to "completed" (the same success
 * terminal value extraction.ts sets — see schema discussion_entries).
 *
 * Category `discussion` => automatically gated on the `discussion_processing`
 * capability via authorizeToolInvocation/CAPABILITY_TO_CATEGORY (same gating
 * path as the existing `extract_from_content` tool — no per-tool gating added).
 */
export const submitExtractedItemsTool: AgentTool = {
  name: "submit_extracted_items",
  description:
    "Persist structured extracted items (decisions, tasks, insights, etc.) for a discussion entry and mark the entry's extraction as completed. Called by the discussion-extraction agent to write its results.",
  parameters: {
    type: "object",
    properties: {
      entryId: {
        type: "string",
        description: "Discussion entry ID these items were extracted from (required)",
      },
      items: {
        type: "array",
        description: "Extracted items to persist (required; may be empty)",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description:
                "Item type: 'decision' | 'task' | 'insight' | 'context' | 'reference' | 'preference' (required)",
            },
            content: {
              type: "string",
              description: "Item content/title (required)",
            },
            confidence: {
              type: "number",
              description: "Optional extraction confidence 0-1",
            },
          },
          required: ["type", "content"],
        },
      },
    },
    required: ["entryId", "items"],
  },
  category: "discussion",
  requiredRole: "founder",
  requiresConfirmation: false,
  execute: async (params: unknown, ctx) => {
    const { entryId, items } = (params ?? {}) as {
      entryId?: unknown;
      items?: unknown;
    };
    const entryIdStr = entryId as string;
    const itemList: SubmitItem[] = Array.isArray(items)
      ? (items as SubmitItem[])
      : [];

    const { discussionExtractedItems, discussionEntries, discussions } =
      await import("@armyofagents/db");
    const { eq, and, sql } = await import("drizzle-orm");

    // Map onto the REAL discussion_extracted_items columns, matching
    // extraction.ts's itemValues shape. The schema has no `content`,
    // `confidence`, or `companyId` columns — `content` maps to the required
    // `title` column; new items get status "pending" (same as extraction.ts).
    if (itemList.length > 0) {
      const rows = itemList.map((item) => ({
        discussionEntryId: entryIdStr,
        type: item.type,
        title: item.content,
        description: null,
        suggestedPriority: null,
        suggestedDepartmentId: null,
        suggestedProjectId: null,
        suggestedLayer: "domain",
        layer: "domain",
        status: "pending" as const,
      }));

      await ctx.db.insert(discussionExtractedItems).values(rows);

      // I-1: increment the parent discussion's pendingItemCount, mirroring
      // extraction.ts (lines ~614-620) EXACTLY. The tool only has entryId in
      // scope, so resolve entry -> discussionId first (extraction.ts gets
      // this from `entry.discussionId` after fetching the entry row).
      const [entryRow] = await ctx.db
        .select({ discussionId: discussionEntries.discussionId })
        .from(discussionEntries)
        .where(eq(discussionEntries.id, entryIdStr));

      if (entryRow?.discussionId) {
        await ctx.db
          .update(discussions)
          .set({
            pendingItemCount: sql`${discussions.pendingItemCount} + ${rows.length}`,
            updatedAt: new Date(),
          })
          .where(eq(discussions.id, entryRow.discussionId));
      }
    }

    // Terminal success status — extraction.ts sets extractionStatus
    // "completed" on the entry after writing items. I-2: guard the terminal
    // write on the still-`processing` state (the runner's atomic claim set
    // pending -> processing; this tool is the single terminalizer and must
    // only complete a still-processing entry), matching the codebase
    // terminalizer/claim convention (extraction.ts:389-398,
    // dispatcher.ts:121-124).
    await ctx.db
      .update(discussionEntries)
      .set({ extractionStatus: "completed" })
      .where(
        and(
          eq(discussionEntries.id, entryIdStr),
          eq(discussionEntries.extractionStatus, "processing"),
        ),
      );

    return {
      success: true,
      data: { count: itemList.length },
      summary: `Persisted ${itemList.length} extracted item(s) for entry ${entryIdStr}`,
    };
  },
};
