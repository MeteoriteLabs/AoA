import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCatalog } from "@/hooks/useCatalog";
import { CatalogCard } from "@/components/marketplace/CatalogCard";
import { MarketplaceLayout } from "@/components/marketplace/MarketplaceLayout";
import { FilterChips } from "@/components/marketplace/FilterChips";
import {
  filterByType,
  sortItems,
  type CatalogSortOption,
} from "@/api/marketplace";
import {
  pathToItemType,
  TYPE_LABELS_PLURAL,
} from "@/lib/marketplace-constants";

export default function MarketplaceType() {
  const { type: typeParam } = useParams<{ type: string }>();
  const itemType = typeParam ? pathToItemType(typeParam) : null;

  const { data: catalog, isLoading, error } = useCatalog();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<CatalogSortOption>("recent");

  const filteredAndSorted = useMemo(() => {
    if (!catalog || !itemType) return [];
    let items = filterByType(catalog.items, itemType);
    if (selectedTags.length > 0) {
      items = items.filter((item) =>
        selectedTags.every((tag) => item.tags.includes(tag as never)),
      );
    }
    return sortItems(items, sort);
  }, [catalog, itemType, selectedTags, sort]);

  const allTags = useMemo(() => {
    if (!catalog || !itemType) return [];
    const tags = new Set<string>();
    for (const item of filterByType(catalog.items, itemType)) {
      for (const tag of item.tags) tags.add(tag);
    }
    return Array.from(tags).sort();
  }, [catalog, itemType]);

  if (!itemType) {
    return (
      <MarketplaceLayout breadcrumbs={[{ label: typeParam ?? "?" }]}>
        <div className="text-center py-12">
          <p className="text-lg font-medium">Unknown item type: {typeParam}</p>
        </div>
      </MarketplaceLayout>
    );
  }

  const typeLabel = TYPE_LABELS_PLURAL[itemType];

  if (isLoading) {
    return (
      <MarketplaceLayout breadcrumbs={[{ label: typeLabel }]}>
        <p className="text-muted-foreground">Loading…</p>
      </MarketplaceLayout>
    );
  }

  if (error) {
    return (
      <MarketplaceLayout breadcrumbs={[{ label: typeLabel }]}>
        <p className="text-destructive">Error: {error.message}</p>
      </MarketplaceLayout>
    );
  }

  return (
    <MarketplaceLayout breadcrumbs={[{ label: typeLabel }]}>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{typeLabel}</h1>
            <p className="text-sm text-muted-foreground">
              {filteredAndSorted.length} {filteredAndSorted.length === 1 ? "item" : "items"}
            </p>
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as CatalogSortOption)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Recently added</SelectItem>
              <SelectItem value="name">Name (A-Z)</SelectItem>
              <SelectItem value="trust">Trust tier</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {allTags.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Filter by tag:</p>
            <FilterChips options={allTags} selected={selectedTags} onChange={setSelectedTags} />
          </div>
        )}

        {filteredAndSorted.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No items match the current filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAndSorted.map((item) => (
              <CatalogCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </MarketplaceLayout>
  );
}
