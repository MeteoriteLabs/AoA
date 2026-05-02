import { useMemo, useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useCatalog } from "@/hooks/useCatalog";
import { MarketplaceLayout } from "@/components/marketplace/MarketplaceLayout";
import { TrustBadge } from "@/components/marketplace/TrustBadge";
import { ReadmeRender } from "@/components/marketplace/ReadmeRender";
import { PluginInstallModal } from "@/components/marketplace/install/PluginInstallModal";
import { SnapshotInstallModal } from "@/components/marketplace/install/SnapshotInstallModal";
import {
  TYPE_ICONS,
  TYPE_LABELS,
  TYPE_LABELS_PLURAL,
  pathToItemType,
} from "@/lib/marketplace-constants";
import type { MarketplaceItemType } from "@armyofagents/shared";

const CAP_PREVIEW = 8;

const TYPE_AVATAR_BG: Record<MarketplaceItemType, string> = {
  plugin: "bg-violet-500/15 text-violet-400",
  skill:  "bg-teal-500/15   text-teal-400",
  agent:  "bg-blue-500/15   text-blue-400",
  team:   "bg-amber-500/15  text-amber-400",
};

export default function MarketplaceDetail() {
  const params = useParams<{ type: string; slug: string; "*": string }>();
  const itemType = params.type ? pathToItemType(params.type) : null;
  const slugSegment = params.slug ?? "";
  const restPath = params["*"] ?? "";
  const fullSlug = restPath ? `${slugSegment}/${restPath}` : slugSegment;
  const catalogItemId = itemType ? `${itemType}:${fullSlug}` : null;

  const { data: catalog, isLoading, error } = useCatalog();
  const [readmeText, setReadmeText] = useState<string | null>(null);
  const [readmeError, setReadmeError] = useState<string | null>(null);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [showAllCaps, setShowAllCaps] = useState(false);

  const item = useMemo(() => {
    if (!catalog || !catalogItemId) return null;
    return catalog.items.find((i) => i.id === catalogItemId) ?? null;
  }, [catalog, catalogItemId]);

  useEffect(() => {
    if (!item) return;
    if (item.content?.inline) {
      setReadmeText(item.content.inline);
      return;
    }
    if (!item.resourceUrl) {
      setReadmeText("(No README available)");
      return;
    }
    setReadmeText(null);
    setReadmeError(null);
    fetch(item.resourceUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((text) => setReadmeText(text))
      .catch((err) => setReadmeError(err.message));
  }, [item]);

  const typeBreadcrumb = (type: MarketplaceItemType) => ({
    label: TYPE_LABELS_PLURAL[type],
    to: `/marketplace?type=${type}`,
  });

  if (!itemType) {
    return (
      <MarketplaceLayout breadcrumbs={[{ label: params.type ?? "?" }]}>
        <div className="text-center py-12">
          <p className="text-lg font-medium">Unknown item type</p>
          <Link
            to="/marketplace"
            className="text-sm text-primary hover:underline mt-2 inline-block"
          >
            ← Back to marketplace
          </Link>
        </div>
      </MarketplaceLayout>
    );
  }

  if (isLoading) {
    return (
      <MarketplaceLayout breadcrumbs={[typeBreadcrumb(itemType)]}>
        <div className="space-y-6 max-w-4xl">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-4 w-80" />
          <Separator />
          <Skeleton className="h-40 w-full" />
        </div>
      </MarketplaceLayout>
    );
  }

  if (error || !catalog) {
    return (
      <MarketplaceLayout breadcrumbs={[typeBreadcrumb(itemType)]}>
        <div className="text-center py-12">
          <p className="text-lg font-medium">Could not load this item</p>
          <p className="text-sm text-muted-foreground mt-2">
            {error?.message ?? "Catalog unavailable"}
          </p>
          <Link
            to={`/marketplace?type=${itemType}`}
            className="text-sm text-primary hover:underline mt-3 inline-block"
          >
            ← Back to {TYPE_LABELS_PLURAL[itemType]}
          </Link>
        </div>
      </MarketplaceLayout>
    );
  }

  if (!item) {
    return (
      <MarketplaceLayout breadcrumbs={[typeBreadcrumb(itemType)]}>
        <div className="text-center py-12">
          <p className="text-lg font-medium">Item not found: {catalogItemId}</p>
          <Link
            to={`/marketplace?type=${itemType}`}
            className="text-sm text-primary hover:underline mt-2 inline-block"
          >
            ← Back to {TYPE_LABELS_PLURAL[itemType]}
          </Link>
        </div>
      </MarketplaceLayout>
    );
  }

  const Icon = TYPE_ICONS[item.type];
  const caps = item.capabilities ?? [];
  const visibleCaps = showAllCaps ? caps : caps.slice(0, CAP_PREVIEW);
  const hiddenCapsCount = caps.length - CAP_PREVIEW;

  return (
    <MarketplaceLayout
      breadcrumbs={[
        typeBreadcrumb(item.type),
        { label: item.name },
      ]}
    >
      <div className="max-w-4xl space-y-8">

        {/* ── Hero ───────────────────────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row gap-8">

          {/* Left: avatar + info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-4 mb-4">
              <div className={cn(
                "w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold shrink-0",
                TYPE_AVATAR_BG[item.type],
              )}>
                {item.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 pt-1">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{TYPE_LABELS[item.type]}</span>
                  <span>·</span>
                  <Badge variant="outline" className="text-xs">v{item.version}</Badge>
                </div>
                <h1 className="text-2xl font-bold leading-tight">{item.name}</h1>
              </div>
            </div>
            <p className="text-muted-foreground mb-4">{item.description}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <TrustBadge tier={item.trust.tier} />
              {item.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
              ))}
            </div>
          </div>

          {/* Right: install card */}
          <div className="lg:w-60 shrink-0">
            <div className="border rounded-xl p-5 bg-card space-y-4">
              <div>
                <p className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground mb-1">
                  Version
                </p>
                <p className="text-sm font-medium">v{item.version}</p>
              </div>
              {item.source.url && (
                <div>
                  <p className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground mb-1">
                    Source
                  </p>
                  <a
                    href={item.source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  >
                    View on GitHub <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              <Button className="w-full" onClick={() => setInstallModalOpen(true)}>
                Install
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        {/* ── Capabilities ───────────────────────────────────────────────────── */}
        {caps.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3">
              Capabilities
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({caps.length})
              </span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {visibleCaps.map((cap) => (
                <div
                  key={cap.id}
                  className="flex items-start gap-2 bg-muted/40 rounded-lg px-3 py-2.5"
                >
                  <code className="text-[11px] bg-background border rounded px-1.5 py-0.5 shrink-0 mt-0.5 leading-snug">
                    {cap.id}
                  </code>
                  <span className="text-xs text-muted-foreground leading-relaxed">
                    {cap.description}
                  </span>
                </div>
              ))}
            </div>
            {hiddenCapsCount > 0 && (
              <button
                className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowAllCaps(!showAllCaps)}
              >
                {showAllCaps ? "Show less" : `Show ${hiddenCapsCount} more`}
              </button>
            )}
          </section>
        )}

        {/* ── Dependencies ───────────────────────────────────────────────────── */}
        {item.requires && item.requires.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold mb-3">Dependencies</h2>
            <ul className="space-y-1">
              {item.requires.map((req) => (
                <li key={req.id} className="text-sm">
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{req.id}</code>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── README ─────────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-lg font-semibold mb-3">README</h2>
          {readmeError ? (
            <p className="text-sm text-destructive">Could not load README: {readmeError}</p>
          ) : readmeText === null ? (
            <p className="text-sm text-muted-foreground">Loading README…</p>
          ) : (
            <ReadmeRender source={readmeText} />
          )}
        </section>
      </div>

      {installModalOpen && item.type === "plugin" && (
        <PluginInstallModal
          item={item}
          open={installModalOpen}
          onOpenChange={setInstallModalOpen}
        />
      )}
      {installModalOpen && item.type !== "plugin" && (
        <SnapshotInstallModal
          item={item}
          open={installModalOpen}
          onOpenChange={setInstallModalOpen}
        />
      )}
    </MarketplaceLayout>
  );
}
