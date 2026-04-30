import { Link } from "react-router-dom";
import type { MarketplaceItemType } from "@armyofagents/shared";
import { TYPE_ICONS, TYPE_LABELS_PLURAL } from "@/lib/marketplace-constants";

export interface TypeTileProps {
  type: MarketplaceItemType;
  count: number;
}

export function TypeTile({ type, count }: TypeTileProps) {
  const Icon = TYPE_ICONS[type];
  const label = TYPE_LABELS_PLURAL[type];

  return (
    <Link
      to={`/marketplace/${type}`}
      className="block group rounded-lg border bg-card p-6 transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-8 w-8 mb-3 text-muted-foreground group-hover:text-foreground transition-colors" />
      <h3 className="text-lg font-semibold">{label}</h3>
      <p className="text-sm text-muted-foreground mt-1">
        {count} {count === 1 ? "item" : "items"}
      </p>
    </Link>
  );
}
