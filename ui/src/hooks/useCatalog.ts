import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { MarketplaceCatalogFile } from "@armyofagents/shared";
import { marketplaceApi } from "@/api/marketplace";

const CATALOG_QUERY_KEY = ["marketplace", "catalog"] as const;
const STALE_TIME_MS = 5 * 60 * 1000;
const GC_TIME_MS = 30 * 60 * 1000;

/**
 * Fetch the marketplace catalog and cache across all marketplace pages.
 *
 * Single shared query key — repeated calls return same promise / cached result.
 * 5min staleTime is safe (CDN republishes nightly + on push).
 *
 * Errors surface unchanged. Common case: 503 "Catalog not yet synced" if
 * server hasn't completed first sync (handled by empty-state at page layer).
 */
export function useCatalog(): UseQueryResult<MarketplaceCatalogFile, Error> {
  return useQuery({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: () => marketplaceApi.getCatalog(),
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
  });
}

export const catalogQueryKey = CATALOG_QUERY_KEY;
