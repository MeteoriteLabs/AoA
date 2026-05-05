import { z } from "zod";

// Mirror of catalog repo's CatalogItem schema. Keep in sync.
// Schema version bumps require coordinated update.

export const CATALOG_SCHEMA_VERSION_MIN = "1.0.0";
export const CATALOG_SCHEMA_VERSION_MAX = "1.0.0"; // bump as compat changes

export const MarketplaceCategorySchema = z.enum([
  "engineering",
  "marketing",
  "support",
  "sales",
  "operations",
  "design",
  "data",
  "productivity",
  "integrations",
  "workflows",
]);
export type MarketplaceCategory = z.infer<typeof MarketplaceCategorySchema>;

export const MarketplaceTagSchema = z.enum([
  "new",
  "featured",
  "enterprise",
  "solo-friendly",
  "requires-api-key",
  "official",
  "partner",
]);
export type MarketplaceTag = z.infer<typeof MarketplaceTagSchema>;

export const MarketplaceTrustTierSchema = z.enum([
  "verified",
  "community",
  "unverified",
]);
export type MarketplaceTrustTier = z.infer<typeof MarketplaceTrustTierSchema>;

export const MarketplaceItemTypeSchema = z.enum([
  "skill",
  "plugin",
  "agent",
  "team",
]);
export type MarketplaceItemType = z.infer<typeof MarketplaceItemTypeSchema>;

export const MarketplaceCatalogItemSchema = z.object({
  id: z.string(),
  type: MarketplaceItemTypeSchema,
  name: z.string(),
  description: z.string(),
  version: z.string(),
  source: z.object({
    adapter: z.string(),
    url: z.string(),
    locator: z.string(),
    commitSha: z.string().optional(), // git SHA at aggregation time
  }),
  // Only present on plugin items, mirrors plugin.npm.{packageName,version}
  npm: z
    .object({
      packageName: z.string(),
      version: z.string(),
    })
    .optional(),
  // Only present on snapshot items (skill/agent/team), commit-pinned URL to fetchable file
  resourceUrl: z.string().optional(),
  trust: z.object({
    tier: MarketplaceTrustTierSchema,
    source: z.string(),
    reviewer: z.string().optional(),
    reviewedAt: z.string().optional(),
    reviewedVersion: z.string().optional(),
  }),
  status: z.enum(["active", "deprecated", "quarantined"]),
  addedAt: z.string(),
  capabilities: z
    .array(
      z.object({
        id: z.string(),
        description: z.string(),
      }),
    )
    .optional(),
  requires: z
    .array(
      z.object({
        type: z.string(),
        id: z.string(),
        versionRange: z.string().optional(),
      }),
    )
    .optional(),
  content: z
    .object({
      inline: z.string().optional(),
      url: z.string().optional(),
    })
    .optional(),
  category: MarketplaceCategorySchema,
  tags: z.array(MarketplaceTagSchema),
  featured: z.boolean().optional(),
});
export type MarketplaceCatalogItem = z.infer<typeof MarketplaceCatalogItemSchema>;

// Alias for ergonomic imports throughout marketplace-install services
export type CatalogItem = MarketplaceCatalogItem;

export const MarketplaceCatalogFileSchema = z.object({
  schemaVersion: z.string(),
  generatedAt: z.string(),
  itemCount: z.number(),
  items: z.array(MarketplaceCatalogItemSchema),
});
export type MarketplaceCatalogFile = z.infer<typeof MarketplaceCatalogFileSchema>;

export interface CatalogSyncStatus {
  lastSyncedAt: string;
  lastSyncStatus: "success" | "failure";
  lastSyncError?: string | null;
  source: "cdn" | "bundled";
  schemaVersion: string;
  itemCount: number;
}

export function isSchemaVersionSupported(version: string): boolean {
  // Strict V1: only 1.0.0 supported.
  return version === CATALOG_SCHEMA_VERSION_MIN;
}

export interface MarketplaceSettings {
  // Section 1: Updates
  pluginUpdatePolicy: "auto_patch" | "auto_minor" | "notify_all";
  skillUpdatePolicy: "auto" | "notify";
  agentUpdatePolicy: "auto" | "notify";
  teamUpdatePolicy: "auto" | "notify";
  // Section 2: Access
  showTrustBadges: boolean;
  showSourceInfo: boolean;
  allowTeamLeadPlugins: boolean;
  teamMemberCanRequestInstall: boolean;
  requireFounderApproval: boolean;
  // Section 3: Catalog refresh
  catalogRefreshHours: 6 | 12 | 24;
  updateCheckHours: 6 | 12 | 24;
  updateWindow: "anytime" | "off_hours" | "weekends";
}

export const MARKETPLACE_SETTINGS_DEFAULTS: MarketplaceSettings = {
  pluginUpdatePolicy: "auto_minor",
  skillUpdatePolicy: "notify",
  agentUpdatePolicy: "notify",
  teamUpdatePolicy: "notify",
  showTrustBadges: true,
  showSourceInfo: true,
  allowTeamLeadPlugins: false,
  teamMemberCanRequestInstall: false,
  requireFounderApproval: false,
  catalogRefreshHours: 6,
  updateCheckHours: 24,
  updateWindow: "anytime",
};

export type PendingUpdateStatus = "pending" | "dismissed" | "applied" | "conflict";
export type PendingUpdateType = "skill" | "agent" | "team" | "plugin";

export interface PendingUpdate {
  id: string;
  companyId: string;
  catalogItemId: string;
  catalogItemName: string;
  itemType: PendingUpdateType;
  currentVersion: string;
  latestVersion: string;
  status: PendingUpdateStatus;
  detectedAt: string;
  updatedAt: string;
}
