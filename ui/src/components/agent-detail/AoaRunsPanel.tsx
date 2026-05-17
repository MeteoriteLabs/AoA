import { useQuery } from "@tanstack/react-query";
import { agentsApi } from "../../api/agents";
import { cn } from "@/lib/utils";
import { relativeTime } from "../../lib/utils";
import { CheckCircle2, XCircle, Clock, Loader2, Slash, Timer } from "lucide-react";

interface AoaRun {
  id: string;
  triggerType: "conversation" | "proactive" | "event" | "sub_agent" | string;
  triggerSource?: string | null;
  summary?: string | null;
  toolsCalled?: string[] | null;
  status: string;
  errorMessage?: string | null;
  completedAt?: string | Date | null;
  durationMs?: number | null;
  costCents?: number | null;
  createdAt: string | Date;
}

const runStatusIcons: Record<string, { icon: typeof CheckCircle2; color: string }> = {
  succeeded: { icon: CheckCircle2, color: "text-green-600 dark:text-green-400" },
  failed: { icon: XCircle, color: "text-red-600 dark:text-red-400" },
  running: { icon: Loader2, color: "text-cyan-600 dark:text-cyan-400 animate-spin" },
  queued: { icon: Clock, color: "text-yellow-600 dark:text-yellow-400" },
  timed_out: { icon: Timer, color: "text-orange-600 dark:text-orange-400" },
  cancelled: { icon: Slash, color: "text-neutral-500 dark:text-neutral-400" },
};

const triggerTypeColors: Record<string, string> = {
  conversation: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  proactive: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  event: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  sub_agent: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
};

function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "-";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

export function AoaRunsPanel({
  agentId,
  companyId,
}: {
  agentId: string;
  companyId: string;
}) {
  const { data: runs, isLoading } = useQuery({
    queryKey: ["aoa-runs", agentId, companyId],
    queryFn: () => agentsApi.getAoaRuns(agentId, companyId),
  });

  const runList = (runs ?? []) as AoaRun[];

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-14 bg-accent/20 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (runList.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-muted-foreground">No runs yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Runs</h3>
      <div className="border border-border rounded-lg divide-y divide-border">
        {runList.map((run) => {
          const statusInfo = runStatusIcons[run.status] ?? { icon: Clock, color: "text-neutral-400" };
          const StatusIcon = statusInfo.icon;
          const triggerColor = triggerTypeColors[run.triggerType] ?? "bg-muted text-muted-foreground";

          return (
            <div key={run.id} className="px-4 py-3 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusInfo.color)} />
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium shrink-0",
                    triggerColor,
                  )}
                >
                  {run.triggerType}
                </span>
                {run.triggerSource && (
                  <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
                    {run.triggerSource}
                  </span>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground shrink-0">
                  {relativeTime(run.createdAt)}
                </span>
              </div>

              {run.summary && (
                <p className="text-xs text-muted-foreground line-clamp-2 pl-5">
                  {run.summary}
                </p>
              )}

              <div className="flex items-center gap-3 pl-5 text-[11px] text-muted-foreground flex-wrap">
                {run.durationMs != null && (
                  <span>Duration: {formatDuration(run.durationMs)}</span>
                )}
                {run.toolsCalled && run.toolsCalled.length > 0 && (
                  <span>{run.toolsCalled.length} tool{run.toolsCalled.length === 1 ? "" : "s"} called</span>
                )}
                {run.costCents != null && run.costCents > 0 && (
                  <span>${(run.costCents / 100).toFixed(4)}</span>
                )}
                {run.errorMessage && (
                  <span className="text-red-600 dark:text-red-400 truncate">{run.errorMessage}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
