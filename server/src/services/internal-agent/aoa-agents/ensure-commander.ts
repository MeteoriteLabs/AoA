import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, internalAgentConfig } from "@armyofagents/db";

export const COMMANDER_AGENT_NAME = "Commander";

/** Idempotently ensure the per-company Commander kind='aoa' row + link
 *  internal_agent_config.agentId. Chat loop (agent-loop.ts) unaffected.
 *  Discriminator: kind='aoa' + runtimeConfig.aoa.role='lead' (NOT agents.role
 *  — that is special-cased). */
export async function ensureCommanderAgent(db: Db, companyId: string): Promise<string> {
  const existing = await db.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa"), eq(agents.name, COMMANDER_AGENT_NAME)))
    .then((r: { id: string }[]) => r[0] ?? null);
  let agentId = existing?.id ?? null;
  if (!agentId) {
    const [created] = await db.insert(agents).values({
      companyId, name: COMMANDER_AGENT_NAME, kind: "aoa", role: "general", status: "idle",
      adapterType: "process",
      runtimeConfig: { aoa: { role: "lead" }, heartbeat: { enabled: false, intervalSec: 0 } },
    }).returning();
    agentId = created.id;
  }
  await db.update(internalAgentConfig).set({ agentId, updatedAt: new Date() })
    .where(eq(internalAgentConfig.companyId, companyId));
  return agentId;
}
