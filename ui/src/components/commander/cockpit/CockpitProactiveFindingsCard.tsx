/**
 * CockpitProactiveFindingsCard — Opt-in cockpit card.
 *
 * Presentational only — receives items from the shared /cockpit query.
 * Returns null when items is empty so the card doesn't mount needlessly.
 *
 * Items are the Commander's recent unread proactive check notifications.
 * Click: if the item has a relatedEntity, navigate to /inbox; otherwise
 * open Commander chat pre-filled with the finding title.
 */

import { Zap } from "lucide-react";
import type { CockpitProactiveItem } from "@armyofagents/shared";

export function CockpitProactiveFindingsCard({
  items,
  onOpenFullPage,
  onAsk,
}: {
  items: CockpitProactiveItem[];
  onOpenFullPage?: (href: string) => void;
  onAsk?: (text: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-border bg-background p-2"
      data-testid="cockpit-card-proactiveFindings"
    >
      <header className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
        <Zap className="size-3.5" aria-hidden />
        Proactive findings
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
              onClick={() => {
                if (item.relatedEntityType && item.relatedEntityId) {
                  onOpenFullPage?.("/inbox");
                } else {
                  onAsk?.(item.title);
                }
              }}
            >
              <span className="truncate font-medium">{item.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
