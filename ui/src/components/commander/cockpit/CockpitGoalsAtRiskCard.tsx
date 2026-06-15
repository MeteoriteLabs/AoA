/**
 * CockpitGoalsAtRiskCard — Opt-in cockpit card.
 *
 * Presentational only — receives items from the shared /cockpit query.
 * Returns null when items is empty so the card doesn't mount needlessly.
 */

import { AlertTriangle } from "lucide-react";
import type { CockpitGoalsAtRiskItem } from "@armyofagents/shared";

export function CockpitGoalsAtRiskCard({
  items,
  onOpenFullPage,
}: {
  items: CockpitGoalsAtRiskItem[];
  onOpenFullPage?: (href: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-border bg-background p-2"
      data-testid="cockpit-card-goalsAtRisk"
    >
      <header className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
        <AlertTriangle className="size-3.5" aria-hidden />
        Goals at risk
        <span className="ml-auto tabular-nums">{items.length}</span>
      </header>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li
            key={item.id}
            className="group flex items-center gap-1 truncate rounded px-1 py-1 text-xs hover:bg-muted/50"
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => onOpenFullPage?.(`/goals/${item.id}`)}
            >
              <span className="truncate font-medium">{item.title}</span>
            </button>
            <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              at risk
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
