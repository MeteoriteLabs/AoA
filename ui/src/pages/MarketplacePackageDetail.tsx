import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import {
  BadgeCheck,
  ChevronLeft,
  Github,
  Layers,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { LobbyShell, LobbyShellMobileMenuButton } from "@/components/LobbyShell";
import { StackedIcon } from "@/components/marketplace/StackedIcon";
import { TYPE_ICONS, SINGLE_ICON_TONES, TEAM_ICON_TONE, shortSource, authorFromSource } from "@/lib/marketplace-constants";
import { useCatalog } from "@/hooks/useCatalog";
import { usePackages } from "@/hooks/usePackages";
import { useDialog } from "@/context/DialogContext";
import { detailUrl } from "@/components/marketplace/CatalogCard";
import { cn } from "@/lib/utils";
import type { MarketplaceCatalogItem, MarketplaceItemType } from "@armyofagents/shared";


export default function MarketplacePackageDetail() {
  const params = useParams<{ id: string; "*": string }>();
  const restPath = params["*"] ?? "";
  const fullPackageId = restPath ? `${params.id}/${restPath}` : (params.id ?? "");

  const { openOnboarding } = useDialog();
  const { data: catalog, isLoading: catalogLoading } = useCatalog();
  const { data: packages, isLoading: packagesLoading } = usePackages();

  const pkg = useMemo(
    () => packages?.find((p) => p.id === fullPackageId) ?? null,
    [packages, fullPackageId],
  );

  const memberItems = useMemo<MarketplaceCatalogItem[]>(() => {
    if (!pkg || !catalog) return [];
    const idSet = new Set(pkg.memberItemIds);
    return catalog.items.filter((it) => idSet.has(it.id));
  }, [pkg, catalog]);

  const isLoading = catalogLoading || packagesLoading;

  return (
    <LobbyShell activeItem="marketplace" onCreateCompany={() => openOnboarding()}>
      <div className="mx-auto w-full max-w-[920px] px-4 py-6 sm:px-6 sm:py-7 md:px-10 md:py-9">
        <LobbyShellMobileMenuButton className="mb-4" />
        <Link
          to="/marketplace"
          className="mb-4 inline-flex items-center gap-1 text-[12px] text-very-dim hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" /> Marketplace
        </Link>

        {isLoading && (
          <div className="text-sm text-dim">Loading…</div>
        )}

        {!isLoading && !pkg && (
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-dim text-center">
            Package not found.
          </div>
        )}

        {!isLoading && pkg && (
          <div className="space-y-7">
            {/* Hero */}
            <div className="rounded-2xl border border-border-strong bg-card p-6 relative overflow-hidden">
              <span aria-hidden className="absolute left-0 top-6 bottom-6 w-[3px] rounded-r bg-amber-500" />
              <span className="absolute right-5 top-5 inline-flex items-center gap-1 uppercase text-[10px] tracking-[0.1em] font-semibold text-very-dim leading-none">
                <Layers className="size-3" /> PACKAGE
              </span>
              <div className="flex flex-col sm:flex-row items-start gap-5 pl-2">
                <StackedIcon icon={Sparkles} tone="amber" className="size-20 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-bold tracking-tight">{pkg.name}</h1>
                    {pkg.verified && (
                      <BadgeCheck
                        data-testid="package-hero-verified"
                        className="size-5 shrink-0 text-[hsl(208_80%_60%)]"
                        aria-label="Verified"
                      />
                    )}
                    <span
                      className={cn(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold",
                        "bg-amber-500/10 border border-amber-500/25 text-amber-400",
                      )}
                    >
                      {pkg.count} items
                    </span>
                  </div>
                  <div className="mt-1 text-[12.5px] text-dim">by {authorFromSource(pkg.sourceUrl)}</div>
                  <div className="mt-3 flex items-center gap-3 text-[12px] text-very-dim flex-wrap">
                    <a
                      href={pkg.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 hover:text-foreground"
                    >
                      <Github className="size-3.5" /> {shortSource(pkg.sourceUrl, pkg.id)}
                    </a>
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0 w-full sm:w-auto">
                  <Button
                    size="default"
                    className="text-[13px] font-semibold inline-flex items-center gap-1.5"
                    onClick={(e) => {
                      e.preventDefault();
                      // Phase C MVP: Install all is a placeholder.
                    }}
                  >
                    <Plus className="size-4" /> Install all {pkg.count} items
                  </Button>
                </div>
              </div>
            </div>

            {/* Included items grid */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[0.95rem] font-semibold tracking-tight">
                  Included items <span className="text-very-dim font-normal text-[0.85rem]">· {pkg.count}</span>
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
                {memberItems.map((item) => {
                  const Icon = TYPE_ICONS[item.type];
                  const tone =
                    item.type === "team"
                      ? TEAM_ICON_TONE
                      : SINGLE_ICON_TONES[item.type as Exclude<MarketplaceItemType, "team">];
                  return (
                    <Link
                      key={item.id}
                      to={detailUrl(item)}
                      className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 hover:bg-card hover:border-border-strong transition-colors"
                    >
                      <div
                        className={cn(
                          "size-7 shrink-0 rounded-md border flex items-center justify-center",
                          tone,
                        )}
                      >
                        <Icon className="size-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium truncate">{item.name}</div>
                        <div className="text-[11px] text-very-dim truncate">{item.description}</div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </LobbyShell>
  );
}
