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
      const { companySkills, agents, internalAgentConfig } = await import("@armyofagents/db");
      const { eq } = await import("drizzle-orm");

      // Flexible resolution: the model sometimes drops the "skill:" prefix or
      // passes the slug/name. Resolve to the canonical company skill.
      const all = await ctx.db
        .select({
          key: companySkills.key,
          slug: companySkills.slug,
          name: companySkills.name,
          description: companySkills.description,
          markdown: companySkills.markdown,
        })
        .from(companySkills)
        .where(eq(companySkills.companyId, ctx.companyId));

      const want = key.toLowerCase();
      const skill =
        all.find((s) => s.key.toLowerCase() === want) ??
        all.find((s) => s.key.toLowerCase() === `skill:${want}`) ??
        all.find((s) => {
          const k = s.key.toLowerCase();
          return k.endsWith(`/${want}`) || k.endsWith(`:${want}`);
        }) ??
        all.find((s) => (s.slug ?? "").toLowerCase() === want) ??
        all.find((s) => (s.name ?? "").toLowerCase() === want) ??
        null;

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
      // companyId via internalAgentConfig.agentId. Check the CANONICAL key.
      if (ctx.actorType === "commander") {
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
          if (!allowed.includes(skill.key)) {
            return {
              success: false,
              data: null,
              summary: `Skill '${skill.key}' is not enabled for Commander. Enable it in Settings → Commander → Skills.`,
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
