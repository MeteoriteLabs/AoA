import { MessageSquare, Pin } from "lucide-react";
import type { CockpitPinnedEntityType, CockpitTaskItem, CommanderInputRef } from "@armyofagents/shared";
import { setCommanderRefDragData } from "./cockpitReferenceDrag";

/** Non-terminal statuses to show and their display labels */
const STATUS_LABEL: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
};

function taskRef(item: CockpitTaskItem): CommanderInputRef {
  return {
    v: 1,
    kind: "task",
    id: item.id,
    label: item.identifier ? `${item.identifier} ${item.title}` : item.title,
    route: `/issues/${item.id}`,
    detail: `status=${item.status}`,
  };
}

function taskPrompt(item: CockpitTaskItem) {
  return `Give me a quick status on ${item.identifier ?? item.title} - what's the latest progress?`;
}

export function CockpitMyTasksCard({
  items,
  onOpenTask,
  onAsk,
  onReference,
  onPin,
}: {
  items: CockpitTaskItem[];
  onOpenTask?: (issueId: string, title: string) => void;
  onAsk?: (text: string) => void;
  onReference?: (ref: CommanderInputRef, suggestedPrompt?: string) => void;
  onPin?: (entityType: CockpitPinnedEntityType, entityId: string) => void;
}) {
  if (items.length === 0) return null;

  // Group by status in a stable order
  const byStatus = new Map<string, CockpitTaskItem[]>();
  for (const item of items) {
    const group = byStatus.get(item.status) ?? [];
    group.push(item);
    byStatus.set(item.status, group);
  }

  // Phase 5B: Internal <header> removed — title/icon/count now live in the
  // CockpitSection trigger in CommanderCockpitPanel. Card renders only body rows.
  return (
    <div data-testid="cockpit-card-my-tasks">
      {Array.from(byStatus.entries()).map(([status, statusItems]) => (
        <div key={status}>
          <p className="mt-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {STATUS_LABEL[status] ?? status}
          </p>
          <ul className="space-y-0.5">
            {statusItems.map((item) => (
              <li
                key={item.id}
                draggable
                onDragStart={(event) => setCommanderRefDragData(event.dataTransfer, taskRef(item), taskPrompt(item))}
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
                    onClick={() => {
                      const prompt = taskPrompt(item);
                      const ref = taskRef(item);
                      if (onReference) onReference(ref, prompt);
                      else onAsk(prompt);
                    }}
                  >
                    <MessageSquare className="size-3" aria-hidden />
                  </button>
                )}
                {onPin && (
                  <button
                    type="button"
                    aria-label="Pin"
                    className="ml-1 hidden shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:flex"
                    onClick={() => onPin("task", item.id)}
                  >
                    <Pin className="size-3" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
