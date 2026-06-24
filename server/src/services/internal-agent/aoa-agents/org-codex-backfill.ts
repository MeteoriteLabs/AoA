import { eq, and } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents } from "@armyofagents/db";
import { isCodexCompatibleModel, DEFAULT_CODEX_CHAT_MODEL } from "../codex-model.js";

function hasPerAgentOpenAiKey(adapterConfig: Record<string, unknown> | null | undefined): boolean {
  const env = adapterConfig?.env as Record<string, unknown> | undefined;
  return typeof env?.OPENAI_API_KEY === "string" && env.OPENAI_API_KEY.trim().length > 0;
}

export function orgCodexRowNeedsBackfill(
  row: { kind?: string | null; adapterType?: string | null; adapterConfig?: Record<string, unknown> | null },
): boolean {
  if (row.kind !== "org" || row.adapterType !== "codex_local") return false;
  // P1 (Codex review): an org agent with its OWN api key validly runs an
  // api-key-only model (gpt-5.3-codex) in apikey mode — never rewrite it.
  if (hasPerAgentOpenAiKey(row.adapterConfig)) return false;
  const model = typeof row.adapterConfig?.model === "string" ? row.adapterConfig.model : "";
  return model.length > 0 && !isCodexCompatibleModel(model);
}

/** Boot sweep: heal org codex rows in a company whose model a ChatGPT login would reject. */
export async function backfillOrgCodexModels(db: Db, companyId: string): Promise<number> {
  // P1 (Codex review): filter in SQL by kind+adapterType (not select-all-then-filter).
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.kind, "org"), eq(agents.adapterType, "codex_local")));
  let fixed = 0;
  for (const row of rows) {
    if (!orgCodexRowNeedsBackfill(row as never)) continue;
    // P1 (Codex review): SHALLOW-merge — replace ONLY model, preserving the org
    // agent's env/cwd/promptTemplate/timeoutSec/etc. (mergeAdapterConfig is
    // crew-only and keeps only instructions* fields, dropping everything else).
    const existing = (row.adapterConfig as Record<string, unknown> | null) ?? {};
    const next = { ...existing, model: DEFAULT_CODEX_CHAT_MODEL };
    // Bump updatedAt on the heal, matching the sibling ensure*/backfill convention
    // (e.g. ensure-commander.ts) so the rewrite is visible in audit/ordered views.
    await db.update(agents).set({ adapterConfig: next, updatedAt: new Date() }).where(and(eq(agents.id, row.id), eq(agents.companyId, companyId)));
    fixed += 1;
  }
  return fixed;
}
