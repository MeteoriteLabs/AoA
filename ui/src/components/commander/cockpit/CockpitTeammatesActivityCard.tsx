/**
 * CockpitTeammatesActivityCard — Opt-in cockpit card.
 *
 * Presentational only — receives items from the shared /cockpit query.
 * Returns null when items is empty so the card doesn't mount needlessly.
 *
 * Items are recent activity from human teammates (RBAC-scoped server-side).
 * Uses the shared activityFormat helpers (DRY — no verb-map duplication).
 * Click: if entityLink returns a path, navigate there; otherwise no-op.
 */

import { Users } from "lucide-react";
import type { CockpitTeammatesActivityItem } from "@armyofagents/shared";
import { activityVerb, entityLink } from "../../../lib/activityFormat";
import { timeAgo } from "../../../lib/timeAgo";

export function CockpitTeammatesActivityCard({
  items,
  onOpenFullPage,
}: {
  items: CockpitTeammatesActivityItem[];
  onOpenFullPage?: (href: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-border bg-background p-2"
      data-testid="cockpit-card-teammatesActivity"
    >
      <header className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
        <Users className="size-3.5" aria-hidden />
        Teammates' activity
        <span className="ml-auto tabular-nums">{items.length}</span>
      </header>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const href = entityLink(item.entityType, item.entityId);
          return (
            <li
              key={item.id}
              className="group flex items-center gap-1 truncate rounded px-1 py-1 text-xs hover:bg-muted/50"
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left"
                onClick={() => {
                  if (href) onOpenFullPage?.(href);
                }}
              >
                <span className="truncate font-medium">
                  {activityVerb(item.action)}{" "}
                  <span className="text-muted-foreground">{item.entityType}</span>
                </span>
              </button>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {timeAgo(item.createdAt)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
