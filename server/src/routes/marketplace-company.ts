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
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { type Db, marketplacePendingUpdates, companySkills, plugins } from "@armyofagents/db";
import { assertBoard, assertCanManageInstanceSettings, assertCompanyAccess } from "./authz.js";
import { marketplaceSettingsService } from "../services/marketplace-settings.js";
import { computeSectionDiff, applyMergeDecisions } from "../services/marketplace-merge.js";
import { marketplaceNotifications } from "../services/marketplace-notifications.js";
import {
  applySkillUpdate,
  SkillCustomizedError,
  SkillDeletedError,
} from "../services/marketplace-install/skill-auto-updater.js";
import type { MarketplaceCatalogFile } from "@armyofagents/shared";
import type { PluginLifecycleManager } from "../services/plugin-lifecycle.js";

export interface MarketplaceCompanyRoutesDeps {
  db: Db;
  catalogService: { readCache(): Promise<MarketplaceCatalogFile | null> };
  pluginLifecycle?: PluginLifecycleManager;
  pluginLoader?: {
    installPlugin(options: {
      packageName: string;
      version: string;
      companyId: string;
    }): Promise<unknown>;
  };
  pluginRollback?: {
    getRollbackTarget(pluginId: string): Promise<{ packageName: string; version: string } | null>;
  };
}

const MarketplaceSettingsPatchSchema = z.object({
  pluginUpdatePolicy:          z.enum(["auto_patch", "auto_minor", "notify_all"]).optional(),
  skillUpdatePolicy:           z.literal("notify").optional(),
  agentUpdatePolicy:           z.enum(["auto", "notify"]).optional(),
  teamUpdatePolicy:            z.enum(["auto", "notify"]).optional(),
  showTrustBadges:             z.boolean().optional(),
  showSourceInfo:              z.boolean().optional(),
  allowTeamLeadPlugins:        z.boolean().optional(),
  teamMemberCanRequestInstall: z.boolean().optional(),
  requireFounderApproval:      z.boolean().optional(),
  catalogRefreshHours:         z.union([z.literal(6), z.literal(12), z.literal(24)]).optional(),
  updateCheckHours:            z.union([z.literal(6), z.literal(12), z.literal(24)]).optional(),
  updateWindow:                z.enum(["anytime", "off_hours", "weekends"]).optional(),
});

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

    const parsed = MarketplaceSettingsPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid settings", details: parsed.error.flatten() });
      return;
    }

    const updated = await svc.patch(companyId, parsed.data);
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

    if (update.status !== "pending" && update.status !== "conflict") {
      res.status(409).json({ error: `Update is not pending (current: ${update.status})` });
      return;
    }

    if (update.itemType === "plugin") {
      assertCanManageInstanceSettings(req);

      if (!deps.pluginLifecycle) {
        res.status(501).json({ error: "Plugin update apply is not configured on this server" });
        return;
      }

      let [plugin] = await db
        .select()
        .from(plugins)
        .where(
          and(
            eq(plugins.companyId, companyId),
            eq(plugins.catalogItemId, update.catalogItemId),
          ),
        )
        .limit(1);

      if (!plugin) {
        const catalog = await deps.catalogService.readCache();
        const catalogItem = catalog?.items.find((item) => item.id === update.catalogItemId);
        const packageName = catalogItem?.npm?.packageName;
        if (packageName) {
          [plugin] = await db
            .select()
            .from(plugins)
            .where(
              and(
                eq(plugins.companyId, companyId),
                eq(plugins.packageName, packageName),
              ),
            )
            .limit(1);
        }
      }

      if (!plugin) {
        res.status(404).json({ error: "Installed plugin not found for this marketplace update" });
        return;
      }

      let result: Awaited<ReturnType<PluginLifecycleManager["upgrade"]>>;
      try {
        result = await deps.pluginLifecycle.upgrade(plugin.id, update.latestVersion);
      } catch (err) {
        const rollbackTarget = await deps.pluginRollback
          ?.getRollbackTarget(plugin.id)
          .catch(() => null);
        if (rollbackTarget && deps.pluginLoader) {
          try {
            await deps.pluginLoader.installPlugin({
              packageName: rollbackTarget.packageName,
              version: rollbackTarget.version,
              companyId,
            });
            await deps.pluginLifecycle.load(plugin.id);
          } catch (rollbackErr) {
            console.error("Marketplace plugin update rollback failed", rollbackErr);
          }
        }
        res.status(400).json({
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      if (result.status === "ready") {
        await db
          .update(marketplacePendingUpdates)
          .set({ status: "applied", updatedAt: new Date() })
          .where(
            and(
              eq(marketplacePendingUpdates.id, id),
              eq(marketplacePendingUpdates.companyId, companyId),
            ),
          );
      }

      res.json({
        ok: true,
        pluginId: plugin.id,
        version: result.version,
        status: result.status,
        delta: result.delta,
      });
      return;
    }

    if (update.itemType === "skill") {
      const catalog = await deps.catalogService.readCache();
      const catalogItem = catalog?.items.find((item) => item.id === update.catalogItemId);
      if (!catalogItem) {
        res.status(422).json({ error: "Catalog item not found — catalog may be stale." });
        return;
      }
      try {
        await applySkillUpdate({
          db,
          catalogItemId: update.catalogItemId,
          catalogItemName: update.catalogItemName,
          companyId,
          catalogItem,
        });
        res.json({ ok: true, applied: true });
      } catch (err) {
        if (err instanceof SkillCustomizedError) {
          res.status(409).json({
            error: "Skill customized. Manual merge required.",
            code: "SKILL_CUSTOMIZED",
          });
        } else if (err instanceof SkillDeletedError) {
          res.status(410).json({ error: "Skill removed.", code: "SKILL_DELETED" });
        } else {
          res.status(500).json({ error: err instanceof Error ? err.message : "Apply failed" });
        }
      }
      return;
    }

    // For agent/team snapshot types: not implemented at V1.
    res.status(501).json({
      error: "Direct apply not supported for agent/team updates. Use POST /updates/:id/merge for reviewed merge.",
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

    if (Object.keys(decisions).length === 0) {
      res.status(400).json({ error: "decisions must not be empty" });
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

    // Both writes are wrapped in a transaction: if the server crashes after the skill
    // update but before the pending-update status change, the transaction rolls back
    // and neither write is committed — the pending row stays "pending" and can be retried.
    await db.transaction(async (tx) => {
      await tx
        .update(companySkills)
        .set({ markdown: merged, sourceRef: update.latestVersion, customized: true, updatedAt: new Date() })
        .where(eq(companySkills.id, skill.id));

      await tx
        .update(marketplacePendingUpdates)
        .set({ status: "applied", updatedAt: new Date() })
        .where(eq(marketplacePendingUpdates.id, id));
    });

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

    const requestingUserId = req.actor.userId ?? "unknown";

    // Notify founders of the install request via the distinct install_requested type
    void marketplaceNotifications
      .installRequested(db, companyId, itemName, requestingUserId)
      .catch(() => {});

    res.status(202).json({ queued: true });
  });

  return router;
}
