import { CheckCircle, MessageSquare } from "lucide-react";
import type { CockpitTaskItem } from "@armyofagents/shared";

export function CockpitReviewCard({
  items,
  onOpenTask,
  onAsk,
}: {
  items: CockpitTaskItem[];
  onOpenTask?: (issueId: string, title: string) => void;
  onAsk?: (text: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-border bg-background p-2"
      data-testid="cockpit-card-review"
    >
      <header className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
        <CheckCircle className="size-3.5" aria-hidden />
        Review
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
              onClick={() => onOpenTask?.(item.id, item.title)}
            >
              {item.identifier && (
                <span className="mr-1 shrink-0 text-[10px] text-muted-foreground">
                  {item.identifier}
                </span>
              )}
              <span className="truncate font-medium">{item.title}</span>
            </button>
            {onAsk && (
              <button
                type="button"
                aria-label="Ask Commander about this"
                className="ml-1 hidden shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:flex"
                onClick={() =>
                  onAsk(
                    `About ${item.identifier ?? item.title} — what changed and should I approve it?`,
                  )
                }
              >
                <MessageSquare className="size-3" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
