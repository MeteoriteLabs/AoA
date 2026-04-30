/**
 * @fileoverview Frontend API client for the AoA marketplace catalog.
 *
 * All functions in `marketplaceApi` map 1:1 to REST endpoints on
 * `server/src/routes/marketplace.ts`. Skeleton for M.3 frontend work.
 *
 * @see server/src/routes/marketplace.ts for endpoint implementation details.
 */

import type { MarketplaceCatalogFile, CatalogSyncStatus } from "@armyofagents/shared";
import { api } from "./client";

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
};
