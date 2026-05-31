import { Link } from "@/lib/router";
import { THREAD_PHASES, type ThreadPhase } from "@armyofagents/shared";
import type { ThreadListItem } from "../../api/threads";
import { cn } from "../../lib/utils";
import { MessageSquare, Plus, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnlistedLane } from "./UnlistedLane";
import { groupThreadsForBoard } from "./boardModel";

/* ── Phase column config ────────────────────────────────────────────────────── */

const PHASE_COLUMNS: Array<{ phase: ThreadPhase; label: string; headerClass: string }> = [
  { phase: "discuss", label: "Discuss", headerClass: "text-blue-700 dark:text-blue-400" },
  { phase: "scope", label: "Scope", headerClass: "text-amber-700 dark:text-amber-400" },
  { phase: "assign", label: "Assign", headerClass: "text-violet-700 dark:text-violet-400" },
  { phase: "done", label: "Done", headerClass: "text-green-700 dark:text-green-400" },
];

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
  /** Archived threads to display in the Archived column. */
  archivedThreads?: ThreadListItem[];
  /** Inbox items for the Unlisted lane (v1: empty — inboxItems API is Task 3/4) */
  inboxItems?: InboxCardItem[];
  onNewThread: () => void;
  /** Called after an inbox item is triaged so the parent can refresh */
  onInboxUpdate?: () => void;
}

export interface InboxCardItem {
  id: string;
  rawContent: string;
  originSource: string | null;
  createdAt: string;
  // Inbound routing (Phase 1) — present when the router has scored this item.
  routerDecision?: string | null;     // 'suggest' → show the confirm affordance
  suggestedThreadId?: string | null;  // the thread the router recommends
  suggestedThreadTitle?: string | null;  // NEW — for suggest_new decisions
  routerConfidence?: number | null;   // cosine distance of the top match (lower = closer)
  routingStatus?: string | null;
}

export function ThreadBoard({ threads, archivedThreads = [], inboxItems = [], onNewThread, onInboxUpdate }: ThreadBoardProps) {
  // Group threads by phase using pure boardModel function
  const byPhase = groupThreadsForBoard(threads);

  // Build a lookup map (id → title) from ALL threads (active + archived)
  // for the suggestion banner in UnlistedLane. Never crash on missing keys.
  const threadsById = new Map<string, string>();
  for (const t of threads) threadsById.set(t.id, t.title);
  for (const t of archivedThreads) threadsById.set(t.id, t.title);

  return (
    <div
      className="flex gap-3 overflow-x-auto pb-4 min-h-[400px]"
      data-testid="thread-board"
    >
      {/* Unlisted lane — pinned at left (amber background) */}
      <UnlistedLane
        inboxItems={inboxItems}
        threadsById={threadsById}
        onTriaged={(_itemId, _action) => {
          onInboxUpdate?.();
        }}
      />

      {/* Phase columns */}
      {PHASE_COLUMNS.map(({ phase, label, headerClass }) => (
        <PhaseColumn
          key={phase}
          phase={phase}
          label={label}
          headerClass={headerClass}
          threads={byPhase[phase] ?? []}
          onNewThread={onNewThread}
        />
      ))}

      {/* Archived column — always rendered so it's visible even when empty */}
      <ArchivedColumn threads={archivedThreads} />
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
      role="region"
      aria-label={label}
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

/* ── Archived Column ─────────────────────────────────────────────────────────── */

function ArchivedColumn({ threads }: { threads: ThreadListItem[] }) {
  return (
    <div
      role="region"
      aria-label="Archived"
      className="flex-none w-[240px] rounded-lg border border-border bg-muted/20 flex flex-col opacity-70"
      data-testid="archived-column"
    >
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
        <Archive className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" aria-hidden />
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
          Archived
        </p>
        <span className="text-[10px] text-muted-foreground font-medium">
          {threads.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        {threads.length === 0 ? (
          <p className="text-[11px] text-muted-foreground text-center py-4 opacity-60">
            No archived threads
          </p>
        ) : (
          threads.map((thread) => (
            <BoardCard key={thread.id} thread={thread} phase={"done" as ThreadPhase} archived />
          ))
        )}
      </div>
    </div>
  );
}

/* ── Board Card ─────────────────────────────────────────────────────────────── */

function BoardCard({ thread, phase: _phase, archived = false }: { thread: ThreadListItem; phase: ThreadPhase; archived?: boolean }) {
  const hasPending = thread.pendingItemCount > 0;

  return (
    <Link
      to={`/discussions/${thread.id}`}
      className={cn(
        "block rounded-md border p-2.5 transition-colors text-left",
        archived
          ? "border-border bg-muted/30 hover:bg-muted/50 opacity-60"
          : hasPending
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
