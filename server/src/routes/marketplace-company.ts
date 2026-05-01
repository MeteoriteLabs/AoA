/**
 * @fileoverview Company-scoped marketplace routes (settings + updates).
 * Mounted under /api/companies/:companyId/marketplace (mergeParams: true).
 *
 * GET  /settings        — get company marketplace settings
 * PATCH /settings       — update company marketplace settings
 * GET  /updates         — list pending updates (stub, filled in Task 4)
 * POST /request-install — team_member install request (stub, filled in Task 10)
 */
import { Router } from "express";
import type { Db } from "@armyofagents/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { marketplaceSettingsService } from "../services/marketplace-settings.js";

export interface MarketplaceCompanyRoutesDeps {
  db: Db;
  catalogService: unknown; // typed properly in later tasks
}

export function createMarketplaceCompanyRouter(deps: MarketplaceCompanyRoutesDeps): Router {
  const { db } = deps;
  const router = Router({ mergeParams: true });
  const svc = marketplaceSettingsService(db);

  // ── Settings ──────────────────────────────────────────────────────────────

  router.get("/settings", async (req, res) => {
    assertBoard(req);
    const companyId = (req.params as Record<string, string>).companyId;
    assertCompanyAccess(req, companyId);

    const settings = await svc.get(companyId);
    res.json(settings);
  });

  router.patch("/settings", async (req, res) => {
    assertBoard(req);
    const companyId = (req.params as Record<string, string>).companyId;
    assertCompanyAccess(req, companyId);

    const patch = req.body as Record<string, unknown>;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      res.status(400).json({ error: "Request body must be a settings object" });
      return;
    }

    const updated = await svc.patch(companyId, patch);
    res.json(updated);
  });

  // ── Updates (stub — filled in Task 4) ────────────────────────────────────

  router.get("/updates", async (req, res) => {
    assertBoard(req);
    const companyId = (req.params as Record<string, string>).companyId;
    assertCompanyAccess(req, companyId);
    res.json([]);
  });

  // ── Request install (stub — filled in Task 10) ────────────────────────────

  router.post("/request-install", async (req, res) => {
    assertBoard(req);
    const companyId = (req.params as Record<string, string>).companyId;
    assertCompanyAccess(req, companyId);
    res.status(202).json({ queued: true });
  });

  return router;
}
