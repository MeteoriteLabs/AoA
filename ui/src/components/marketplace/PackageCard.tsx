import { Link } from "react-router-dom";
import { BadgeCheck, Github, Layers, Sparkles } from "lucide-react";
import type { MarketplacePackage } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";
import { StackedIcon } from "./StackedIcon";
import { cn } from "@/lib/utils";

export interface PackageCardProps {
  pkg: MarketplacePackage;
}

/**
 * Stable URL for a package detail page. Package IDs may contain a slash
 * (e.g. `garrytan/gstack` for synthesized packages), and the route
 * `/marketplace/package/:id/*` uses a splat to capture the trailing segment.
 */
export function packageDetailUrl(pkg: MarketplacePackage): string {
  return `/marketplace/package/${pkg.id}`;
}

/** Extract "owner/repo" short label from a github URL. Falls back to id. */
function shortSource(url: string, fallback: string): string {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (m) return `${m[1]}/${m[2]!.replace(/\.git$/, "")}`;
  return fallback;
}

/** Extract owner portion of a github URL for the by-line. */
function authorFromSource(url: string): string {
  const m = url.match(/github\.com\/([^/]+)/i);
  return m?.[1] ?? "community";
}

export function PackageCard({ pkg }: PackageCardProps) {
  const repoShort = shortSource(pkg.sourceUrl, pkg.id);
  const author = authorFromSource(pkg.sourceUrl);

  return (
    <div className="relative">
      <Link
        to={packageDetailUrl(pkg)}
        className="block hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
      >
        <div className="relative card-hover rounded-xl border border-border-strong bg-card overflow-hidden p-4 pl-5">
          {/* Left-edge amber accent rule */}
          <span aria-hidden className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r bg-amber-500" />

          {/* Type chip — top-right, with Layers icon */}
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 uppercase text-[10px] tracking-[0.1em] font-semibold text-very-dim leading-none">
            <Layers className="size-3" />
            PACKAGE
          </span>

          {/* Header: stacked icon + name + author */}
          <div className="flex items-start gap-3 pr-20 sm:pr-24">
            <StackedIcon icon={Sparkles} tone="amber" className="size-12 shrink-0" />
            <div className="min-w-0 flex-1 mt-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="text-[1.05rem] font-semibold tracking-tight truncate">{pkg.name}</h3>
                {pkg.verified && (
                  <BadgeCheck
                    data-testid="package-verified"
                    className="size-4 shrink-0 text-[hsl(208_80%_60%)]"
                    aria-label="Verified"
                  />
                )}
                <span
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold",
                    "bg-amber-500/10 border border-amber-500/25 text-amber-400",
                  )}
                >
                  {pkg.count} items
                </span>
              </div>
              <div className="mt-0.5 text-[12px] text-very-dim truncate">by {author}</div>
            </div>
          </div>

          {/* Footer: github source + install all */}
          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 text-[11.5px] text-very-dim">
              <Github className="size-3 shrink-0" />
              <span className="truncate">{repoShort}</span>
            </div>
            <Button
              size="sm"
              className="text-[11.5px] h-7 px-3 shrink-0"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                // Phase C MVP: "Install all" is a placeholder. Bulk install
                // wiring is deferred to Phase D / future iteration.
              }}
            >
              Install all
            </Button>
          </div>
        </div>
      </Link>
    </div>
  );
}
