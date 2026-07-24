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
import { ensureSteward } from "./ensure-steward.js";
import { ensureLibrarian } from "./ensure-librarian.js";

/**
 * True when this company's AoA crew is governed by an installed marketplace
 * package (non-`@legacy` templateOrigin). When so, the legacy ensure-*
 * seeders for the CREW roster must NOT run — the marketplace owns the crew.
 *
 * This gate applies to {@link ensureCrewAgents} ONLY.
 * {@link ensureInfrastructureAgents} runs unconditionally (P8d).
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

type EnsureStep = readonly [string, () => Promise<unknown>];

/**
 * Run seed steps sequentially (never Promise.all — ensureEngineer's
 * Maker→Engineer rename must not race the other seeds on the unique
 * agents-name-per-company index) with per-step error tolerance: one failing
 * step must never abort the rest, in either half of the split.
 */
async function runEnsureSteps(companyId: string, scope: string, steps: EnsureStep[]): Promise<void> {
  for (const [label, fn] of steps) {
    try {
      await fn();
    } catch (err) {
      logger.warn({ err, companyId }, `${scope}: ${label} failed`);
    }
  }
}

/**
 * Seed the agents AoA itself requires, REGARDLESS of whether the marketplace
 * owns this company's crew. Callers MUST NOT gate this on
 * {@link isCrewMarketplaceManaged} (P8d — that gate covers the crew half only).
 *
 * - **Commander** — the always-on internal assistant, and the row that
 *   `internal_agent_config.agentId` points at. Re-running it after a
 *   cliTool/model change also migrates its adapter (`shouldRewriteCrewAdapter`
 *   → `mergeCrewAdapterConfig` inside `ensure-commander.ts`), so a
 *   marketplace-managed company must still reach this on a config change or
 *   Commander is stranded on the old provider.
 * - **Steward** — Inbox Hub curation.
 *   ⚠️ **TEMPORARY PLACEMENT.** Steward sits here only because it is not
 *   published in the marketplace catalog (verified against the live CDN on
 *   2026-07-24: 11 published agents, none of them Steward; the bundled
 *   `ui/src/aoa-marketplace-snapshot.json` agrees). T2.4 of
 *   `docs/aoa/plans/2026-07-24-phase2-marketplace-provisioning.md` authors and
 *   publishes `agent:aoa-curated/aoa-steward` and adds it to
 *   `team:aoa-curated/default-crew`. **When T2.4 lands, move `ensureSteward`
 *   out of this list and into {@link ensureCrewAgents}** — its continued
 *   existence is then guaranteed by the team install, and T2.5's
 *   protected-origin set is what stops it being uninstalled.
 */
export async function ensureInfrastructureAgents(db: Db, companyId: string): Promise<void> {
  await runEnsureSteps(companyId, "ensureInfrastructureAgents", [
    ["commander", () => ensureCommanderAgent(db, companyId)],
    // See the Steward note above — move to ensureCrewAgents once T2.4 publishes it.
    ["steward", () => ensureSteward(db, companyId)],
  ]);
}

/**
 * Seed the marketplace-owned crew roster: Command Staff (Navigator, Planner,
 * Memory Keeper), Adjutant, Scout, Engineer, Chronicler, Librarian. Every one
 * of these is published in the catalog, so once a company is marketplace-managed
 * the install owns them and these legacy seeders must not overwrite them.
 *
 * **Callers are responsible for the gate:** skip this when
 * {@link isCrewMarketplaceManaged} is true.
 *
 * Re-running this after a provider/crewModel change migrates existing rows to
 * the newly-resolved adapter via shouldRewriteCrewAdapter + mergeCrewAdapterConfig
 * inside each ensure-*.
 */
export async function ensureCrewAgents(db: Db, companyId: string): Promise<void> {
  await runEnsureSteps(companyId, "ensureCrewAgents", [
    ["command staff", () => ensureCommandStaff(db, companyId)],
    ["adjutant", () => ensureAdjutant(db, companyId)],
    ["scout", () => ensureScout(db, companyId)],
    ["engineer", () => ensureEngineer(db, companyId)],
    ["chronicler", () => ensureChronicler(db, companyId)],
    ["librarian", () => ensureLibrarian(db, companyId)],
  ]);
}

/**
 * Infrastructure + the full legacy crew roster, UNGATED.
 *
 * ⚠️ This is **not** the entrypoint for normal provisioning. Every production
 * caller (boot backfill, company create, config-change re-ensure) now calls
 * {@link ensureInfrastructureAgents} unconditionally and
 * {@link ensureCrewAgents} only when {@link isCrewMarketplaceManaged} is false.
 * Calling this behind a whole-function marketplace gate is the bug P8d fixed —
 * it silently stops seeding Commander and Steward.
 *
 * It survives as the single "give this company the complete legacy roster"
 * call for the deliberate fallback path in T2.3 (company create degrades to
 * the legacy seeders when the marketplace install fails), where running the
 * whole roster ungated is exactly what is wanted.
 */
export async function ensureAllCrewAgents(db: Db, companyId: string): Promise<void> {
  await ensureInfrastructureAgents(db, companyId);
  await ensureCrewAgents(db, companyId);
}
