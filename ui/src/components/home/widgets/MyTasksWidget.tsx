import { useQuery } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";
import type { Issue } from "@armyofagents/shared";
import { Link } from "@/lib/router";
import { issuesApi } from "../../../api/issues";
import { queryKeys } from "../../../lib/queryKeys";
import { WidgetShell } from "./WidgetShell";
import type { WidgetProps } from "./types";

const TERMINAL = new Set(["done", "cancelled"]);

export function MyTasksWidget({ companyId, editing }: WidgetProps) {
  const { data } = useQuery({
    queryKey: queryKeys.issues.listAssignedToMe(companyId),
    queryFn: () => issuesApi.list(companyId, { assigneeUserId: "me" }),
    enabled: !!companyId,
  });
  const tasks = (data ?? []).filter((t: Issue) => !TERMINAL.has(t.status)).slice(0, 5);
  if (!data || tasks.length === 0) return null;
  return (
    <WidgetShell title="My tasks" icon={ListChecks} to="/issues" editing={editing}>
      <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {tasks.map((t: Issue) => (
          <Link key={t.id} to={`/issues/${t.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm text-inherit no-underline transition-colors hover:bg-accent/50">
            <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
            <span className="shrink-0 text-xs capitalize text-muted-foreground">{t.status.replace(/_/g, " ")}</span>
          </Link>
        ))}
      </div>
    </WidgetShell>
  );
}
