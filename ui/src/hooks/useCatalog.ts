import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { MarketplaceCatalogFile } from "@armyofagents/shared";
import { marketplaceApi } from "@/api/marketplace";
import bundledSnapshot from "@/aoa-marketplace-snapshot.json";

const CATALOG_QUERY_KEY = ["marketplace", "catalog"] as const;
const STALE_TIME_MS = 5 * 60 * 1000;
const GC_TIME_MS = 30 * 60 * 1000;

/**
 * Fetch the marketplace catalog and cache across all marketplace pages.
 *
 * Single shared query key — repeated calls return same promise / cached result.
 * 5min staleTime is safe (CDN republishes nightly + on push).
 *
 * Falls back to the bundled snapshot when the API is unavailable (e.g. server
 * not yet synced, backend offline during local development). This ensures the
 * marketplace always shows something rather than a blank error screen.
 */
export function useCatalog(): UseQueryResult<MarketplaceCatalogFile, Error> {
  return useQuery({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async () => {
      try {
        return await marketplaceApi.getCatalog();
      } catch {
        // Server unavailable or catalog not yet synced — use bundled snapshot.
        return bundledSnapshot as MarketplaceCatalogFile;
      }
    },
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
  });
}

export const catalogQueryKey = CATALOG_QUERY_KEY;
