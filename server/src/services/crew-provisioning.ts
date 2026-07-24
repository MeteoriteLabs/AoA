/**
 * @fileoverview Company-create crew provisioning (T2.3).
 *
 * One entry point, {@link provisionCompanyCrew}, with one job: get a new
 * company its crew, preferring the marketplace so the company is born
 * *updateable* (`crew-updater.ts` skips `…@legacy` origins forever), and
 * falling back to the legacy `ensure-*` seeders so a marketplace outage can
 * never break onboarding.
 *
 * The fallback is LOSSY and the log says so — see
 * {@link LEGACY_CREW_SEEDER_COVERAGE}.
 */

import type { Db } from "@armyofagents/db";
import type { MarketplaceCatalogFile } from "@armyofagents/shared";
import { logger } from "../middleware/logger.js";
import { ensureCrewAgents } from "./internal-agent/aoa-agents/crew-seeding.js";
import {
  DEFAULT_CREW_TEAM_ITEM_ID,
  bootstrapCrewFromMarketplace,
  crewTeamIsInstalled,
  type CrewBootstrapDeps,
  type CrewBootstrapResult,
} from "./marketplace-install/crew-bootstrap.js";

/**
 * Which legacy `ensure-*` seeder (if any) can stand in for each agent the
 * marketplace crew team declares.
 *
 * `null` means **no legacy seeder exists** — a company that degrades to the
 * fallback simply will not have that agent, with nothing in the resulting data
 * to distinguish it from a complete roster. That is why the degrade log names
 * these explicitly instead of saying "install failed, using legacy seeders".
 *
 * Verified 2026-07-24 against `server/src/services/internal-agent/aoa-agents/`:
 * there is no `ensure-reviewer.ts` anywhere in the tree, while
 * `team:aoa-curated/default-crew` requires `agent:aoa-curated/aoa-reviewer`.
 *
 * Keep this in sync when the catalog team's `requires[]` changes. Unknown
 * (unlisted) catalog agent ids are treated as UNCOVERED — fail loud, not
 * silent, so a new roster member shows up in the log the first time it degrades.
 */
export const LEGACY_CREW_SEEDER_COVERAGE: Readonly<Record<string, string | null>> = {
  "agent:aoa-curated/aoa-adjutant": "ensureAdjutant",
  "agent:aoa-curated/aoa-scout": "ensureScout",
  "agent:aoa-curated/aoa-engineer": "ensureEngineer",
  "agent:aoa-curated/aoa-chronicler": "ensureChronicler",
  "agent:aoa-curated/aoa-librarian": "ensureLibrarian",
  "agent:aoa-curated/aoa-navigator": "ensureCommandStaff",
  "agent:aoa-curated/aoa-planner": "ensureCommandStaff",
  "agent:aoa-curated/aoa-memory-keeper": "ensureCommandStaff",
  // No seeder. A degraded company is permanently missing its Reviewer.
  "agent:aoa-curated/aoa-reviewer": null,
};

export interface LegacyCoverageGap {
  /** Catalog ids of crew agents the legacy seeders cannot provide. */
  itemIds: string[];
  /**
   * `catalog` — computed from the live team item's `requires[]` (authoritative).
   * `last-known` — no catalog was available, so derived from the static map.
   */
  source: "catalog" | "last-known";
}

/**
 * Which crew roles the legacy fallback cannot provide.
 *
 * When a catalog is in hand the answer comes from the team item's `requires[]`
 * — that is authoritative and catches a roster the static map has drifted from.
 * With no catalog (the common degrade cause) it falls back to the map's known
 * gaps, flagged as `last-known` so a reader knows it may be incomplete.
 */
export function describeLegacyCoverageGap(
  catalog: MarketplaceCatalogFile | null,
): LegacyCoverageGap {
  const teamItem = catalog?.items.find(
    (item) => item.id === DEFAULT_CREW_TEAM_ITEM_ID && item.type === "team",
  );

  if (teamItem) {
    const requiredAgentIds = (teamItem.requires ?? [])
      .filter((req) => req.type === "agent")
      .map((req) => req.id);
    return {
      itemIds: requiredAgentIds.filter((id) => !LEGACY_CREW_SEEDER_COVERAGE[id]),
      source: "catalog",
    };
  }

  return {
    itemIds: Object.entries(LEGACY_CREW_SEEDER_COVERAGE)
      .filter(([, seeder]) => !seeder)
      .map(([id]) => id),
    source: "last-known",
  };
}

export type CrewProvisioningOutcome =
  | { mode: "marketplace"; operationId: string; teamId: string | null }
  | { mode: "marketplace-already-dispatched"; operationId: string }
  /**
   * The bootstrap reported failure, but the company IS marketplace-managed —
   * the install committed and only its bookkeeping failed. Seeding was skipped.
   */
  | { mode: "marketplace-clobber-averted"; reason: string }
  | { mode: "legacy"; reason: string; unprovidedItemIds: string[] };

/**
 * Provision a newly created company's crew. Marketplace first, legacy seeders
 * as the degrade. Never throws — company creation must not depend on the
 * marketplace being reachable.
 */
export async function provisionCompanyCrew(
  db: Db,
  companyId: string,
  deps: CrewBootstrapDeps = {},
): Promise<CrewProvisioningOutcome> {
  let result: CrewBootstrapResult;
  try {
    result = await bootstrapCrewFromMarketplace(db, companyId, deps);
  } catch (err) {
    // bootstrapCrewFromMarketplace documents that it never throws; this is the
    // belt to that suspenders, so a docblock going stale cannot break create.
    result = {
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
      operationId: null,
      catalog: null,
    };
  }

  if (result.status === "installed") {
    logger.info(
      {
        companyId,
        operationId: result.operationId,
        teamId: result.teamId,
        catalogSource: result.catalogSource,
        teamItemId: DEFAULT_CREW_TEAM_ITEM_ID,
      },
      "crew provisioned from the marketplace",
    );
    return { mode: "marketplace", operationId: result.operationId, teamId: result.teamId };
  }

  if (result.status === "already-dispatched") {
    logger.info(
      { companyId, operationId: result.operationId, operationStatus: result.operationStatus },
      "crew bootstrap already dispatched for this company (idempotency key hit) — not re-installing",
    );
    return { mode: "marketplace-already-dispatched", operationId: result.operationId };
  }

  // R7: keep the three unavailability causes distinguishable. `no-service-registered`
  // is a WIRING REGRESSION (nothing called registerMarketplaceCatalogService) and must
  // not read like a CDN blip; `sync-cooldown` means a recent attempt already failed.
  const reason =
    result.status === "unavailable"
      ? (result.detail ? `${result.reason}:${result.detail}` : result.reason)
      : `install failed: ${result.reason}`;
  const gap = describeLegacyCoverageGap(result.catalog);

  logger.error(
    {
      companyId,
      teamItemId: DEFAULT_CREW_TEAM_ITEM_ID,
      degradeReason: reason,
      operationId: result.status === "failed" ? result.operationId : null,
      unprovidedItemIds: gap.itemIds,
      unprovidedSource: gap.source,
    },
    gap.itemIds.length > 0
      ? `crew provisioning DEGRADED to the legacy seeders (${reason}). ` +
          "This company will be stamped `…@legacy` and excluded from marketplace crew updates, AND " +
          `these crew members have NO legacy seeder and will be MISSING entirely: ${gap.itemIds.join(", ")} ` +
          `(roster source: ${gap.source})`
      : `crew provisioning DEGRADED to the legacy seeders (${reason}). ` +
          "This company will be stamped `…@legacy` and excluded from marketplace crew updates. " +
          "The legacy seeders cover every declared crew member.",
  );

  // ── The last gate before we write legacy rows ────────────────────────────
  //
  // A `failed` bootstrap result does NOT prove nothing was installed.
  // `dispatchInstall` can commit the team-body transaction, write `success`,
  // and THEN throw — the success DB write can fail, or `publishLiveEvent` is a
  // bare synchronous `EventEmitter.emit` (`live-events.ts`) so a throwing
  // subscriber propagates. Either lands in dispatchInstall's own catch, which
  // overwrites the terminal patch with `failure`.
  //
  // Seeding on top of that committed roster is silent and permanent:
  // `seedCrewAgent` hits ON CONFLICT DO NOTHING on every name-overlapping role,
  // takes the `!inserted` branch, and overwrites the MARKETPLACE rows'
  // `runtimeConfig.aoa.toolAllowlist`, possibly their adapter, and their
  // instruction bundle — while `templateOrigin`/`templateVersion` survive. The
  // company then looks marketplace-managed at the current catalog version, so
  // `crew-updater` will never repair it, and no duplicate rows are minted so
  // nothing in the data reveals the damage.
  //
  // One indexed query closes the whole class rather than the two known
  // triggers. It asks "did OUR team install commit?" (the `teams` row written
  // in the same transaction as the agents) rather than the broad
  // `isCrewMarketplaceManaged` predicate — that one also matches the
  // infrastructure agents seeded moments earlier, so using it here would make
  // a company skip its own crew the day any seeder starts stamping an origin.
  if (await crewTeamIsInstalled(db, companyId)) {
    logger.error(
      { companyId, degradeReason: reason, teamItemId: DEFAULT_CREW_TEAM_ITEM_ID },
      "crew bootstrap reported failure but the crew team IS installed — " +
        "the install committed and its bookkeeping failed. SKIPPING the legacy seeders " +
        "(running them would silently overwrite the marketplace crew's runtimeConfig, " +
        "adapter and instructions while leaving templateOrigin intact, putting the rows " +
        "beyond the reach of crew-updater).",
    );
    return { mode: "marketplace-clobber-averted", reason };
  }

  await ensureCrewAgents(db, companyId);
  return { mode: "legacy", reason, unprovidedItemIds: gap.itemIds };
}
