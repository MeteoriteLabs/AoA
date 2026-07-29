import type { GoalProgress } from "@armyofagents/shared";
import { Target } from "lucide-react";
import { Link } from "@/lib/router";
import { useHomeSummary } from "../../../hooks/useHomeSummary";
import { WidgetShell } from "./WidgetShell";
import type { WidgetProps } from "./types";

export function ObjectivesWidget({ companyId, editing }: WidgetProps) {
  const { data } = useHomeSummary(companyId);
  if (!data || data.goalProgress.length === 0) return null; // matches today: section hidden when empty
  return (
    <WidgetShell title="Objectives" icon={Target} to="/objectives" editing={editing}>
      <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {data.goalProgress.map((goal: GoalProgress) => (
          <Link key={goal.id} to={`/goals/${goal.id}`} className="flex items-center gap-3 px-4 py-3 text-sm text-inherit no-underline transition-colors hover:bg-accent/50">
            <Target className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{goal.title}</span>
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs ${goal.status === "at_risk" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-primary/10 text-primary"}`}>
                  {goal.status === "at_risk" ? "At Risk" : "Active"}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                {goal.totalTasks > 0 ? (
                  <>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${goal.progressPercent}%` }} />
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{goal.doneTasks}/{goal.totalTasks} tasks</span>
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">no tasks yet</span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </WidgetShell>
  );
}
