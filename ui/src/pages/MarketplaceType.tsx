import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCatalog } from "@/hooks/useCatalog";
import { CatalogCard } from "@/components/marketplace/CatalogCard";
import { LobbyShell, LobbyShellMobileMenuButton } from "@/components/LobbyShell";
import { FilterChips } from "@/components/marketplace/FilterChips";
import { useDialog } from "@/context/DialogContext";
import {
  filterByType,
  sortItems,
  type CatalogSortOption,
} from "@/api/marketplace";
import {
  pathToItemType,
  TYPE_LABELS_PLURAL,
} from "@/lib/marketplace-constants";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import type { PluginRecord } from "@armyofagents/shared";

export default function MarketplaceType() {
  const { type: typeParam } = useParams<{ type: string }>();
  const itemType = typeParam ? pathToItemType(typeParam) : null;
  const { openOnboarding } = useDialog();

  const { data: catalog, isLoading, error } = useCatalog();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<CatalogSortOption>("recent");

  const { data: installedPlugins } = useQuery({
    queryKey: queryKeys.plugins.all,
    queryFn: () => pluginsApi.list(),
  });

  const installedByPackageName = useMemo(
    () => new Map((installedPlugins ?? []).map((p: PluginRecord) => [p.packageName, p])),
    [installedPlugins],
  );

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
      <LobbyShell activeItem="marketplace" defaultCollapsed onCreateCompany={() => openOnboarding()}>
        <div className="mx-auto w-full max-w-[920px] px-4 py-6 sm:px-6 sm:py-7 md:px-10 md:py-9">
          <LobbyShellMobileMenuButton className="mb-4" />
          <div className="text-center py-12">
            <p className="text-lg font-medium">Unknown item type: {typeParam}</p>
            <Link
              to="/marketplace"
              className="text-sm text-primary hover:underline mt-2 inline-block"
            >
              ← Back to marketplace
            </Link>
          </div>
        </div>
      </LobbyShell>
    );
  }

  const typeLabel = TYPE_LABELS_PLURAL[itemType];

  if (isLoading) {
    return (
      <LobbyShell activeItem="marketplace" defaultCollapsed onCreateCompany={() => openOnboarding()}>
        <div className="mx-auto w-full max-w-[920px] px-4 py-6 sm:px-6 sm:py-7 md:px-10 md:py-9">
          <LobbyShellMobileMenuButton className="mb-4" />
          <div className="space-y-6">
            <Skeleton className="h-8 w-48" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-40" />
              ))}
            </div>
          </div>
        </div>
      </LobbyShell>
    );
  }

  if (error) {
    return (
      <LobbyShell activeItem="marketplace" defaultCollapsed onCreateCompany={() => openOnboarding()}>
        <div className="mx-auto w-full max-w-[920px] px-4 py-6 sm:px-6 sm:py-7 md:px-10 md:py-9">
          <LobbyShellMobileMenuButton className="mb-4" />
          <div className="text-center py-12">
            <p className="text-lg font-medium">Could not load {typeLabel.toLowerCase()}</p>
            <p className="text-sm text-muted-foreground mt-2">
              {error.message || "Unknown error"}
            </p>
          </div>
        </div>
      </LobbyShell>
    );
  }

  return (
    <LobbyShell activeItem="marketplace" defaultCollapsed onCreateCompany={() => openOnboarding()}>
      <div className="mx-auto w-full max-w-[920px] px-4 py-6 sm:px-6 sm:py-7 md:px-10 md:py-9">
        <LobbyShellMobileMenuButton className="mb-4" />
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
                <CatalogCard key={item.id} item={item} installedByPackageName={installedByPackageName} />
              ))}
            </div>
          )}
        </div>
      </div>
    </LobbyShell>
  );
}
