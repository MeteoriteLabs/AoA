/**
 * @fileoverview Marketplace install orchestrator.
 *
 * Two entry points:
 * - `startInstallOperation` creates the operation row (or returns the existing
 *   one if idempotencyKey matches a recent op). Synchronous; fast — no install
 *   work happens here.
 * - `dispatchInstall` runs the per-type installer, updates the operation row,
 *   and fires per-company live-events. Designed to run in background — caller
 *   fire-and-forgets after returning the operation ID to the client.
 *
 * All install types (skill / agent / team / plugin) flow through `dispatchInstall`.
 * The route layer pre-curries `installPlugin` (and the team installer's
 * `installPlugin` cascade hook) with `pluginLoader`, parallel to the way
 * `installTeam` already pre-curries its `installPlugin` dependency.
 */

import type { Db } from "@armyofagents/db";
import type { CascadeStepResult } from "@armyofagents/db";
import type { CatalogItem, MarketplaceCatalogFile, LiveEventType } from "@armyofagents/shared";
import { logger } from "../../middleware/logger.js";
import {
  createOperation,
  findExistingByIdempotencyKey,
  updateOperation as defaultUpdateOperation,
  type OperationRow,
} from "./operation-store.js";
import type { InstallRequest } from "./types.js";
import type { InstallSkillOpts, InstallSkillResult } from "./skill-installer.js";
import type { InstallAgentOpts, InstallAgentResult } from "./agent-installer.js";
import type { InstallTeamOpts, InstallTeamResult } from "./team-installer.js";
import { resolveAgentNameConflict } from "./conflict-resolver.js";
import { marketplaceNotifications } from "../marketplace-notifications.js";

export interface Installers {
  installSkill: (opts: InstallSkillOpts) => Promise<InstallSkillResult>;
  installAgent: (opts: InstallAgentOpts) => Promise<InstallAgentResult>;
  // installTeam takes opts WITHOUT installPlugin — the route layer pre-curries
  // installPlugin in by wrapping the raw `installTeam` from team-installer.ts.
  installTeam: (opts: Omit<InstallTeamOpts, "installPlugin">) => Promise<InstallTeamResult>;
  // installPlugin is pre-curried at route layer with pluginLoader (parallel
  // to installTeam's pre-curried installPlugin)
  installPlugin: (opts: { catalogItem: CatalogItem; companyId: string; db: Db }) => Promise<{ pluginId: string; alreadyInstalled: boolean }>;
}

export interface PublishLiveEventFn {
  (event: { companyId: string; type: LiveEventType; payload?: Record<string, unknown> }): void;
}

export interface StartInstallOpts {
  request: InstallRequest;
  catalogItem: CatalogItem;
  companyId: string;
  requestedByUserId: string;
  db: Db;
}

/**
 * Create the operation row (or return existing if idempotencyKey matches recent op).
 * Does NOT execute the install — caller must call dispatchInstall separately
 * (typically in background after returning operation ID to client).
 */
export async function startInstallOperation(opts: StartInstallOpts): Promise<OperationRow> {
  const { request, catalogItem, companyId, requestedByUserId, db } = opts;

  if (request.idempotencyKey) {
    const existing = await findExistingByIdempotencyKey(db, companyId, request.idempotencyKey);
    if (existing) return existing;
  }

  return await createOperation(db, {
    companyId,
    catalogItem,
    targetDepartmentId: request.targetDepartmentId,
    idempotencyKey: request.idempotencyKey,
    requestedByUserId,
  });
}

export interface DispatchInstallOpts {
  operation: OperationRow;
  catalogItem: CatalogItem;
  catalog: MarketplaceCatalogFile;
  db: Db;
  installers: Installers;
  /**
   * Override hook for tests. Production callers omit this and the orchestrator
   * uses `defaultUpdateOperation(db, ...)` from operation-store.
   */
  updateOperation?: (
    id: string,
    patch: Parameters<typeof defaultUpdateOperation>[2],
  ) => Promise<void>;
  publishLiveEvent: PublishLiveEventFn;
}

/**
 * Execute the install for an operation. Updates the operation row and fires
 * per-company live-events (started -> completed/failed).
 *
 * Designed to run in background (caller fire-and-forgets). Errors are caught
 * and recorded on the operation row — never thrown to caller.
 */
export async function dispatchInstall(opts: DispatchInstallOpts): Promise<void> {
  const { operation, catalogItem, catalog, db, installers, publishLiveEvent } = opts;
  const updateFn = opts.updateOperation ?? ((id, patch) => defaultUpdateOperation(db, id, patch));

  try {
    await updateFn(operation.id, { status: "running" });

    // Publish started AFTER the row is updated to "running" so subscribers
    // that immediately fetch the operation see consistent state.
    publishLiveEvent({
      companyId: operation.companyId,
      type: "marketplace.install.started",
      payload: { operationId: operation.id, catalogItemId: catalogItem.id },
    });

    let resultEntityId: string;
    let cascadeResults: CascadeStepResult[] | undefined;

    if (catalogItem.type === "skill") {
      const r = await installers.installSkill({ catalogItem, companyId: operation.companyId, db });
      resultEntityId = r.skillId;
    } else if (catalogItem.type === "agent") {
      const resolvedName = await resolveAgentNameConflict({
        db,
        companyId: operation.companyId,
        desiredName: catalogItem.name,
      });
      const r = await installers.installAgent({
        catalogItem, companyId: operation.companyId, db, desiredName: resolvedName,
      });
      resultEntityId = r.agentId;
    } else if (catalogItem.type === "team") {
      if (!operation.targetDepartmentId) {
        throw new Error("Team install requires targetDepartmentId");
      }
      const r = await installers.installTeam({
        catalogItem, catalog, companyId: operation.companyId,
        targetDepartmentId: operation.targetDepartmentId, db,
      });
      resultEntityId = r.teamId;
      cascadeResults = r.cascadeResults;
    } else if (catalogItem.type === "plugin") {
      const r = await installers.installPlugin({ catalogItem, companyId: operation.companyId, db });
      resultEntityId = r.pluginId;
    } else {
      throw new Error(`Unknown item type: ${(catalogItem as { type: string }).type}`);
    }

    await updateFn(operation.id, {
      status: "success",
      resultEntityId,
      cascadeResults: cascadeResults ?? null,
      completedAt: new Date(),
    });

    publishLiveEvent({
      companyId: operation.companyId,
      type: "marketplace.install.completed",
      payload: { operationId: operation.id, catalogItemId: catalogItem.id, resultEntityId },
    });

    void marketplaceNotifications
      .installCompleted(db, operation.companyId, catalogItem.name, operation.id)
      .catch((err) => logger.error({ err }, "marketplace notification failed"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { operationId: operation.id, catalogItemId: catalogItem.id, err: message },
      "marketplace install dispatch failed",
    );
    await updateFn(operation.id, {
      status: "failure", errorMessage: message, completedAt: new Date(),
    });
    publishLiveEvent({
      companyId: operation.companyId,
      type: "marketplace.install.failed",
      payload: { operationId: operation.id, catalogItemId: catalogItem.id, error: message },
    });

    void marketplaceNotifications
      .installFailed(db, operation.companyId, catalogItem.name, message)
      .catch((err) => logger.error({ err }, "marketplace notification failed"));
  }
}
