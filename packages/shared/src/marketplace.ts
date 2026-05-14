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
  "requires-cli-tooling",
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

export const MarketplaceProviderRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  homepageUrl: z.string().url().optional(),
  logoUrl: z.string().url().optional(),
  fallbackInitials: z.string(),
});
export type MarketplaceProviderRef = z.infer<typeof MarketplaceProviderRefSchema>;

export const MarketplaceSkillBundleSchema = z.object({
  type: z.literal("github-directory"),
  repo: z.string(),
  commitSha: z.string(),
  path: z.string(),
  treeUrl: z.string().url(),
});
export type MarketplaceSkillBundle = z.infer<typeof MarketplaceSkillBundleSchema>;

export const MarketplaceSkillFrontmatterSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string()).optional(),
  allowedTools: z.string().optional(),
  userInvocable: z.boolean().optional(),
  disableModelInvocation: z.boolean().optional(),
  raw: z.record(z.unknown()).default({}),
});
export type MarketplaceSkillFrontmatter = z.infer<typeof MarketplaceSkillFrontmatterSchema>;

export const MarketplaceSkillMetadataSchema = z.object({
  bundle: MarketplaceSkillBundleSchema,
  frontmatter: MarketplaceSkillFrontmatterSchema,
});
export type MarketplaceSkillMetadata = z.infer<typeof MarketplaceSkillMetadataSchema>;

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
      tarballUrl: z.string().url().optional(),
      // Subresource Integrity (SRI) hash matching npm registry metadata format.
      // When present, plugin install verifies the resolved package's integrity
      // (read from package-lock.json after `npm install`) against this value
      // and fail-closes on mismatch. Catalog items omitting this field install
      // unverified for backward compatibility.
      // Format: `<algorithm>-<base64>`, e.g. `sha512-...==` or `sha256-...`.
      integrity: z
        .string()
        .regex(
          /^sha(?:256|384|512)-[A-Za-z0-9+/]+=*$/,
          "integrity must be `sha(256|384|512)-<base64>` (npm SRI format)",
        )
        .optional(),
    })
    .optional(),
  // Only present on snapshot items (skill/agent/team), commit-pinned URL to fetchable file
  resourceUrl: z.string().optional(),
  provider: MarketplaceProviderRefSchema.optional(),
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
  packageId: z.string().optional(),
  category: MarketplaceCategorySchema,
  tags: z.array(MarketplaceTagSchema),
  featured: z.boolean().optional(),
  runtimeRequires: z.array(z.string()).optional(),
  skill: MarketplaceSkillMetadataSchema.optional(),
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

/**
 * A "package" is a synthetic grouping of catalog items that share a GitHub
 * source repo (or an explicit `packageId`). Synthesis rule: items grouped by
 * `owner/repo` extracted from `source.url`, with threshold ≥ 2 items.
 *
 * Synthesized packages don't have a description; UI shows "N skills" instead.
 * If the upstream catalog repo later wants curated names/descriptions, items
 * can carry an explicit `packageId` whose metadata can be looked up elsewhere.
 */
export const MarketplacePackageSchema = z.object({
  /** Stable identifier — `owner/repo` for synthesized, the literal `packageId` for explicit. */
  id: z.string(),
  /** Display name — repo name for synthesized (`gstack`), literal `packageId` for explicit. */
  name: z.string(),
  /** Canonical GitHub URL (e.g. `https://github.com/garrytan/gstack`). */
  sourceUrl: z.string(),
  /** Catalog item IDs that belong to this package, sorted ascending. */
  memberItemIds: z.array(z.string()),
  /** Number of member items. Always equal to `memberItemIds.length`. */
  count: z.number().int().nonnegative(),
  /** True iff every member item has `trust.tier === "verified"`. */
  verified: z.boolean(),
  /** Whether this package was created via an explicit `packageId` override. False = synthesized. */
  explicit: z.boolean(),
  /** Provider identity/logo chosen deterministically from package members. */
  provider: MarketplaceProviderRefSchema.optional(),
});
export type MarketplacePackage = z.infer<typeof MarketplacePackageSchema>;

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
  pluginUpdatePolicy: "notify_all",
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
