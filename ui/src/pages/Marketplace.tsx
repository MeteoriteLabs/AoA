import { Skeleton } from "@/components/ui/skeleton";
import { useCatalog } from "@/hooks/useCatalog";
import { CatalogCard } from "@/components/marketplace/CatalogCard";
import { MarketplaceLayout } from "@/components/marketplace/MarketplaceLayout";
import { TypeTile } from "@/components/marketplace/TypeTile";
import { CategoryTile } from "@/components/marketplace/CategoryTile";
import {
  filterByType,
  featuredItems,
  recentlyAddedItems,
} from "@/api/marketplace";
import type { MarketplaceItemType } from "@armyofagents/shared";

const TYPES: MarketplaceItemType[] = ["plugin", "skill", "agent", "team"];

export default function Marketplace() {
  const { data: catalog, isLoading, error } = useCatalog();

  if (isLoading) {
    return (
      <MarketplaceLayout>
        <div className="space-y-6">
          <p className="text-muted-foreground">Loading marketplace…</p>
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
      <MarketplaceLayout>
        <div className="text-center py-12">
          <p className="text-lg font-medium">Could not load the marketplace</p>
          <p className="text-sm text-muted-foreground mt-2">
            {error.message || "Unknown error"}
          </p>
        </div>
      </MarketplaceLayout>
    );
  }

  if (!catalog || catalog.items.length === 0) {
    return (
      <MarketplaceLayout>
        <div className="text-center py-12">
          <p className="text-lg font-medium">No items in the marketplace yet</p>
          <p className="text-sm text-muted-foreground mt-2">
            Check back later — new items appear when the catalog is updated.
          </p>
        </div>
      </MarketplaceLayout>
    );
  }

  const featured = featuredItems(catalog.items, 6);
  const recent = recentlyAddedItems(catalog.items, 6);

  // Compute category counts (top 10 by item count)
  const categoryCounts: Record<string, number> = {};
  for (const item of catalog.items) {
    categoryCounts[item.category] = (categoryCounts[item.category] ?? 0) + 1;
  }
  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return (
    <MarketplaceLayout>
      <div className="space-y-10">
        {featured.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-4">Featured</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {featured.map((item) => (
                <CatalogCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-xl font-semibold mb-4">Recently Added</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recent.map((item) => (
              <CatalogCard key={item.id} item={item} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">Browse by type</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {TYPES.map((type) => (
              <TypeTile
                key={type}
                type={type}
                count={filterByType(catalog.items, type).length}
              />
            ))}
          </div>
        </section>

        {topCategories.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-4">Browse by category</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {topCategories.map(([category, count]) => (
                <CategoryTile key={category} category={category} count={count} />
              ))}
            </div>
          </section>
        )}
      </div>
    </MarketplaceLayout>
  );
}
