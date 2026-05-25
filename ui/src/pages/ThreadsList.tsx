import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useDialog } from "../context/DialogContext";
import { threadsApi, type ThreadListItem } from "../api/threads";
import type { InboxCardItem } from "../components/threads/ThreadBoard";
import { api } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { THREAD_PHASES, type ThreadPhase } from "@armyofagents/shared";
import {
  MessageSquare,
  ClipboardPen,
  PenLine,
  Mic,
  Plug,
  Plus,
  Search,
  RefreshCw,
  LayoutList,
  LayoutGrid,
} from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../components/EmptyState";
import { ThreadBoard } from "../components/threads/ThreadBoard";

// ── Phase filter config ───────────────────────────────────────────────────────

const PHASE_FILTERS = [
  { value: "all" as const, label: "All" },
  ...THREAD_PHASES.map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) })),
];

type PhaseFilterValue = "all" | ThreadPhase;
type ViewMode = "list" | "board";

// ── Origin icon/badge map ─────────────────────────────────────────────────────

const ORIGIN_BADGES: Record<string, { label: string; class: string; icon: typeof ClipboardPen }> = {
  paste: { label: "Paste", class: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", icon: ClipboardPen },
  write: { label: "Write", class: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", icon: PenLine },
  voice: { label: "Voice", class: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300", icon: Mic },
  mcp: { label: "MCP", class: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300", icon: Plug },
};

// ── Phase chip colors ─────────────────────────────────────────────────────────

const PHASE_COLORS: Record<ThreadPhase, string> = {
  discuss: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  scope: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  assign: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  done: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

// ── Relative time helper ──────────────────────────────────────────────────────

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
   ThreadsList — continuum index page
   ════════════════════════════════════════════════════════════════════════ */

export function ThreadsList() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs, setSubtitle, setEntityColor } = useBreadcrumbs();
  const { openNewThread } = useDialog();
  const [searchParams, setSearchParams] = useSearchParams();

  // View mode persisted in URL param
  const viewParam = searchParams.get("view");
  const view: ViewMode = viewParam === "board" ? "board" : "list";

  const [phaseFilter, setPhaseFilter] = useState<PhaseFilterValue>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ── Set breadcrumbs ──
  useEffect(() => {
    setBreadcrumbs([{ label: "Discussions" }]);
    setEntityColor("var(--entity-brief)");
    return () => {
      setSubtitle(null);
      setEntityColor(null);
    };
  }, [setBreadcrumbs, setSubtitle, setEntityColor]);

  // ── Query ──
  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.threads.list(selectedCompanyId ?? ""),
    queryFn: () => threadsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    retry: false,
  });

  const { data: inboxData } = useQuery({
    queryKey: queryKeys.threads.inbox(selectedCompanyId ?? ""),
    queryFn: () => api.get<{ items: InboxCardItem[]; total: number }>(`/companies/${selectedCompanyId}/discussions/inbox`),
    enabled: !!selectedCompanyId,
    retry: false,
  });
  const inboxItems = inboxData?.items ?? [];

  const threads = (data?.discussions ?? []) as ThreadListItem[];

  // Subtitle: count with pending
  useEffect(() => {
    if (!threads.length) return;
    const pending = threads.filter((t) => t.pendingItemCount > 0).length;
    setSubtitle(pending > 0 ? `${pending} with pending items` : null);
  }, [threads, setSubtitle]);

  // ── Client-side filtering ──
  const filtered = useMemo(() => {
    let result = [...threads];

    if (phaseFilter !== "all") {
      result = result.filter((t) => t.phase === phaseFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((t) => t.title.toLowerCase().includes(q));
    }

    return result;
  }, [threads, phaseFilter, searchQuery]);

  // ── Loading ──
  if (isLoading) {
    return (
      <div className="space-y-4">
        <ThreadsListHeader
          phaseFilter={phaseFilter}
          setPhaseFilter={setPhaseFilter}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          view={view}
          setView={(v) => {
            const next = new URLSearchParams(searchParams);
            if (v === "list") next.delete("view");
            else next.set("view", v);
            setSearchParams(next);
          }}
          onNewThread={openNewThread}
          totalCount={0}
        />
        <div
          className="space-y-2"
          data-testid="threads-list-skeleton"
          aria-label="Loading threads..."
        >
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 rounded-lg border border-border bg-card animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Error ──
  if (isError) {
    return (
      <div className="space-y-4">
        <ThreadsListHeader
          phaseFilter={phaseFilter}
          setPhaseFilter={setPhaseFilter}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          view={view}
          setView={(v) => {
            const next = new URLSearchParams(searchParams);
            if (v === "list") next.delete("view");
            else next.set("view", v);
            setSearchParams(next);
          }}
          onNewThread={openNewThread}
          totalCount={0}
        />
        <div className="flex flex-col items-center gap-4 py-16" data-testid="threads-list-error">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load threads.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="flex items-center gap-1.5">
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const setView = (v: ViewMode) => {
    const next = new URLSearchParams(searchParams);
    if (v === "list") next.delete("view");
    else next.set("view", v);
    setSearchParams(next);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[1.6rem] font-bold tracking-tight">
          Discussions<span className="text-brand">.</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Threads where decisions, tasks, and insights get shaped from raw input.
        </p>
      </div>

      <ThreadsListHeader
        phaseFilter={phaseFilter}
        setPhaseFilter={setPhaseFilter}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        view={view}
        setView={setView}
        onNewThread={openNewThread}
        totalCount={threads.length}
      />

      {/* Board view */}
      {view === "board" && (
        <ThreadBoard
          threads={filtered}
          inboxItems={inboxItems}
          onNewThread={openNewThread}
          onInboxUpdate={() => refetch()}
        />
      )}

      {/* List view */}
      {view === "list" && (
        <>
          {filtered.length === 0 ? (
            threads.length > 0 ? (
              <EmptyState
                icon={MessageSquare}
                message="No threads match the current filters"
                description="Try adjusting your filters or clearing them."
                entityColor="var(--entity-brief)"
              />
            ) : (
              <EmptyState
                icon={MessageSquare}
                message="No threads yet. Start a new one."
                description="Start a thread to capture and shape decisions, tasks, and insights from raw input."
                entityColor="var(--entity-brief)"
                action="New Thread"
                onAction={() => openNewThread()}
              />
            )
          ) : (
            <div className="space-y-2">
              {filtered.map((thread) => (
                <ThreadRow key={thread.id} thread={thread} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────────────── */

interface ThreadsListHeaderProps {
  phaseFilter: PhaseFilterValue;
  setPhaseFilter: (v: PhaseFilterValue) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  view: ViewMode;
  setView: (v: ViewMode) => void;
  onNewThread: () => void;
  totalCount: number;
}

function ThreadsListHeader({
  phaseFilter,
  setPhaseFilter,
  searchQuery,
  setSearchQuery,
  view,
  setView,
  onNewThread,
  totalCount,
}: ThreadsListHeaderProps) {
  return (
    <div className="flex flex-col gap-2">
      {/* Phase filters + view toggle + new button */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {PHASE_FILTERS.map((pf) => {
            const isActive = phaseFilter === pf.value;
            return (
              <button
                key={pf.value}
                type="button"
                onClick={() => setPhaseFilter(pf.value)}
                aria-pressed={isActive}
                className={cn(
                  "inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium border transition-colors",
                  isActive
                    ? "bg-foreground text-background border-foreground"
                    : "bg-transparent text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {pf.label}
                {pf.value === "all" && (
                  <span className="ml-1.5 text-[10px] opacity-70">{totalCount}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setView("list")}
              aria-label="List view"
              className={cn(
                "flex items-center px-2 py-1.5 text-xs transition-colors",
                view === "list"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              <LayoutList className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView("board")}
              aria-label="Board view"
              className={cn(
                "flex items-center px-2 py-1.5 text-xs transition-colors",
                view === "board"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>

          <Button size="sm" onClick={onNewThread}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Thread
          </Button>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        <input
          type="search"
          placeholder="Search threads..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-input bg-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label="Search threads"
        />
      </div>
    </div>
  );
}

function ThreadRow({ thread }: { thread: ThreadListItem }) {
  const hasPending = thread.pendingItemCount > 0;
  const origin = thread.lastEntryInputType
    ? ORIGIN_BADGES[thread.lastEntryInputType]
    : null;
  const OriginIcon = origin?.icon ?? MessageSquare;
  const phaseColor = PHASE_COLORS[thread.phase] ?? "bg-muted text-muted-foreground";

  return (
    <Link
      to={`/discussions/${thread.id}`}
      className={cn(
        "flex items-center justify-between rounded-lg border p-4 transition-colors",
        hasPending
          ? "border-blue-300 bg-blue-50/60 hover:bg-blue-100/60 dark:border-blue-800 dark:bg-blue-950/30 dark:hover:bg-blue-950/50"
          : "border-border bg-card hover:bg-accent/50",
      )}
    >
      {/* Left: icon + title + meta */}
      <div className="flex items-center gap-3 min-w-0">
        <OriginIcon
          className={cn(
            "h-4 w-4 shrink-0",
            hasPending ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground",
          )}
          aria-hidden
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">{thread.title}</p>
            {hasPending && (
              <span className="inline-flex items-center rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white shrink-0">
                {thread.pendingItemCount} pending
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {/* Unread dot placeholder — will be real once read-state API is wired */}
            {hasPending && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" aria-label="Unread" />
            )}
            {thread.lastEntryAt && (
              <span className="text-xs text-muted-foreground">
                {relativeTime(thread.lastEntryAt)}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {thread.entryCount} {thread.entryCount === 1 ? "entry" : "entries"}
            </span>
            {origin && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  origin.class,
                )}
              >
                <OriginIcon className="h-3 w-3" />
                {origin.label}
              </span>
            )}
            {thread.scopeName && (
              <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {thread.scopeName}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right: phase chip + owner */}
      <div className="flex items-center gap-2 ml-4 shrink-0">
        {thread.ownerUserId ? (
          <span className="text-xs text-muted-foreground hidden sm:block">
            {thread.ownerUserId.slice(0, 8)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground hidden sm:block">Unclaimed</span>
        )}
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium capitalize",
            phaseColor,
          )}
        >
          {thread.phase}
        </span>
      </div>
    </Link>
  );
}
