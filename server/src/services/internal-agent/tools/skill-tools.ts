import type { AgentTool, ToolResult } from "../types.js";

export const useSkillTool: AgentTool = {
  name: "use_skill",
  description:
    "Load a skill's full instructions into context. Call this before applying any skill. The skill content will be available for the rest of this conversation.",
  parameters: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "The skill key from the Available Skills list",
      },
    },
    required: ["key"],
  },
  category: "query",
  requiredRole: "team_member",
  requiresConfirmation: false,
  execute: async (params: unknown, ctx): Promise<ToolResult> => {
    const { key } = (params ?? {}) as { key?: unknown };
    if (!key || typeof key !== "string") {
      return {
        success: false,
        data: null,
        summary: "key is required",
        error: "INVALID_PARAMS",
      };
    }

    try {
      const { companySkills } = await import("@armyofagents/db");
      const { and, eq } = await import("drizzle-orm");

      const [skill] = await ctx.db
        .select({
          key: companySkills.key,
          name: companySkills.name,
          description: companySkills.description,
          markdown: companySkills.markdown,
        })
        .from(companySkills)
        .where(and(eq(companySkills.companyId, ctx.companyId), eq(companySkills.key, key)))
        .limit(1);

      if (!skill) {
        return {
          success: false,
          data: null,
          summary: `Skill '${key}' not found. Check the Available Skills list for valid keys.`,
          error: "NOT_FOUND",
        };
      }

      // Curated-source-of-truth enforcement: the Commander may only use skills
      // selected for it (agents.skillKeys). The bridge sets actorType
      // "commander" but not an agent id, so resolve the Commander agent from
      // companyId via internalAgentConfig.agentId.
      if (ctx.actorType === "commander") {
        const { agents, internalAgentConfig } = await import("@armyofagents/db");
        const [cfg] = await ctx.db
          .select({ agentId: internalAgentConfig.agentId })
          .from(internalAgentConfig)
          .where(eq(internalAgentConfig.companyId, ctx.companyId))
          .limit(1);
        if (cfg?.agentId) {
          const [agent] = await ctx.db
            .select({ skillKeys: agents.skillKeys })
            .from(agents)
            .where(eq(agents.id, cfg.agentId))
            .limit(1);
          const allowed: string[] = Array.isArray(agent?.skillKeys) ? agent.skillKeys : [];
          if (!allowed.includes(key)) {
            return {
              success: false,
              data: null,
              summary: `Skill '${key}' is not enabled for Commander. Enable it in Settings → Commander → Skills.`,
              error: "NOT_ENABLED",
            };
          }
        }
      }

      return {
        success: true,
        data: { key: skill.key, name: skill.name, content: skill.markdown },
        summary: `Loaded skill: ${skill.name}. Follow the instructions in 'content' for the rest of this conversation.`,
      };
    } catch (err: any) {
      return {
        success: false,
        data: null,
        summary: err?.message ?? "Failed to load skill",
        error: "INTERNAL",
      };
    }
  },
};
