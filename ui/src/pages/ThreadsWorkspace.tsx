/**
 * ThreadsWorkspace — the §13 "continuum": ONE surface that breathes by width.
 *
 * Mounted on /discussions, /discussions/:discussionId and /threads/:threadId so
 * the same component (and its panel layout) persists across selection changes —
 * the board IS the switcher: clicking a card navigates, the index snaps from a
 * full-width board to a narrow rail, and the 3-pane detail opens beside it.
 *
 *   No selection  →  [ index fills: Board lens | List lens ]
 *   Selection     →  [ index rail 264px (collapsible → 48px) │ detail 3-pane ]
 *
 * The detail is the existing ThreadDetail rendered `embedded` (its own left rail
 * hidden, since this surface supplies the index). Map lens is deferred (v1.1).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useDialog } from "../context/DialogContext";
import { api } from "../api/client";
import { threadsApi, type ThreadListItem } from "../api/threads";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import {
  LayoutList,
  LayoutGrid,
  Plus,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { ThreadBoard, type InboxCardItem } from "../components/threads/ThreadBoard";
import { ThreadDetail } from "./ThreadDetail";

type Lens = "list" | "board";

const PHASE_DOT: Record<string, string> = {
  discuss: "bg-blue-500",
  scope: "bg-amber-500",
  assign: "bg-violet-500",
  done: "bg-green-500",
};

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(dateStr).toLocaleDateString();
}

/** Track desktop vs mobile so the continuum split is desktop-only; on mobile we
 *  render the full ThreadDetail (its own rail + tab bar). */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isDesktop;
}

export function ThreadsWorkspace() {
  const { discussionId, threadId } = useParams<{ discussionId?: string; threadId?: string }>();
  const selectedId = discussionId ?? threadId ?? null;
  const hasSelection = !!selectedId;
  const isDesktop = useIsDesktop();

  const { selectedCompanyId } = useCompany();
  const { openNewThread } = useDialog();
  const { setBreadcrumbs, setEntityColor, setSubtitle } = useBreadcrumbs();
  const [searchParams, setSearchParams] = useSearchParams();

  // Lens persisted in the URL (?view=list). Default board.
  const viewParam = searchParams.get("view");
  const lens: Lens = viewParam === "list" ? "list" : "board";
  const setLens = (l: Lens) => {
    const next = new URLSearchParams(searchParams);
    if (l === "board") next.delete("view");
    else next.set("view", l);
    setSearchParams(next, { replace: true });
  };

  const [railCollapsed, setRailCollapsed] = useState(false);
  const [search, setSearch] = useState("");

  // Breadcrumb for browse mode; the detail (ThreadDetail) sets its own.
  useEffect(() => {
    if (hasSelection) return;
    setBreadcrumbs([{ label: "Discussions" }]);
    setEntityColor("var(--entity-brief)");
    return () => {
      setSubtitle(null);
      setEntityColor(null);
    };
  }, [hasSelection, setBreadcrumbs, setEntityColor, setSubtitle]);

  const { data } = useQuery({
    queryKey: ["threads", selectedCompanyId, "list"],
    queryFn: () => threadsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    retry: false,
  });
  const threads = (data?.discussions ?? []) as ThreadListItem[];

  const { data: inboxData } = useQuery({
    queryKey: ["threads-inbox", selectedCompanyId],
    queryFn: () =>
      api.get<{ items: InboxCardItem[]; total: number }>(
        `/companies/${selectedCompanyId}/discussions/inbox`,
      ),
    enabled: !!selectedCompanyId && !hasSelection,
    retry: false,
  });
  const inboxItems = inboxData?.items ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return threads;
    const q = search.trim().toLowerCase();
    return threads.filter((t) => t.title.toLowerCase().includes(q));
  }, [threads, search]);

  // Index width: browse → fills; detail → narrow rail (collapsible).
  const indexWidth = !hasSelection
    ? "flex-1 min-w-0"
    : railCollapsed
      ? "w-[48px] shrink-0"
      : "w-[264px] shrink-0";

  // On mobile with a selection, hide the index rail — the full ThreadDetail
  // (rendered non-embedded below) owns navigation via its mobile tab bar.
  const showIndex = !hasSelection || isDesktop;

  return (
    <div className="flex h-full overflow-hidden" data-testid="threads-workspace">
      {/* ── Index surface (board ↔ list ↔ icon rail) ── */}
      {showIndex && (
        <div
          className={cn(
            "h-full overflow-hidden bg-background flex flex-col transition-[width] duration-200",
            hasSelection && "border-r border-border",
            indexWidth,
          )}
          data-testid="threads-index"
        >
          {hasSelection ? (
            <DetailRail
              collapsed={railCollapsed}
              onToggle={() => setRailCollapsed((c) => !c)}
              threads={threads}
              currentId={selectedId}
              onNewThread={openNewThread}
            />
          ) : (
            <BrowseIndex
              lens={lens}
              setLens={setLens}
              search={search}
              setSearch={setSearch}
              threads={filtered}
              inboxItems={inboxItems}
              onNewThread={openNewThread}
            />
          )}
        </div>
      )}

      {/* ── Detail (embedded 3-pane on desktop; full ThreadDetail on mobile) ── */}
      {hasSelection && (
        <div className="flex-1 min-w-0 h-full" data-testid="threads-detail">
          <ThreadDetail embedded={isDesktop} />
        </div>
      )}
    </div>
  );
}

/* ── Browse index: header (lens + search + New) + board/list ── */

interface BrowseIndexProps {
  lens: Lens;
  setLens: (l: Lens) => void;
  search: string;
  setSearch: (s: string) => void;
  threads: ThreadListItem[];
  inboxItems: InboxCardItem[];
  onNewThread: () => void;
}

function BrowseIndex({
  lens,
  setLens,
  search,
  setSearch,
  threads,
  inboxItems,
  onNewThread,
}: BrowseIndexProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-4 pt-4 pb-3 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[1.4rem] font-bold tracking-tight leading-none">
              Discussions<span className="text-brand">.</span>
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Threads where decisions, tasks, and insights get shaped from raw input.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Lens switcher (Map = v1.1) */}
            <div className="flex items-center rounded-md border border-border overflow-hidden" role="group" aria-label="View lens">
              <button
                type="button"
                onClick={() => setLens("list")}
                aria-label="List view"
                aria-pressed={lens === "list"}
                className={cn(
                  "flex items-center px-2 py-1.5 text-xs transition-colors",
                  lens === "list" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent",
                )}
              >
                <LayoutList className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setLens("board")}
                aria-label="Board view"
                aria-pressed={lens === "board"}
                className={cn(
                  "flex items-center px-2 py-1.5 text-xs transition-colors",
                  lens === "board" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent",
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

        <div className="relative max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder="Search threads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-input bg-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Search threads"
          />
        </div>
      </div>

      {lens === "board" ? (
        <div className="flex-1 min-h-0 overflow-hidden px-4 pb-4">
          <ThreadBoard threads={threads} inboxItems={inboxItems} onNewThread={onNewThread} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto px-4 pb-4">
          <ThreadListRows threads={threads} currentId={null} />
        </div>
      )}
    </div>
  );
}

/* ── Detail-mode rail: collapse toggle + thread list (or icon dots) ── */

interface DetailRailProps {
  collapsed: boolean;
  onToggle: () => void;
  threads: ThreadListItem[];
  currentId: string | null;
  onNewThread: () => void;
}

function DetailRail({ collapsed, onToggle, threads, currentId, onNewThread }: DetailRailProps) {
  return (
    <div className="flex flex-col h-full">
      <div
        className={cn(
          "shrink-0 flex items-center gap-1 border-b border-border h-[42px]",
          collapsed ? "justify-center px-1" : "px-2",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand index" : "Collapse index"}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
        {!collapsed && (
          <>
            <span className="flex-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Discussions
            </span>
            <button
              type="button"
              onClick={onNewThread}
              aria-label="New thread"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Plus className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1.5 pt-1">
            {threads.map((t) => (
              <Link
                key={t.id}
                to={`/discussions/${t.id}`}
                title={t.title}
                aria-current={t.id === currentId ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                  t.id === currentId
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", PHASE_DOT[t.phase] ?? "bg-muted-foreground")} />
              </Link>
            ))}
          </div>
        ) : (
          <ThreadListRows threads={threads} currentId={currentId} />
        )}
      </div>
    </div>
  );
}

/* ── Shared thread-list renderer (browse list lens + detail rail) ── */

function ThreadListRows({
  threads,
  currentId,
}: {
  threads: ThreadListItem[];
  currentId: string | null;
}) {
  if (threads.length === 0) {
    return <p className="px-2 py-6 text-center text-xs text-muted-foreground">No threads yet</p>;
  }
  return (
    <nav className="space-y-0.5" aria-label="Thread index">
      {threads.map((t) => {
        const isActive = t.id === currentId;
        return (
          <Link
            key={t.id}
            to={`/discussions/${t.id}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-start gap-2 rounded-md px-2 py-2 transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "mt-1.5 h-1.5 w-1.5 rounded-full shrink-0",
                PHASE_DOT[t.phase] ?? "bg-muted-foreground",
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate text-foreground">{t.title}</span>
                {t.pendingItemCount > 0 && (
                  <span className="shrink-0 rounded-full bg-blue-500/15 px-1.5 text-[9px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                    {t.pendingItemCount}
                  </span>
                )}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="capitalize">{t.phase}</span>
                {t.lastEntryAt && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{relativeTime(t.lastEntryAt)}</span>
                  </>
                )}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
