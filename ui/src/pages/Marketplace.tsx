import { useState, useMemo, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/context/CompanyContext";
import { useDialog } from "@/context/DialogContext";
import { useCatalog } from "@/hooks/useCatalog";
import { usePackages } from "@/hooks/usePackages";
import { CatalogCard } from "@/components/marketplace/CatalogCard";
import { PackageCard } from "@/components/marketplace/PackageCard";
import { MarketplaceFilterChips } from "@/components/marketplace/MarketplaceFilterChips";
import { MarketplaceSubfilterChips } from "@/components/marketplace/MarketplaceSubfilterChips";
import { LobbyShell, LobbyShellMobileMenuButton } from "@/components/LobbyShell";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import { filterByType } from "@/api/marketplace";
import type {
  MarketplaceItemType,
  MarketplaceCatalogItem,
  PluginRecord,
} from "@armyofagents/shared";

type SortMode = "all" | "featured" | "recent" | "az";
const SORT_OPTIONS = [
  { key: "all", label: "All" },
  { key: "featured", label: "Featured" },
  { key: "recent", label: "Recently added" },
  { key: "az", label: "A–Z" },
] as const;

const TRUST_RANK: Record<string, number> = { verified: 2, community: 1, unverified: 0 };

function applySort(items: MarketplaceCatalogItem[], mode: SortMode): MarketplaceCatalogItem[] {
  if (mode === "featured") {
    return items.filter((it) => it.featured === true);
  }
  if (mode === "recent") {
    return [...items].sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""));
  }
  if (mode === "az") {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }
  // "all" — default rank: trust desc, then name asc
  return [...items].sort((a, b) => {
    const ta = TRUST_RANK[a.trust.tier] ?? 0;
    const tb = TRUST_RANK[b.trust.tier] ?? 0;
    if (tb !== ta) return tb - ta;
    return a.name.localeCompare(b.name);
  });
}

export default function Marketplace() {
  const { data: catalog, isLoading, error } = useCatalog();
  const { data: packages } = usePackages();
  const { openOnboarding } = useDialog();
  useCompany();

  const { data: installedPlugins } = useQuery({
    queryKey: queryKeys.plugins.all,
    queryFn: () => pluginsApi.list(),
  });
  const installedByPackageName = useMemo(
    () => new Map((installedPlugins ?? []).map((p: PluginRecord) => [p.packageName, p])),
    [installedPlugins],
  );

  const [searchParams] = useSearchParams();
  const [selectedType, setSelectedType] = useState<MarketplaceItemType | null>(() => {
    const t = searchParams.get("type");
    return t === "plugin" || t === "skill" || t === "agent" || t === "team" ? t : null;
  });
  const [sortMode, setSortMode] = useState<SortMode>("all");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K to focus search.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const items = useMemo(() => catalog?.items ?? [], [catalog]);

  const typeCounts = useMemo<Partial<Record<MarketplaceItemType, number>>>(
    () => ({
      skill: filterByType(items, "skill").length,
      plugin: filterByType(items, "plugin").length,
      agent: filterByType(items, "agent").length,
      team: filterByType(items, "team").length,
    }),
    [items],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = items;
    if (selectedType) list = list.filter((it) => it.type === selectedType);
    if (q) {
      list = list.filter(
        (it) =>
          it.name.toLowerCase().includes(q) || it.description.toLowerCase().includes(q),
      );
    }
    return applySort(list, sortMode);
  }, [items, selectedType, search, sortMode]);

  return (
    <LobbyShell activeItem="marketplace" defaultCollapsed onCreateCompany={() => openOnboarding()}>
      <div className="mx-auto w-full max-w-[1080px] px-4 py-6 sm:px-6 sm:py-7 md:px-10 md:py-9">
        <LobbyShellMobileMenuButton className="mb-4" />

        {/* Heading */}
        <div className="mb-5">
          <h1 className="text-[1.55rem] font-bold tracking-tight">
            Marketplace<span className="text-brand">.</span>
          </h1>
          <p className="mt-1 text-[0.86rem] text-dim">
            Skills, plugins, agents, and teams — installable from any GitHub repo.
          </p>
        </div>

        {/* Search */}
        <div className="mb-3 relative">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-very-dim pointer-events-none" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search marketplace…"
            className="w-full h-9 pl-9 pr-3 rounded-md bg-card border border-border text-sm placeholder:text-very-dim focus:outline-none focus:border-border-strong"
          />
        </div>

        {/* Filter chips (type) */}
        <div className="mb-4">
          <MarketplaceFilterChips value={selectedType} onChange={setSelectedType} counts={typeCounts} />
        </div>

        {/* Sub-filter chips (sort/discover) */}
        <div className="mb-5">
          <MarketplaceSubfilterChips
            value={sortMode}
            onChange={(v) => setSortMode(v as SortMode)}
            options={SORT_OPTIONS}
          />
        </div>

        {/* Packages — only shown when no specific type filter is active */}
        {selectedType === null && packages && packages.length > 0 && (
          <div className="mb-7">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-dim">
                Packages <span className="text-very-dim font-normal">· {packages.length}</span>
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {packages.map((pkg) => (
                <PackageCard key={pkg.id} pkg={pkg} />
              ))}
            </div>
          </div>
        )}

        {/* Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-dim">
            Failed to load catalog.
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-dim text-center">
            No matches.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {visible.map((item) => (
              <CatalogCard
                key={item.id}
                item={item}
                installedByPackageName={installedByPackageName}
              />
            ))}
          </div>
        )}
      </div>
    </LobbyShell>
  );
}
