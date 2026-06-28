// server/src/services/internal-agent/aoa-agents/ensure-all-crew.ts
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents } from "@armyofagents/db";
import { logger } from "../../../middleware/logger.js";
import { ensureCommanderAgent } from "./ensure-commander.js";
import { ensureCommandStaff } from "./ensure-command-staff.js";
import { ensureAdjutant } from "./ensure-adjutant.js";
import { ensureScout } from "./ensure-scout.js";
import { ensureEngineer } from "./ensure-engineer.js";
import { ensureChronicler } from "./ensure-chronicler.js";

/**
 * True when this company's AoA crew is governed by an installed marketplace
 * package (non-`@legacy` templateOrigin). When so, the legacy ensure-*
 * seeders must NOT run — the marketplace owns the crew. Mirrors the gate
 * previously inlined in index.ts (boot) and companies.ts (create).
 */
export async function isCrewMarketplaceManaged(db: Db, companyId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.companyId, companyId),
          eq(agents.kind, "aoa"),
          sql`${agents.templateOrigin} IS NOT NULL AND ${agents.templateOrigin} NOT LIKE '%@legacy'`,
        ),
      )
      .limit(1);
    return !!row;
  } catch (err) {
    logger.warn({ err, companyId }, "isCrewMarketplaceManaged check failed — defaulting to NOT managed");
    return false;
  }
}

/**
 * Idempotently (re-)seed the full AoA crew for a company. Sequential (not
 * Promise.all) so ensureEngineer's Maker→Engineer rename can never race the
 * other seeds on the unique name index. Each step is independently
 * error-tolerant — one failure must not abort the rest (matches boot/create).
 *
 * Re-running this after a provider/crewModel change migrates existing rows to
 * the newly-resolved adapter via shouldRewriteCrewAdapter + mergeCrewAdapterConfig
 * inside each ensure-*.
 *
 * Callers are responsible for the marketplace gate (isCrewMarketplaceManaged).
 */
export async function ensureAllCrewAgents(db: Db, companyId: string): Promise<void> {
  const steps: Array<readonly [string, () => Promise<unknown>]> = [
    ["commander", () => ensureCommanderAgent(db, companyId)],
    ["command staff", () => ensureCommandStaff(db, companyId)],
    ["adjutant", () => ensureAdjutant(db, companyId)],
    ["scout", () => ensureScout(db, companyId)],
    ["engineer", () => ensureEngineer(db, companyId)],
    ["chronicler", () => ensureChronicler(db, companyId)],
  ];
  for (const [label, fn] of steps) {
    try {
      await fn();
    } catch (err) {
      logger.warn({ err, companyId }, `ensureAllCrewAgents: ${label} failed`);
    }
  }
}
