import { eq, and } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { plugins } from "@armyofagents/db";
import type { CatalogItem } from "@armyofagents/shared";

/**
 * Subset of the real plugin runtime services the marketplace wrapper needs.
 * Real types live in server/src/services/plugin-loader.ts (DiscoveredPlugin),
 * server/src/services/plugin-registry.ts, and server/src/services/plugin-lifecycle.ts.
 */
export interface PluginLoaderLike {
  installPlugin(opts: {
    packageName?: string;
    version?: string;
    localPath?: string;
    installDir?: string;
  }): Promise<{
    packagePath: string;
    packageName: string;
    version: string;
    source: string;
    manifest: { id: string; [key: string]: unknown } | null;
  }>;
  registry: {
    getByKey(pluginKey: string): Promise<{ id: string; pluginKey: string } | null>;
    getById(pluginId: string): Promise<{ id: string; pluginKey: string; status?: string } | null>;
  };
  lifecycle: {
    load(pluginId: string): Promise<void>;
  };
}

export interface InstallMarketplacePluginOpts {
  catalogItem: CatalogItem;
  companyId: string;
  db: Db;
  pluginLoader: PluginLoaderLike;
}

export interface InstallMarketplacePluginResult {
  pluginId: string;
  alreadyInstalled: boolean;
}

/**
 * Marketplace wrapper around pluginLoader.installPlugin() + lifecycle.load().
 *
 * Mirrors the existing pattern in routes/plugins.ts:638-667:
 *   1. Idempotency check: if a plugin row exists at same version, return early.
 *   2. installPlugin → discovered (downloads npm package, validates manifest,
 *      writes plugins row in 'installed' state).
 *   3. registry.getByKey(discovered.manifest.id) → existing plugin row.
 *   4. lifecycle.load(existingPlugin.id) → transitions 'installed' → 'ready'.
 *
 * companyId is used only for idempotency lookup against the plugins table.
 * Once installed the plugin is instance-scoped (available to all companies).
 *
 * @throws Error if catalogItem.npm missing, manifest missing, or any step fails.
 */
export async function installMarketplacePlugin(
  opts: InstallMarketplacePluginOpts,
): Promise<InstallMarketplacePluginResult> {
  const { catalogItem, db, pluginLoader } = opts;

  if (catalogItem.type !== "plugin") {
    throw new Error(`installMarketplacePlugin called with non-plugin: ${catalogItem.id}`);
  }
  if (!catalogItem.npm) {
    throw new Error(`Plugin ${catalogItem.id} missing npm field — aggregator must populate npm.{packageName,version}`);
  }

  // 1. Idempotency: is this package already installed at the target version?
  const existing = await db
    .select()
    .from(plugins)
    .where(
      and(
        eq(plugins.packageName, catalogItem.npm.packageName),
        eq(plugins.version, catalogItem.npm.version),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return { pluginId: existing[0].id, alreadyInstalled: true };
  }

  // 2. Delegate to existing pipeline (returns DiscoveredPlugin)
  const discovered = await pluginLoader.installPlugin({
    packageName: catalogItem.npm.packageName,
    version: catalogItem.npm.version,
  });

  if (!discovered.manifest) {
    throw new Error(`Plugin installed but manifest is missing for ${catalogItem.id}`);
  }

  // 3. Look up the row that installPlugin just registered
  const existingPlugin = await pluginLoader.registry.getByKey(discovered.manifest.id);
  if (!existingPlugin) {
    throw new Error(`Plugin installed but not found in registry: pluginKey=${discovered.manifest.id}`);
  }

  // 4. Transition to ready state
  await pluginLoader.lifecycle.load(existingPlugin.id);

  return { pluginId: existingPlugin.id, alreadyInstalled: false };
}
