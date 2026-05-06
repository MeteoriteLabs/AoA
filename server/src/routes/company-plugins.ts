/**
 * Company-scoped plugin management routes.
 *
 * Mounted at /api/companies/:companyId/plugins by app.ts.
 *
 * These routes handle plugin management from the company's perspective:
 * - List installed plugins for this company
 * - Read/write per-company plugin config (plugin_config table, company-scoped)
 * - Trigger upgrade (delegates to lifecycle.upgrade())
 * - Approve new capabilities (upgrade_pending → ready)
 * - Rollback to previous version
 * - Toggle plugin enabled/disabled for this company
 */
import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  plugins,
  pluginConfig,
  pluginCompanySettings,
  pluginVersionSnapshots,
} from "@armyofagents/db";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import type { PluginLifecycleManager } from "../services/plugin-lifecycle.js";
import type { PluginLoader } from "../services/plugin-loader.js";

export function companyPluginRoutes(
  db: Db,
  lifecycle: PluginLifecycleManager,
  loader: PluginLoader,
) {
  const router = Router({ mergeParams: true });

  // ── GET /api/companies/:companyId/plugins ────────────────────────────────
  // List all plugins installed for this company with their settings overlay.
  router.get("/", async (req, res) => {
    assertBoard(req);
    const params = req.params as Record<string, string>;
    const companyId = params.companyId;
    assertCompanyAccess(req, companyId);

    const installed = await db
      .select()
      .from(plugins)
      .where(eq(plugins.companyId, companyId))
      .orderBy(plugins.installedAt);

    const settings = await db
      .select()
      .from(pluginCompanySettings)
      .where(eq(pluginCompanySettings.companyId, companyId));

    const configs = await db
      .select()
      .from(pluginConfig)
      .where(eq(pluginConfig.companyId, companyId));

    const settingsMap = new Map(settings.map((s) => [s.pluginId, s]));
    const configMap = new Map(configs.map((c) => [c.pluginId, c]));

    const result = installed.map((plugin) => ({
      id: plugin.id,
      companyId: plugin.companyId,
      catalogItemId: plugin.catalogItemId,
      pluginKey: plugin.pluginKey,
      packageName: plugin.packageName,
      version: plugin.version,
      status: plugin.status,
      categories: plugin.categories,
      manifest: plugin.manifestJson,
      lastError: plugin.lastError,
      installedAt: plugin.installedAt,
      updatedAt: plugin.updatedAt,
      enabled: settingsMap.get(plugin.id)?.enabled ?? true,
      configJson: configMap.get(plugin.id)?.configJson ?? {},
    }));

    res.json(result);
  });

  // ── GET /api/companies/:companyId/plugins/:pluginId/config ───────────────
  router.get("/:pluginId/config", async (req, res) => {
    assertBoard(req);
    const { companyId, pluginId } = req.params as { companyId: string; pluginId: string };
    assertCompanyAccess(req, companyId);

    const [config] = await db
      .select()
      .from(pluginConfig)
      .where(and(eq(pluginConfig.companyId, companyId), eq(pluginConfig.pluginId, pluginId)));

    res.json({ configJson: config?.configJson ?? {} });
  });

  // ── POST /api/companies/:companyId/plugins/:pluginId/config ──────────────
  // Upsert per-company plugin config.
  router.post("/:pluginId/config", async (req, res) => {
    assertBoard(req);
    const { companyId, pluginId } = req.params as { companyId: string; pluginId: string };
    assertCompanyAccess(req, companyId);

    const { configJson } = req.body as { configJson: Record<string, unknown> };
    if (!configJson || typeof configJson !== "object") {
      res.status(400).json({ error: "configJson must be an object" });
      return;
    }

    // Verify plugin belongs to this company
    const [plugin] = await db
      .select({ id: plugins.id })
      .from(plugins)
      .where(and(eq(plugins.companyId, companyId), eq(plugins.id, pluginId)));

    if (!plugin) {
      res.status(404).json({ error: "Plugin not found for this company" });
      return;
    }

    const [existing] = await db
      .select()
      .from(pluginConfig)
      .where(and(eq(pluginConfig.companyId, companyId), eq(pluginConfig.pluginId, pluginId)));

    if (existing) {
      const [updated] = await db
        .update(pluginConfig)
        .set({ configJson, updatedAt: new Date() })
        .where(eq(pluginConfig.id, existing.id))
        .returning();
      res.json({ configJson: updated.configJson });
    } else {
      const [inserted] = await db
        .insert(pluginConfig)
        .values({ companyId, pluginId, configJson })
        .returning();
      res.json({ configJson: inserted.configJson });
    }
  });

  // ── POST /api/companies/:companyId/plugins/:pluginId/upgrade ─────────────
  // Trigger upgrade to the latest catalog version.
  // Returns { version, status: 'ready' | 'upgrade_pending', delta? }
  // Note: lifecycle.upgrade() saves the rollback snapshot internally.
  router.post("/:pluginId/upgrade", async (req, res) => {
    assertBoard(req);
    const { companyId, pluginId } = req.params as { companyId: string; pluginId: string };
    assertCompanyAccess(req, companyId);

    const { version } = req.body as { version?: string };

    if (version !== undefined && typeof version !== "string") {
      res.status(400).json({ error: "version must be a string" });
      return;
    }

    const [plugin] = await db
      .select()
      .from(plugins)
      .where(and(eq(plugins.companyId, companyId), eq(plugins.id, pluginId)));

    if (!plugin) {
      res.status(404).json({ error: "Plugin not found for this company" });
      return;
    }

    try {
      const result = await lifecycle.upgrade(plugin.id, version);
      res.json(result);
    } catch (err) {
      // Auto-rollback: find the most recent snapshot and reinstall
      const [snapshot] = await db
        .select()
        .from(pluginVersionSnapshots)
        .where(
          and(
            eq(pluginVersionSnapshots.companyId, companyId),
            eq(pluginVersionSnapshots.pluginId, pluginId),
          ),
        )
        .orderBy(desc(pluginVersionSnapshots.createdAt))
        .limit(1);

      if (snapshot) {
        try {
          await loader.installPlugin({
            packageName: snapshot.packageName,
            version: snapshot.version,
            companyId,
          });
          await lifecycle.load(plugin.id);
          await db
            .delete(pluginVersionSnapshots)
            .where(eq(pluginVersionSnapshots.id, snapshot.id));
        } catch (revertErr) {
          // Plugin is in broken state — log but don't mask the original error
          console.error("Auto-rollback failed", revertErr);
        }
      }

      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // ── POST /api/companies/:companyId/plugins/:pluginId/upgrade/approve ─────
  // Approve new capabilities and transition upgrade_pending → ready.
  router.post("/:pluginId/upgrade/approve", async (req, res) => {
    assertBoard(req);
    const { companyId, pluginId } = req.params as { companyId: string; pluginId: string };
    assertCompanyAccess(req, companyId);

    const [plugin] = await db
      .select()
      .from(plugins)
      .where(and(eq(plugins.companyId, companyId), eq(plugins.id, pluginId)));

    if (!plugin) {
      res.status(404).json({ error: "Plugin not found for this company" });
      return;
    }
    if (plugin.status !== "upgrade_pending") {
      res.status(400).json({ error: `Plugin is not in upgrade_pending state (current: ${plugin.status})` });
      return;
    }

    await lifecycle.load(plugin.id); // transitions upgrade_pending → ready, starts worker
    res.json({ status: "ready" });
  });

  // ── POST /api/companies/:companyId/plugins/:pluginId/upgrade/rollback ────
  // Cancel upgrade — restore from snapshot, transition back to ready.
  router.post("/:pluginId/upgrade/rollback", async (req, res) => {
    assertBoard(req);
    const { companyId, pluginId } = req.params as { companyId: string; pluginId: string };
    assertCompanyAccess(req, companyId);

    const [plugin] = await db
      .select({ id: plugins.id })
      .from(plugins)
      .where(and(eq(plugins.companyId, companyId), eq(plugins.id, pluginId)));

    if (!plugin) {
      res.status(404).json({ error: "Plugin not found for this company" });
      return;
    }

    const [snapshot] = await db
      .select()
      .from(pluginVersionSnapshots)
      .where(
        and(
          eq(pluginVersionSnapshots.companyId, companyId),
          eq(pluginVersionSnapshots.pluginId, pluginId),
        ),
      )
      .orderBy(desc(pluginVersionSnapshots.createdAt))
      .limit(1);

    if (!snapshot) {
      res.status(404).json({ error: "No rollback snapshot found for this plugin" });
      return;
    }

    try {
      await loader.installPlugin({
        packageName: snapshot.packageName,
        version: snapshot.version,
        companyId,
      });

      const [updatedPlugin] = await db
        .select()
        .from(plugins)
        .where(and(eq(plugins.companyId, companyId), eq(plugins.id, pluginId)));

      if (updatedPlugin) await lifecycle.load(updatedPlugin.id);

      res.json({ status: "ready", version: snapshot.version });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  // ── PATCH /api/companies/:companyId/plugins/:pluginId/settings ───────────
  // Toggle enabled/disabled for this company.
  router.patch("/:pluginId/settings", async (req, res) => {
    assertBoard(req);
    const { companyId, pluginId } = req.params as { companyId: string; pluginId: string };
    assertCompanyAccess(req, companyId);

    const { enabled } = req.body as { enabled: boolean };
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "enabled must be a boolean" });
      return;
    }

    const [existing] = await db
      .select()
      .from(pluginCompanySettings)
      .where(
        and(
          eq(pluginCompanySettings.companyId, companyId),
          eq(pluginCompanySettings.pluginId, pluginId),
        ),
      );

    if (existing) {
      const [updated] = await db
        .update(pluginCompanySettings)
        .set({ enabled, updatedAt: new Date() })
        .where(eq(pluginCompanySettings.id, existing.id))
        .returning();
      res.json({ enabled: updated.enabled });
    } else {
      const [inserted] = await db
        .insert(pluginCompanySettings)
        .values({ companyId, pluginId, enabled })
        .returning();
      res.json({ enabled: inserted.enabled });
    }
  });

  return router;
}
