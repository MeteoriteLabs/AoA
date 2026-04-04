import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { heartbeatsApi } from "../../api/heartbeats";
import { StatusBadge } from "../StatusBadge";
import { Identity } from "../Identity";
import { cn, relativeTime } from "@/lib/utils";
import { ChevronDown, ChevronRight, Loader2, Check, X as XIcon } from "lucide-react";
import type { RunForIssue } from "../../api/activity";

interface RunBlockProps {
  run: RunForIssue;
  agentName: string;
  /** Index from end — 0 = latest run */
  isLatest?: boolean;
  compact?: boolean;
  className?: string;
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diffSec = Math.round((e - s) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === "running" || status === "in_progress") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-500" />;
  }
  if (status === "succeeded" || status === "completed") {
    return <Check className="h-3.5 w-3.5 text-green-500" />;
  }
  if (status === "failed" || status === "error") {
    return <XIcon className="h-3.5 w-3.5 text-red-500" />;
  }
  return <span className="h-3.5 w-3.5 rounded-full bg-muted-foreground/30 inline-block" />;
}

export function RunBlock({
  run,
  agentName,
  isLatest = false,
  compact = false,
  className,
}: RunBlockProps) {
  const isRunning = run.status === "running" || run.status === "in_progress";
  const [expanded, setExpanded] = useState(isLatest || isRunning);

  // Fetch run log/events when expanded and for active runs
  const { data: logData } = useQuery({
    queryKey: ["run-log", run.runId],
    queryFn: () => heartbeatsApi.log(run.runId),
    enabled: expanded,
    refetchInterval: isRunning ? 3000 : false,
  });

  const duration = formatDuration(run.startedAt, run.finishedAt);

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-accent/10",
        className,
      )}
      data-testid={`run-block-${run.runId}`}
    >
      {/* Collapsed summary — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent/20 transition-colors rounded-lg"
        data-testid={`run-block-toggle-${run.runId}`}
      >
        <RunStatusIcon status={run.status} />
        <Identity name={agentName} size="xs" />
        <span className="text-xs text-muted-foreground">
          Run {run.runId.slice(0, 6)}
        </span>
        <StatusBadge status={run.status} />
        {duration && (
          <span className="text-xs text-muted-foreground">{duration}</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {relativeTime(run.startedAt ?? run.createdAt)}
        </span>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {/* Expanded output */}
      {expanded && (
        <div
          className={cn(
            "border-t border-border bg-neutral-950 rounded-b-lg p-3 font-mono text-xs overflow-auto",
            compact ? "max-h-[200px]" : "max-h-[400px]",
          )}
          data-testid={`run-block-output-${run.runId}`}
        >
          {logData?.content ? (
            <pre className="whitespace-pre-wrap text-foreground/90">{logData.content}</pre>
          ) : isRunning ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Streaming output...</span>
            </div>
          ) : (
            <span className="text-muted-foreground">No output recorded</span>
          )}
        </div>
      )}
    </div>
  );
}
