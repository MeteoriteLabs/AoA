import { MessageSquare as MessageSquareIcon } from "lucide-react";
import type { CockpitDiscussionItem } from "@armyofagents/shared";

export function CockpitDiscussionsCard({
  items,
  onOpenFullPage,
  onAsk,
}: {
  items: CockpitDiscussionItem[];
  onOpenFullPage?: (href: string) => void;
  onAsk?: (text: string) => void;
}) {
  if (items.length === 0) return null;

  // Phase 5B: Internal <header> removed — title/icon/count now live in the
  // CockpitSection trigger in CommanderCockpitPanel. Card renders only body rows.
  return (
    <div data-testid="cockpit-card-discussions">
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li
            key={item.id}
            className="group flex items-center gap-1 truncate rounded px-1 py-1 text-xs hover:bg-muted/50"
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => onOpenFullPage?.(`/discussions/${item.id}`)}
            >
              <span className="truncate font-medium">
                {item.title ?? "Untitled discussion"}
              </span>
              {item.reason === "extraction_failed" && (
                <span className="ml-1 shrink-0 rounded bg-destructive/10 px-1 text-[10px] text-destructive">
                  Failed
                </span>
              )}
              {item.pendingItemCount > 0 && (
                <span className="ml-1 shrink-0 rounded bg-brand/10 px-1 text-[10px] text-brand">
                  {item.pendingItemCount} pending
                </span>
              )}
            </button>
            {onAsk && (
              <button
                type="button"
                aria-label="Ask Commander about this"
                className="ml-1 hidden shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:flex"
                onClick={() =>
                  onAsk(
                    `Summarize the discussion "${item.title ?? "Untitled"}" and what action items are pending approval.`,
                  )
                }
              >
                <MessageSquareIcon className="size-3" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
