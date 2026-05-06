import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import type { PluginCategory, PluginStatus, PaperclipPluginManifestV1 } from "@armyofagents/shared";

/**
 * `plugins` table — stores one row per installed plugin.
 *
 * Plugins are scoped per company. The unique constraint is on
 * `(company_id, plugin_key)` (note: `company_id` is currently nullable
 * during backfill and will become NOT NULL in Task 3). The full manifest
 * is persisted as JSONB in `manifest_json` so the host can reconstruct
 * capability and UI slot information without loading the plugin package.
 *
 * @see PLUGIN_SPEC.md §21.3
 */
export const plugins = pgTable(
  "plugins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    catalogItemId: text("catalog_item_id"),
    pluginKey: text("plugin_key").notNull(),
    packageName: text("package_name").notNull(),
    version: text("version").notNull(),
    apiVersion: integer("api_version").notNull().default(1),
    categories: jsonb("categories").$type<PluginCategory[]>().notNull().default([]),
    manifestJson: jsonb("manifest_json").$type<PaperclipPluginManifestV1>().notNull(),
    status: text("status").$type<PluginStatus>().notNull().default("installed"),
    installOrder: integer("install_order"),
    /** Resolved package path for local-path installs; used to find worker entrypoint. */
    packagePath: text("package_path"),
    lastError: text("last_error"),
    installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // After backfill (Task 4), companyId will be NOT NULL.
    // For now: nullable so the migration applies without breaking existing rows.
    companyPluginKeyIdx: uniqueIndex("plugins_company_plugin_key_idx").on(
      table.companyId,
      table.pluginKey,
    ),
    statusIdx: index("plugins_status_idx").on(table.status),
  }),
);
