import type { AgentTool } from "../types.js";
import { parseMentions, processMentions } from "../../threads.js";

export function createPostEntryTool(): AgentTool {
  return {
    name: "post_entry",
    description:
      "Post a message to a thread as this agent. Use for crew coordination, summaries, and @mentions.",
    parameters: {
      type: "object",
      properties: {
        threadId: {
          type: "string",
          description: "The discussion/thread ID",
        },
        content: {
          type: "string",
          description: "Message text (supports @mentions like @Planner, @Router)",
        },
        parentEntryId: {
          type: "string",
          description: "Reply to an existing entry (optional)",
        },
        sourceInfo: {
          type: "object",
          description: "Metadata e.g. { systemNotice: true } (optional)",
        },
      },
      required: ["threadId", "content"],
    },
    category: "discussion",
    requiredRole: "team_member",
    requiresConfirmation: false,
    execute: async (params: unknown, ctx) => {
      const { threadId, content, parentEntryId, sourceInfo } = (params ?? {}) as Record<
        string,
        unknown
      >;

      const entry = await ctx.services.discussions.addEntry(
        ctx.companyId,
        threadId as string,
        {
          inputType: "agent",
          rawContent: content as string,
          parentEntryId: (parentEntryId as string) ?? null,
          authorAgentId: ctx.agentId ?? null,
          sourceInfo: (sourceInfo as Record<string, unknown>) ?? null,
        },
        ctx.agentId ?? "aoa-agent",
      );

      const mentions = parseMentions(content as string);
      if (mentions.length > 0) {
        await processMentions(
          ctx.db,
          ctx.companyId,
          threadId as string,
          entry.id,
          mentions,
          { hopCount: 1 },
        );
      }

      return {
        success: true,
        data: { entryId: entry.id },
        summary: "Posted entry to thread",
      };
    },
  };
}
