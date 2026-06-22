import { eq, and } from "drizzle-orm";
import { discussions } from "@armyofagents/db";
import { publishLiveEvent } from "../../live-events.js";
import type { AgentTool } from "../types.js";

export function createNotifyOwnerTool(): AgentTool {
  return {
    name: "notify_owner",
    description:
      "Send a notification to the thread owner. Use when the crew needs human attention or approval.",
    parameters: {
      type: "object",
      properties: {
        threadId: {
          type: "string",
          description: "The discussion/thread ID",
        },
        message: {
          type: "string",
          description: "The notification message",
        },
        level: {
          type: "string",
          description: "Severity hint: info | warning | urgent (default: info)",
        },
      },
      required: ["threadId", "message"],
    },
    category: "coordination",
    requiredRole: "team_member",
    requiresConfirmation: false,
    execute: async (params: unknown, ctx) => {
      const { threadId, message, level } = (params ?? {}) as Record<
        string,
        unknown
      >;

      // Fetch thread to resolve ownerUserId (direct DB read — no RBAC check needed
      // because the tool is already scoped to this company via ctx.companyId)
      const thread = await ctx.db
        .select({ ownerUserId: discussions.ownerUserId })
        .from(discussions)
        .where(
          and(
            eq(discussions.id, threadId as string),
            eq(discussions.companyId, ctx.companyId),
          ),
        )
        .then((rows: Array<{ ownerUserId: string | null }>) => rows[0] ?? null);

      if (!thread) {
        return {
          success: false,
          data: null,
          summary: "Thread not found",
          error: "NOT_FOUND",
        };
      }

      if (!thread.ownerUserId) {
        return {
          success: false,
          data: null,
          summary: "Thread has no owner to notify",
          error: "NO_OWNER",
        };
      }

      const notification = await ctx.services.notifications.create(
        ctx.companyId,
        {
          userId: thread.ownerUserId,
          type: "internal_agent.notification",
          title: `Thread notification${level && level !== "info" ? ` [${level}]` : ""}`,
          message: message as string,
          relatedEntityType: "discussion",
          relatedEntityId: threadId as string,
        },
      );

      publishLiveEvent({
        companyId: ctx.companyId,
        type: "internal_agent.notification",
        payload: { notificationId: notification.id, threadId },
      });

      return {
        success: true,
        data: { notificationId: notification.id },
        summary: `Notified thread owner`,
      };
    },
  };
}
