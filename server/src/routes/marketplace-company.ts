/**
 * @fileoverview Company-scoped marketplace routes (settings + updates).
 * Mounted under /api/companies/:companyId/marketplace (mergeParams: true).
 *
 * GET  /settings          — get company marketplace settings
 * PATCH /settings         — update company marketplace settings
 * GET  /updates           — list pending updates
 * POST /updates/:id/dismiss — dismiss a pending update
 * POST /updates/:id/apply   — apply a pending update (stub, filled in Task 11)
 * POST /request-install   — team_member install request (stub, filled in Task 10)
 */
import { Router } from "express";
import { and, eq, ne } from "drizzle-orm";
import { type Db, marketplacePendingUpdates } from "@armyofagents/db";
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

  // ── Updates ───────────────────────────────────────────────────────────────

  router.get("/updates", async (req, res) => {
    assertBoard(req);
    const companyId = (req.params as Record<string, string>).companyId;
    assertCompanyAccess(req, companyId);

    const typeFilter = req.query.type as string | undefined;
    const conditions = [
      eq(marketplacePendingUpdates.companyId, companyId),
      ne(marketplacePendingUpdates.status, "dismissed"),
      ne(marketplacePendingUpdates.status, "applied"),
    ];
    if (typeFilter) {
      conditions.push(eq(marketplacePendingUpdates.itemType, typeFilter));
    }

    const rows = await db.select().from(marketplacePendingUpdates).where(and(...conditions));
    res.json(rows);
  });

  // POST /updates/:id/dismiss
  router.post("/updates/:id/dismiss", async (req, res) => {
    assertBoard(req);
    const companyId = (req.params as Record<string, string>).companyId;
    assertCompanyAccess(req, companyId);

    const { id } = req.params as { id: string };
    await db
      .update(marketplacePendingUpdates)
      .set({ status: "dismissed", updatedAt: new Date() })
      .where(
        and(
          eq(marketplacePendingUpdates.id, id),
          eq(marketplacePendingUpdates.companyId, companyId),
        ),
      );
    res.json({ ok: true });
  });

  // POST /updates/:id/apply — stub (implemented in Task 11)
  router.post("/updates/:id/apply", async (req, res) => {
    assertBoard(req);
    const companyId = (req.params as Record<string, string>).companyId;
    assertCompanyAccess(req, companyId);
    res.status(501).json({ error: "Apply not yet implemented" });
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
