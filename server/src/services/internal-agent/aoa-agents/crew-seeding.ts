// server/src/services/internal-agent/aoa-agents/crew-seeding.ts
//
// The legacy (non-marketplace) agent seeding entrypoints, split in two by the
// marketplace boundary (P8d), plus the predicate that decides which half a
// caller may skip.
//
// There is deliberately NO "seed everything" union export. Every caller must
// choose a half: infrastructure is unconditional, the crew roster is gated.
// A union symbol invites `if (managed) return; seedEverything()` — which is
// exactly the bug this module was split to fix.
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
 *
 * **Read this BEFORE seeding anything.** It is a read-your-own-writes hazard
 * otherwise: the predicate matches any `kind='aoa'` row with a non-`@legacy`
 * origin, and the seeders insert `kind='aoa'` rows. Today they stamp no
 * `templateOrigin` at all (`seed-crew-agent.ts`; the `@legacy` suffix is
 * applied only by `backfill-template-origin.ts` at boot) so seeding first
 * happens to be safe — but nothing enforces that, and the failure mode is
 * silent: a company would see its own just-inserted Commander, conclude
 * "marketplace-managed", and skip its entire crew.
 *
 * Fails open to "not managed" (run the legacy seeders) on a DB error — a
 * company must never be left crewless because a gate query blipped.
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
 *
 * ⚠️ **Steward's placement here is TEMPORARY.** It sits on the infrastructure
 * side only because it is not published in the marketplace catalog (verified
 * against the live CDN on 2026-07-24: 11 published agents, none of them
 * Steward; the bundled `ui/src/aoa-marketplace-snapshot.json` agrees). T2.4 of
 * `docs/aoa/plans/2026-07-24-phase2-marketplace-provisioning.md` authors and
 * publishes `agent:aoa-curated/aoa-steward` and adds it to
 * `team:aoa-curated/default-crew`.
 *
 * **Moving `ensureSteward` into {@link ensureCrewAgents} is NOT sufficient on
 * its own — it must be paired with a reconciliation of the pre-existing legacy
 * Steward rows.** Companies created between T2.3 and T2.4 own a Steward row
 * with `templateOrigin` NULL: `seed-crew-agent.ts` stamps no origin on insert,
 * and "Steward" is absent from `CREW_NAMES` in `backfill-template-origin.ts`,
 * so the boot backfill never stamps it either. `team-reconcile.ts:96-107`
 * computes its `missing` set from the non-null `templateOrigin`s of the
 * installed team's *members* — a legacy Steward is neither a team member nor
 * origin-stamped, so it fails that lookup twice over and reconcile installs a
 * SECOND Steward. That does not crash —
 * `resolveAgentNameConflict` renames the newcomer — so the company silently
 * ends up with two Steward agents, both carrying the
 * `{kind:"sweep", config:{role:"steward"}}` trigger, i.e. duplicated hub
 * curation runs. T2.4 must stamp or remove the legacy row as part of the move.
 *
 * **Chronicler has the identical NULL-origin gap** (also absent from
 * `CREW_NAMES`), so it needs the same reconciliation whenever its catalog
 * status is acted on. Do NOT "fix" the gap by stamping these rows with a
 * non-`@legacy` origin — see the plan's T2.5 section: that NULL is load-bearing
 * for {@link isCrewMarketplaceManaged}, and a non-`@legacy` stamp would
 * suppress every company's crew seeding.
 */
export async function ensureInfrastructureAgents(db: Db, companyId: string): Promise<void> {
  await runEnsureSteps(companyId, "ensureInfrastructureAgents", [
    ["commander", () => ensureCommanderAgent(db, companyId)],
    // See the Steward note above — moving this line is a two-part change.
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
 * {@link isCrewMarketplaceManaged} is true. This is also the call for a
 * deliberate degrade-to-legacy fallback (T2.3) — infrastructure will already
 * have been seeded unconditionally by then.
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
