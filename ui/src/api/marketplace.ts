/**
 * @fileoverview Frontend API client for the AoA marketplace catalog.
 *
 * All functions in `marketplaceApi` map 1:1 to REST endpoints on
 * `server/src/routes/marketplace.ts`. Skeleton for M.3 frontend work.
 *
 * @see server/src/routes/marketplace.ts for endpoint implementation details.
 */

import type {
  CatalogItem,
  CatalogSyncStatus,
  MarketplaceCatalogFile,
  MarketplaceItemType,
  MarketplaceSettings,
  PendingUpdate,
} from "@armyofagents/shared";

export type { PendingUpdate };

export type { MarketplaceSettings };
import { api } from "./client";

// M.3b: Install flow types — wired to backend endpoints from M.2.

export interface InstallRequest {
  catalogItemId: string;
  targetDepartmentId?: string;
  idempotencyKey?: string;
}

export interface InstallOperation {
  id: string;
  companyId: string;
  catalogItemId: string;
  itemType: "plugin" | "skill" | "agent" | "team";
  targetDepartmentId: string | null;
  status: "pending" | "running" | "success" | "failure";
  resultEntityId: string | null;
  errorMessage: string | null;
  cascadeResults: unknown[] | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface InstallPlanStep {
  catalogItemId: string;
  itemType: "plugin" | "skill" | "agent" | "team";
  name: string;
  version: string;
  action: "install-new" | "skip-already-installed" | "fail-version-mismatch";
  reason?: string;
}

export interface InstallPlan {
  rootItem: { id: string; name: string; type: string; version: string };
  steps: InstallPlanStep[];
  conflicts: Array<{
    catalogItemId: string;
    kind: "name-collision" | "adapter-mismatch" | "model-unavailable";
    detail: string;
    resolution: "auto-suffix" | "fail-fast" | "warn-and-proceed";
  }>;
}

export const marketplaceApi = {
  async getCatalog(): Promise<MarketplaceCatalogFile> {
    return api.get<MarketplaceCatalogFile>("/marketplace/catalog");
  },

  async getStatus(): Promise<CatalogSyncStatus> {
    return api.get<CatalogSyncStatus>("/marketplace/catalog/status");
  },

  async sync(): Promise<{ itemCount: number; status: CatalogSyncStatus }> {
    return api.post<{ itemCount: number; status: CatalogSyncStatus }>(
      "/marketplace/catalog/sync",
      {},
    );
  },

  async resolvePlan(
    companyId: string,
    catalogItemId: string,
  ): Promise<InstallPlan> {
    return api.get<InstallPlan>(
      `/companies/${companyId}/marketplace/resolve/${catalogItemId}`,
    );
  },

  async install(
    companyId: string,
    request: InstallRequest,
  ): Promise<{ operationId: string; status: string }> {
    return api.post<{ operationId: string; status: string }>(
      `/companies/${companyId}/marketplace/install`,
      request,
    );
  },

  async getOperation(
    companyId: string,
    operationId: string,
  ): Promise<InstallOperation> {
    return api.get<InstallOperation>(
      `/companies/${companyId}/marketplace/install/${operationId}`,
    );
  },

  async getSettings(companyId: string): Promise<MarketplaceSettings> {
    return api.get<MarketplaceSettings>(
      `/companies/${companyId}/marketplace/settings`,
    );
  },

  async patchSettings(
    companyId: string,
    patch: Partial<MarketplaceSettings>,
  ): Promise<MarketplaceSettings> {
    return api.patch<MarketplaceSettings>(
      `/companies/${companyId}/marketplace/settings`,
      patch,
    );
  },

  async getUpdates(companyId: string, type?: string): Promise<PendingUpdate[]> {
    const path = type
      ? `/companies/${companyId}/marketplace/updates?type=${type}`
      : `/companies/${companyId}/marketplace/updates`;
    return api.get<PendingUpdate[]>(path);
  },

  async dismissUpdate(companyId: string, updateId: string): Promise<void> {
    await api.post<{ ok: boolean }>(
      `/companies/${companyId}/marketplace/updates/${updateId}/dismiss`,
      {},
    );
  },

  async applyUpdate(companyId: string, updateId: string): Promise<void> {
    await api.post<{ error: string }>(
      `/companies/${companyId}/marketplace/updates/${updateId}/apply`,
      {},
    );
  },

  async requestInstall(companyId: string, catalogItemId: string): Promise<void> {
    await api.post<{ queued: boolean }>(
      `/companies/${companyId}/marketplace/request-install`,
      { catalogItemId },
    );
  },
};

/** Filter catalog items by type. Pure function. */
export function filterByType(
  items: CatalogItem[],
  type: MarketplaceItemType,
): CatalogItem[] {
  return items.filter((i) => i.type === type);
}

/** Filter catalog items by category. Pure function. */
export function filterByCategory(
  items: CatalogItem[],
  category: string,
): CatalogItem[] {
  return items.filter((i) => i.category === category);
}

/**
 * Substring search across name, description, tags. Case-insensitive.
 * Empty/whitespace query returns input unchanged.
 */
export function searchItems(items: CatalogItem[], query: string): CatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    if (item.name.toLowerCase().includes(q)) return true;
    if (item.description.toLowerCase().includes(q)) return true;
    if (item.tags.some((t) => t.toLowerCase().includes(q))) return true;
    return false;
  });
}

export type CatalogSortOption = "recent" | "name" | "trust";

/**
 * Sort catalog items. Returns new array.
 *   recent: addedAt desc (newest first)
 *   name: alphabetical asc
 *   trust: verified > community > unverified, then alphabetical
 */
export function sortItems(
  items: CatalogItem[],
  sort: CatalogSortOption,
): CatalogItem[] {
  const TIER_RANK = { verified: 0, community: 1, unverified: 2 } as const;
  const sorted = [...items];
  if (sort === "recent") {
    return sorted.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }
  if (sort === "name") {
    return sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  return sorted.sort((a, b) => {
    const r = TIER_RANK[a.trust.tier] - TIER_RANK[b.trust.tier];
    if (r !== 0) return r;
    return a.name.localeCompare(b.name);
  });
}

/** Group items by type. Used in search results. */
export function groupByType(
  items: CatalogItem[],
): Record<MarketplaceItemType, CatalogItem[]> {
  return items.reduce(
    (acc, item) => {
      acc[item.type].push(item);
      return acc;
    },
    { skill: [], agent: [], plugin: [], team: [] } as Record<
      MarketplaceItemType,
      CatalogItem[]
    >,
  );
}

/** Top N featured items (filter by featured===true, sort recent). */
export function featuredItems(items: CatalogItem[], n = 6): CatalogItem[] {
  return sortItems(
    items.filter((i) => i.featured),
    "recent",
  ).slice(0, n);
}

/** Top N recently added items. */
export function recentlyAddedItems(items: CatalogItem[], n = 6): CatalogItem[] {
  return sortItems(items, "recent").slice(0, n);
}
