import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { useLiveUpdates } from "../context/LiveUpdatesProvider";
import { threadsApi, type ThreadListItem, type ThreadDetail as ThreadDetailType } from "../api/threads";
import { RefreshCw, Flag, Link2, Brain, X, ArrowRight, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OriginCard } from "../components/threads/OriginCard";
import { ThreadTab } from "../components/threads/ThreadTab";
import { ScopeTab } from "../components/threads/ScopeTab";
import type { ScopeItem } from "../components/threads/scopeGrouping";

/* ─── Mobile tab definitions (mirrors WorkspaceLayout pattern) ─── */

const MOBILE_TABS = [
  { key: "origin" as const, label: "Origin" },
  { key: "thread" as const, label: "Thread" },
  { key: "scope" as const, label: "Scope" },
  { key: "viewer" as const, label: "Viewer" },
];

type MobileTab = (typeof MOBILE_TABS)[number]["key"];
type CenterTab = "thread" | "scope";

/* Phase → dot color for the left-rail index */
const PHASE_DOT: Record<string, string> = {
  discuss: "bg-blue-500",
  scope: "bg-amber-500",
  assign: "bg-violet-500",
  done: "bg-green-500",
};

/* ════════════════════════════════════════════════════════════════════════
   ThreadDetail Page — 3-pane layout (left rail | center | right viewer)
   ════════════════════════════════════════════════════════════════════════ */

export function ThreadDetail({ embedded = false }: { embedded?: boolean } = {}) {
  // `embedded` = rendered inside ThreadsWorkspace (the §13 continuum), which
  // supplies the index rail itself — so we hide our own left rail to avoid
  // duplicating it. Standalone (routed directly) keeps the full 3-pane.
  // Accept both threadId (from /threads/:threadId) and discussionId (from /discussions/:discussionId)
  // since discussions and threads share the same backend table.
  const { threadId, discussionId } = useParams<{ threadId?: string; discussionId?: string }>();
  const resolvedId = threadId ?? discussionId;
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs, setSubtitle, setEntityColor } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [mobileTab, setMobileTab] = useState<MobileTab>("thread");
  const [centerTab, setCenterTab] = useState<CenterTab>("thread");
  // Right-viewer selection: a clicked Scope item (null → home/shortcuts)
  const [viewerItem, setViewerItem] = useState<ScopeItem | null>(null);
  // Right-viewer collapse (§15: both side rails collapse to an icon strip)
  const [viewerCollapsed, setViewerCollapsed] = useState(false);

  // Focus ref for center panel heading
  const centerHeadingRef = useRef<HTMLHeadingElement>(null);

  // ── Query ──
  const {
    data: thread,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["threads", selectedCompanyId, resolvedId],
    queryFn: () => threadsApi.detail(selectedCompanyId!, resolvedId!),
    enabled: !!selectedCompanyId && !!resolvedId,
    retry: false,
  });

  // ── Plan 7: live thread updates (refetch-on-poke) + reconnect catch-up ──
  const { connectionState, subscribeThread, unsubscribeThread, sendPresence, onReconnect } =
    useLiveUpdates();

  // Subscribe the company WS to this thread on mount; unsubscribe on unmount.
  // The server's per-thread registry + envelope-RBAC fan-out only then delivers
  // thread.* pokes for this thread; LiveUpdatesProvider invalidates the query.
  useEffect(() => {
    if (!resolvedId) return;
    subscribeThread(resolvedId);
    return () => unsubscribeThread(resolvedId);
  }, [resolvedId, subscribeThread, unsubscribeThread]);

  // Heartbeat presence while the thread is open so other viewers see us "here".
  // Ephemeral on the server (TTL-swept); we send immediately + every 8s.
  useEffect(() => {
    if (!resolvedId) return;
    sendPresence(resolvedId);
    const id = window.setInterval(() => sendPresence(resolvedId), 8_000);
    return () => window.clearInterval(id);
  }, [resolvedId, sendPresence]);

  // On WS reconnect, catch up by refetching the active thread (covers any pokes
  // missed while disconnected). The catch-up REST endpoint (sinceSeq) backs the
  // same refresh server-side; refetching the detail query is the simplest
  // correct client path and keeps RBAC in REST.
  useEffect(() => {
    if (!resolvedId || !selectedCompanyId) return;
    return onReconnect(() => {
      queryClient.invalidateQueries({ queryKey: ["threads", selectedCompanyId, resolvedId] });
    });
  }, [resolvedId, selectedCompanyId, onReconnect, queryClient]);

  // Flatten extracted items from all entries for the Scope tab
  const scopeItems = useMemo((): ScopeItem[] => {
    if (!thread) return [];
    return thread.entries.flatMap((entry) =>
      entry.extractedItems.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        description: item.description,
        status: item.status,
        conflictsWith: item.conflictsWith,
        suggestedPriority: item.suggestedPriority,
        suggestedAssigneeId: item.suggestedAssigneeId,
        suggestedDepartmentId: item.suggestedDepartmentId,
        suggestedLayer: item.suggestedLayer,
        layer: item.layer,
        dedupAction: item.dedupAction,
        resultTaskId: item.resultTaskId,
        resultMemoryId: item.resultMemoryId,
        createdAt: item.createdAt,
      })),
    );
  }, [thread]);

  // ── Breadcrumbs ──
  useEffect(() => {
    setBreadcrumbs([
      { label: "Discussions", href: "/discussions" },
      { label: thread?.title ?? "Thread" },
    ]);
    setEntityColor("var(--entity-brief)");
    return () => {
      setSubtitle(null);
      setEntityColor(null);
    };
  }, [thread?.title, setBreadcrumbs, setSubtitle, setEntityColor]);

  useEffect(() => {
    if (!thread) return;
    setSubtitle(
      thread.pendingItemCount > 0 ? `${thread.pendingItemCount} items pending` : null,
    );
  }, [thread, setSubtitle]);

  // Move focus to center heading when thread loads
  useEffect(() => {
    if (thread && centerHeadingRef.current) {
      centerHeadingRef.current.focus();
    }
  }, [thread?.id]);

  // ── Tab keyboard navigation ──
  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, currentTab: CenterTab) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const tabs: CenterTab[] = ["thread", "scope"];
        const currentIndex = tabs.indexOf(currentTab);
        const nextIndex =
          e.key === "ArrowRight"
            ? (currentIndex + 1) % tabs.length
            : (currentIndex - 1 + tabs.length) % tabs.length;
        setCenterTab(tabs[nextIndex]);
      }
    },
    [],
  );

  // ── Loading skeleton ──
  if (isLoading) {
    return (
      <div
        className="flex flex-col gap-4 p-6"
        data-testid="thread-detail-skeleton"
        aria-label="Loading thread..."
      >
        <div className="h-6 rounded-md bg-muted animate-pulse w-1/2" />
        <div className="h-4 rounded-md bg-muted animate-pulse w-3/4" />
        <div className="h-4 rounded-md bg-muted animate-pulse w-2/3" />
        <div className="h-32 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  // ── Error state ──
  if (isError || !thread) {
    return (
      <div className="flex flex-col items-center gap-4 py-20" data-testid="thread-error-state">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this thread.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="flex items-center gap-1.5"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  /* ──────────────────────────────────────────────────────────────────────
     Render: Desktop 3-pane + mobile tab layout
     The key mobile design rule: all panels rendered, CSS hidden for inactive.
     Mirrors WorkspaceLayout's mobile pattern exactly.
  ────────────────────────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="thread-detail">
      {/* ── Plan 7 (D2): non-blocking connection pill ── */}
      <ConnectionPill state={connectionState} />

      {/* ── Mobile tab bar (visible only on small screens) ── */}
      <div
        className="flex border-b border-border shrink-0 md:hidden"
        data-testid="thread-mobile-tabs"
      >
        {MOBILE_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setMobileTab(key);
              // The mobile pane-tabs double as the Thread/Scope switcher on
              // small screens (the center content-tab bar is hidden there), so
              // keep centerTab in sync to avoid showing the wrong content.
              if (key === "thread" || key === "scope") setCenterTab(key);
            }}
            className={cn(
              "flex-1 flex items-center justify-center px-2 py-2.5 text-xs font-medium transition-colors",
              mobileTab === key
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
            data-testid={`mobile-tab-${key}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Desktop 3-pane layout + mobile panel stacks (CSS hidden) ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Left rail — thread navigation index ── */}
        {/* Desktop: always visible. Mobile: only when mobileTab = "origin".
            Hidden when embedded — ThreadsWorkspace provides the index rail. */}
        {!embedded && (
          <div
            className={cn(
              "shrink-0 h-full overflow-auto border-r border-border bg-background",
              "w-[220px]",
              // Mobile CSS hidden — mirrors WorkspaceLayout
              mobileTab !== "origin" ? "hidden md:block" : "block md:block",
            )}
            data-testid="thread-left-rail"
            aria-label="Thread navigation"
          >
            <ThreadLeftRail companyId={selectedCompanyId!} currentThreadId={thread.id} />
          </div>
        )}

        {/* ── Center panel — OriginCard + Thread|Scope tabs ── */}
        {/* Mobile: center panel is visible when thread or scope tab is active */}
        <div
          className={cn(
            "flex-1 min-w-0 h-full overflow-auto flex flex-col",
            // Mobile CSS hidden — mirrors WorkspaceLayout: all panels always rendered, only active shown
            mobileTab === "thread" || mobileTab === "scope" ? "flex" : "hidden md:flex",
          )}
          data-testid="thread-center-panel"
        >
          {/* Center heading (focus target on open) */}
          <h1
            ref={centerHeadingRef}
            tabIndex={-1}
            className="sr-only"
          >
            {thread.title}
          </h1>

          {/* OriginCard — thread metadata + phase pills */}
          <div className="shrink-0 p-4 border-b border-border">
            <OriginCard
              thread={thread}
              companyId={selectedCompanyId!}
              onPhaseChanged={() =>
                queryClient.invalidateQueries({ queryKey: ["threads", selectedCompanyId, resolvedId] })
              }
            />
          </div>

          {/* Thread|Scope tab bar — desktop only; on mobile the pane-tabs above
              ([Origin|Thread|Scope|Viewer]) are the switcher, so this is hidden
              to avoid duplicate Thread/Scope tabs. */}
          <div
            role="tablist"
            aria-label="Thread sections"
            className="hidden md:flex border-b border-border shrink-0 px-4"
          >
            {(["thread", "scope"] as CenterTab[]).map((tab) => (
              <button
                key={tab}
                id={`thread-tab-${tab}`}
                role="tab"
                type="button"
                aria-selected={centerTab === tab}
                aria-controls={`thread-tabpanel-${tab}`}
                tabIndex={centerTab === tab ? 0 : -1}
                onKeyDown={(e) => handleTabKeyDown(e, tab)}
                onClick={() => {
                  setCenterTab(tab);
                  // Sync mobile tab to the center tab if mobile
                  if (tab === "thread") setMobileTab("thread");
                  else if (tab === "scope") setMobileTab("scope");
                }}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium transition-colors capitalize",
                  "focus-visible:outline-2 focus-visible:outline-primary",
                  centerTab === tab
                    ? "text-primary border-b-2 border-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`center-tab-${tab}`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>

          {/* Tab panels */}
          <div className="flex-1 min-h-0 overflow-auto">
            <div
              id="thread-tabpanel-thread"
              role="tabpanel"
              aria-labelledby="thread-tab-thread"
              className={cn("h-full p-4", centerTab !== "thread" && "hidden")}
              data-testid="thread-tabpanel-thread"
            >
              <ThreadTab
                threadId={thread.id}
                companyId={selectedCompanyId!}
                entries={thread.entries}
                isLoading={isLoading}
                isError={isError}
                onRetry={refetch}
              />
            </div>

            <div
              id="thread-tabpanel-scope"
              role="tabpanel"
              aria-labelledby="thread-tab-scope"
              className={cn("h-full p-4", centerTab !== "scope" && "hidden")}
              data-testid="thread-tabpanel-scope"
            >
              <ScopeTab
                summaryText={thread.summaryText}
                summaryNext={thread.summaryNext}
                items={scopeItems}
                planSteps={[]} // TODO: add planSteps to ThreadDetail type when backend exposes it
                isLoading={isLoading}
                isError={isError}
                onRetry={refetch}
                onItemClick={(item) => {
                  setViewerItem(item);
                  setMobileTab("viewer");
                }}
              />
            </div>
          </div>
        </div>

        {/* ── Right viewer panel (collapsible — §15: both rails collapse) ── */}
        <div
          className={cn(
            "shrink-0 h-full overflow-hidden border-l border-border bg-muted/20 transition-[width] duration-200",
            viewerCollapsed ? "w-[46px]" : "w-[340px]",
            // Mobile: only show when mobileTab = "viewer"
            mobileTab !== "viewer" ? "hidden md:block" : "block",
          )}
          data-testid="thread-right-viewer"
          data-collapsed={viewerCollapsed ? "true" : "false"}
          aria-label="Thread viewer"
        >
          {viewerCollapsed ? (
            <div className="flex flex-col items-center pt-2">
              <button
                type="button"
                onClick={() => setViewerCollapsed(false)}
                aria-label="Expand viewer"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <PanelRightOpen className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <ThreadViewerPanel
              thread={thread}
              companyId={selectedCompanyId!}
              item={viewerItem}
              onClose={() => setViewerItem(null)}
              onOpenScope={() => {
                setCenterTab("scope");
                setMobileTab("scope");
              }}
              onCollapse={() => setViewerCollapsed(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Connection Pill (Plan 7 D2)
   Subtle, non-blocking banner for reconnecting / offline. Does not cover
   content. Announced via aria-live="polite" — and only ONCE per transition
   into a degraded state (not on every reconnect retry), so screen readers
   aren't spammed.
   ════════════════════════════════════════════════════════════════════════ */

function ConnectionPill({ state }: { state: "connecting" | "open" | "reconnecting" | "offline" }) {
  // Only announce when we actually enter a degraded state, and only once per
  // entry (announceRef gates repeat announcements during retry loops).
  const announceRef = useRef(false);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    if (state === "reconnecting" || state === "offline") {
      if (!announceRef.current) {
        announceRef.current = true;
        setAnnounce(state === "offline" ? "You're offline" : "Connection lost. Reconnecting.");
      }
    } else {
      announceRef.current = false;
      setAnnounce("");
    }
  }, [state]);

  if (state === "open" || state === "connecting") {
    // Keep a polite live region mounted so the "restored" clear is announced.
    return <div aria-live="polite" className="sr-only">{announce}</div>;
  }

  const label = state === "offline" ? "You're offline" : "Reconnecting…";
  return (
    <div
      data-testid="thread-connection-pill"
      className="shrink-0 flex items-center justify-center"
    >
      <span
        className={cn(
          "my-1 inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-[11px] font-medium",
          state === "offline"
            ? "bg-destructive/10 text-destructive"
            : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            state === "offline" ? "bg-destructive" : "bg-amber-500 animate-pulse",
          )}
          aria-hidden="true"
        />
        {label}
      </span>
      {/* Polite, once-per-entry announcement (gated above). */}
      <div aria-live="polite" className="sr-only">{announce}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Thread Left Rail — navigation index
   ════════════════════════════════════════════════════════════════════════ */

function ThreadLeftRail({
  companyId,
  currentThreadId,
}: {
  companyId: string;
  currentThreadId: string;
}) {
  // Render the thread index so the rail is a real switcher (the §13 "list" lens).
  const { data } = useQuery({
    queryKey: ["threads", companyId, "list"],
    queryFn: () => threadsApi.list(companyId),
    enabled: !!companyId,
    retry: false,
  });
  const threads = (data?.discussions ?? []) as ThreadListItem[];

  return (
    <div className="p-2">
      <div className="flex items-center justify-between px-2 mb-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Discussions
        </p>
        <span className="text-[10px] text-muted-foreground tabular-nums">{threads.length}</span>
      </div>
      <nav className="space-y-0.5" aria-label="Thread index">
        {threads.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">No threads yet</p>
        ) : (
          threads.map((t) => {
            const isActive = t.id === currentThreadId;
            return (
              <Link
                key={t.id}
                to={`/discussions/${t.id}`}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    PHASE_DOT[t.phase] ?? "bg-muted-foreground",
                  )}
                  aria-hidden
                />
                <span className="flex-1 truncate">{t.title}</span>
                {t.pendingItemCount > 0 && (
                  <span className="shrink-0 rounded-full bg-blue-500/15 px-1.5 text-[9px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                    {t.pendingItemCount}
                  </span>
                )}
              </Link>
            );
          })
        )}
      </nav>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Thread Viewer Panel — right-side content viewer
   ════════════════════════════════════════════════════════════════════════ */

const AUTONOMY_BANNER: Record<number, { label: string; text: string }> = {
  0: { label: "L0 · Manual", text: "Agents act only when you explicitly ask." },
  1: { label: "L1 · Assist", text: "Agents suggest; you approve each step." },
  2: {
    label: "L2 · Drive",
    text: "Agents drive Discuss → Scope → Assign autonomously. Assignment needs your confirmation.",
  },
};

const ITEM_TYPE_COLORS: Record<string, string> = {
  task: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  decision: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  insight: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  reference: "bg-stone-200 text-stone-800 dark:bg-stone-800/30 dark:text-stone-300",
  artifact: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  context: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  preference: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

interface ThreadViewerPanelProps {
  thread: ThreadDetailType;
  companyId: string;
  /** Currently selected scope item to preview (null → home/shortcuts) */
  item?: ScopeItem | null;
  onClose?: () => void;
  onOpenScope?: () => void;
  onCollapse?: () => void;
  /** Optional URL/HTML to preview in the sandboxed iframe (artifact/reference) */
  previewUrl?: string;
  previewHtml?: string;
}

function ThreadViewerPanel({
  thread,
  companyId,
  item,
  onClose,
  onOpenScope,
  onCollapse,
  previewUrl,
  previewHtml,
}: ThreadViewerPanelProps) {
  const { pushToast } = useToast();
  const hasIframe = Boolean(previewUrl || previewHtml);

  const { data: linksData } = useQuery({
    queryKey: ["thread-links", companyId, thread.id],
    queryFn: () => threadsApi.listLinks(companyId, thread.id),
    enabled: !!companyId,
    retry: false,
  });
  const linkedCount = linksData?.links?.length ?? 0;

  function copyLink() {
    try {
      void navigator.clipboard?.writeText(window.location.href);
      pushToast({ title: "Link copied", tone: "success" });
    } catch {
      pushToast({ title: "Couldn't copy link", tone: "warn" });
    }
  }

  // ── Iframe preview (artifact/reference URL or HTML) ──
  if (hasIframe) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 h-9 border-b border-border shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Preview
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <iframe
          title={`Viewer for thread: ${thread.title}`}
          srcDoc={previewHtml}
          src={previewHtml ? undefined : previewUrl}
          className="w-full flex-1 border-0"
          sandbox={
            previewHtml
              ? "allow-same-origin allow-scripts"
              : "allow-same-origin allow-scripts allow-popups"
          }
        />
      </div>
    );
  }

  // ── Selected scope item detail ──
  if (item) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 h-9 border-b border-border shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {item.type}
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close item"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="p-4 space-y-3 overflow-auto">
          <h3 className="text-sm font-semibold leading-snug text-foreground">{item.title}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                ITEM_TYPE_COLORS[item.type] ?? "bg-muted text-muted-foreground",
              )}
            >
              {item.type}
            </span>
            <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
              {item.status}
            </span>
          </div>
          {item.description && (
            <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>
          )}
          {onOpenScope && (
            <button
              type="button"
              onClick={onOpenScope}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
            >
              Open in Scope <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Home: Jump-to + Quick actions + autonomy explainer ──
  const autonomy = thread.autonomyLevel != null ? AUTONOMY_BANNER[thread.autonomyLevel] : null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 h-9 border-b border-border shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Viewer
        </span>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse viewer"
            className="text-muted-foreground hover:text-foreground"
          >
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="p-3 space-y-4 overflow-auto">
        {/* Jump to */}
        <section>
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Jump to
          </p>
          <div className="space-y-1">
            {thread.goalId && (
              <Link
                to={`/goals/${thread.goalId}`}
                className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
              >
                <Flag className="h-3 w-3 shrink-0" />
                <span className="flex-1">Linked goal</span>
                <ArrowRight className="h-3 w-3 opacity-60" />
              </Link>
            )}
            {linkedCount > 0 && (
              <Link
                to={`/discussions/${thread.id}`}
                className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
              >
                <Link2 className="h-3 w-3 shrink-0" />
                <span className="flex-1">Linked threads</span>
                <span className="rounded-full bg-muted px-1.5 text-[9px] font-semibold tabular-nums">
                  {linkedCount}
                </span>
              </Link>
            )}
            <Link
              to="/memory"
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
            >
              <Brain className="h-3 w-3 shrink-0" />
              <span className="flex-1">Memory</span>
              <ArrowRight className="h-3 w-3 opacity-60" />
            </Link>
          </div>
        </section>

        {/* Quick actions */}
        <section>
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Quick actions
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onOpenScope}
              className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
            >
              Open Scope
            </button>
            <button
              type="button"
              onClick={copyLink}
              className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
            >
              Copy link
            </button>
          </div>
        </section>

        {/* Autonomy explainer */}
        {autonomy && (
          <div className="rounded-md border border-teal-500/20 bg-teal-500/5 px-3 py-2 text-[11px] leading-relaxed text-teal-700 dark:text-teal-300">
            <span className="font-semibold">{autonomy.label}</span> · {autonomy.text}
          </div>
        )}

        <p className="px-1 text-[11px] text-muted-foreground">
          Select a Scope item to preview it here.
        </p>
      </div>
    </div>
  );
}
