import { useState } from "react";
import { Link } from "react-router-dom";
import type { CatalogItem } from "@armyofagents/shared";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrustBadge } from "./TrustBadge";
import { TYPE_ICONS, TYPE_LABELS } from "@/lib/marketplace-constants";
import { PluginInstallModal } from "@/components/marketplace/install/PluginInstallModal";
import { SnapshotInstallModal } from "@/components/marketplace/install/SnapshotInstallModal";

export interface CatalogCardProps {
  item: CatalogItem;
}

export function detailUrl(item: CatalogItem): string {
  const colonIdx = item.id.indexOf(":");
  const slug = item.id.slice(colonIdx + 1);
  return `/marketplace/${item.type}/${slug}`;
}

export function CatalogCard({ item }: CatalogCardProps) {
  const Icon = TYPE_ICONS[item.type];
  const typeLabel = TYPE_LABELS[item.type];
  const [installOpen, setInstallOpen] = useState(false);

  return (
    <div>
      <Link
        to={detailUrl(item)}
        className="block hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
      >
        <Card className="h-full transition-colors hover:bg-accent/50 rounded-xl border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{typeLabel}</span>
              </div>
              <TrustBadge tier={item.trust.tier} showLabel={false} className="shrink-0" />
            </div>
            <h3 className="text-base font-semibold mt-2 line-clamp-1">{item.name}</h3>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
              {item.description}
            </p>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                <Badge variant="outline" className="text-xs shrink-0">
                  v{item.version}
                </Badge>
                {item.tags.slice(0, 1).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs shrink-0">
                    {tag}
                  </Badge>
                ))}
              </div>
              <Button
                size="sm"
                className="text-xs h-7 px-2.5 shrink-0"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setInstallOpen(true);
                }}
              >
                Install
              </Button>
            </div>
          </CardContent>
        </Card>
      </Link>

      {installOpen && item.type === "plugin" && (
        <PluginInstallModal
          item={item}
          open={installOpen}
          onOpenChange={setInstallOpen}
        />
      )}
      {installOpen && item.type !== "plugin" && (
        <SnapshotInstallModal
          item={item}
          open={installOpen}
          onOpenChange={setInstallOpen}
        />
      )}
    </div>
  );
}
