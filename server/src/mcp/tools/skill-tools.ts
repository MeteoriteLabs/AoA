import { z } from "zod";
import { companySkills, agents, internalAgentConfig } from "@armyofagents/db";
import { and, eq } from "drizzle-orm";
import {
  type ToolContext,
  type ToolHandler,
  type ToolResult,
  notFoundResult,
  ok,
} from "./types.js";

async function handleUseSkill(
  ctx: ToolContext,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = z.object({ key: z.string().min(1) }).parse(args);

  const [skill] = await ctx.db
    .select({
      key: companySkills.key,
      name: companySkills.name,
      description: companySkills.description,
      markdown: companySkills.markdown,
    })
    .from(companySkills)
    .where(
      and(
        eq(companySkills.companyId, ctx.companyId),
        eq(companySkills.key, parsed.key),
      ),
    )
    .limit(1);

  if (!skill) {
    return notFoundResult(
      `Skill '${parsed.key}' not found for this company. Use list_skills to see available skills.`,
    );
  }

  // Curated-source-of-truth enforcement: the Commander may only use skills that
  // are selected for it (agents.skillKeys). The bridge sets actor.source
  // "commander" but not agentId, so resolve the Commander agent from companyId
  // via internalAgentConfig.agentId.
  if (ctx.actor.source === "commander") {
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
      if (!allowed.includes(parsed.key)) {
        return notFoundResult(
          `Skill '${parsed.key}' is not enabled for Commander. Enable it in Settings → Commander → Skills.`,
        );
      }
    }
  }

  return ok({
    key: skill.key,
    name: skill.name,
    description: skill.description ?? null,
    content: skill.markdown ?? `Skill '${parsed.key}' has no markdown content.`,
  });
}

export const skillToolHandlers: Record<string, ToolHandler> = {
  "use_skill": handleUseSkill,
};
