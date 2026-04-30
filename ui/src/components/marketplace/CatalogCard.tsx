import { Link } from "react-router-dom";
import type { CatalogItem } from "@armyofagents/shared";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrustBadge } from "./TrustBadge";
import { TYPE_ICONS, TYPE_LABELS } from "@/lib/marketplace-constants";

export interface CatalogCardProps {
  item: CatalogItem;
}

/**
 * Build the detail page URL for a catalog item.
 *
 * Catalog ID format: "{type}:{slug}" where slug may contain slashes
 * (e.g. "plugin:aoa-curated/aoa-plugin-slack").
 *
 * URL: /marketplace/{type}/{slug-with-slashes-preserved}
 *
 * The route uses a splat (`:type/:slug/*`) so slashes in slugs map cleanly
 * to URL path segments — no URL-encoding hack needed.
 */
export function detailUrl(item: CatalogItem): string {
  const colonIdx = item.id.indexOf(":");
  const slug = item.id.slice(colonIdx + 1);
  return `/marketplace/${item.type}/${slug}`;
}

/**
 * Uniform card for a catalog item — used in homepage grids, type browse
 * grids, and search results.
 */
export function CatalogCard({ item }: CatalogCardProps) {
  const Icon = TYPE_ICONS[item.type];
  const typeLabel = TYPE_LABELS[item.type];

  return (
    <Link
      to={detailUrl(item)}
      className="block hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
    >
      <Card className="h-full transition-colors hover:bg-accent/50">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{typeLabel}</span>
            </div>
            <TrustBadge tier={item.trust.tier} className="shrink-0" />
          </div>
          <h3 className="text-base font-semibold mt-2 line-clamp-1">{item.name}</h3>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
            {item.description}
          </p>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              v{item.version}
            </Badge>
            {item.tags.slice(0, 2).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
