import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers } from "@armyofagents/db";

export const EXTRACTION_AGENT_NAME = "Discussion Extraction";
export const EXTRACTION_INSTRUCTION =
  "You are the discussion-extraction agent. Read the discussion entry in your " +
  "context. Identify decisions, tasks, insights, context, references and " +
  "preferences. Call the `submit-extracted-items` tool with the structured " +
  "items. Do not output anything else.";

export async function ensureExtractionAgent(db: Db, companyId: string): Promise<string> {
  const existing = await db.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa"), eq(agents.name, EXTRACTION_AGENT_NAME)))
    .then((r: { id: string }[]) => r[0] ?? null);
  if (existing) return existing.id;
  const [created] = await db.insert(agents).values({
    companyId, name: EXTRACTION_AGENT_NAME, kind: "aoa", role: "general", status: "idle",
    adapterType: "process",
    runtimeConfig: { aoa: { role: "member", instruction: EXTRACTION_INSTRUCTION }, heartbeat: { enabled: false, intervalSec: 0 } },
  }).returning();
  await db.insert(aoaAgentTriggers).values({
    companyId, agentId: created.id, kind: "outbox", enabled: true,
    config: { source: "discussion_entry_pending" },
  });
  return created.id;
}
