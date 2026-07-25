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
  "commander", // Commander personal AI skills — must stay separate from workflows/design
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

const GITHUB_REPO_OWNER_PATTERN = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?";
const GITHUB_REPO_NAME_PATTERN = "[A-Za-z0-9._-]+";
const GITHUB_OWNER_REPO_REGEX = new RegExp(
  `^${GITHUB_REPO_OWNER_PATTERN}/${GITHUB_REPO_NAME_PATTERN}$`,
);
const MARKETPLACE_GITHUB_REPO_MESSAGE =
  "Skill bundle repo must be a GitHub owner/repo or HTTPS github.com owner/repo URL";
const MARKETPLACE_COMMIT_SHA_MESSAGE =
  "Skill bundle commitSha must be a full 40-character hex commit SHA";
const MARKETPLACE_COMMIT_SHA_REGEX = /^[0-9a-f]{40}$/i;

export function isMarketplaceGitHubRepo(repo: string): boolean {
  if (!repo || repo.trim() !== repo) return false;

  if (GITHUB_OWNER_REPO_REGEX.test(repo)) return true;

  let parsed: URL;
  try {
    parsed = new URL(repo);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") {
    return false;
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) return false;
  const [owner, nameWithSuffix] = segments;
  const repoName = nameWithSuffix.endsWith(".git")
    ? nameWithSuffix.slice(0, -".git".length)
    : nameWithSuffix;

  return GITHUB_OWNER_REPO_REGEX.test(`${owner}/${repoName}`);
}

export const MarketplaceSkillBundleSchema = z.object({
  type: z.literal("github-directory"),
  repo: z.string().refine(isMarketplaceGitHubRepo, MARKETPLACE_GITHUB_REPO_MESSAGE),
  commitSha: z.string().regex(MARKETPLACE_COMMIT_SHA_REGEX, MARKETPLACE_COMMIT_SHA_MESSAGE),
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
 * Per-item, drop-and-warn parser for catalog.json — the forward-compat property
 * `MarketplaceCatalogFileSchema.parse()` lacks.
 *
 * WHY (FU-14): `MarketplaceCatalogItemSchema.type` is a hard enum. A whole-array
 * `.parse()` rejects the ENTIRE file the moment ONE item carries an unknown `type`
 * (e.g. a future `"connector"`/`"workflow"` kind) or any other unparseable shape.
 * The sync failure path preserves the previous cache, so a single new item type
 * would silently freeze the catalog FOREVER on every older self-hosted instance.
 * This parser mirrors `parseMcpConnectorCatalog` (mcp-connector-catalog.ts): it
 * validates the ENVELOPE, then `safeParse`s each item independently, dropping the
 * bad ones by id instead of failing the file. Items that DO parse are validated at
 * full strength (a known-`type` item with a bad shape is still dropped, never
 * accepted malformed) — the category/tag enums are per-item fields, so a bad
 * category or tag drops only that item.
 *
 * Return shape mirrors the connector parser's `malformed` concept:
 * - `malformed: true` ⇔ the envelope itself is unintelligible: `input` is not a
 *   non-null object, or `items` is absent / not an array. `catalog` is `null` and
 *   `dropped` is `[]`. Callers should treat this like a fetch failure and KEEP the
 *   last known-good cache.
 * - `malformed: false` ⇔ we read an `items` array (even a legitimately empty one).
 *   `catalog` is a `MarketplaceCatalogFile` whose `items` are the survivors and
 *   whose `itemCount` is recomputed to `items.length` (honest count of what is
 *   actually served). `dropped` lists the ids (or `"<unidentified>"`) of items
 *   that failed per-item validation. Never throws, for any input.
 *
 * NOTE: this parser does NOT gate on `schemaVersion` — that stays the caller's
 * decision via `isSchemaVersionSupported`, exactly as before.
 */
export function parseMarketplaceCatalog(input: unknown): {
  catalog: MarketplaceCatalogFile | null;
  dropped: string[];
  malformed: boolean;
} {
  if (typeof input !== "object" || input === null) {
    return { catalog: null, dropped: [], malformed: true };
  }
  const envelope = input as {
    schemaVersion?: unknown;
    generatedAt?: unknown;
    itemCount?: unknown;
    items?: unknown;
  };
  if (!Array.isArray(envelope.items)) {
    return { catalog: null, dropped: [], malformed: true };
  }

  const items: MarketplaceCatalogItem[] = [];
  const dropped: string[] = [];
  for (const raw of envelope.items) {
    const parsed = MarketplaceCatalogItemSchema.safeParse(raw);
    if (parsed.success) {
      items.push(parsed.data);
    } else {
      const id =
        typeof raw === "object" && raw !== null
          ? (raw as { id?: unknown }).id
          : undefined;
      dropped.push(typeof id === "string" ? id : "<unidentified>");
    }
  }

  // The envelope metadata is best-effort: a future schema that reshapes or omits
  // these must not blank the shelf. A non-string schemaVersion degrades to "" —
  // `isSchemaVersionSupported("")` is false, so the caller keeps its cache rather
  // than serving an unversioned file. `itemCount` is recomputed from survivors.
  const schemaVersion =
    typeof envelope.schemaVersion === "string" ? envelope.schemaVersion : "";
  const generatedAt =
    typeof envelope.generatedAt === "string"
      ? envelope.generatedAt
      : new Date(0).toISOString();

  return {
    catalog: { schemaVersion, generatedAt, itemCount: items.length, items },
    dropped,
    malformed: false,
  };
}

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

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Whether a CDN catalog's `schemaVersion` is one this client can serve.
 *
 * INTENT (unchanged): reject a version we cannot understand — a major bump signals
 * breaking, non-backward-compatible changes and must still be refused (the sync
 * path then keeps the last known-good cache).
 *
 * FU-14 loosening: the previous strict equality (`=== "1.0.0"`) made ANY bump —
 * including an additive, backward-compatible minor/patch — freeze the catalog on
 * every older instance, the envelope-level twin of the per-item freeze this file
 * fixes. Now that `parseMarketplaceCatalog` drops unknown items rather than the
 * whole file, an additive minor bump is safe to accept: unknown item shapes fall
 * out per-item, known items keep working. So we accept any version in the SAME
 * MAJOR band as the supported range and at or above the MIN floor. `2.0.0` (major
 * bump = breaking) is still rejected; `1.1.0` (additive) is now accepted; `0.9.0`
 * (below the floor) is rejected.
 */
export function isSchemaVersionSupported(version: string): boolean {
  const parsed = parseSemver(version);
  if (!parsed) return false;
  const min = parseSemver(CATALOG_SCHEMA_VERSION_MIN);
  const max = parseSemver(CATALOG_SCHEMA_VERSION_MAX);
  if (!min || !max) return false;
  // Same major as the supported band (breaking major bumps rejected)...
  if (parsed[0] !== max[0]) return false;
  // ...and not below the MIN floor.
  return compareSemver(parsed, min) >= 0;
}

export interface MarketplaceSettings {
  // Section 1: Updates
  pluginUpdatePolicy: "auto_patch" | "auto_minor" | "notify_all";
  skillUpdatePolicy: "notify";
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
