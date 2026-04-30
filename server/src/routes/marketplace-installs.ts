/**
 * @fileoverview Marketplace install REST API routes
 *
 * Mounted under /api/companies/:companyId/marketplace.
 * - POST /install — start install operation, return operation ID (202 Accepted)
 * - GET  /install/:operationId — operation status + cascade results
 * - GET  /resolve/:catalogItemId — preview install plan (cascade tree)
 *
 * All routes require board-level auth (assertBoard).
 * Per-company auth enforced via assertCompanyAccess on req.params.companyId.
 *
 * Plugin installs require pluginLoader injection (not available to the
 * orchestrator), so the route handler dispatches them through a local
 * `runPluginInstall` helper instead of `dispatchInstall`. Other types
 * (skill / agent / team) flow through the standard orchestrator path.
 */

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@armyofagents/db";
import type { MarketplaceCatalogService } from "../services/aoa-marketplace.js";
import type { CatalogItem } from "@armyofagents/shared";
import { resolveInstallPlan } from "../services/marketplace-install/resolver.js";
import {
  startInstallOperation,
  dispatchInstall,
  installSkill,
  installAgent,
  installTeam,
  installMarketplacePlugin,
  findOperationById,
  updateOperation,
  type Installers,
  type OperationRow,
} from "../services/marketplace-install/index.js";
import type { PluginLoaderLike } from "../services/marketplace-install/plugin-installer.js";
import { publishLiveEvent } from "../services/live-events.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";

const InstallRequestSchema = z.object({
  catalogItemId: z.string().min(1),
  targetDepartmentId: z.string().uuid().optional(),
  idempotencyKey: z.string().min(1).max(100).optional(),
});

export interface MarketplaceInstallRoutesDeps {
  db: Db;
  catalogService: MarketplaceCatalogService;
  pluginLoader: PluginLoaderLike;
}

export function createMarketplaceInstallRouter(deps: MarketplaceInstallRoutesDeps): Router {
  const { db, catalogService, pluginLoader } = deps;
  const router = Router({ mergeParams: true });

  router.get("/resolve/:catalogItemId", async (req, res) => {
    assertBoard(req);
    const companyId = (req.params as Record<string, string>).companyId;
    if (!companyId) {
      res.status(400).json({ error: "Company context required" });
      return;
    }
    assertCompanyAccess(req, companyId);

    const catalog = await catalogService.readCache();
    if (!catalog) {
      res.status(503).json({ error: "Catalog not yet synced" });
      return;
    }

    try {
      const plan = await resolveInstallPlan({
        catalogItemId: req.params.catalogItemId,
        catalog, db, companyId,
      });
      res.json(plan);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({ error: message });
    }
  });

  router.post("/install", async (req, res) => {
    assertBoard(req);
    const companyId = (req.params as Record<string, string>).companyId;
    const userId = req.actor.userId;
    if (!companyId || !userId) {
      res.status(400).json({ error: "Company + user context required" });
      return;
    }
    assertCompanyAccess(req, companyId);

    const parseResult = InstallRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "Invalid request", details: parseResult.error.flatten() });
      return;
    }
    const request = parseResult.data;

    const catalog = await catalogService.readCache();
    if (!catalog) {
      res.status(503).json({ error: "Catalog not yet synced" });
      return;
    }

    const catalogItem = catalog.items.find((i) => i.id === request.catalogItemId);
    if (!catalogItem) {
      res.status(404).json({ error: `Catalog item not found: ${request.catalogItemId}` });
      return;
    }

    if (catalogItem.type !== "plugin" && !request.targetDepartmentId) {
      res.status(400).json({ error: `targetDepartmentId required for ${catalogItem.type} installs` });
      return;
    }

    const operation = await startInstallOperation({
      request, catalogItem, companyId, requestedByUserId: userId, db,
    });

    if (catalogItem.type === "plugin") {
      void runPluginInstall(operation, catalogItem, companyId, db, pluginLoader);
    } else {
      const installers: Installers = {
        installSkill,
        installAgent,
        installTeam: (opts) =>
          installTeam({
            ...opts,
            installPlugin: async (pluginOpts) => {
              const r = await installMarketplacePlugin({
                catalogItem: pluginOpts.catalogItem,
                companyId: pluginOpts.companyId,
                db: pluginOpts.db,
                pluginLoader,
              });
              return { pluginId: r.pluginId, alreadyInstalled: r.alreadyInstalled };
            },
          }),
        installMarketplacePlugin: (opts) => installMarketplacePlugin({ ...opts, pluginLoader }),
      };

      void dispatchInstall({ operation, catalogItem, catalog, db, installers, publishLiveEvent });
    }

    res.status(202).json({ operationId: operation.id, status: operation.status });
  });

  router.get("/install/:operationId", async (req, res) => {
    assertBoard(req);
    const companyId = (req.params as Record<string, string>).companyId;
    if (!companyId) {
      res.status(400).json({ error: "Company context required" });
      return;
    }
    assertCompanyAccess(req, companyId);

    const op = await findOperationById(db, req.params.operationId, companyId);
    if (!op) {
      res.status(404).json({ error: "Operation not found" });
      return;
    }
    res.json(op);
  });

  return router;
}

/**
 * Plugin-install path. Mirrors `dispatchInstall` but injects pluginLoader
 * (which is route-layer scoped — not available to the orchestrator).
 */
async function runPluginInstall(
  operation: OperationRow,
  catalogItem: CatalogItem,
  companyId: string,
  db: Db,
  pluginLoader: PluginLoaderLike,
): Promise<void> {
  publishLiveEvent({
    companyId,
    type: "marketplace.install.started",
    payload: { operationId: operation.id, catalogItemId: catalogItem.id },
  });
  try {
    await updateOperation(db, operation.id, { status: "running" });
    const result = await installMarketplacePlugin({ catalogItem, companyId, db, pluginLoader });
    await updateOperation(db, operation.id, {
      status: "success", resultEntityId: result.pluginId, completedAt: new Date(),
    });
    publishLiveEvent({
      companyId,
      type: "marketplace.install.completed",
      payload: { operationId: operation.id, catalogItemId: catalogItem.id, resultEntityId: result.pluginId },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateOperation(db, operation.id, {
      status: "failure", errorMessage: message, completedAt: new Date(),
    });
    publishLiveEvent({
      companyId,
      type: "marketplace.install.failed",
      payload: { operationId: operation.id, catalogItemId: catalogItem.id, error: message },
    });
  }
}
