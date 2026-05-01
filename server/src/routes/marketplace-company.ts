/**
 * @fileoverview Company-scoped marketplace routes (settings + updates).
 * Mounted under /api/companies/:companyId/marketplace (mergeParams: true).
 *
 * GET  /settings          — get company marketplace settings
 * PATCH /settings         — update company marketplace settings
 * GET  /updates           — list pending updates
 * POST /updates/:id/dismiss — dismiss a pending update
 * POST /updates/:id/apply   — apply a pending update (stub, filled in Task 11)
 * GET  /updates/:id/diff  — returns section-level diff for a skill update
 * POST /updates/:id/merge — apply merge decisions and save merged content
 * POST /request-install   — team_member install request (stub, filled in Task 10)
 */
import { Router } from "express";
import { and, eq, ne } from "drizzle-orm";
import { type Db, marketplacePendingUpdates, companySkills } from "@armyofagents/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { marketplaceSettingsService } from "../services/marketplace-settings.js";
import { computeSectionDiff, applyMergeDecisions } from "../services/marketplace-merge.js";
import { marketplaceNotifications } from "../services/marketplace-notifications.js";
import type { MarketplaceCatalogFile } from "@armyofagents/shared";

export interface MarketplaceCompanyRoutesDeps {
  db: Db;
  catalogService: { readCache(): Promise<MarketplaceCatalogFile | null> };
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

  // POST /updates/:id/apply
  router.post("/updates/:id/apply", async (req, res) => {
    assertBoard(req);
    const companyId = (req.params as Record<string, string>).companyId;
    assertCompanyAccess(req, companyId);

    const { id } = req.params as { id: string };
    const [update] = await db
      .select()
      .from(marketplacePendingUpdates)
      .where(
        and(
          eq(marketplacePendingUpdates.id, id),
          eq(marketplacePendingUpdates.companyId, companyId),
        ),
      );

    if (!update) {
      res.status(404).json({ error: "Update not found" });
      return;
    }

    if (update.itemType === "plugin") {
      // Plugin updates handled via POST /api/plugins/:pluginId/upgrade
      // Return redirect hint for the UI
      res.status(303).json({
        redirect: `/api/plugins/${update.catalogItemId}/upgrade`,
        message: "Use POST /api/plugins/:pluginId/upgrade to apply plugin updates",
      });
      return;
    }

    // For snapshot types (skill/agent/team): use POST /updates/:id/merge for reviewed merges.
    // Direct auto-apply is not implemented at V1.
    res.status(501).json({
      error: "Direct apply not supported for skill/agent/team updates. Use POST /updates/:id/merge for reviewed merge.",
    });
  });

  // GET /updates/:id/diff — returns section-level diff for a skill update
  router.get("/updates/:id/diff", async (req, res) => {
    assertBoard(req);
    const companyId = (req.params as Record<string, string>).companyId;
    assertCompanyAccess(req, companyId);

    const { id } = req.params as { id: string };
    const [update] = await db
      .select()
      .from(marketplacePendingUpdates)
      .where(
        and(
          eq(marketplacePendingUpdates.id, id),
          eq(marketplacePendingUpdates.companyId, companyId),
        ),
      );

    if (!update) {
      res.status(404).json({ error: "Update not found" });
      return;
    }

    if (update.itemType !== "skill") {
      res.status(400).json({ error: "Section diff only supported for skill updates" });
      return;
    }

    // Get current installed skill content
    const [skill] = await db
      .select({ markdown: companySkills.markdown })
      .from(companySkills)
      .where(
        and(
          eq(companySkills.companyId, companyId),
          eq(companySkills.sourceLocator, update.catalogItemId),
        ),
      );

    if (!skill) {
      res.status(404).json({ error: "Installed skill not found" });
      return;
    }

    // Fetch latest from catalog
    const catalog = await deps.catalogService.readCache();
    const catalogItem = catalog?.items.find((i) => i.id === update.catalogItemId);
    if (!catalogItem?.resourceUrl) {
      res.status(503).json({ error: "Catalog item resource URL not available" });
      return;
    }

    try {
      const upstreamRes = await fetch(catalogItem.resourceUrl as string, {
        signal: AbortSignal.timeout(15000),
      });
      if (!upstreamRes.ok) throw new Error(`Fetch failed: ${upstreamRes.status}`);
      const upstreamContent = await upstreamRes.text();

      const diff = computeSectionDiff(skill.markdown ?? "", upstreamContent);
      res.json({ diff, currentVersion: update.currentVersion, latestVersion: update.latestVersion });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Failed to fetch upstream content: ${message}` });
    }
  });

  // POST /updates/:id/merge — apply merge decisions and save
  router.post("/updates/:id/merge", async (req, res) => {
    assertBoard(req);
    const companyId = (req.params as Record<string, string>).companyId;
    assertCompanyAccess(req, companyId);

    const { id } = req.params as { id: string };
    const { decisions } = req.body as { decisions?: Record<string, "mine" | "theirs"> };

    if (!decisions || typeof decisions !== "object" || Array.isArray(decisions)) {
      res.status(400).json({ error: "decisions must be an object" });
      return;
    }

    const invalidDecision = Object.values(decisions).find((v) => v !== "mine" && v !== "theirs");
    if (invalidDecision !== undefined) {
      res.status(400).json({ error: `Invalid decision value "${String(invalidDecision)}" — must be "mine" or "theirs"` });
      return;
    }

    const [update] = await db
      .select()
      .from(marketplacePendingUpdates)
      .where(
        and(
          eq(marketplacePendingUpdates.id, id),
          eq(marketplacePendingUpdates.companyId, companyId),
        ),
      );

    if (!update || update.itemType !== "skill") {
      res.status(404).json({ error: "Update not found or not a skill" });
      return;
    }

    const [skill] = await db
      .select({ id: companySkills.id, markdown: companySkills.markdown })
      .from(companySkills)
      .where(
        and(
          eq(companySkills.companyId, companyId),
          eq(companySkills.sourceLocator, update.catalogItemId),
        ),
      );

    if (!skill) {
      res.status(404).json({ error: "Installed skill not found" });
      return;
    }

    const catalog = await deps.catalogService.readCache();
    const catalogItem = catalog?.items.find((i) => i.id === update.catalogItemId);
    if (!catalogItem?.resourceUrl) {
      res.status(503).json({ error: "Catalog resource URL not available" });
      return;
    }

    const upstreamRes = await fetch(catalogItem.resourceUrl as string, {
      signal: AbortSignal.timeout(15000),
    });
    if (!upstreamRes.ok) {
      res.status(502).json({ error: "Failed to fetch upstream content" });
      return;
    }
    const upstreamContent = await upstreamRes.text();
    const diff = computeSectionDiff(skill.markdown ?? "", upstreamContent);
    const merged = applyMergeDecisions(diff, decisions);

    // Save merged content + update sourceRef to latestVersion
    await db
      .update(companySkills)
      .set({ markdown: merged, sourceRef: update.latestVersion })
      .where(eq(companySkills.id, skill.id));

    // Mark update as applied
    await db
      .update(marketplacePendingUpdates)
      .set({ status: "applied", updatedAt: new Date() })
      .where(eq(marketplacePendingUpdates.id, id));

    res.json({ ok: true });
  });

  // ── Request install ────────────────────────────────────────────────────────

  router.post("/request-install", async (req, res) => {
    assertBoard(req);
    const companyId = (req.params as Record<string, string>).companyId;
    assertCompanyAccess(req, companyId);

    const { catalogItemId } = req.body as { catalogItemId?: string };
    if (!catalogItemId) {
      res.status(400).json({ error: "catalogItemId is required" });
      return;
    }

    // Look up catalog item name for the notification
    const catalog = await deps.catalogService.readCache();
    const catalogItem = catalog?.items.find((i) => i.id === catalogItemId);
    const itemName = catalogItem?.name ?? catalogItemId;

    // Notify founders of the install request (reuses install_completed notification
    // with a "request:" prefix so founders can distinguish in their inbox)
    void marketplaceNotifications
      .installCompleted(db, companyId, `Install request: ${itemName}`, "request")
      .catch(() => {});

    res.status(202).json({ queued: true });
  });

  return router;
}
