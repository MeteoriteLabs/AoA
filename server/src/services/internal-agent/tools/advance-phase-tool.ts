import type { AgentTool } from "../types.js";
import { THREAD_PHASES, type ThreadPhase } from "@armyofagents/shared";

export function createAdvancePhaseTool(): AgentTool {
  return {
    name: "advance_phase",
    description: "Advance a thread to the next phase. Requires autonomy level ≥ 2.",
    parameters: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "The discussion/thread ID" },
        toPhase: {
          type: "string",
          description: "Target phase: discuss | scope | assign | done",
        },
      },
      required: ["threadId", "toPhase"],
    },
    category: "action",
    requiredRole: "team_member",
    requiresConfirmation: false,
    execute: async (params: unknown, ctx) => {
      const { threadId, toPhase } = (params ?? {}) as Record<string, unknown>;

      // Autonomy gate — fail-closed: absent or < 2 → reject
      if ((ctx.effectiveAutonomy ?? 0) < 2) {
        return {
          success: false,
          data: null,
          summary: "advance_phase requires autonomy level ≥ 2",
          error: "AUTONOMY_INSUFFICIENT",
        };
      }

      const actor = {
        userId: ctx.agentId ?? "aoa-agent",
        role: "team_member" as const,
        isHuman: false,
      };

      await ctx.services.threads.advancePhase(
        ctx.companyId,
        threadId as string,
        toPhase as ThreadPhase,
        actor,
      );

      return {
        success: true,
        data: { phase: toPhase },
        summary: `Thread advanced to phase: ${toPhase}`,
      };
    },
  };
}
