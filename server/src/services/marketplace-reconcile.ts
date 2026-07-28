import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  activityLog,
  companies,
  marketplaceCompanySettings,
} from "@armyofagents/db";
import {
  MARKETPLACE_SETTINGS_DEFAULTS,
  type CatalogItem,
  type CatalogSyncStatus,
  type MarketplaceCatalogFile,
  type MarketplaceMaintenanceStage as SharedMarketplaceMaintenanceStage,
  type MarketplaceReconcileFailure,
  type MarketplaceReconcileResponse,
  type MarketplaceSettings,
} from "@armyofagents/shared";
import { logger } from "../middleware/logger.js";
import { agentInstructionsService } from "./agent-instructions.js";
import type { AgentInstructionsServiceLike } from "./marketplace-install/agent-create.js";
import { checkCrewUpdates } from "./marketplace-install/crew-updater.js";
import {
  reconcileTeamMembers,
  type ReconcileTeamMembersResult,
} from "./marketplace-install/team-reconcile.js";
import { runCrewRepairPass, type CrewRepairPassResult } from "./crew-repair.js";
import {
  runLegacyStewardReconcilePass,
  type LegacyStewardReconcilePassResult,
} from "./marketplace-install/legacy-steward-reconcile.js";
import type { MarketplaceCatalogService } from "./aoa-marketplace.js";
import { sha256Digest } from "./feedback-redaction.js";
import { runUpdateCheck } from "./marketplace-update-checker.js";
import { withMarketplaceUpdateLock } from "./marketplace-update-coordinator.js";

export type MarketplaceMaintenanceStage = SharedMarketplaceMaintenanceStage;
export type MarketplaceMaintenanceFailure = MarketplaceReconcileFailure;

export interface MarketplaceMaintenanceResult {
  companiesExamined: number;
  crewRepair: CrewRepairPassResult;
  legacySteward: LegacyStewardReconcilePassResult;
  crewUpdates: {
    succeeded: number;
    failed: number;
  };
  teamReconcile: ReconcileTeamMembersResult;
  failures: MarketplaceMaintenanceFailure[];
}

export type MarketplaceReconcileResult = Omit<
  MarketplaceReconcileResponse,
  "replayed"
>;

export interface MarketplaceMaintenanceDeps {
  listCompanyIds: (db: Db) => Promise<readonly string[]>;
  loadSettings: (db: Db, companyId: string) => Promise<MarketplaceSettings>;
  runCrewRepair: typeof runCrewRepairPass;
  runLegacyStewardReconcile: typeof runLegacyStewardReconcilePass;
  checkCrewUpdates: typeof checkCrewUpdates;
  reconcileTeamMembers: typeof reconcileTeamMembers;
}

export interface RunMarketplaceMaintenanceOptions {
  db: Db;
  catalogItems: CatalogItem[];
  /**
   * A manual caller may snapshot the fleet before writing its start audit and
   * pass that exact target set here. Scheduled callers continue to discover
   * companies inside the serialized maintenance pass.
   */
  companyIds?: readonly string[];
  instructionsService?: AgentInstructionsServiceLike;
  /**
   * Manual recovery processes the whole fleet and uses the guarded force path.
   * Boot/interval callers retain the existing bounded pass and cooldown.
   */
  mode?: "scheduled" | "manual";
  deps?: Partial<MarketplaceMaintenanceDeps>;
}

const EMPTY_CREW_REPAIR: CrewRepairPassResult = {
  catalogReady: false,
  inspected: 0,
  repaired: 0,
  skippedFailClosed: 0,
  skippedCooldown: 0,
  skippedOverBudget: 0,
  failed: 0,
};

const EMPTY_STEWARD_RECONCILE: LegacyStewardReconcilePassResult = {
  disabled: false,
  catalogReady: false,
  inspected: 0,
  adopted: 0,
  skippedOverBudget: 0,
  failed: 0,
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listCompanyIds(db: Db): Promise<readonly string[]> {
  const rows = await db
    .select({ id: companies.id })
    .from(companies)
    .orderBy(companies.id);
  return rows.map((row) => row.id);
}

async function loadSettings(
  db: Db,
  companyId: string,
): Promise<MarketplaceSettings> {
  const rows = await db
    .select({ settings: marketplaceCompanySettings.settings })
    .from(marketplaceCompanySettings)
    .where(eq(marketplaceCompanySettings.companyId, companyId))
    .limit(1);
  return {
    ...MARKETPLACE_SETTINGS_DEFAULTS,
    ...((rows[0]?.settings as Partial<MarketplaceSettings> | undefined) ?? {}),
  };
}

const DEFAULT_DEPS: MarketplaceMaintenanceDeps = {
  listCompanyIds,
  loadSettings,
  runCrewRepair: runCrewRepairPass,
  runLegacyStewardReconcile: runLegacyStewardReconcilePass,
  checkCrewUpdates,
  reconcileTeamMembers,
};

let maintenanceTail: Promise<void> = Promise.resolve();

async function withMaintenanceLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = maintenanceTail;
  let release!: () => void;
  maintenanceTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

/**
 * Reusable catalog-driven crew sequence. This is shared by the boot/24-hour
 * loop and the instance-admin recovery operation so they cannot drift.
 */
export async function runMarketplaceCrewMaintenance(
  options: RunMarketplaceMaintenanceOptions,
): Promise<MarketplaceMaintenanceResult> {
  return withMaintenanceLock(() =>
    runMarketplaceCrewMaintenanceUnlocked(options),
  );
}

async function runMarketplaceCrewMaintenanceUnlocked(
  options: RunMarketplaceMaintenanceOptions,
): Promise<MarketplaceMaintenanceResult> {
  const deps = { ...DEFAULT_DEPS, ...options.deps };
  const discoveredCompanyIds =
    options.companyIds ?? (await deps.listCompanyIds(options.db));
  const companyIds = [...new Set(discoveredCompanyIds)].sort();
  const failures: MarketplaceMaintenanceFailure[] = [];
  const failuresByCompanyStage = new Map<
    string,
    MarketplaceMaintenanceFailure
  >();
  const manual = options.mode === "manual";
  const maxPerPass = manual ? companyIds.length : undefined;
  const instructionsService =
    options.instructionsService ?? agentInstructionsService();
  const recordFailure = (
    companyId: string,
    stage: MarketplaceMaintenanceStage,
    error: unknown,
  ) => {
    const key = `${companyId}\0${stage}`;
    const existing = failuresByCompanyStage.get(key);
    if (existing) {
      existing.occurrences = (existing.occurrences ?? 1) + 1;
      return;
    }
    const failure = {
      companyId,
      stage,
      message: errorMessage(error),
    };
    failuresByCompanyStage.set(key, failure);
    failures.push(failure);
  };

  let crewRepair = { ...EMPTY_CREW_REPAIR };
  try {
    crewRepair = await deps.runCrewRepair({
      db: options.db,
      companyIds,
      catalogItems: options.catalogItems,
      maxPerPass,
      force: manual,
      onFailure: ({ companyId, error }) => {
        recordFailure(companyId, "crew_repair", error);
      },
    });
  } catch (error) {
    crewRepair = { ...EMPTY_CREW_REPAIR, failed: companyIds.length };
    for (const companyId of companyIds) {
      recordFailure(companyId, "crew_repair", error);
    }
  }

  let legacySteward = { ...EMPTY_STEWARD_RECONCILE };
  try {
    legacySteward = await deps.runLegacyStewardReconcile({
      db: options.db,
      companyIds,
      catalogItems: options.catalogItems,
      maxPerPass,
      onFailure: ({ companyId, error }) => {
        recordFailure(companyId, "legacy_steward", error);
      },
    });
  } catch (error) {
    legacySteward = {
      ...EMPTY_STEWARD_RECONCILE,
      failed: companyIds.length,
    };
    for (const companyId of companyIds) {
      recordFailure(companyId, "legacy_steward", error);
    }
  }

  const crewUpdateResult = { succeeded: 0, failed: 0 };
  const teamResult: ReconcileTeamMembersResult = {
    teamsReconciled: 0,
    membersAdded: 0,
  };

  for (const companyId of companyIds) {
    let crewUpdateFailed = false;
    try {
      const settings = await deps.loadSettings(options.db, companyId);
      await deps.checkCrewUpdates({
        db: options.db,
        companyId,
        catalogItems: options.catalogItems,
        settings,
        instructionsService,
        onFailure: ({ error }) => {
          crewUpdateFailed = true;
          recordFailure(companyId, "crew_update", error);
        },
      });
      if (crewUpdateFailed) {
        crewUpdateResult.failed += 1;
      } else {
        crewUpdateResult.succeeded += 1;
      }
    } catch (error) {
      crewUpdateResult.failed += 1;
      recordFailure(companyId, "crew_update", error);
    }

    try {
      const result = await deps.reconcileTeamMembers({
        db: options.db,
        companyId,
        catalogItems: options.catalogItems,
        instructionsService,
        onFailure: ({ error }) => {
          recordFailure(companyId, "team_reconcile", error);
        },
      });
      teamResult.teamsReconciled += result.teamsReconciled;
      teamResult.membersAdded += result.membersAdded;
    } catch (error) {
      recordFailure(companyId, "team_reconcile", error);
    }
  }

  return {
    companiesExamined: companyIds.length,
    crewRepair,
    legacySteward,
    crewUpdates: crewUpdateResult,
    teamReconcile: teamResult,
    failures,
  };
}

export function digestMarketplaceCatalog(
  catalog: MarketplaceCatalogFile,
): string {
  return sha256Digest(catalog);
}

export interface MarketplaceReconciliationActor {
  actorType: "user";
  actorId: string;
}

export interface MarketplaceReconciliationAuditInput {
  db: Db;
  phase: "started" | "completed";
  operationId: string;
  actor: MarketplaceReconciliationActor;
  companyIds: readonly string[];
  catalog: MarketplaceReconcileResult["catalog"];
  result?: MarketplaceReconcileResult;
}

export type MarketplaceReconciliationAuditWriter = (
  input: MarketplaceReconciliationAuditInput,
) => Promise<void>;

export async function writeMarketplaceReconciliationAudit(
  input: MarketplaceReconciliationAuditInput,
): Promise<void> {
  if (input.companyIds.length === 0) return;

  const action =
    input.phase === "started"
      ? "marketplace.reconciliation_started"
      : "marketplace.reconciliation_completed";
  const inserted = await input.db
    .insert(activityLog)
    .values(
      input.companyIds.map((companyId) => ({
        companyId,
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        action,
        entityType: "marketplace_reconciliation",
        entityId: input.operationId,
        details: {
          operationId: input.operationId,
          phase: input.phase,
          catalog: input.catalog,
          ...(input.result
            ? {
                status: input.result.status,
                fleetRepairs: input.result.repairs,
                companyFailures: input.result.failures.filter(
                  (failure) => failure.companyId === companyId,
                ),
              }
            : {
                stages: [
                  "marketplace_update",
                  "crew_repair",
                  "legacy_steward",
                  "crew_update",
                  "team_reconcile",
                ],
              }),
        },
      })),
    )
    .returning({ id: activityLog.id });

  if (inserted.length !== input.companyIds.length) {
    throw new Error(
      `Marketplace reconciliation audit persisted ${inserted.length} of ${input.companyIds.length} company records`,
    );
  }
}

export class MarketplaceCatalogRefreshError extends Error {
  constructor(
    public readonly operationId: string,
    public readonly catalogStatus: CatalogSyncStatus | null,
    public readonly catalogOutcome:
      | "cdn_success"
      | "fallback_success"
      | "failure",
    public readonly catalogError: string | null,
  ) {
    super("Marketplace catalog refresh failed; no reconciliation was run");
  }
}

export class MarketplaceReconcileExecutionError extends Error {
  constructor(public readonly operationId: string) {
    super("Marketplace reconciliation failed");
  }
}

export interface RunMarketplaceReconciliationOptions {
  db: Db;
  catalogService: Pick<MarketplaceCatalogService, "refresh">;
  actor: MarketplaceReconciliationActor;
  operationId?: string;
  maintenance?: typeof runMarketplaceCrewMaintenance;
  listCompanyIds?: MarketplaceMaintenanceDeps["listCompanyIds"];
  audit?: MarketplaceReconciliationAuditWriter;
  updateCheck?: typeof runUpdateCheck;
}

export async function runMarketplaceReconciliation(
  options: RunMarketplaceReconciliationOptions,
): Promise<MarketplaceReconcileResult> {
  const operationId = options.operationId ?? randomUUID();
  return withMarketplaceUpdateLock(() =>
    withMaintenanceLock(() =>
      runMarketplaceReconciliationLocked(options, operationId),
    ),
  );
}

async function runMarketplaceReconciliationLocked(
  options: RunMarketplaceReconciliationOptions,
  operationId: string,
): Promise<MarketplaceReconcileResult> {
  logger.info({ operationId }, "marketplace reconciliation started");

  try {
    const {
      catalog,
      status: catalogStatus,
      outcome: catalogOutcome,
      error: catalogError,
    } =
      await options.catalogService.refresh();
    if (
      !catalog ||
      catalogOutcome !== "cdn_success" ||
      catalogStatus?.lastSyncStatus !== "success"
    ) {
      logger.warn(
        { operationId, catalogStatus, catalogOutcome, catalogError },
        "marketplace reconciliation stopped because catalog refresh failed",
      );
      throw new MarketplaceCatalogRefreshError(
        operationId,
        catalogStatus,
        catalogOutcome,
        catalogError,
      );
    }

    const catalogIdentity: MarketplaceReconcileResult["catalog"] = {
      generatedAt: catalog.generatedAt,
      canonicalDigestSha256: digestMarketplaceCatalog(catalog),
      schemaVersion: catalog.schemaVersion,
      itemCount: catalog.itemCount,
      source: catalogStatus.source,
    };
    const listTargets = options.listCompanyIds ?? listCompanyIds;
    const companyIds = [
      ...new Set(await listTargets(options.db)),
    ].sort();
    const audit = options.audit ?? writeMarketplaceReconciliationAudit;
    await audit({
      db: options.db,
      phase: "started",
      operationId,
      actor: options.actor,
      companyIds,
      catalog: catalogIdentity,
    });

    const updateCheck = options.updateCheck ?? runUpdateCheck;
    const updateCheckResult = await updateCheck(options.db, catalog.items, {
      companyIds,
    });
    const updateFailures: MarketplaceMaintenanceFailure[] =
      updateCheckResult.failures.map((failure) => ({
        companyId: failure.companyId,
        stage: "marketplace_update",
        message: failure.catalogItemId
          ? `${failure.itemType} ${failure.catalogItemId}: ${failure.message}`
          : `${failure.itemType}: ${failure.message}`,
      }));

    // The reconciliation already owns the maintenance lock from before its
    // start audit. Calling the public wrapper here would try to acquire the
    // same non-reentrant lock again, so the production path invokes the shared
    // unlocked implementation. Injected test/alternate maintenance runs inside
    // the same outer lock.
    const maintenanceOptions: RunMarketplaceMaintenanceOptions = {
      db: options.db,
      catalogItems: catalog.items,
      companyIds,
      mode: "manual",
    };
    const result =
      options.maintenance &&
      options.maintenance !== runMarketplaceCrewMaintenance
        ? await options.maintenance(maintenanceOptions)
        : await runMarketplaceCrewMaintenanceUnlocked(maintenanceOptions);
    const failures = [...updateFailures, ...result.failures];
    const incomplete =
      failures.length > 0 ||
      result.crewRepair.failed > 0 ||
      result.crewRepair.skippedFailClosed > 0 ||
      result.crewRepair.skippedCooldown > 0 ||
      result.crewRepair.skippedOverBudget > 0 ||
      !result.crewRepair.catalogReady ||
      result.legacySteward.disabled ||
      !result.legacySteward.catalogReady ||
      result.legacySteward.failed > 0 ||
      result.crewUpdates.failed > 0 ||
      result.legacySteward.skippedOverBudget > 0;
    const response: MarketplaceReconcileResult = {
      operationId,
      status: incomplete ? "partial" : "success",
      repairs: {
        crewCompaniesRepaired: result.crewRepair.repaired,
        legacyStewardsAdopted: result.legacySteward.adopted,
        teamsReconciled: result.teamReconcile.teamsReconciled,
        teamMembersAdded: result.teamReconcile.membersAdded,
      },
      catalog: catalogIdentity,
      ...result,
      failures,
    };

    await audit({
      db: options.db,
      phase: "completed",
      operationId,
      actor: options.actor,
      companyIds,
      catalog: catalogIdentity,
      result: response,
    });

    logger.info(
      {
        operationId,
        status: response.status,
        catalog: response.catalog,
        companiesExamined: response.companiesExamined,
        crewRepair: response.crewRepair,
        legacySteward: response.legacySteward,
        crewUpdates: response.crewUpdates,
        teamReconcile: response.teamReconcile,
        failureCount: response.failures.reduce(
          (total, failure) => total + (failure.occurrences ?? 1),
          0,
        ),
      },
      "marketplace reconciliation completed",
    );
    return response;
  } catch (error) {
    if (error instanceof MarketplaceCatalogRefreshError) throw error;
    logger.error(
      { err: error, operationId },
      "marketplace reconciliation failed",
    );
    throw new MarketplaceReconcileExecutionError(operationId);
  }
}
