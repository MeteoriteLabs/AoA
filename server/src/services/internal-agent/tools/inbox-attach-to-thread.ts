// server/src/services/internal-agent/tools/inbox-attach-to-thread.ts
//
// Task C2 batch 2 — `attach_to_thread` (action tool, Navigator).
//
// Moves a thread_inbox_items row into a real thread as a new discussion entry.
//
// Task 1.8 rewrite — routing dial gate:
//
//   'suggest'               → record routerDecision='suggest' + suggestedThreadId for
//                             the founder to confirm in the Inbox (Phase 2 UI); do NOT post.
//   'auto_attach'/'full_auto' → post content immediately via the shared, companyId-guarded,
//                             atomic write-path (attachInboxItemToThread).
//   'off'                   → also acts via the shared service. The dispatcher already gates
//                             auto-routing wakeups at 'off'; an explicit attach_to_thread
//                             call at 'off' is a direct / manual Navigator action.
//
// Eliminates:
//   - The duplicated inline transaction (#6) — now owned by the shared service.
//   - The cross-tenant hole (#7) — companyId validation now happens in the shared service
//     (for act paths) or in the pre-flight guard below (for suggest path).
//   - The absent seq bump, atomic claim, live events, and routingStatus update —
//     now all handled by attachInboxItemToThread in inbox-attach.ts.

import { and, eq } from "drizzle-orm";
import { threadInboxItems, internalAgentConfig } from "@armyofagents/db";
import { attachInboxItemToThread } from "../../inbox-attach.js";
import type { AgentTool } from "../types.js";

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

    // ── Step 1: read the routing dial ─────────────────────────────────────────
    const [cfg] = await ctx.db
      .select({ level: internalAgentConfig.inboundRoutingLevel })
      .from(internalAgentConfig)
      .where(eq(internalAgentConfig.companyId, ctx.companyId))
      .limit(1);
    const level = (cfg?.level ?? "off") as string;

    // ── Step 2: suggest path — record decision, do NOT post content ───────────
    if (level === "suggest") {
      // Pre-flight existence + company guard (shared service not called on this path).
      const [item] = await ctx.db
        .select({ id: threadInboxItems.id, companyId: threadInboxItems.companyId })
        .from(threadInboxItems)
        .where(eq(threadInboxItems.id, inboxItemId))
        .limit(1);
      if (!item) {
        return {
          success: false,
          data: null,
          summary: "Inbox item not found",
          error: "NOT_FOUND",
        };
      }
      if (item.companyId !== ctx.companyId) {
        return {
          success: false,
          data: null,
          summary: "Inbox item belongs to a different company",
          error: "COMPANY_MISMATCH",
        };
      }
      // Record the suggestion — leave status='pending' so the item awaits human confirm.
      await ctx.db
        .update(threadInboxItems)
        .set({
          routerDecision: "suggest",
          suggestedThreadId: threadId,
          routingStatus: "routed",
        })
        .where(
          and(
            eq(threadInboxItems.id, inboxItemId),
            eq(threadInboxItems.companyId, ctx.companyId),
          ),
        );
      return {
        success: true,
        data: { suggested: true, suggestedThreadId: threadId },
        summary:
          "Routing suggestion recorded — founder confirms in the Inbox",
      };
    }

    // ── Step 3: act path (auto_attach | full_auto | off) → shared service ─────
    try {
      const res = await attachInboxItemToThread(ctx.db, {
        companyId: ctx.companyId,
        inboxItemId,
        threadId,
        actor: {
          actorId: ctx.agentId ?? "system",
          actorType: "agent",
          agentId: ctx.agentId ?? null,
        },
      });
      return {
        success: true,
        data: { entryId: res.entryId, alreadyHandled: res.alreadyHandled },
        summary: res.alreadyHandled
          ? "Inbox item was already attached"
          : "Inbox item attached to thread",
      };
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.includes("COMPANY_MISMATCH")) {
        return {
          success: false,
          data: null,
          summary:
            "Inbox item or thread belongs to a different company",
          error: "COMPANY_MISMATCH",
        };
      }
      return {
        success: false,
        data: null,
        summary: `Failed to attach inbox item: ${msg || "unknown error"}`,
        error: "TRANSACTION_FAILED",
      };
    }
  },
};
