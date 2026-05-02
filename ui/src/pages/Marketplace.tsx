import { useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpen, Bot, Plug, Search, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useCatalog } from "@/hooks/useCatalog";
import { CatalogCard } from "@/components/marketplace/CatalogCard";
import { MarketplaceLayout } from "@/components/marketplace/MarketplaceLayout";
import { filterByType } from "@/api/marketplace";
import type { MarketplaceItemType, MarketplaceCategory } from "@armyofagents/shared";

// ─── Type pill config ────────────────────────────────────────────────────────

const TYPES = [
  { type: "plugin" as MarketplaceItemType, label: "Plugins", Icon: Plug },
  { type: "skill"  as MarketplaceItemType, label: "Skills",  Icon: BookOpen },
  { type: "agent"  as MarketplaceItemType, label: "Agents",  Icon: Bot },
  { type: "team"   as MarketplaceItemType, label: "Teams",   Icon: Users },
] as const;

const TYPE_COLORS: Record<MarketplaceItemType, string> = {
  plugin: "hover:border-violet-500/40 data-[active=true]:border-violet-500/50 data-[active=true]:bg-violet-500/10",
  skill:  "hover:border-teal-500/40   data-[active=true]:border-teal-500/50   data-[active=true]:bg-teal-500/10",
  agent:  "hover:border-blue-500/40   data-[active=true]:border-blue-500/50   data-[active=true]:bg-blue-500/10",
  team:   "hover:border-amber-500/40  data-[active=true]:border-amber-500/50  data-[active=true]:bg-amber-500/10",
};

const TYPE_ICON_BG: Record<MarketplaceItemType, string> = {
  plugin: "bg-violet-500/15 text-violet-400",
  skill:  "bg-teal-500/15   text-teal-400",
  agent:  "bg-blue-500/15   text-blue-400",
  team:   "bg-amber-500/15  text-amber-400",
};

// ─── Category chip config ────────────────────────────────────────────────────

const CATEGORIES: Array<{ category: MarketplaceCategory; label: string; emoji: string }> = [
  { category: "engineering",  label: "Engineering",  emoji: "⚙️" },
  { category: "marketing",    label: "Marketing",    emoji: "📢" },
  { category: "support",      label: "Support",      emoji: "💬" },
  { category: "sales",        label: "Sales",        emoji: "💼" },
  { category: "operations",   label: "Operations",   emoji: "🔧" },
  { category: "design",       label: "Design",       emoji: "🎨" },
  { category: "data",         label: "Data",         emoji: "📊" },
  { category: "productivity", label: "Productivity", emoji: "⚡" },
  { category: "integrations", label: "Integrations", emoji: "🔗" },
  { category: "workflows",    label: "Workflows",    emoji: "🔄" },
];

// ─── Sort ────────────────────────────────────────────────────────────────────

type SortOrder = "popular" | "newest" | "az";

const TRUST_RANK: Record<string, number> = { verified: 2, community: 1, unverified: 0 };

function sortItems(items: ReturnType<typeof filterByType>, order: SortOrder) {
  return [...items].sort((a, b) => {
    if (order === "az")     return a.name.localeCompare(b.name);
    if (order === "newest") return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
    // popular: trust tier desc, then name asc as tiebreak
    const diff = (TRUST_RANK[b.trust.tier] ?? 0) - (TRUST_RANK[a.trust.tier] ?? 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Marketplace() {
  const { data: catalog, isLoading, error } = useCatalog();

  const [searchParams] = useSearchParams();

  const [selectedType, setSelectedType] = useState<MarketplaceItemType | null>(() => {
    const t = searchParams.get("type");
    return (t === "plugin" || t === "skill" || t === "agent" || t === "team")
      ? (t as MarketplaceItemType)
      : null;
  });
  const [selectedCategory, setSelectedCategory] = useState<MarketplaceCategory | null>(null);
  const [sortOrder,        setSortOrder]         = useState<SortOrder>("popular");
  const [search,           setSearch]            = useState("");

  const items = catalog?.items ?? [];

  // Per-type counts for pill subtitles
  const typeCounts = useMemo(() =>
    Object.fromEntries(TYPES.map(({ type }) => [type, filterByType(items, type).length])),
    [items],
  );

  // Per-category counts for chip badges
  const categoryCounts = useMemo(() =>
    items.reduce<Record<string, number>>((acc, item) => {
      acc[item.category] = (acc[item.category] ?? 0) + 1;
      return acc;
    }, {}),
    [items],
  );

  // Filtered + sorted browse results
  const browseItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = items.filter(item => {
      if (selectedType     && item.type     !== selectedType)     return false;
      if (selectedCategory && item.category !== selectedCategory) return false;
      if (q && !item.name.toLowerCase().includes(q) && !item.description.toLowerCase().includes(q)) return false;
      return true;
    });
    return sortItems(filtered, sortOrder);
  }, [items, selectedType, selectedCategory, sortOrder, search]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <MarketplaceLayout actions={null}>
        <div className="max-w-5xl mx-auto px-8 py-8 space-y-6">
          <Skeleton className="h-24 w-2/3" />
          <Skeleton className="h-11 w-full" />
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
          </div>
        </div>
      </MarketplaceLayout>
    );
  }

  if (error) {
    return (
      <MarketplaceLayout actions={null}>
        <div className="text-center py-20">
          <p className="text-lg font-medium">Could not load the marketplace</p>
          <p className="text-sm text-muted-foreground mt-2">{error.message || "Unknown error"}</p>
        </div>
      </MarketplaceLayout>
    );
  }

  // ── Page ─────────────────────────────────────────────────────────────────
  return (
    <MarketplaceLayout actions={null}>
      <div className="max-w-5xl mx-auto px-8 py-8">

        {/* Hero */}
        <div className="mb-6">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-[10px] font-semibold tracking-widest uppercase mb-3">
            <span className="w-1 h-1 rounded-full bg-violet-400" />
            AoA Marketplace
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight leading-tight mb-1.5">
            Extend your workforce
            <br />
            <span className="bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
              with skills, agents &amp; plugins
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Browse and install pre-built capabilities curated by the AoA team and community.
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search skills, agents, teams, plugins…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-card border border-border rounded-lg pl-10 pr-16 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500/40 transition-all"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 bg-muted border border-border text-muted-foreground text-[11px] px-1.5 py-0.5 rounded font-mono">
            ⌘K
          </kbd>
        </div>

        {/* Type pills */}
        <div className="grid grid-cols-4 gap-2.5 mb-4">
          {TYPES.map(({ type, label, Icon }) => {
            const isActive = selectedType === type;
            return (
              <button
                key={type}
                data-active={isActive}
                onClick={() => setSelectedType(isActive ? null : type)}
                className={cn(
                  "flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border border-border bg-card text-left transition-all",
                  TYPE_COLORS[type],
                )}
              >
                <span className={cn("w-7 h-7 rounded-md flex items-center justify-center shrink-0", TYPE_ICON_BG[type])}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold leading-tight">{label}</span>
                  <span className="block text-xs text-muted-foreground">{typeCounts[type] ?? 0} available</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Category chips — single scrollable row */}
        <div className="mb-7">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground mb-2 px-0.5">
            Browse by category
          </p>
          <div className="relative">
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {/* All chip */}
              <button
                onClick={() => setSelectedCategory(null)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium whitespace-nowrap shrink-0 transition-all",
                  selectedCategory === null
                    ? "bg-violet-500/10 border-violet-500/40 text-violet-300"
                    : "bg-muted border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground",
                )}
              >
                ✦ All
                <span className={cn("text-[11px]", selectedCategory === null ? "text-violet-400/60" : "text-muted-foreground")}>
                  {items.length}
                </span>
              </button>

              {/* Category chips */}
              {CATEGORIES.map(({ category, label, emoji }) => {
                const count = categoryCounts[category] ?? 0;
                const isActive = selectedCategory === category;
                return (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(isActive ? null : category)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium whitespace-nowrap shrink-0 transition-all",
                      isActive
                        ? "bg-violet-500/10 border-violet-500/40 text-violet-300"
                        : "bg-muted border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground",
                    )}
                  >
                    {emoji} {label}
                    <span className={cn("text-[11px]", isActive ? "text-violet-400/60" : "text-muted-foreground")}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent" />
          </div>
        </div>

        {/* Browse results */}
        <div>
          {/* Result count + sort */}
          <div className="flex items-center mb-4">
            <span className="text-xs text-muted-foreground">{browseItems.length} results</span>
            <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
              Sort by:
              {(["popular", "newest", "az"] as SortOrder[]).map(order => (
                <button
                  key={order}
                  onClick={() => setSortOrder(order)}
                  className={cn(
                    "px-2.5 py-1 rounded-md border transition-all capitalize",
                    sortOrder === order
                      ? "bg-muted border-border text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {order === "az" ? "A–Z" : order.charAt(0).toUpperCase() + order.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Grid */}
          {browseItems.length === 0 ? (
            items.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">
                <p className="font-medium">Catalog is syncing…</p>
                <p className="text-sm mt-1">Items will appear here once the catalog finishes loading.</p>
              </div>
            ) : (
              <div className="text-center py-20 text-muted-foreground">
                <p className="font-medium">No results</p>
                <p className="text-sm mt-1">Try a different search or filter.</p>
              </div>
            )
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {browseItems.map(item => (
                <CatalogCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </MarketplaceLayout>
  );
}
