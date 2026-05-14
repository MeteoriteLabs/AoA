import { useState, useMemo, useRef, useEffect, useCallback, type ComponentType, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Bot, ChevronLeft, ChevronRight, Layers, Puzzle, Search, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/context/CompanyContext";
import { useDialog } from "@/context/DialogContext";
import { useCatalog } from "@/hooks/useCatalog";
import { usePackages } from "@/hooks/usePackages";
import { CatalogCard } from "@/components/marketplace/CatalogCard";
import { PackageCard } from "@/components/marketplace/PackageCard";
import { PackageInstallModal } from "@/components/marketplace/install/PackageInstallModal";
import { MarketplaceFilterChips } from "@/components/marketplace/MarketplaceFilterChips";
import { MarketplaceSubfilterChips } from "@/components/marketplace/MarketplaceSubfilterChips";
import { LobbyShell, LobbyShellMobileMenuButton } from "@/components/LobbyShell";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import { filterByType } from "@/api/marketplace";
import { cn } from "@/lib/utils";
import type {
  MarketplaceItemType,
  MarketplaceCatalogItem,
  MarketplacePackage,
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

const SECTION_CAP = 6;

const SECTION_ICONS: Record<MarketplaceItemType, ComponentType<{ className?: string }>> = {
  skill: Sparkles,
  plugin: Puzzle,
  agent: Bot,
  team: Bot, // matches MarketplaceFilterChips — StackedIcon is card-only
};

const SECTION_TONES: Record<MarketplaceItemType, string> = {
  skill: "bg-amber-500/15 border-amber-500/30 text-amber-500",
  plugin: "bg-blue-500/15 border-blue-500/30 text-blue-500",
  agent: "bg-purple-500/15 border-purple-500/30 text-purple-500",
  team: "bg-teal-500/15 border-teal-500/30 text-teal-500",
};

const SECTION_LABELS: Record<MarketplaceItemType, string> = {
  skill: "Skills",
  plugin: "Plugins",
  agent: "Agents",
  team: "Teams",
};

const SECTION_ORDER: ReadonlyArray<MarketplaceItemType> = ["skill", "plugin", "agent", "team"];
const SKILL_PACKAGE_PREVIEW_COUNT = 6;

interface SectionHeaderProps {
  type: MarketplaceItemType;
  total: number;
  showSeeAll: boolean;
  onSeeAll: () => void;
}

function SectionHeader({ type, total, showSeeAll, onSeeAll }: SectionHeaderProps) {
  const Icon = SECTION_ICONS[type];
  const tone = SECTION_TONES[type];
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-dim">
        <span className={cn("inline-flex size-5 items-center justify-center rounded-md border", tone)}>
          <Icon className="size-3" />
        </span>
        {SECTION_LABELS[type]}
        <span className="text-very-dim font-normal normal-case tracking-normal">· {total}</span>
      </h2>
      {showSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="text-[12px] text-dim hover:text-foreground"
        >
          See all →
        </button>
      )}
    </div>
  );
}

function PackagesHeader({
  total,
  onSeeAll,
  title = "Packages",
}: {
  total: number;
  onSeeAll?: () => void;
  title?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-dim">
        <span className="inline-flex size-5 items-center justify-center rounded-md border bg-amber-500/15 border-amber-500/30 text-amber-500">
          <Layers className="size-3" />
        </span>
        {title}
        <span className="text-very-dim font-normal normal-case tracking-normal">· {total}</span>
      </h2>
      {onSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="text-[12px] text-dim hover:text-foreground"
        >
          See all →
        </button>
      )}
    </div>
  );
}

function OverviewShelf({
  testId,
  scrollTestId,
  label,
  children,
}: {
  testId?: string;
  scrollTestId?: string;
  label: string;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const maxScrollLeft = node.scrollWidth - node.clientWidth;
    setCanScrollLeft(node.scrollLeft > 1);
    setCanScrollRight(node.scrollLeft < maxScrollLeft - 1);
  }, []);

  useEffect(() => {
    updateScrollState();
    const node = scrollRef.current;
    if (!node) return;
    node.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      node.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [updateScrollState, children]);

  const scrollShelf = (direction: "left" | "right") => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollBy({
      left: direction === "left" ? -node.clientWidth * 0.9 : node.clientWidth * 0.9,
      behavior: "smooth",
    });
  };

  return (
    <div className="group/shelf relative -mx-4 sm:-mx-6 md:-mx-10">
      <button
        type="button"
        aria-label={`Scroll ${label} left`}
        disabled={!canScrollLeft}
        onClick={() => scrollShelf("left")}
        className={cn(
          "absolute left-2 top-1/2 z-10 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border-strong bg-card/95 text-dim shadow-lg shadow-black/20 transition-all hover:bg-card-2 hover:text-foreground md:flex",
          !canScrollLeft && "pointer-events-none opacity-0",
        )}
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        type="button"
        aria-label={`Scroll ${label} right`}
        disabled={!canScrollRight}
        onClick={() => scrollShelf("right")}
        className={cn(
          "absolute right-2 top-1/2 z-10 hidden size-8 -translate-y-1/2 items-center justify-center rounded-full border border-border-strong bg-card/95 text-dim shadow-lg shadow-black/20 transition-all hover:bg-card-2 hover:text-foreground md:flex",
          !canScrollRight && "pointer-events-none opacity-0",
        )}
      >
        <ChevronRight className="size-4" />
      </button>
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-2 right-0 top-0 z-[1] w-12 bg-gradient-to-l from-bg to-transparent"
      />
      <div
        ref={scrollRef}
        data-testid={scrollTestId}
        className="overflow-x-auto px-4 pb-2 sm:px-6 md:px-10 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
      >
        <div
          data-testid={testId}
          className="grid grid-flow-col grid-rows-2 auto-cols-[calc(100vw-2rem)] gap-3.5 sm:auto-cols-[minmax(20rem,32rem)]"
        >
          {children}
        </div>
      </div>
    </div>
  );
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
  const [showAllSkillPackages, setShowAllSkillPackages] = useState(false);
  const [search, setSearch] = useState("");
  const [packageToInstall, setPackageToInstall] = useState<MarketplacePackage | null>(null);
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
  const packageInstallMembers = useMemo<MarketplaceCatalogItem[]>(() => {
    if (!packageToInstall) return [];
    const idSet = new Set(packageToInstall.memberItemIds);
    return items.filter((item) => idSet.has(item.id));
  }, [items, packageToInstall]);

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

  // Group visible (post-search, post-sort) items by type.
  const grouped = useMemo<Record<MarketplaceItemType, MarketplaceCatalogItem[]>>(() => {
    const out: Record<MarketplaceItemType, MarketplaceCatalogItem[]> = {
      skill: [], plugin: [], agent: [], team: [],
    };
    for (const it of visible) out[it.type].push(it);
    return out;
  }, [visible]);

  function renderPackageOverview() {
    if (!packages?.length) return null;
    return (
      <section className="mb-7">
        <PackagesHeader total={packages.length} onSeeAll={() => setSelectedType("skill")} />
        <OverviewShelf
          label="packages"
          testId="marketplace-packages-overview"
          scrollTestId="marketplace-packages-overview-scroll"
        >
          {packages.map((pkg) => (
            <PackageCard key={pkg.id} pkg={pkg} onInstallAll={setPackageToInstall} />
          ))}
        </OverviewShelf>
      </section>
    );
  }

  function renderSkillPackageSection() {
    if (!packages?.length) return null;
    const hasMore = packages.length > SKILL_PACKAGE_PREVIEW_COUNT;
    const visiblePackages = showAllSkillPackages
      ? packages
      : packages.slice(0, SKILL_PACKAGE_PREVIEW_COUNT);
    return (
      <section className="mb-7">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-dim">
            <span className="inline-flex size-5 items-center justify-center rounded-md border bg-amber-500/15 border-amber-500/30 text-amber-500">
              <Layers className="size-3" />
            </span>
            Skill packages
            <span className="text-very-dim font-normal normal-case tracking-normal">· {packages.length}</span>
          </h2>
          {hasMore && (
            <button
              type="button"
              onClick={() => setShowAllSkillPackages((current) => !current)}
              className="text-[12px] text-dim hover:text-foreground"
            >
              {showAllSkillPackages ? "Show less" : "View more"}
            </button>
          )}
        </div>
        <div
          data-testid="marketplace-skills-packages-grid"
          className="grid grid-cols-1 gap-3.5 sm:grid-cols-2"
        >
          {visiblePackages.map((pkg) => (
            <PackageCard key={pkg.id} pkg={pkg} onInstallAll={setPackageToInstall} />
          ))}
        </div>
      </section>
    );
  }

  // Render a single section block. `capped` is the visible-after-cap slice;
  // `total` is the full count used in the header + cap decision.
  function renderSection(type: MarketplaceItemType, capped: MarketplaceCatalogItem[], total: number) {
    if (total === 0) return null;
    const isOverview = selectedType === null;
    return (
      <section key={type} className="mb-7">
        <SectionHeader
          type={type}
          total={total}
          showSeeAll={selectedType === null && total > SECTION_CAP}
          onSeeAll={() => setSelectedType(type)}
        />
        {isOverview ? (
          <OverviewShelf label="section">
            {capped.map((item) => (
              <CatalogCard
                key={item.id}
                item={item}
                installedByPackageName={installedByPackageName}
              />
            ))}
          </OverviewShelf>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {capped.map((item) => (
              <CatalogCard
                key={item.id}
                item={item}
                installedByPackageName={installedByPackageName}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <LobbyShell activeItem="marketplace" onCreateCompany={() => openOnboarding()}>
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

        {/* Body */}
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
        ) : selectedType !== null ? (
          // Single-section view: cap removed, "See all" hidden.
          selectedType === "skill" ? (
            <>
              {renderSkillPackageSection()}
              {renderSection(selectedType, grouped[selectedType], grouped[selectedType].length)}
            </>
          ) : (
            renderSection(selectedType, grouped[selectedType], grouped[selectedType].length)
          )
        ) : (
          // All-view: overview shelves, capped, with packages promoted first.
          <>
            {renderPackageOverview()}
            {SECTION_ORDER.map((type) => {
              const items = grouped[type];
              return renderSection(type, items.slice(0, SECTION_CAP), items.length);
            })}
          </>
        )}
      </div>
      <PackageInstallModal
        pkg={packageToInstall}
        memberItems={packageInstallMembers}
        open={packageToInstall !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPackageToInstall(null);
        }}
      />
    </LobbyShell>
  );
}
