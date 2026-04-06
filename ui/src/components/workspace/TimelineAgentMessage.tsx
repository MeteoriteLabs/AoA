import { Identity } from "../Identity";
import { StatusBadge } from "../StatusBadge";
import { cn, relativeTime } from "@/lib/utils";
import { formatDuration, RunStatusIcon, runStatusBorderColor, formatBytes, summarizeOutputs } from "./workspace-utils";
import type { RunForIssue } from "../../api/activity";
import { StructuredRunBlock } from "./transcript";
import type { DepartmentType } from "./transcript/types";

interface TimelineAgentMessageProps {
  run: RunForIssue;
  agentName: string;
  isLatest?: boolean;
  compact?: boolean;
  adapterType?: string;
  departmentType?: string;
}

export function TimelineAgentMessage({
  run,
  agentName,
  isLatest = false,
  compact = false,
  adapterType = "process",
  departmentType = "general",
}: TimelineAgentMessageProps) {
  const isRunning = run.status === "running" || run.status === "in_progress";

  const duration = formatDuration(run.startedAt, run.finishedAt);
  const outputs = run.detectedOutputs ?? [];
  const { fileCount, totalBytes } = summarizeOutputs(outputs);
  const borderColor = runStatusBorderColor(run.status);

  return (
    <div
      className={cn(
        "rounded-lg border border-border border-l-4 bg-card/50",
        borderColor,
      )}
      data-testid={`timeline-agent-msg-${run.runId}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <RunStatusIcon status={run.status} />
        <Identity name={agentName} size="xs" />
        <StatusBadge status={run.status} />
        {duration && (
          <span className="text-xs text-muted-foreground">{duration}</span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {relativeTime(run.startedAt ?? run.createdAt)}
        </span>
      </div>

      {/* Summary line — file changes */}
      {fileCount > 0 && (
        <div className="px-3 pb-2 text-xs text-muted-foreground">
          Changed {fileCount} file{fileCount !== 1 ? "s" : ""} ({formatBytes(totalBytes)})
        </div>
      )}

      {/* Structured run output */}
      <div className="border-t border-border">
        <StructuredRunBlock
          runId={run.runId}
          adapterType={adapterType}
          departmentType={departmentType as DepartmentType}
          isRunning={isRunning}
          isLatest={isLatest}
          compact={compact}
          agentName={agentName}
        />
      </div>
    </div>
  );
}
