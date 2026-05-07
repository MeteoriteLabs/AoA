import { useState } from "react";
import { Link } from "react-router-dom";
import { BadgeCheck, Bot, Github } from "lucide-react";
import type { CatalogItem, PluginRecord, MarketplaceItemType } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TYPE_ICONS } from "@/lib/marketplace-constants";
import { PluginInstallModal } from "@/components/marketplace/install/PluginInstallModal";
import { SnapshotInstallModal } from "@/components/marketplace/install/SnapshotInstallModal";
import { TypeChip } from "./TypeChip";
import { StackedIcon } from "./StackedIcon";
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

/** Extract "owner/repo" from a github URL. Falls back to the locator if non-github. */
function shortSource(url: string, locator: string): string {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (m) return `${m[1]}/${m[2]!.replace(/\.git$/, "")}`;
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.replace(/^\/+|\/+$/g, "");
  } catch {
    return locator;
  }
}

/** Extract "owner" portion of "owner/repo". Used as the by-line. */
function authorFromSource(url: string): string {
  const m = url.match(/github\.com\/([^/]+)/i);
  if (m) return m[1] ?? "community";
  return "community";
}

const SINGLE_ICON_TONES: Record<Exclude<MarketplaceItemType, "team">, string> = {
  skill: "bg-amber-500/15 border-amber-500/30 text-amber-500",
  plugin: "bg-blue-500/15 border-blue-500/30 text-blue-500",
  agent: "bg-purple-500/15 border-purple-500/30 text-purple-500",
};

export function CatalogCard({ item, installedByPackageName }: CatalogCardProps) {
  const [installOpen, setInstallOpen] = useState(false);
  const installedPlugin = item.npm?.packageName
    ? installedByPackageName?.get(item.npm.packageName)
    : undefined;

  const isVerified = item.trust.tier === "verified";
  const Icon = TYPE_ICONS[item.type];
  const author = authorFromSource(item.source.url);
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
            {item.type === "team" ? (
              <StackedIcon icon={Bot} tone="teal" className="size-12 shrink-0" />
            ) : (
              <div
                className={cn(
                  "size-12 shrink-0 rounded-2xl border flex items-center justify-center",
                  SINGLE_ICON_TONES[item.type as Exclude<MarketplaceItemType, "team">],
                )}
              >
                <Icon className="size-5" />
              </div>
            )}
            <div className="min-w-0 flex-1 mt-0.5">
              <div className="flex items-center gap-1.5">
                <h3 className="text-[1.05rem] font-semibold tracking-tight truncate">{item.name}</h3>
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
