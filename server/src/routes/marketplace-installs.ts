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
 * All install types (skill / agent / team / plugin) flow through `dispatchInstall`.
 * The route layer pre-curries `installPlugin` (and the team installer's
 * `installPlugin` cascade hook) with `pluginLoader`, which is route-layer
 * scoped and not available to the orchestrator.
 */

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@armyofagents/db";
import type { MarketplaceCatalogService } from "../services/aoa-marketplace.js";
import { resolveInstallPlan } from "../services/marketplace-install/resolver.js";
import {
  startInstallOperation,
  dispatchInstall,
  installSkill,
  installAgent,
  installTeam,
  installMarketplacePlugin,
  findOperationById,
  type Installers,
} from "../services/marketplace-install/index.js";
import type { PluginLoaderLike } from "../services/marketplace-install/plugin-installer.js";
import { publishLiveEvent } from "../services/live-events.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { permissionService } from "../services/permissions.js";
import { marketplaceSettingsService } from "../services/marketplace-settings.js";
import { marketplaceNotifications } from "../services/marketplace-notifications.js";
import { logger } from "../middleware/logger.js";

/**
 * Check if a user role can install a given catalog item type.
 * @param role - effective user role ('founder' | 'team_lead' | 'team_member')
 * @param type - catalog item type ('skill' | 'agent' | 'team' | 'plugin')
 * @param allowTeamLeadPlugins - from company marketplace settings
 */
export function canInstallType(
  role: string,
  type: string,
  allowTeamLeadPlugins: boolean,
): boolean {
  if (role === "founder") return true;
  if (role === "team_lead") {
    if (type === "plugin") return allowTeamLeadPlugins;
    return true; // skill, agent, team
  }
  return false; // team_member
}

/**
 * Resolve the install access decision for a role + type + settings combination.
 * Returns:
 *   "allow"   — proceed with install
 *   "request" — needs approval: team_member with request permission, OR
 *               team_lead when requireFounderApproval=true
 *   "deny"    — insufficient permissions: return 403
 */
export function resolveInstallDecision(
  role: string,
  type: string,
  settings: {
    allowTeamLeadPlugins: boolean;
    teamMemberCanRequestInstall: boolean;
    requireFounderApproval: boolean;
  },
): "allow" | "request" | "deny" {
  if (role === "founder") return "allow";
  if (settings.requireFounderApproval && role === "team_lead") return "request";
  if (canInstallType(role, type, settings.allowTeamLeadPlugins)) return "allow";
  if (role === "team_member" && settings.teamMemberCanRequestInstall) return "request";
  return "deny";
}

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

    // RBAC check — skip for local_implicit actors (full access by design) and instance admins
    // Agent actors (type !== "board") also bypass — they use separate permission paths
    if (
      req.actor.type === "board" &&
      req.actor.source !== "local_implicit" &&
      !req.actor.isInstanceAdmin
    ) {
      const effectiveRole = await permissionService(db).getEffectiveRole(companyId, userId);
      const settings = await marketplaceSettingsService(db).get(companyId);

      const decision = resolveInstallDecision(effectiveRole, catalogItem.type, settings);
      if (decision === "request") {
        // Persist a pending operation row so founders can review it via GET /install/:operationId,
        // then notify founders that a team member has requested the install.
        let requestedOp;
        try {
          requestedOp = await startInstallOperation({
            request, catalogItem, companyId, requestedByUserId: userId, db,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.status(500).json({ error: `Failed to queue install request: ${message}` });
          return;
        }
        void marketplaceNotifications
          .installRequested(db, companyId, catalogItem.name, userId, requestedOp.id)
          .catch((err) => logger.error({ err }, "marketplace installRequested notification failed"));
        res.status(202).json({
          queued: true,
          operationId: requestedOp.id,
          status: requestedOp.status,
          message: "Install request submitted. A founder will review it.",
        });
        return;
      }
      if (decision === "deny") {
        res.status(403).json({ error: `Insufficient permissions to install ${catalogItem.type}` });
        return;
      }
    }

    if ((catalogItem.type === "agent" || catalogItem.type === "team") && !request.targetDepartmentId) {
      res.status(400).json({ error: `targetDepartmentId required for ${catalogItem.type} installs` });
      return;
    }

    const operation = await startInstallOperation({
      request, catalogItem, companyId, requestedByUserId: userId, db,
    });

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
      installPlugin: (opts) => installMarketplacePlugin({ ...opts, pluginLoader }),
    };

    void dispatchInstall({ operation, catalogItem, catalog, db, installers, publishLiveEvent });

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
