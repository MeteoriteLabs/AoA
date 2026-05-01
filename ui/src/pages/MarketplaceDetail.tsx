import { useMemo, useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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

/**
 * Detail page for a single catalog item: /marketplace/{type}/{slug}
 *
 * Slug may contain slashes (e.g. "aoa-curated/aoa-plugin-slack"), so the
 * route is declared with a splat (`:slug/*`). We re-join the splat tail
 * here to recover the full slug → catalog id ("{type}:{slug}").
 *
 * Sections:
 *   - Header: type + version + trust + tags + Install button
 *   - Capabilities (plugins) — list of {id, description}
 *   - Dependencies (teams/agents) — list of catalog IDs
 *   - README — inline content if present, else HTTP fetch from resourceUrl
 *   - Source link to commit-pinned repo URL
 *
 * Install dispatches to type-specific modals (M.3b.H):
 *   - plugin → PluginInstallModal (instance-scoped, no company picker)
 *   - skill/agent/team → SnapshotInstallModal (company + dept picker)
 * The modals own their toast + polling lifecycle.
 */
export default function MarketplaceDetail() {
  const params = useParams<{ type: string; slug: string; "*": string }>();
  const itemType = params.type ? pathToItemType(params.type) : null;
  // Splat preserves slashes — combine slug + rest if rest non-empty.
  const slugSegment = params.slug ?? "";
  const restPath = params["*"] ?? "";
  const fullSlug = restPath ? `${slugSegment}/${restPath}` : slugSegment;
  const catalogItemId = itemType ? `${itemType}:${fullSlug}` : null;

  const { data: catalog, isLoading, error } = useCatalog();
  const [readmeText, setReadmeText] = useState<string | null>(null);
  const [readmeError, setReadmeError] = useState<string | null>(null);
  const [installModalOpen, setInstallModalOpen] = useState(false);

  const item = useMemo(() => {
    if (!catalog || !catalogItemId) return null;
    return catalog.items.find((i) => i.id === catalogItemId) ?? null;
  }, [catalog, catalogItemId]);

  // Fetch README (inline preferred, else HTTP)
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
      <MarketplaceLayout
        breadcrumbs={[{ label: TYPE_LABELS_PLURAL[itemType], to: `/marketplace/${itemType}` }]}
      >
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
      <MarketplaceLayout
        breadcrumbs={[{ label: TYPE_LABELS_PLURAL[itemType], to: `/marketplace/${itemType}` }]}
      >
        <div className="text-center py-12">
          <p className="text-lg font-medium">Could not load this item</p>
          <p className="text-sm text-muted-foreground mt-2">
            {error?.message ?? "Catalog unavailable"}
          </p>
          <Link
            to={`/marketplace/${itemType}`}
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
      <MarketplaceLayout
        breadcrumbs={[{ label: TYPE_LABELS_PLURAL[itemType], to: `/marketplace/${itemType}` }]}
      >
        <div className="text-center py-12">
          <p className="text-lg font-medium">Item not found: {catalogItemId}</p>
          <Link
            to={`/marketplace/${itemType}`}
            className="text-sm text-primary hover:underline mt-2 inline-block"
          >
            ← Back to {TYPE_LABELS_PLURAL[itemType]}
          </Link>
        </div>
      </MarketplaceLayout>
    );
  }

  const Icon = TYPE_ICONS[item.type];

  return (
    <MarketplaceLayout
      breadcrumbs={[
        { label: TYPE_LABELS_PLURAL[item.type], to: `/marketplace/${item.type}` },
        { label: item.name },
      ]}
    >
      <div className="space-y-8 max-w-4xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Icon className="h-4 w-4" />
              <span>{TYPE_LABELS[item.type]}</span>
              <span>·</span>
              <Badge variant="outline" className="text-xs">v{item.version}</Badge>
            </div>
            <h1 className="text-3xl font-semibold">{item.name}</h1>
            <p className="text-muted-foreground mt-2">{item.description}</p>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <TrustBadge tier={item.trust.tier} />
              {item.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
              ))}
            </div>
          </div>
          <Button onClick={() => setInstallModalOpen(true)}>Install</Button>
        </div>

        <Separator />

        {item.capabilities && item.capabilities.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Capabilities</h2>
            <ul className="space-y-2">
              {item.capabilities.map((cap) => (
                <li key={cap.id} className="text-sm">
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{cap.id}</code>
                  <span className="text-muted-foreground ml-2">— {cap.description}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {item.requires && item.requires.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Dependencies</h2>
            <ul className="space-y-1">
              {item.requires.map((req) => (
                <li key={req.id} className="text-sm">
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{req.id}</code>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="text-xl font-semibold mb-3">README</h2>
          {readmeError ? (
            <p className="text-sm text-destructive">Could not load README: {readmeError}</p>
          ) : readmeText === null ? (
            <p className="text-sm text-muted-foreground">Loading README…</p>
          ) : (
            <ReadmeRender source={readmeText} />
          )}
        </section>

        {item.source.url && (
          <section>
            <h2 className="text-xl font-semibold mb-3">Source</h2>
            <a
              href={item.source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline inline-flex items-center gap-1"
            >
              {item.source.url}
              <ExternalLink className="h-3 w-3" />
            </a>
          </section>
        )}
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
