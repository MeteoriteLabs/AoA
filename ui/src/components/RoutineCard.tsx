// ui/src/components/RoutineCard.tsx
import { Clock3, MoreHorizontal, Play, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentIcon } from "./AgentIconPicker";
import { describeSchedule } from "./ScheduleEditor";
import { timeAgo } from "../lib/timeAgo";
import { cn } from "../lib/utils";
import type { RoutineListItem } from "@paperclipai/shared";
import type { Agent } from "@paperclipai/shared";

interface Project {
  id: string;
  name: string;
  color: string | null;
}

interface RoutineCardProps {
  routine: RoutineListItem;
  agentById: Map<string, Agent>;
  projectById: Map<string, Project>;
  isRunning: boolean;
  isStatusPending: boolean;
  hasLiveRun?: boolean;
  onNavigate: () => void;
  onRun: () => void;
  onToggleStatus: () => void;
  onArchive: () => void;
}

function lastRunLabel(status: string): string {
  const map: Record<string, string> = {
    issue_created: "issue created",
    completed: "completed",
    failed: "failed",
    skipped: "skipped",
    coalesced: "coalesced",
    received: "running",
  };
  return map[status] ?? status.replaceAll("_", " ");
}

function lastRunColor(status: string): string {
  if (status === "issue_created" || status === "completed") return "text-emerald-400";
  if (status === "failed") return "text-destructive";
  if (status === "received") return "text-blue-400";
  return "text-muted-foreground";
}

export function RoutineCard({
  routine,
  agentById,
  projectById,
  isRunning,
  isStatusPending,
  hasLiveRun = false,
  onNavigate,
  onRun,
  onToggleStatus,
  onArchive,
}: RoutineCardProps) {
  const enabled = routine.status === "active";
  const isArchived = routine.status === "archived";
  const agent = routine.assigneeAgentId ? agentById.get(routine.assigneeAgentId) : undefined;
  const project = routine.projectId ? projectById.get(routine.projectId) : undefined;

  // Pick first schedule trigger's cron expression for display
  const scheduleTrigger = routine.triggers?.find((t) => t.kind === "schedule");
  const triggerCount = routine.triggers?.length ?? 0;

  return (
    <div
      className={cn(
        "group relative border bg-card rounded-lg p-4 cursor-pointer transition-all",
        hasLiveRun
          ? "border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.06)]"
          : "border-border hover:border-border/80",
      )}
      onClick={onNavigate}
    >
      {/* Header row: icon + title + toggle */}
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent">
          <Repeat className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{routine.title}</p>
        </div>
        {/* Toggle — stop propagation so click doesn't navigate */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? `Pause ${routine.title}` : `Enable ${routine.title}`}
          disabled={isStatusPending || isArchived}
          className={cn(
            "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
            enabled ? "bg-emerald-500" : "bg-muted",
            (isStatusPending || isArchived) && "cursor-not-allowed opacity-50",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStatus();
          }}
        >
          <span
            className={cn(
              "inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
              enabled ? "translate-x-[18px]" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      {/* Metadata row */}
      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        {project ? (
          <>
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: project.color ?? "#64748b" }}
            />
            <span className="truncate">{project.name}</span>
          </>
        ) : (
          <span>No project</span>
        )}
        {agent ? (
          <>
            <span className="text-border">·</span>
            <AgentIcon icon={agent.icon} className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{agent.name}</span>
          </>
        ) : null}
      </div>

      {/* Schedule line */}
      <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock3 className="h-3 w-3 shrink-0" />
        {triggerCount === 0 ? (
          <span className="italic">No triggers</span>
        ) : scheduleTrigger?.cronExpression ? (
          <span>{describeSchedule(scheduleTrigger.cronExpression)}</span>
        ) : triggerCount === 1 ? (
          <span>{routine.triggers![0].kind} trigger</span>
        ) : (
          <span>{triggerCount} triggers</span>
        )}
      </div>

      {/* Last run line */}
      <div className="mt-1 text-xs text-muted-foreground">
        {routine.lastRun ? (
          <>
            <span>Last: {timeAgo(routine.lastRun.triggeredAt)}</span>
            <span className="mx-1 text-border">·</span>
            <span className={lastRunColor(routine.lastRun.status)}>
              {lastRunLabel(routine.lastRun.status)}
            </span>
          </>
        ) : (
          <span className="italic">Never run</span>
        )}
      </div>

      {/* Hover footer */}
      <div className="mt-3 border-t border-border/50 pt-2.5 opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={isRunning || isArchived}
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
        >
          <Play className="mr-1 h-3 w-3" />
          {isRunning ? "Running..." : "Run now"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon-sm" aria-label="More actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onNavigate(); }}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={isStatusPending || isArchived}
              onClick={(e) => { e.stopPropagation(); onToggleStatus(); }}
            >
              {enabled ? "Pause" : "Enable"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isStatusPending}
              onClick={(e) => { e.stopPropagation(); onArchive(); }}
            >
              {isArchived ? "Restore" : "Archive"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
