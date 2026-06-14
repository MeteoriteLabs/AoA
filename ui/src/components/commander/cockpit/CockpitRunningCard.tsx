import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { heartbeatsApi, type LiveRunForIssue } from "../../../api/heartbeats";
import { queryKeys } from "../../../lib/queryKeys";

export function CockpitRunningCard({
  companyId,
  onActiveChange,
}: {
  companyId: string;
  onActiveChange: (active: boolean) => void;
}) {
  const { data } = useQuery({
    queryKey: queryKeys.liveRuns(companyId),
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId),
    enabled: !!companyId,
    refetchInterval: 5000, // crew runs aren't covered by LiveUpdates invalidation (Codex #1)
  });

  // Defensive: the company /live-runs endpoint (called with no minCount) returns only
  // live rows (queued/running) today; this guard keeps "Running now" correct if future
  // statuses are ever added to that response.
  const runs = ((data ?? []) as LiveRunForIssue[]).filter(
    (r) => r.status === "running" || r.status === "queued",
  );

  useEffect(() => {
    onActiveChange(runs.length > 0);
  }, [runs.length, onActiveChange]);

  if (runs.length === 0) return null;

  return (
    <section
      className="rounded-lg border border-border bg-background p-2"
      data-testid="cockpit-card-running"
    >
      <header className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
        <Play className="size-3.5" aria-hidden />
        Running now
        <span className="ml-auto tabular-nums">{runs.length}</span>
      </header>
      <ul className="space-y-0.5">
        {runs.map((r) => (
          <li
            key={r.id}
            className="flex items-center gap-1 truncate rounded px-1 py-1 text-xs hover:bg-muted/50"
          >
            <span className="truncate font-medium">{r.agentName ?? "Agent"}</span>
            <span className="ml-auto shrink-0 text-[10px] uppercase text-muted-foreground">
              {r.status}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
