import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers } from "@armyofagents/db";

export const EXTRACTION_AGENT_NAME = "Discussion Extraction";
export const EXTRACTION_INSTRUCTION =
  "You are the discussion-extraction agent. Read the discussion entry in your " +
  "context. Identify decisions, tasks, insights, context, references and " +
  "preferences. Call the `submit-extracted-items` tool with the structured " +
  "items. Do not output anything else.";

// D2: explicit allowlist — extraction agent may ONLY call submit_extracted_items.
export const EXTRACTION_AGENT_TOOL_ALLOWLIST = ["submit_extracted_items"] as const;

export async function ensureExtractionAgent(db: Db, companyId: string): Promise<string> {
  const existing = await db.select({ id: agents.id, runtimeConfig: agents.runtimeConfig }).from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "aoa"), eq(agents.name, EXTRACTION_AGENT_NAME)))
    .then((r: { id: string; runtimeConfig: unknown }[]) => r[0] ?? null);
  if (existing) {
    // D2 idempotent backfill: merge toolAllowlist into existing row's runtimeConfig
    // so pre-D2 rows aren't stranded by default-deny. Use a targeted update that
    // preserves all other runtimeConfig fields (heartbeat, instruction, role).
    const rc = (existing.runtimeConfig as Record<string, unknown>) ?? {};
    const aoaCfg = (rc.aoa as Record<string, unknown>) ?? {};
    if (!Array.isArray(aoaCfg.toolAllowlist)) {
      const updatedRc = {
        ...rc,
        aoa: { ...aoaCfg, toolAllowlist: [...EXTRACTION_AGENT_TOOL_ALLOWLIST] },
      };
      await db.update(agents)
        .set({ runtimeConfig: updatedRc, updatedAt: new Date() })
        .where(eq(agents.id, existing.id));
    }
    return existing.id;
  }
  const [created] = await db.insert(agents).values({
    companyId, name: EXTRACTION_AGENT_NAME, kind: "aoa", role: "general", status: "idle",
    adapterType: "process",
    runtimeConfig: {
      aoa: { role: "member", instruction: EXTRACTION_INSTRUCTION, toolAllowlist: [...EXTRACTION_AGENT_TOOL_ALLOWLIST] },
      heartbeat: { enabled: false, intervalSec: 0 },
    },
  }).returning();
  await db.insert(aoaAgentTriggers).values({
    companyId, agentId: created.id, kind: "outbox", enabled: true,
    config: { source: "discussion_entry_pending" },
  });
  return created.id;
}
