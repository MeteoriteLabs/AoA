import { Link } from "@/lib/router";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import type { MarketplaceProviderRef } from "@armyofagents/shared";
import { cn } from "@/lib/utils";
import { ProviderLogo } from "@/components/marketplace/ProviderLogo";

interface Props {
  packageId: string;
  name: string;
  count: number;
  provider?: MarketplaceProviderRef | null;
  expanded: boolean;
  hasUpdate: boolean;
  active: boolean;
  onToggleExpand: (packageId: string) => void;
}

export function SkillPackageRow({
  packageId,
  name,
  count,
  provider,
  expanded,
  hasUpdate,
  active,
  onToggleExpand,
}: Props) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const chevronName = expanded ? "chevron-down" : "chevron-right";
  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 px-3 py-2 text-[12.5px]",
        "border-l-[3px] border-amber-500",
        "bg-gradient-to-r from-amber-500/[0.04] from-0% to-transparent to-[36%]",
        "hover:from-amber-500/[0.075] hover:to-white/[0.02]",
        active && "border-l-brand bg-brand/10 text-brand",
      )}
    >
      <button
        type="button"
        aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
        onClick={() => onToggleExpand(packageId)}
        className="flex size-4 shrink-0 items-center justify-center text-dim hover:text-text"
      >
        <Chevron data-icon={chevronName} className="size-3.5" />
      </button>
      {provider ? (
        <ProviderLogo provider={provider} className="size-5 shrink-0 rounded-md" />
      ) : (
        <Sparkles className="size-3.5 shrink-0 text-amber-500" aria-hidden />
      )}
      <Link
        to={`/skills/package/${packageId}`}
        className="min-w-0 flex-1 truncate font-medium no-underline text-current hover:text-text"
      >
        {name}
      </Link>
      {hasUpdate && (
        <span
          title="Update available"
          className="inline-flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-500"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-amber-500" />
          upd
        </span>
      )}
      <span className="rounded-full bg-amber-500/10 px-1.5 text-[10px] font-medium tabular-nums text-amber-500">
        {count}
      </span>
      {active && (
        <span
          aria-hidden
          className="absolute right-2.5 top-1/2 size-[5px] -translate-y-1/2 rounded-full bg-brand shadow-[0_0_6px_rgba(184,45,28,0.55)]"
        />
      )}
    </div>
  );
}
