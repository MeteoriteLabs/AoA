/**
 * @fileoverview Install the AoA crew from the marketplace at company creation
 * (T2.3 / P8, P8c).
 *
 * Before this existed, every company was seeded by the hand-written legacy
 * `ensure-*` seeders, whose rows are stamped `…@legacy` by
 * `backfill-template-origin.ts`. `crew-updater.ts` skips `@legacy` rows
 * forever, so every company was permanently frozen out of the update pipeline
 * that was already built and running. Installing `team:aoa-curated/default-crew`
 * at create time is what makes a company *born updateable*.
 *
 * Three hard rules:
 *
 * 1. **This never blocks or fails company creation.** Every failure mode —
 *    no catalog, item missing, fetch failure, deadline, DB error — returns a
 *    result the caller degrades on. It does not throw.
 * 2. **It is bounded.** The real roster is 27 sequential network fetches at
 *    30s apiece; unbounded, that is ~13.5 minutes inside an interactive POST.
 *    See {@link CREW_INSTALL_DEADLINE_MS}.
 * 3. **It goes through the orchestrator**, not straight to `installTeam`, so
 *    the install is recorded in `marketplace_install_operations` with its
 *    cascade results and idempotency key. T2.7 (diff/merge) and T2.8
 *    (re-materialization) build on that record; a second, divergent bootstrap
 *    path would fork them.
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { teams } from "@armyofagents/db";
import type { CatalogItem, MarketplaceCatalogFile } from "@armyofagents/shared";
import { logger } from "../../middleware/logger.js";
import { publishLiveEvent as defaultPublishLiveEvent } from "../live-events.js";
import {
  resolveCatalogForBootstrap,
  type CatalogAvailability,
  type CatalogUnavailableReason,
} from "../aoa-marketplace.js";
import { dispatchInstall, startInstallOperation, type Installers, type PublishLiveEventFn } from "./orchestrator.js";
import { claimOperationForDispatch, updateOperation } from "./operation-store.js";
import { installSkill } from "./skill-installer.js";
import { installTeam } from "./team-installer.js";

/** The catalog item that defines the AoA crew roster. */
export const DEFAULT_CREW_TEAM_ITEM_ID = "team:aoa-curated/default-crew";

/**
 * Aggregate wall-clock budget for the whole team install (all resource fetches
 * + the team-body transaction).
 *
 * Sizing: the published roster is 27 fetches — `team.json`, 9 `agent.json`, and
 * 17 skill bodies (**zero** of the crew's skills carry `content.inline`, so all
 * of them hit the network). At {@link CREW_INSTALL_FETCH_CONCURRENCY} = 6 a
 * healthy CDN (~200ms/request) finishes in ~1-2s, and even a sluggish
 * 2s/request CDN finishes in ~10s. 30s therefore never truncates a working
 * install, while capping a *degraded* (slow, not down — down fails fast) CDN
 * at 30s instead of minutes.
 *
 * Worst case for company create is now `CATALOG_AVAILABILITY_TIMEOUT_MS` (12s)
 * + this (30s) ≈ 42s, versus ~13.5 minutes before — and comfortably inside
 * Node's 300s default `requestTimeout`, which was previously the real
 * (socket-error) ceiling.
 */
export const CREW_INSTALL_DEADLINE_MS = 30_000;

/**
 * Resource fetches in flight during pre-flight. 6 keeps the healthy path ~5×
 * faster than sequential without hammering `raw.githubusercontent.com`.
 * Sequential (1) remains the default for every other `installTeam` caller —
 * the public install route is 202-accepted and does not pay this latency
 * synchronously, so there is no reason to change its behaviour in this fix.
 */
export const CREW_INSTALL_FETCH_CONCURRENCY = 6;

/**
 * Deterministic idempotency key. `startInstallOperation` returns the EXISTING
 * operation on a key hit within 24h, and {@link claimOperationForDispatch} then
 * decides — atomically — whether this caller owns the dispatch. Together they
 * make a concurrent or repeated bootstrap incapable of double-installing.
 *
 * (Note: company create's issue-prefix retry loop does NOT reach this — it only
 * re-enters on a conflict at the company INSERT, before a companyId exists. The
 * reachable repeat caller is the T2.3b repair path.)
 */
export function crewBootstrapIdempotencyKey(companyId: string): string {
  return `bootstrap-crew:${companyId}`;
}

export type CrewBootstrapResult =
  | { status: "installed"; teamId: string | null; operationId: string; catalogSource: "cache" | "sync" }
  /** Another caller holds (or completed) this install — do NOT seed over it. */
  | { status: "already-dispatched"; operationId: string; operationStatus: string }
  | {
    status: "unavailable";
    reason: "no-catalog" | "team-not-in-catalog";
    detail: CatalogUnavailableReason | null;
    catalog: MarketplaceCatalogFile | null;
  }
  | { status: "failed"; reason: string; operationId: string | null; catalog: MarketplaceCatalogFile | null };

export interface CrewBootstrapDeps {
  /** Who to attribute the install operation to. Free text column, no FK. */
  requestedByUserId?: string | null;
  /** Override catalog resolution (tests). Default: cache → bounded sync → snapshot. */
  resolveCatalog?: () => Promise<CatalogAvailability>;
  /** Override the catalog-availability budget (tests). */
  catalogTimeoutMs?: number;
  /** Override the aggregate install budget (tests). */
  installDeadlineMs?: number;
  publishLiveEvent?: PublishLiveEventFn;
}

/**
 * Plugin installs are not reachable from the bootstrap path: the loader lives
 * at the route layer, and company create runs far below it.
 * `team:aoa-curated/default-crew` requires no plugins today. If a future
 * catalog revision adds one, this throws — which fails the team install, which
 * degrades the company to the legacy seeders WITH a loud log, rather than
 * silently installing a half-configured plugin.
 */
const bootstrapPluginInstaller = async (opts: { catalogItem: CatalogItem }): Promise<never> => {
  throw new Error(
    `crew bootstrap cannot install plugin dependency ${opts.catalogItem.id} — ` +
      "the plugin loader is route-scoped. Install it from the Marketplace after onboarding.",
  );
};

function buildBootstrapInstallers(signal: AbortSignal): Installers {
  return {
    installSkill,
    installTeam: (opts) =>
      installTeam({
        ...opts,
        installPlugin: bootstrapPluginInstaller,
        signal,
        fetchConcurrency: CREW_INSTALL_FETCH_CONCURRENCY,
      }),
    // Unreachable for a team item — dispatchInstall only calls these on
    // `agent` / `plugin` roots. Fail loudly rather than pretend to work.
    installAgent: () => {
      throw new Error("crew bootstrap does not install standalone agents");
    },
    installPlugin: bootstrapPluginInstaller,
  };
}

/**
 * Install `team:aoa-curated/default-crew` for a freshly created company.
 *
 * @returns a discriminated result. NEVER throws.
 */
export async function bootstrapCrewFromMarketplace(
  db: Db,
  companyId: string,
  deps: CrewBootstrapDeps = {},
): Promise<CrewBootstrapResult> {
  let catalog: MarketplaceCatalogFile | null = null;
  const deadline = new AbortController();
  const deadlineMs = deps.installDeadlineMs ?? CREW_INSTALL_DEADLINE_MS;
  let deadlineTimer: NodeJS.Timeout | undefined;

  try {
    const resolve =
      deps.resolveCatalog ?? (() => resolveCatalogForBootstrap(db, deps.catalogTimeoutMs));
    const resolved = await resolve();
    if (resolved.status !== "ok") {
      return { status: "unavailable", reason: "no-catalog", detail: resolved.reason, catalog: null };
    }
    catalog = resolved.catalog;

    const teamItem = catalog.items.find(
      (item) => item.id === DEFAULT_CREW_TEAM_ITEM_ID && item.type === "team",
    );
    if (!teamItem) {
      return { status: "unavailable", reason: "team-not-in-catalog", detail: null, catalog };
    }

    const operation = await startInstallOperation({
      request: {
        catalogItemId: teamItem.id,
        idempotencyKey: crewBootstrapIdempotencyKey(companyId),
      },
      catalogItem: teamItem,
      companyId,
      requestedByUserId: deps.requestedByUserId ?? "system:crew-bootstrap",
      db,
    });

    // Ownership is decided by a conditional UPDATE, not by reading `status`.
    // A read is check-then-act: two concurrent bootstraps can both see
    // `pending` (the loser's conflict-fetch returns the winner's row before the
    // winner writes `running`) and both dispatch, minting a renamed duplicate
    // roster ("Scout 2"). `failure` IS claimable — nobody owns a failed install
    // and nothing was installed, so a repair pass must be able to retry it.
    const claimed = await claimOperationForDispatch(db, operation.id);
    if (!claimed) {
      return {
        status: "already-dispatched",
        operationId: operation.id,
        operationStatus: operation.status,
      };
    }

    deadlineTimer = setTimeout(() => deadline.abort(), deadlineMs);
    deadlineTimer.unref?.();

    // dispatchInstall swallows its own errors onto the operation row, so the
    // terminal patch is the only in-process signal of success/failure.
    //
    // ⚠️ It can also write `success` and THEN throw (the success DB write at
    // orchestrator.ts, or a throwing live-event subscriber), land in its own
    // catch, and overwrite that with `failure`. So a `failed` result here does
    // NOT prove nothing was installed — `provisionCompanyCrew` re-checks the
    // marketplace gate before it seeds anything.
    let terminalStatus: string | null = null;
    let terminalError: string | null = null;
    let resultEntityId: string | null = null;

    await dispatchInstall({
      operation,
      catalogItem: teamItem,
      catalog,
      db,
      installers: buildBootstrapInstallers(deadline.signal),
      publishLiveEvent: deps.publishLiveEvent ?? defaultPublishLiveEvent,
      updateOperation: async (id, patch) => {
        if (patch.status === "success" || patch.status === "failure") {
          terminalStatus = patch.status;
          terminalError = patch.errorMessage ?? null;
          resultEntityId = patch.resultEntityId ?? null;
        }
        await updateOperation(db, id, patch);
      },
    });

    if (terminalStatus === "success") {
      return {
        status: "installed",
        teamId: resultEntityId,
        operationId: operation.id,
        catalogSource: resolved.source,
      };
    }

    return {
      status: "failed",
      reason: terminalError ?? "install did not reach a terminal state",
      operationId: operation.id,
      catalog,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ err, companyId }, "crew bootstrap threw before dispatch");
    return { status: "failed", reason, operationId: null, catalog };
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}

/**
 * Did THIS company's crew-team install actually commit?
 *
 * The `teams` row is written inside the same phase-3 transaction as the crew
 * agents, so its presence is an exact witness: team row ⇔ agents committed.
 *
 * Deliberately NOT `isCrewMarketplaceManaged`. That predicate matches **any**
 * `kind='aoa'` row with a non-`@legacy` origin, including the infrastructure
 * agents (Commander, Steward) seeded moments earlier by
 * `ensureInfrastructureAgents`. Today nothing stamps an origin at seed time —
 * but `aoa-bootstrap-wiring.test.ts` (`stampsOriginOnSeed`) exists precisely
 * because nothing *enforces* that, and using the broad predicate here would
 * make a company skip its own crew entirely the day a seeder starts stamping.
 * (It did: that test failed when this guard was first written that way.)
 *
 * **Fails CLOSED** — an unreadable answer reports "installed", i.e. do not
 * seed. The asymmetry is deliberate: a crewless company is visible and
 * repairable (T2.3b), a marketplace crew silently overwritten by the legacy
 * seeders is neither.
 */
export async function crewTeamIsInstalled(db: Db, companyId: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(
        and(eq(teams.companyId, companyId), eq(teams.templateOrigin, DEFAULT_CREW_TEAM_ITEM_ID)),
      )
      .limit(1);
    return !!row;
  } catch (err) {
    logger.warn(
      { err, companyId },
      "crew-team install check failed — assuming INSTALLED so the legacy seeders cannot clobber it",
    );
    return true;
  }
}
