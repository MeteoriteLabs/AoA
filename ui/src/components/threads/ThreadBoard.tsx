import { useMemo } from "react";
import { Link } from "@/lib/router";
import { THREAD_PHASES, type ThreadPhase } from "@armyofagents/shared";
import type { ThreadListItem } from "../../api/threads";
import { cn } from "../../lib/utils";
import { MessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/* ── Phase column config ────────────────────────────────────────────────────── */

const PHASE_COLUMNS: Array<{ phase: ThreadPhase; label: string; headerClass: string }> = [
  { phase: "discuss", label: "Discuss", headerClass: "text-blue-700 dark:text-blue-400" },
  { phase: "scope", label: "Scope", headerClass: "text-amber-700 dark:text-amber-400" },
  { phase: "assign", label: "Assign", headerClass: "text-violet-700 dark:text-violet-400" },
  { phase: "done", label: "Done", headerClass: "text-green-700 dark:text-green-400" },
];

const PHASE_COLORS: Record<ThreadPhase, string> = {
  discuss: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  scope: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  assign: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  done: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/* ════════════════════════════════════════════════════════════════════════
   ThreadBoard — Kanban-style view of threads by phase
   ════════════════════════════════════════════════════════════════════════ */

interface ThreadBoardProps {
  threads: ThreadListItem[];
  /** Inbox items for the Unlisted lane (v1: empty — inboxItems API is Task 3/4) */
  inboxItems?: InboxCardItem[];
  onNewThread: () => void;
}

export interface InboxCardItem {
  id: string;
  rawContent: string;
  originSource: string | null;
  createdAt: string;
}

export function ThreadBoard({ threads, inboxItems = [], onNewThread }: ThreadBoardProps) {
  // Group threads by phase
  const byPhase = useMemo(() => {
    const map = new Map<ThreadPhase, ThreadListItem[]>(
      THREAD_PHASES.map((p) => [p, []]),
    );
    for (const t of threads) {
      const list = map.get(t.phase);
      if (list) list.push(t);
    }
    return map;
  }, [threads]);

  return (
    <div
      className="flex gap-3 overflow-x-auto pb-4 min-h-[400px]"
      data-testid="thread-board"
    >
      {/* Unlisted lane — pinned at left (amber background) */}
      <UnlistedLane inboxItems={inboxItems} />

      {/* Phase columns */}
      {PHASE_COLUMNS.map(({ phase, label, headerClass }) => (
        <PhaseColumn
          key={phase}
          phase={phase}
          label={label}
          headerClass={headerClass}
          threads={byPhase.get(phase) ?? []}
          onNewThread={onNewThread}
        />
      ))}
    </div>
  );
}

/* ── Unlisted Lane ─────────────────────────────────────────────────────────── */

interface UnlistedLaneProps {
  inboxItems: InboxCardItem[];
}

function UnlistedLane({ inboxItems }: UnlistedLaneProps) {
  return (
    <div
      className="flex-none w-[220px] rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 flex flex-col"
      data-testid="unlisted-lane"
    >
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-amber-200 dark:border-amber-800">
        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wider">
          Unlisted
        </p>
        <p className="text-[10px] text-amber-700/70 dark:text-amber-400/70 mt-0.5">
          Needs triage
        </p>
      </div>

      {/* Items */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        {inboxItems.length === 0 ? (
          <p className="text-xs text-amber-700/50 dark:text-amber-400/50 text-center py-4">
            Nothing to triage
          </p>
        ) : (
          inboxItems.map((item) => (
            <div
              key={item.id}
              className="rounded-md border border-amber-200 dark:border-amber-800 bg-white dark:bg-amber-950/40 p-2"
            >
              <p className="text-xs line-clamp-3 text-foreground/80">
                {item.rawContent}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {relativeTime(item.createdAt)}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── Phase Column ────────────────────────────────────────────────────────────── */

interface PhaseColumnProps {
  phase: ThreadPhase;
  label: string;
  headerClass: string;
  threads: ThreadListItem[];
  onNewThread: () => void;
}

function PhaseColumn({ phase, label, headerClass, threads, onNewThread }: PhaseColumnProps) {
  return (
    <div
      className="flex-none w-[240px] rounded-lg border border-border bg-muted/30 flex flex-col"
      data-testid={`phase-column-${phase}`}
    >
      {/* Header — not clickable for reorder (v1) */}
      <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className={cn("text-xs font-semibold uppercase tracking-wider", headerClass)}>
            {label}
          </p>
          <span className="text-[10px] text-muted-foreground font-medium">
            {threads.length}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onNewThread}
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          aria-label={`New thread in ${label}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        {threads.length === 0 ? (
          <p className="text-[11px] text-muted-foreground text-center py-4 opacity-60">
            No threads
          </p>
        ) : (
          threads.map((thread) => (
            <BoardCard key={thread.id} thread={thread} phase={phase} />
          ))
        )}
      </div>
    </div>
  );
}

/* ── Board Card ─────────────────────────────────────────────────────────────── */

function BoardCard({ thread, phase }: { thread: ThreadListItem; phase: ThreadPhase }) {
  const hasPending = thread.pendingItemCount > 0;
  const phaseColor = PHASE_COLORS[phase];

  return (
    <Link
      to={`/discussions/${thread.id}`}
      className={cn(
        "block rounded-md border p-2.5 transition-colors text-left",
        hasPending
          ? "border-blue-300 bg-blue-50/80 hover:bg-blue-100/80 dark:border-blue-800 dark:bg-blue-950/30"
          : "border-border bg-background hover:bg-accent/50",
      )}
    >
      {/* Origin icon + title */}
      <div className="flex items-start gap-1.5">
        <MessageSquare
          className={cn(
            "h-3.5 w-3.5 mt-0.5 shrink-0",
            hasPending ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground",
          )}
          aria-hidden
        />
        <p className="text-xs font-medium leading-snug line-clamp-2">{thread.title}</p>
      </div>

      {/* Meta row */}
      <div className="flex items-center justify-between mt-1.5 gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Unread dot */}
          {hasPending && (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" aria-label="Pending" />
          )}
          {/* Last activity */}
          {thread.lastEntryAt && (
            <span className="text-[10px] text-muted-foreground truncate">
              {relativeTime(thread.lastEntryAt)}
            </span>
          )}
        </div>

        {/* Owner: avatar initial or "–" */}
        <span className="text-[10px] text-muted-foreground shrink-0">
          {thread.ownerUserId ? thread.ownerUserId.slice(0, 4) : "–"}
        </span>
      </div>

      {/* Phase chip — only shown in Unlisted lane; hidden in phase columns */}
      {/* In phase columns the column header already communicates the phase */}
    </Link>
  );
}
