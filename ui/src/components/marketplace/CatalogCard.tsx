import { useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Bot, Github } from "lucide-react";
import type { CatalogItem, PluginRecord } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TYPE_ICONS, SINGLE_ICON_TONES, shortSource, authorFromSource } from "@/lib/marketplace-constants";
import { PluginInstallModal } from "@/components/marketplace/install/PluginInstallModal";
import { SnapshotInstallModal } from "@/components/marketplace/install/SnapshotInstallModal";
import { TypeChip } from "./TypeChip";
import { StackedIcon } from "./StackedIcon";
import { ProviderLogo } from "./ProviderLogo";
import { cn } from "@/lib/utils";

export interface CatalogCardProps {
  item: CatalogItem;
  installedByPackageName?: Map<string, PluginRecord>;
}

export function detailUrl(item: CatalogItem): string {
  const colonIdx = item.id.indexOf(":");
  const slug = item.id.slice(colonIdx + 1);
  return `/marketplace/${item.type}/${slug}`;
}

export function CatalogCard({ item, installedByPackageName }: CatalogCardProps) {
  const [installOpen, setInstallOpen] = useState(false);
  const installedPlugin = item.npm?.packageName
    ? installedByPackageName?.get(item.npm.packageName)
    : undefined;

  const isVerified = item.trust.tier === "verified";
  const Icon = TYPE_ICONS[item.type];
  const author = item.provider?.name ?? authorFromSource(item.source.url);
  const repoShort = shortSource(item.source.url, item.source.locator);

  return (
    <div className="relative">
      <Link
        to={detailUrl(item)}
        className="block hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
      >
        <div className="relative card-hover rounded-xl border border-border-strong bg-card overflow-hidden p-4">
          {/* Type chip — top-right */}
          <TypeChip type={item.type} className="absolute right-3 top-3" />

          {/* Header: hero icon + name + author */}
          <div className="flex items-start gap-3 pr-16 sm:pr-20">
            {item.provider ? (
              <ProviderLogo provider={item.provider} className="size-12 shrink-0 rounded-2xl" />
            ) : item.type === "team" ? (
              <StackedIcon icon={Bot} tone="teal" className="size-12 shrink-0" />
            ) : (
              <div
                data-testid="catalog-type-avatar"
                className={cn("size-12 shrink-0 rounded-2xl border flex items-center justify-center", SINGLE_ICON_TONES[item.type])}
              >
                <Icon className="size-5" />
              </div>
            )}
            <div className="min-w-0 flex-1 mt-0.5">
              <div className="flex items-center gap-1.5">
                <h3 className="text-[1.05rem] font-semibold tracking-tight truncate">{item.name}</h3>
                {/* Verified-only marker by design (v3 mockup). Community + unverified items
                    show no badge here — the full 3-state TrustBadge lives on the detail page. */}
                {isVerified && (
                  <BadgeCheck
                    data-testid="verified-check"
                    className="size-4 shrink-0 text-[hsl(208_80%_60%)]"
                    aria-label="Verified"
                  />
                )}
              </div>
              <div className="mt-0.5 text-[12px] text-very-dim truncate">by {author}</div>
            </div>
          </div>

          {/* Description */}
          <p className="mt-3 text-[12.5px] text-dim leading-relaxed line-clamp-2">
            {item.description}
          </p>

          {/* Footer row: github source on left, install on right */}
          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 text-[11.5px] text-very-dim">
              <Github className="size-3 shrink-0" />
              <span className="truncate">{repoShort}</span>
            </div>
            {installedPlugin ? (
              installedPlugin.status === "ready" ? (
                <Badge className="text-[11px] h-7 px-2.5 shrink-0 bg-green-600 hover:bg-green-600 cursor-default">
                  Installed
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[11px] h-7 px-2.5 shrink-0 cursor-default">
                  Pending
                </Badge>
              )
            ) : (
              <Button
                size="sm"
                className="text-[11.5px] h-7 px-3 shrink-0"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setInstallOpen(true);
                }}
              >
                Install
              </Button>
            )}
          </div>
        </div>
      </Link>

      {item.type === "plugin" && (
        <PluginInstallModal item={item} open={installOpen} onOpenChange={setInstallOpen} />
      )}
      {item.type !== "plugin" && (
        <SnapshotInstallModal item={item} open={installOpen} onOpenChange={setInstallOpen} />
      )}
    </div>
  );
}
