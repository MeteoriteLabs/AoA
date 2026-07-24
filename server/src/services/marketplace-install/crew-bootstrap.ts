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
 * Two hard rules:
 *
 * 1. **This never blocks or fails company creation.** Every failure mode —
 *    no catalog, item missing, fetch failure, DB error — returns a result the
 *    caller degrades on. It does not throw.
 * 2. **It goes through the orchestrator**, not straight to `installTeam`, so
 *    the install is recorded in `marketplace_install_operations` with its
 *    cascade results and idempotency key. T2.7 (diff/merge) and T2.8
 *    (re-materialization) build on that record; a second, divergent bootstrap
 *    path would fork them.
 */

import type { Db } from "@armyofagents/db";
import type { CatalogItem, MarketplaceCatalogFile } from "@armyofagents/shared";
import { logger } from "../../middleware/logger.js";
import { publishLiveEvent as defaultPublishLiveEvent } from "../live-events.js";
import { resolveCatalogForBootstrap, type ResolvedBootstrapCatalog } from "../aoa-marketplace.js";
import { dispatchInstall, startInstallOperation, type Installers, type PublishLiveEventFn } from "./orchestrator.js";
import { updateOperation } from "./operation-store.js";
import { installSkill } from "./skill-installer.js";
import { installTeam } from "./team-installer.js";

/** The catalog item that defines the AoA crew roster. */
export const DEFAULT_CREW_TEAM_ITEM_ID = "team:aoa-curated/default-crew";

/**
 * Deterministic idempotency key. `startInstallOperation` returns the EXISTING
 * operation on a key hit within 24h, so a retried or concurrent create cannot
 * double-install the crew (company create already retries on issue-prefix
 * collision, so this is reachable).
 */
export function crewBootstrapIdempotencyKey(companyId: string): string {
  return `bootstrap-crew:${companyId}`;
}

export type CrewBootstrapResult =
  | { status: "installed"; teamId: string | null; operationId: string; catalogSource: "cache" | "sync" }
  /** An operation for this key already exists — a concurrent/retried create owns it. */
  | { status: "already-dispatched"; operationId: string; operationStatus: string }
  | { status: "unavailable"; reason: "no-catalog" | "team-not-in-catalog"; catalog: MarketplaceCatalogFile | null }
  | { status: "failed"; reason: string; operationId: string | null; catalog: MarketplaceCatalogFile | null };

export interface CrewBootstrapDeps {
  /** Who to attribute the install operation to. Free text column, no FK. */
  requestedByUserId?: string | null;
  /** Override catalog resolution (tests). Default: cache → bounded sync → snapshot. */
  resolveCatalog?: () => Promise<ResolvedBootstrapCatalog | null>;
  /** Override the catalog-availability budget (tests). */
  catalogTimeoutMs?: number;
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

function buildBootstrapInstallers(): Installers {
  return {
    installSkill,
    installTeam: (opts) => installTeam({ ...opts, installPlugin: bootstrapPluginInstaller }),
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
  try {
    const resolve =
      deps.resolveCatalog ?? (() => resolveCatalogForBootstrap(db, deps.catalogTimeoutMs));
    const resolved = await resolve();
    if (!resolved) {
      return { status: "unavailable", reason: "no-catalog", catalog: null };
    }
    catalog = resolved.catalog;

    const teamItem = catalog.items.find(
      (item) => item.id === DEFAULT_CREW_TEAM_ITEM_ID && item.type === "team",
    );
    if (!teamItem) {
      return { status: "unavailable", reason: "team-not-in-catalog", catalog };
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

    // Idempotency: a fresh row is `pending`. Anything else means a concurrent
    // or earlier create already owns this install — dispatching again would
    // re-run the team installer and mint a duplicate roster (the name-conflict
    // resolver would rename them "Scout 2", …). Leave it alone.
    if (operation.status !== "pending") {
      return {
        status: "already-dispatched",
        operationId: operation.id,
        operationStatus: operation.status,
      };
    }

    // dispatchInstall swallows its own errors onto the operation row, so the
    // terminal patch is the only in-process signal of success/failure.
    let terminalStatus: string | null = null;
    let terminalError: string | null = null;
    let resultEntityId: string | null = null;

    await dispatchInstall({
      operation,
      catalogItem: teamItem,
      catalog,
      db,
      installers: buildBootstrapInstallers(),
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
  }
}
