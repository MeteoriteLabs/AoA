import { Bot, Puzzle, Sparkles } from "lucide-react";
import type { MarketplaceItemType } from "@armyofagents/shared";
import { cn } from "@/lib/utils";

export interface MarketplaceFilterChipsProps {
  /** Currently selected type filter. `null` means "All". */
  value: MarketplaceItemType | null;
  /** Called when the user picks a type. `null` for the "All" chip. */
  onChange: (next: MarketplaceItemType | null) => void;
  /** Per-type counts shown inline as a dim suffix. */
  counts: Partial<Record<MarketplaceItemType, number>>;
}

const CHIPS: Array<{
  key: MarketplaceItemType | "all";
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}> = [
  { key: "all", label: "All" },
  { key: "skill", label: "Skills", icon: Sparkles },
  { key: "plugin", label: "Plugins", icon: Puzzle },
  { key: "agent", label: "Agents", icon: Bot },
  { key: "team", label: "Teams", icon: Bot },
];

/**
 * Top-level type-filter pill row for the marketplace browse page.
 * Single-select; the `All` chip resets to `value=null`. The counts prop is
 * optional per-key — chips render their count if present.
 */
export function MarketplaceFilterChips({ value, onChange, counts }: MarketplaceFilterChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {CHIPS.map((chip) => {
        const isActive = chip.key === "all" ? value === null : value === chip.key;
        const count = chip.key === "all" ? undefined : counts[chip.key as MarketplaceItemType];
        return (
          <button
            key={chip.key}
            type="button"
            data-active={isActive ? "true" : undefined}
            onClick={() => onChange(chip.key === "all" ? null : (chip.key as MarketplaceItemType))}
            className={cn(
              "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12.5px] font-medium transition-colors border",
              isActive
                ? "bg-foreground text-bg border-foreground"
                : "bg-card border-border text-foreground/[0.78] hover:bg-card-2 hover:text-foreground hover:border-border-strong",
            )}
          >
            {chip.icon && <chip.icon className="size-3.5" />}
            <span>{chip.label}</span>
            {count !== undefined && (
              <span className={cn("text-[11px]", isActive ? "opacity-60" : "text-very-dim")}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
