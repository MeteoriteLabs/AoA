import { MessageSquare } from "lucide-react";
import type { CockpitRunItem } from "@armyofagents/shared";

// Phase 5B: Internal <header> removed — title/icon/count now live in the
// CockpitSection trigger in CommanderCockpitPanel. Card renders only body rows.

export function CockpitRunningCard({
  runs,
  onOpenTask,
  onAsk,
}: {
  runs: CockpitRunItem[];
  onOpenTask?: (issueId: string, title: string) => void;
  onAsk?: (text: string) => void;
}) {
  if (runs.length === 0) return null;

  return (
    <div data-testid="cockpit-card-running">
      <ul className="space-y-0.5">
        {runs.map((r) => (
          <li
            key={r.id}
            className="group flex items-center gap-1 truncate rounded px-1 py-1 text-xs hover:bg-muted/50"
          >
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left"
              onClick={() => {
                if (r.issueId && onOpenTask) {
                  onOpenTask(r.issueId, r.agentName ? `Run by ${r.agentName}` : "Running task");
                }
              }}
            >
              <span className="truncate font-medium">{r.agentName ?? "Agent"}</span>
            </button>
            <span className="shrink-0 text-[10px] uppercase text-muted-foreground">
              {r.status}
            </span>
            {onAsk && (
              <button
                type="button"
                aria-label="Ask Commander about this"
                className="ml-1 hidden shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:flex"
                onClick={() =>
                  onAsk(
                    `What is ${r.agentName ?? "the agent"} working on right now? Is there anything I should know?`,
                  )
                }
              >
                <MessageSquare className="size-3" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
