import type { MarketplaceItemType } from "@armyofagents/shared";
import { cn } from "@/lib/utils";

const LABELS: Record<MarketplaceItemType, string> = {
  skill: "SKILL",
  plugin: "PLUGIN",
  agent: "AGENT",
  team: "TEAM",
};

export interface TypeChipProps {
  type: MarketplaceItemType;
  className?: string;
}

/**
 * Small uppercase type chip rendered in the top-right corner of every
 * marketplace card. Monochrome by design — the colored hero icon already
 * carries the type signal; the chip is just a textual confirmation.
 */
export function TypeChip({ type, className }: TypeChipProps) {
  return (
    <span
      className={cn(
        "uppercase text-[10px] tracking-[0.1em] font-semibold text-very-dim leading-none",
        className,
      )}
    >
      {LABELS[type]}
    </span>
  );
}
