import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "@/lib/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { threadsApi } from "../api/threads";
import { RefreshCw } from "lucide-react";
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

/* ════════════════════════════════════════════════════════════════════════
   ThreadDetail Page — 3-pane layout (left rail | center | right viewer)
   ════════════════════════════════════════════════════════════════════════ */

export function ThreadDetail() {
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
      {/* ── Mobile tab bar (visible only on small screens) ── */}
      <div
        className="flex border-b border-border shrink-0 md:hidden"
        data-testid="thread-mobile-tabs"
      >
        {MOBILE_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setMobileTab(key)}
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
        {/* Desktop: always visible. Mobile: only when mobileTab = "origin" */}
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
          <ThreadLeftRail threadId={thread.id} title={thread.title} />
        </div>

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

          {/* Thread|Scope tab bar */}
          <div
            role="tablist"
            aria-label="Thread sections"
            className="flex border-b border-border shrink-0 px-4"
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
                onItemClick={() => {}}
              />
            </div>
          </div>
        </div>

        {/* ── Right viewer panel ── */}
        <div
          className={cn(
            "shrink-0 h-full overflow-auto border-l border-border bg-muted/20",
            "w-[340px]",
            // Mobile: only show when mobileTab = "viewer"
            mobileTab !== "viewer" ? "hidden md:block" : "block",
          )}
          data-testid="thread-right-viewer"
          aria-label="Thread viewer"
        >
          <ThreadViewerPanel thread={thread} />
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Thread Left Rail — navigation index
   ════════════════════════════════════════════════════════════════════════ */

function ThreadLeftRail({ threadId: _threadId, title }: { threadId: string; title: string }) {
  // TODO(Plan 5): use threadId for index nav (jump-to-entry, section links)
  return (
    <div className="p-3 space-y-1">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">
        Thread
      </p>
      <div className="rounded-md px-2 py-1.5 text-sm bg-accent text-accent-foreground font-medium truncate">
        {title}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Thread Viewer Panel — right-side content viewer
   ════════════════════════════════════════════════════════════════════════ */

interface ThreadViewerPanelProps {
  thread: { title: string };
  /** Optional URL to preview in the sandboxed iframe */
  previewUrl?: string;
  /** Optional raw HTML to render via srcdoc */
  previewHtml?: string;
}

function ThreadViewerPanel({ thread, previewUrl, previewHtml }: ThreadViewerPanelProps) {
  const hasContent = previewUrl || previewHtml;

  return (
    <div className="flex flex-col h-full">
      {!hasContent && (
        <div className="p-4">
          <p className="text-xs text-muted-foreground">
            Select an item to preview it here.
          </p>
        </div>
      )}
      {hasContent && previewHtml && (
        <iframe
          title={`Viewer for thread: ${thread.title}`}
          srcDoc={previewHtml}
          className="w-full flex-1 border-0"
          sandbox="allow-same-origin allow-scripts"
        />
      )}
      {hasContent && previewUrl && !previewHtml && (
        <iframe
          title={`Viewer for thread: ${thread.title}`}
          src={previewUrl}
          className="w-full flex-1 border-0"
          sandbox="allow-same-origin allow-scripts allow-popups"
        />
      )}
    </div>
  );
}
