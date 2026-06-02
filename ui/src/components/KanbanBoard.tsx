import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { StatusIcon } from "./StatusIcon";
import { PriorityIcon } from "./PriorityIcon";
import { Identity } from "./Identity";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Link2 } from "lucide-react";
import type { Issue } from "@armyofagents/shared";

const boardStatuses = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
];

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Agent {
  id: string;
  name: string;
}

/**
 * Per-issue live-run detail for the "Live" pill (thread-chat-experience Task
 * 5.5/5.7). When supplied, the pill renders "{agentName} · {elapsed}" instead of
 * the bare "Live" — surfaced from `liveRunsForCompany`, which now includes crew
 * (internal_agent) runs with { agentName, startedAt }. Optional: callers that
 * only pass `liveIssueIds` keep the plain "Live" pill.
 */
export interface LiveRunInfo {
  agentName?: string | null;
  /** ISO timestamp (or Date) the run started; the elapsed anchor. */
  startedAt?: string | Date | null;
}

interface KanbanBoardProps {
  issues: Issue[];
  agents?: Agent[];
  liveIssueIds?: Set<string>;
  /** Optional richer live-run info per issue id for the "Live" pill. */
  liveRunsByIssue?: Map<string, LiveRunInfo>;
  onUpdateIssue: (id: string, data: Record<string, unknown>) => void;
  onSelectIssue?: (issueIdentifier: string) => void;
}

/** Compact elapsed label from a start time, e.g. "0:42", "3:05", "1h12m". */
function formatElapsed(startedAt: string | Date | null | undefined, nowMs: number): string | null {
  if (!startedAt) return null;
  const start = typeof startedAt === "string" ? Date.parse(startedAt) : startedAt.getTime();
  if (!Number.isFinite(start)) return null;
  const secs = Math.max(0, Math.floor((nowMs - start) / 1000));
  if (secs < 3600) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h${m.toString().padStart(2, "0")}m`;
}

/* ── Droppable Column ── */

function KanbanColumn({
  status,
  issues,
  agents,
  liveIssueIds,
  liveRunsByIssue,
  nowMs,
  onSelectIssue,
}: {
  status: string;
  issues: Issue[];
  agents?: Agent[];
  liveIssueIds?: Set<string>;
  liveRunsByIssue?: Map<string, LiveRunInfo>;
  nowMs: number;
  onSelectIssue?: (issueIdentifier: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="flex flex-col min-w-[260px] w-[260px] shrink-0">
      <div className="flex items-center gap-2 px-2 py-2 mb-1">
        <StatusIcon status={status} />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {statusLabel(status)}
        </span>
        <span className="text-xs text-muted-foreground/60 ml-auto tabular-nums">
          {issues.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-[120px] rounded-md p-1 space-y-1 transition-colors ${
          isOver ? "bg-accent/40" : "bg-muted/20"
        }`}
      >
        <SortableContext
          items={issues.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {issues.map((issue) => (
            <KanbanCard
              key={issue.id}
              issue={issue}
              agents={agents}
              isLive={liveIssueIds?.has(issue.id)}
              liveRun={liveRunsByIssue?.get(issue.id)}
              nowMs={nowMs}
              onSelectIssue={onSelectIssue}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

/* ── Draggable Card ── */

function KanbanCard({
  issue,
  agents,
  isLive,
  liveRun,
  nowMs,
  isOverlay,
  onSelectIssue,
}: {
  issue: Issue;
  agents?: Agent[];
  isLive?: boolean;
  liveRun?: LiveRunInfo;
  nowMs?: number;
  isOverlay?: boolean;
  onSelectIssue?: (issueIdentifier: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id, data: { issue } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const agentName = (id: string | null) => {
    if (!id || !agents) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`kanban-card-hover rounded-md border bg-card p-2.5 cursor-grab active:cursor-grabbing transition-all duration-150 ${
        isDragging && !isOverlay ? "opacity-30" : ""
      } ${isOverlay ? "shadow-lg ring-1 ring-primary/20" : ""}`}
    >
      <Link
        to={`/issues/${issue.identifier ?? issue.id}`}
        className="block no-underline text-inherit"
        onClick={(e) => {
          // Prevent navigation during drag
          if (isDragging) { e.preventDefault(); return; }
          if (onSelectIssue) {
            e.preventDefault();
            onSelectIssue(issue.identifier ?? issue.id);
          }
        }}
      >
        <div className="flex items-start gap-1.5 mb-1.5">
          <span className="text-xs text-muted-foreground font-mono shrink-0">
            {issue.identifier ?? issue.id.slice(0, 8)}
          </span>
          {isLive && (() => {
            // Task 5.5/5.7: when a live-run row carries the executing agent +
            // start time, label the pill "{agentName} · {elapsed}"; otherwise
            // fall back to the bare "Live".
            const elapsed = formatElapsed(liveRun?.startedAt, nowMs ?? Date.now());
            const name = liveRun?.agentName ?? null;
            const label =
              name && elapsed ? `${name} · ${elapsed}` : name ? name : "Live";
            return (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-1.5 py-0.5 shrink-0 ml-auto max-w-[160px]"
                title={name && elapsed ? `${name} · running ${elapsed}` : "Live run in progress"}
              >
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
                <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400 truncate">
                  {label}
                </span>
              </span>
            );
          })()}
          {issue.status === "blocked" && !isLive && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400 shrink-0 ml-auto">
                    <Link2 className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Blocked by dependencies
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <p className="text-sm leading-snug line-clamp-2 mb-1">{issue.title}</p>
        {issue.description && (
          <p className="text-xs text-muted-foreground/70 line-clamp-2 mb-1.5 leading-relaxed">
            {issue.description.split("\n")[0].slice(0, 140)}
          </p>
        )}
        {/* Labels */}
        {(issue.labels ?? []).length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mb-1.5">
            {(issue.labels ?? []).slice(0, 3).map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center rounded-full border px-1.5 py-0 text-[9px] font-medium leading-4"
                style={{
                  borderColor: label.color,
                  color: label.color,
                  backgroundColor: `${label.color}1f`,
                }}
              >
                {label.name}
              </span>
            ))}
            {(issue.labels ?? []).length > 3 && (
              <span className="text-[9px] text-muted-foreground">+{(issue.labels ?? []).length - 3}</span>
            )}
          </div>
        )}
        <div className="flex items-center gap-2">
          <PriorityIcon priority={issue.priority} />
          {issue.assigneeAgentId && (() => {
            const name = agentName(issue.assigneeAgentId);
            return name ? (
              <Identity name={name} size="xs" />
            ) : (
              <span className="text-xs text-muted-foreground font-mono">
                {issue.assigneeAgentId.slice(0, 8)}
              </span>
            );
          })()}
        </div>
      </Link>
    </div>
  );
}

/* ── Main Board ── */

export function KanbanBoard({
  issues,
  agents,
  liveIssueIds,
  liveRunsByIssue,
  onUpdateIssue,
  onSelectIssue,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Task 5.5/5.7: tick a 1s clock so the live pill's elapsed counter advances,
  // but only while at least one card is live (no idle timer churn).
  const hasLive = (liveIssueIds?.size ?? 0) > 0;
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!hasLive) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasLive]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const columnIssues = useMemo(() => {
    const grouped: Record<string, Issue[]> = {};
    for (const status of boardStatuses) {
      grouped[status] = [];
    }
    for (const issue of issues) {
      if (grouped[issue.status]) {
        grouped[issue.status].push(issue);
      }
    }
    return grouped;
  }, [issues]);

  const activeIssue = useMemo(
    () => (activeId ? issues.find((i) => i.id === activeId) : null),
    [activeId, issues]
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const issueId = active.id as string;
    const issue = issues.find((i) => i.id === issueId);
    if (!issue) return;

    // Determine target status: the "over" could be a column id (status string)
    // or another card's id. Find which column the "over" belongs to.
    let targetStatus: string | null = null;

    if (boardStatuses.includes(over.id as string)) {
      targetStatus = over.id as string;
    } else {
      // It's a card - find which column it's in
      const targetIssue = issues.find((i) => i.id === over.id);
      if (targetIssue) {
        targetStatus = targetIssue.status;
      }
    }

    if (targetStatus && targetStatus !== issue.status) {
      onUpdateIssue(issueId, { status: targetStatus });
    }
  }

  function handleDragOver(_event: DragOverEvent) {
    // Could be used for visual feedback; keeping simple for now
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-2 px-2">
        {boardStatuses.map((status) => (
          <KanbanColumn
            key={status}
            status={status}
            issues={columnIssues[status] ?? []}
            agents={agents}
            liveIssueIds={liveIssueIds}
            liveRunsByIssue={liveRunsByIssue}
            nowMs={nowMs}
            onSelectIssue={onSelectIssue}
          />
        ))}
      </div>
      <DragOverlay>
        {activeIssue ? (
          <KanbanCard issue={activeIssue} agents={agents} isOverlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
