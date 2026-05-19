import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, internalAgentConfig } from "@armyofagents/db";
import { agentInstructionsService } from "../../agent-instructions.js";
import { seedCommanderInstructionBundle } from "./seed-commander-bundle.js";
import { seedDefaultCommanderSkills } from "../../marketplace-install/default-skill-seeder.js";

export const COMMANDER_AGENT_NAME = "Commander";

// D2: Commander (lead) tool allowlist — broad but explicit (least privilege
// still applies to the lead). Includes all tools EXCEPT submit_extracted_items
// which belongs exclusively to the extraction sub-agent.
export const COMMANDER_TOOL_ALLOWLIST = [
  // Delegation (B3)
  "delegate_to_subagent",
  // Query
  "query_tasks",
  "query_goals",
  "query_agents",
  "query_departments",
  "query_budget",
  "query_activity",
  // Action
  "create_task",
  "update_task",
  "create_department",
  "create_goal",
  "create_agent",
  "update_agent",
  "assign_task",
  "wakeup_agent",
  // Memory
  "query_memory",
  "create_memory",
  "update_memory",
  "find_similar_memory",
  "detect_conflicts",
  // Discussion
  "extract_from_content",
  "search_discussions",
  "link_discussion_to_project",
  // Workflow
  "create_workflow_template",
  "instantiate_workflow",
  "add_task_dependency",
  // File
  "read_file",
  // Coordination
  "query_dependency_chain",
  // Analysis
  "analyze_workload",
  "suggest_improvements",
] as const;

/** Idempotently ensure the per-company Commander kind='aoa' row + link
 *  internal_agent_config.agentId. Chat loop (agent-loop.ts) unaffected.
 *  Discriminator: kind='aoa' + runtimeConfig.aoa.role='lead' (NOT agents.role
 *  — that is special-cased). */
export async function ensureCommanderAgent(db: Db, companyId: string): Promise<string> {
  const existing = await db.select({ id: agents.id, runtimeConfig: agents.runtimeConfig }).from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa"), eq(agents.name, COMMANDER_AGENT_NAME)))
    .then((r: { id: string; runtimeConfig: unknown }[]) => r[0] ?? null);
  let agentId = existing?.id ?? null;
  if (!agentId) {
    const [created] = await db.insert(agents).values({
      companyId, name: COMMANDER_AGENT_NAME, kind: "aoa", role: "general", status: "idle",
      adapterType: "process",
      runtimeConfig: {
        aoa: { role: "lead", toolAllowlist: [...COMMANDER_TOOL_ALLOWLIST] },
        heartbeat: { enabled: false, intervalSec: 0 },
      },
    }).returning();
    agentId = created.id;
  } else {
    // D2 idempotent backfill: merge toolAllowlist into existing row's runtimeConfig
    // so pre-D2 rows aren't stranded by default-deny.
    const rc = (existing.runtimeConfig as Record<string, unknown>) ?? {};
    const aoaCfg = (rc.aoa as Record<string, unknown>) ?? {};
    if (!Array.isArray(aoaCfg.toolAllowlist)) {
      const updatedRc = {
        ...rc,
        aoa: { ...aoaCfg, toolAllowlist: [...COMMANDER_TOOL_ALLOWLIST] },
      };
      await db.update(agents)
        .set({ runtimeConfig: updatedRc, updatedAt: new Date() })
        .where(eq(agents.id, agentId));
    }
  }
  // Seed the editable instruction bundle (idempotent; never clobbers edits).
  // Runs for BOTH the just-created and the pre-existing (back-fill) paths.
  try {
    const row = await db
      .select({ id: agents.id, companyId: agents.companyId, name: agents.name, adapterConfig: agents.adapterConfig })
      .from(agents)
      .where(eq(agents.id, agentId))
      .then((r: { id: string; companyId: string; name: string; adapterConfig: Record<string, unknown> | null }[]) => r[0]);
    if (row) {
      const nextAdapterConfig = await seedCommanderInstructionBundle({
        agent: { id: row.id, companyId: row.companyId, name: row.name, adapterConfig: row.adapterConfig },
        service: agentInstructionsService(),
      });
      await db.update(agents).set({ adapterConfig: nextAdapterConfig, updatedAt: new Date() }).where(eq(agents.id, agentId));
    }
  } catch {
    // Seeding failure must not block Commander provisioning (graceful: the
    // chat falls back to the SYSTEM_INSTRUCTIONS constant — M2).
  }
  // Seed default catalog skills (idempotent; never blocks provisioning).
  try {
    await seedDefaultCommanderSkills({ db, companyId });
  } catch {
    // Non-fatal — catalog may not be seeded yet on first boot.
  }
  await db.update(internalAgentConfig).set({ agentId, updatedAt: new Date() })
    .where(eq(internalAgentConfig.companyId, companyId));
  return agentId;
}
