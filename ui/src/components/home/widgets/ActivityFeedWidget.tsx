import { Activity } from "lucide-react";
import { useHomeSummary } from "../../../hooks/useHomeSummary";
import { timeAgo } from "../../../lib/timeAgo";
import { formatAction, activityEntityName } from "../activityFormat";
import { WidgetShell } from "./WidgetShell";
import type { WidgetProps } from "./types";

export function ActivityFeedWidget({ companyId, editing }: WidgetProps) {
  const { data } = useHomeSummary(companyId);
  if (!data || data.recentActivity.length === 0) return null; // matches today
  return (
    <WidgetShell title="Today's activity" icon={Activity} to="/activity" editing={editing}>
      <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {data.recentActivity.map((item) => (
          <div key={item.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <Activity className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted-foreground">{formatAction(item)}</span>{" "}
              <span className="font-medium">{activityEntityName(item)}</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(item.createdAt)}</span>
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}
