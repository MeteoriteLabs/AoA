import { useMemo } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useCatalog } from "@/hooks/useCatalog";
import { CatalogCard } from "@/components/marketplace/CatalogCard";
import { MarketplaceLayout } from "@/components/marketplace/MarketplaceLayout";
import { searchItems, filterByCategory, groupByType } from "@/api/marketplace";
import { TYPE_LABELS_PLURAL } from "@/lib/marketplace-constants";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import type { MarketplaceItemType, PluginRecord } from "@armyofagents/shared";

const TYPES: MarketplaceItemType[] = ["plugin", "skill", "agent", "team"];

export default function MarketplaceSearch() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const category = searchParams.get("category") ?? "";

  const { data: catalog, isLoading, error } = useCatalog();

  const { data: installedPlugins } = useQuery({
    queryKey: queryKeys.plugins.all,
    queryFn: () => pluginsApi.list(),
  });

  const installedByPackageName = useMemo(
    () => new Map((installedPlugins ?? []).map((p: PluginRecord) => [p.packageName, p])),
    [installedPlugins],
  );

  const grouped = useMemo(() => {
    if (!catalog) return null;
    let items = catalog.items;
    if (category) items = filterByCategory(items, category);
    if (q.trim()) items = searchItems(items, q);
    return groupByType(items);
  }, [catalog, q, category]);

  const totalCount = grouped
    ? Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0)
    : 0;

  if (isLoading) {
    return (
      <MarketplaceLayout breadcrumbs={[{ label: "Search" }]}>
        <div className="space-y-6">
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        </div>
      </MarketplaceLayout>
    );
  }

  if (error) {
    return (
      <MarketplaceLayout breadcrumbs={[{ label: "Search" }]}>
        <div className="text-center py-12">
          <p className="text-lg font-medium">Could not load search results</p>
          <p className="text-sm text-muted-foreground mt-2">
            {error.message || "Unknown error"}
          </p>
        </div>
      </MarketplaceLayout>
    );
  }

  return (
    <MarketplaceLayout breadcrumbs={[{ label: "Search" }]}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">
            {q ? `Search: "${q}"` : "All items"}
            {category && (
              <span className="text-muted-foreground"> · category: {category}</span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            {totalCount} {totalCount === 1 ? "result" : "results"}
          </p>
        </div>

        {totalCount === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No items match your search.</p>
            <Link
              to="/marketplace"
              className="text-sm text-primary hover:underline mt-2 inline-block"
            >
              ← Back to marketplace
            </Link>
          </div>
        ) : (
          TYPES.map((type) => {
            const items = grouped![type];
            if (items.length === 0) return null;
            return (
              <section key={type}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold">{TYPE_LABELS_PLURAL[type]}</h2>
                  <Link
                    to={`/marketplace/${type}`}
                    className="text-xs text-primary hover:underline"
                  >
                    See all →
                  </Link>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {items.map((item) => (
                    <CatalogCard key={item.id} item={item} installedByPackageName={installedByPackageName} />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </MarketplaceLayout>
  );
}
