import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { useLiveUpdates } from "../context/LiveUpdatesProvider";
import { threadsApi, type ThreadListItem, type ThreadDetail as ThreadDetailType } from "../api/threads";
import { api } from "../api/client";
import type { DiscussionEntryAttachment, ExtractedItem } from "../api/discussions";
import {
  RefreshCw, Pencil, ChevronDown, ChevronRight, Pause, Play,
  Archive, ArchiveRestore, MoreHorizontal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ThreadTab } from "../components/threads/ThreadTab";
import { ThreadCollapsedTabStrip, ThreadViewer } from "../components/threads/ThreadViewer";
import { ScopeTab } from "../components/threads/ScopeTab";
import { BranchesTab } from "../components/threads/BranchesTab";
import type { ScopeItem } from "../components/threads/scopeGrouping";
import { autonomyLabel, type AutonomyValue } from "@armyofagents/shared";
import {
  OPEN_TAB_KEY,
  closeTab,
  createOpenTab,
  ensureTab,
  scopeItemToTab,
  threadAttachmentToTab,
  type ThreadViewerTab,
} from "../components/threads/threadViewerModel";

/* ─── Phase constants ─── */

const PHASES = ["discuss", "scope", "assign", "done"] as const;
type Phase = (typeof PHASES)[number];

const NEXT_PHASE: Partial<Record<Phase, Phase>> = {
  discuss: "scope",
  scope:   "assign",
  assign:  "done",
};

const PHASE_BTN: Partial<Record<Phase, string>> = {
  discuss: "Scope →",
  scope:   "Assign →",
  assign:  "Done ✓",
};

const PHASE_LABELS: Record<Phase, string> = {
  discuss: "Discuss",
  scope:   "Scope",
  assign:  "Assign",
  done:    "Done",
};

/* ─── Autonomy pill ─── */

// Canonical 0-2 scale (Manual / Assist / Drive) sourced from @armyofagents/shared.
// Colors keyed on AutonomyValue (0 | 1 | 2).
const AUTONOMY_COLORS: Record<AutonomyValue, { color: string; bgColor: string }> = {
  0: { color: "#D9A938", bgColor: "rgba(217,169,56,0.15)" },
  1: { color: "#60a5fa", bgColor: "rgba(96,165,250,0.15)" },
  2: { color: "#4FB67E", bgColor: "rgba(79,182,126,0.15)" },
};

/* ─── Mobile + center tab types ─── */

const MOBILE_TABS = [
  { key: "origin"   as const, label: "Origin" },
  { key: "thread"   as const, label: "Thread" },
  { key: "scope"    as const, label: "Scope" },
  { key: "branches" as const, label: "Branches" },
  { key: "viewer"   as const, label: "Viewer" },
];

type MobileTab = (typeof MOBILE_TABS)[number]["key"];
type CenterTab = "thread" | "scope" | "branches";

const VIEWER_MIN_WIDTH = 280;
const VIEWER_DEFAULT_WIDTH = 340;
const VIEWER_MAX_WIDTH = 680;

/* ─── Phase dot color for left rail ─── */

const PHASE_DOT: Record<string, string> = {
  discuss: "bg-blue-500",
  scope:   "bg-amber-500",
  assign:  "bg-violet-500",
  done:    "bg-green-500",
};

/* ─── initials helper ─── */

function toInitials(id: string | null | undefined): string {
  if (!id) return "?";
  if (id === "local-board") return "LB";
  if (/^[0-9a-f]{8}-/i.test(id)) return "M";
  return (
    id.replace(/[-_]/g, " ").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?"
  );
}

const AGENT_ROLE_COLORS: Array<[RegExp, string]> = [
  [/scribe/i, "#6470DC"], [/adjutant/i, "#D9A938"], [/router/i, "#3FA8C7"],
  [/planner/i, "#5AA87E"], [/dispatcher/i, "#7E8AA8"],
];
function agentColor(name: string | null): string {
  for (const [re, c] of AGENT_ROLE_COLORS) if (re.test(name ?? "")) return c;
  return "#7E8AA8";
}

/* ════════════════════════════════════════════════════════════════════════
   ThreadDetail Page
   ════════════════════════════════════════════════════════════════════════ */

interface ThreadDetailProps {
  embedded?: boolean;
  onViewerWideChange?: (wide: boolean) => void;
}

export function ThreadDetail({ embedded = false, onViewerWideChange }: ThreadDetailProps = {}) {
  void onViewerWideChange;
  const { threadId, discussionId } = useParams<{ threadId?: string; discussionId?: string }>();
  const resolvedId = threadId ?? discussionId;
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs, setSubtitle, setEntityColor } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [mobileTab, setMobileTab] = useState<MobileTab>("thread");
  const [centerTab, setCenterTab] = useState<CenterTab>("thread");
  const [viewerTabs, setViewerTabs] = useState<ThreadViewerTab[]>(() => [createOpenTab()]);
  const [activeViewerKey, setActiveViewerKey] = useState<string | null>(OPEN_TAB_KEY);
  const [viewerCollapsed, setViewerCollapsed] = useState(false);
  const [viewerWidth, setViewerWidth] = useState(VIEWER_DEFAULT_WIDTH);

  // Header state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [showTitleEdit, setShowTitleEdit] = useState(false);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const centerHeadingRef = useRef<HTMLHeadingElement>(null);
  const viewerDragStart = useRef<{ x: number; width: number } | null>(null);

  // Query
  const { data: thread, isLoading, isError, refetch } = useQuery({
    queryKey: ["threads", selectedCompanyId, resolvedId],
    queryFn: () => threadsApi.detail(selectedCompanyId!, resolvedId!),
    enabled: !!selectedCompanyId && !!resolvedId,
    retry: false,
  });

  useEffect(() => {
    setViewerTabs([createOpenTab()]);
    setActiveViewerKey(OPEN_TAB_KEY);
  }, [resolvedId]);

  const openViewerTab = useCallback((tab: ThreadViewerTab) => {
    setViewerTabs((current) => ensureTab(current, tab));
    setActiveViewerKey(tab.key);
    setViewerCollapsed(false);
    setMobileTab("viewer");
  }, []);

  const closeViewerTab = useCallback((key: string) => {
    setViewerTabs((current) => {
      const next = closeTab(current, key);
      if (activeViewerKey === key) {
        setActiveViewerKey(next[0]?.key ?? null);
      }
      return next;
    });
  }, [activeViewerKey]);

  const openScopeItemInViewer = useCallback((item: ExtractedItem) => {
    openViewerTab(scopeItemToTab(item));
  }, [openViewerTab]);

  const openAttachmentInViewer = useCallback((
    attachment: DiscussionEntryAttachment,
    entryId?: string,
  ) => {
    openViewerTab(threadAttachmentToTab(attachment, entryId));
  }, [openViewerTab]);

  // Live updates
  const { connectionState, subscribeThread, unsubscribeThread, sendPresence, onReconnect } =
    useLiveUpdates();

  useEffect(() => {
    if (!resolvedId) return;
    subscribeThread(resolvedId);
    return () => unsubscribeThread(resolvedId);
  }, [resolvedId, subscribeThread, unsubscribeThread]);

  useEffect(() => {
    if (!resolvedId) return;
    sendPresence(resolvedId);
    const id = window.setInterval(() => sendPresence(resolvedId), 8_000);
    return () => window.clearInterval(id);
  }, [resolvedId, sendPresence]);

  useEffect(() => {
    if (!resolvedId || !selectedCompanyId) return;
    return onReconnect(() => {
      queryClient.invalidateQueries({ queryKey: ["threads", selectedCompanyId, resolvedId] });
    });
  }, [resolvedId, selectedCompanyId, onReconnect, queryClient]);

  // Derived scope items
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

  const extractedItemById = useMemo(() => {
    const map = new Map<string, ExtractedItem>();
    if (!thread) return map;
    for (const entry of thread.entries) {
      for (const item of entry.extractedItems) {
        map.set(item.id, item);
      }
    }
    return map;
  }, [thread]);

  // Derived participant counts from entries
  const participants = useMemo(() => {
    if (!thread) return { humans: [] as string[], agents: [] as { id: string; name: string | null }[] };
    const humanSet = new Set<string>();
    const agentMap = new Map<string, string | null>();
    for (const e of thread.entries) {
      if (e.authorAgentId) agentMap.set(e.authorAgentId, e.authorAgentName);
      else if (e.createdBy) humanSet.add(e.createdBy);
    }
    return {
      humans: [...humanSet],
      agents: [...agentMap.entries()].map(([id, name]) => ({ id, name })),
    };
  }, [thread]);

  const totalParticipants = participants.humans.length + participants.agents.length;
  const branchCount = useMemo(() => scopeItems.filter((i) => i.type === "spin_off_thread").length, [scopeItems]);

  // Invalidate helper
  const invalidateThread = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["threads", selectedCompanyId, resolvedId] });
  }, [queryClient, selectedCompanyId, resolvedId]);

  // Mutations
  const renameMutation = useMutation({
    mutationFn: (title: string) =>
      api.patch<ThreadDetailType>(
        `/companies/${selectedCompanyId!}/discussions/${resolvedId!}`,
        { title },
      ),
    onSuccess: () => {
      invalidateThread();
      setIsRenaming(false);
      pushToast({ title: "Thread renamed", tone: "success" });
    },
    onError: () => pushToast({ title: "Rename failed", tone: "warn" }),
  });

  const claimMutation = useMutation({
    mutationFn: () => threadsApi.claim(selectedCompanyId!, resolvedId!),
    onSuccess: () => {
      invalidateThread();
      pushToast({ title: "Thread claimed", tone: "success" });
    },
    onError: () => pushToast({ title: "Failed to claim thread", tone: "warn" }),
  });

  const advancePhaseMutation = useMutation({
    mutationFn: (phase: string) =>
      threadsApi.advancePhase(selectedCompanyId!, resolvedId!, phase),
    onSuccess: () => invalidateThread(),
    onError: () => pushToast({ title: "Failed to advance phase", tone: "warn" }),
  });

  const pauseCrewMutation = useMutation({
    mutationFn: () => threadsApi.pauseCrew(selectedCompanyId!, resolvedId!),
    onSuccess: () => {
      invalidateThread();
      pushToast({ title: "Crew paused", tone: "success" });
    },
    onError: () => pushToast({ title: "Failed to pause crew", tone: "warn" }),
  });

  const resumeCrewMutation = useMutation({
    mutationFn: () => threadsApi.resumeCrew(selectedCompanyId!, resolvedId!),
    onSuccess: () => {
      invalidateThread();
      pushToast({ title: "Crew resumed", tone: "success" });
    },
    onError: () => pushToast({ title: "Failed to resume crew", tone: "warn" }),
  });

  // Archive / unarchive the thread (PATCH /discussions/:id { status }).
  // Server gates this to founder/team_lead; there is no hard delete.
  const archiveMutation = useMutation({
    mutationFn: (next: "active" | "archived") =>
      threadsApi.setStatus(selectedCompanyId!, resolvedId!, next),
    onSuccess: (_d, next) => {
      // Refresh both the thread detail and the left-rail list.
      invalidateThread();
      queryClient.invalidateQueries({ queryKey: ["threads", selectedCompanyId] });
      if (next === "archived") {
        pushToast({ title: "Thread archived", tone: "success" });
        // useNavigate from @/lib/router auto-prepends the company prefix.
        navigate("/discussions");
      } else {
        pushToast({ title: "Thread unarchived", tone: "success" });
      }
    },
    onError: () => pushToast({ title: "Failed to update thread", tone: "warn" }),
  });

  const setAutonomyMutation = useMutation({
    mutationFn: (level: number | null) =>
      threadsApi.setAutonomyLevel(selectedCompanyId!, resolvedId!, level),
    onSuccess: () => invalidateThread(),
    onError: () => pushToast({ title: "Failed to update autonomy", tone: "warn" }),
  });

  // Autonomy dropdown state
  const [autonomyOpen, setAutonomyOpen] = useState(false);

  // Rename modal handlers
  function openRename() {
    setRenameTitle(thread?.title ?? "");
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.focus(), 50);
  }

  function handleRename() {
    const t = renameTitle.trim();
    if (!t || t === thread?.title) { setIsRenaming(false); return; }
    renameMutation.mutate(t);
  }

  // Breadcrumbs
  useEffect(() => {
    setBreadcrumbs([
      { label: "Discussions", href: "/discussions" },
      { label: thread?.title ?? "Thread" },
    ]);
    setEntityColor("var(--entity-brief)");
    return () => { setSubtitle(null); setEntityColor(null); };
  }, [thread?.title, setBreadcrumbs, setSubtitle, setEntityColor]);

  useEffect(() => {
    if (!thread) return;
    setSubtitle(thread.pendingItemCount > 0 ? `${thread.pendingItemCount} items pending` : null);
  }, [thread, setSubtitle]);

  useEffect(() => {
    if (thread && centerHeadingRef.current) centerHeadingRef.current.focus();
  }, [thread?.id]);

  // Tab keyboard navigation
  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, currentTab: CenterTab) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const tabs: CenterTab[] = ["thread", "scope", "branches"];
      const i = tabs.indexOf(currentTab);
      const next =
        e.key === "ArrowRight" ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
      setCenterTab(tabs[next]);
    }
  }, []);

  const startViewerResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (viewerCollapsed) return;
    viewerDragStart.current = { x: event.clientX, width: viewerWidth };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [viewerCollapsed, viewerWidth]);

  const resizeViewer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!viewerDragStart.current) return;
    const delta = viewerDragStart.current.x - event.clientX;
    const nextWidth = Math.min(
      VIEWER_MAX_WIDTH,
      Math.max(VIEWER_MIN_WIDTH, viewerDragStart.current.width + delta),
    );
    setViewerWidth(nextWidth);
  }, []);

  const stopViewerResize = useCallback(() => {
    viewerDragStart.current = null;
  }, []);

  // Loading / error
  if (isLoading) {
    return (
      <div
        className={cn(
          "flex h-full flex-col",
          !embedded && "bg-muted/30 p-2",
        )}
        data-testid="thread-detail-skeleton"
      >
        <div
          className={cn(
            "flex flex-1 flex-col gap-4 p-6",
            !embedded && "rounded-xl border border-border bg-background shadow-sm",
          )}
        >
          <div className="h-6 rounded-md bg-muted animate-pulse w-1/2" />
          <div className="h-4 rounded-md bg-muted animate-pulse w-3/4" />
          <div className="h-32 rounded-md bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (isError || !thread) {
    return (
      <div
        className={cn(
          "flex h-full flex-col",
          !embedded && "bg-muted/30 p-2",
        )}
        data-testid="thread-error-state"
      >
        <div
          className={cn(
            "flex flex-1 flex-col items-center gap-4 py-20",
            !embedded && "rounded-xl border border-border bg-background shadow-sm",
          )}
        >
          <p className="text-sm text-muted-foreground">Couldn&apos;t load this thread.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // Phase computations
  const phaseIndex = PHASES.indexOf(thread.phase as Phase);
  const nextPhase = NEXT_PHASE[thread.phase as Phase];
  const phaseButtonLabel = PHASE_BTN[thread.phase as Phase];
  const autonomyInfo =
    thread.autonomyLevel != null && thread.autonomyLevel in AUTONOMY_COLORS
      ? { label: autonomyLabel(thread.autonomyLevel), ...AUTONOMY_COLORS[thread.autonomyLevel as AutonomyValue] }
      : null;

  // Participant avatars (first 5)
  const allParticipants: Array<{ type: "human" | "agent"; id: string; name: string | null }> = [
    ...participants.humans.map((id) => ({ type: "human" as const, id, name: null })),
    ...participants.agents.map(({ id, name }) => ({ type: "agent" as const, id, name })),
  ];
  const shownParticipants = allParticipants.slice(0, 5);
  const hiddenCount = Math.max(0, allParticipants.length - 5);

  return (
    <div
      className={cn(
        "flex flex-col h-full overflow-hidden",
        !embedded && "bg-muted/30 p-2",
      )}
      data-testid="thread-detail"
    >
      <ConnectionPill state={connectionState} />

      {/* Rename modal */}
      {isRenaming && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
          onClick={() => setIsRenaming(false)}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-xl border border-border p-4 space-y-3"
            style={{ background: "var(--card, #161a20)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-foreground">Rename thread</h2>
            <input
              ref={renameInputRef}
              type="text"
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") setIsRenaming(false);
              }}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              placeholder="Thread title"
            />
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsRenaming(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleRename} disabled={renameMutation.isPending}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile tab bar */}
      <div className="flex border-b border-border shrink-0 md:hidden" data-testid="thread-mobile-tabs">
        {MOBILE_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setMobileTab(key);
              if (key === "thread" || key === "scope" || key === "branches")
                setCenterTab(key as CenterTab);
            }}
            className={cn(
              "flex-1 flex items-center justify-center px-1 py-2.5 text-xs font-medium transition-colors",
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

      {/* Desktop 3-pane */}
      <div
        className={cn(
          "flex flex-1 min-h-0 overflow-hidden",
          embedded && "gap-2",
          !embedded && "rounded-xl border border-border bg-background shadow-sm",
        )}
      >

        {/* Left rail */}
        {!embedded && (
          <div
            className={cn(
              "shrink-0 h-full overflow-auto border-r border-border bg-background w-[220px]",
              mobileTab !== "origin" ? "hidden md:block" : "block",
            )}
            data-testid="thread-left-rail"
          >
            <ThreadLeftRail companyId={selectedCompanyId!} currentThreadId={thread.id} />
          </div>
        )}

        {/* Center panel */}
        <div
          className={cn(
            "flex-1 min-w-0 h-full overflow-hidden flex flex-col",
            embedded && "rounded-xl border border-border bg-background shadow-sm",
            mobileTab === "thread" || mobileTab === "scope" || mobileTab === "branches"
              ? "flex"
              : "hidden md:flex",
          )}
          data-testid="thread-center-panel"
          data-pane="center"
        >
          <h1 ref={centerHeadingRef} tabIndex={-1} className="sr-only">{thread.title}</h1>

          {/* ── Header card ── */}
          <div
            className="shrink-0 border-b border-border"
            style={{ background: "var(--card, #161a20)" }}
          >
            {/* Row 1: title + controls */}
            <div className="flex items-center gap-3 px-4 pt-4 pb-2">
              {/* Title with hover-to-edit */}
              <div
                className="flex items-center gap-1.5 flex-1 min-w-0 group cursor-pointer"
                onMouseEnter={() => setShowTitleEdit(true)}
                onMouseLeave={() => setShowTitleEdit(false)}
                onClick={openRename}
              >
                <h2
                  className="text-lg font-bold text-foreground truncate leading-tight"
                  style={{ letterSpacing: "-0.01em" }}
                >
                  {thread.title}
                </h2>
                <Pencil
                  className={cn(
                    "h-3.5 w-3.5 text-muted-foreground/40 shrink-0 transition-opacity",
                    showTitleEdit ? "opacity-100" : "opacity-0",
                  )}
                />
              </div>

              {/* Controls: autonomy pill + phase advance + pause */}
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Autonomy pill — click opens level picker */}
                <div className="relative">
                  <button
                    type="button"
                    title="Change autonomy level"
                    onClick={() => setAutonomyOpen((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-opacity hover:opacity-80"
                    style={
                      autonomyInfo
                        ? { color: autonomyInfo.color, background: autonomyInfo.bgColor }
                        : { color: "hsl(0 0% 60%)", background: "hsl(0 0% 14%)" }
                    }
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: autonomyInfo?.color ?? "hsl(0 0% 40%)" }}
                    />
                    {autonomyInfo?.label ?? "Auto off"}
                    <ChevronDown className="h-2.5 w-2.5 opacity-60" />
                  </button>

                  {autonomyOpen && (
                    <div
                      className="absolute right-0 top-full mt-1 z-50 min-w-[130px] rounded-lg border border-border shadow-lg py-1"
                      style={{ background: "var(--card, #161a20)" }}
                    >
                      {([null, 0, 1, 2] as Array<AutonomyValue | null>).map((lvl) => {
                        const label = autonomyLabel(lvl);
                        const colors = lvl !== null ? AUTONOMY_COLORS[lvl] : null;
                        const color = colors?.color ?? "hsl(0 0% 40%)";
                        const bg    = colors?.bgColor ?? "hsl(0 0% 14%)";
                        const isActive = (thread.autonomyLevel ?? null) === lvl;
                        return (
                          <button
                            key={String(lvl)}
                            type="button"
                            onClick={() => {
                              setAutonomyOpen(false);
                              if (!isActive) setAutonomyMutation.mutate(lvl);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-muted/30"
                            style={{ color: isActive ? color : "hsl(0 0% 70%)" }}
                          >
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                            {label}
                            {isActive && <span className="ml-auto text-[9px] opacity-60">✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Phase advance button */}
                {phaseButtonLabel && nextPhase && (
                  <button
                    type="button"
                    onClick={() => advancePhaseMutation.mutate(nextPhase)}
                    disabled={advancePhaseMutation.isPending}
                    className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold transition-opacity disabled:opacity-50"
                    style={{
                      color: "#eeeeee",
                      background: "hsl(0 0% 20%)",
                      border: "1px solid hsl(0 0% 28%)",
                    }}
                  >
                    {phaseButtonLabel}
                  </button>
                )}

                {/* Pause/resume crew — solid button, wired to crewPaused */}
                <button
                  type="button"
                  title={thread.crewPaused ? "Resume crew" : "Pause crew"}
                  onClick={() =>
                    thread.crewPaused
                      ? resumeCrewMutation.mutate()
                      : pauseCrewMutation.mutate()
                  }
                  disabled={pauseCrewMutation.isPending || resumeCrewMutation.isPending}
                  className="w-7 h-7 rounded-full flex items-center justify-center transition-colors disabled:opacity-40"
                  style={
                    thread.crewPaused
                      ? { background: "#b82d1c", color: "#fff" }
                      : { background: "hsl(0 0% 20%)", color: "hsl(0 0% 70%)", border: "1px solid hsl(0 0% 28%)" }
                  }
                >
                  {thread.crewPaused
                    ? <Play className="h-3 w-3 ml-0.5" />
                    : <Pause className="h-3.5 w-3.5" />
                  }
                </button>

                {/* Archive / unarchive thread */}
                <button
                  type="button"
                  title={thread.status === "archived" ? "Unarchive thread" : "Archive thread"}
                  onClick={() => archiveMutation.mutate(thread.status === "archived" ? "active" : "archived")}
                  disabled={archiveMutation.isPending}
                  className="w-7 h-7 rounded-full flex items-center justify-center transition-colors disabled:opacity-40"
                  style={{ background: "hsl(0 0% 20%)", color: "hsl(0 0% 70%)", border: "1px solid hsl(0 0% 28%)" }}
                >
                  {thread.status === "archived"
                    ? <ArchiveRestore className="h-3.5 w-3.5" />
                    : <Archive className="h-3.5 w-3.5" />
                  }
                </button>
              </div>
            </div>

            {/* Scope tag */}
            {thread.scopeName && (
              <div className="flex items-center gap-1.5 px-4 pb-2">
                <span className="text-[11px] text-muted-foreground/60">Scoped to:</span>
                <span className="text-[11px] font-medium text-muted-foreground capitalize">
                  {thread.scopeType}
                </span>
                <span className="text-muted-foreground/30 text-[11px]">·</span>
                <span className="text-[11px] font-medium text-muted-foreground">
                  {thread.scopeName}
                </span>
              </div>
            )}

            {/* Claim banner */}
            {thread.ownerUserId === null && (
              <div
                className="mx-4 mb-2 flex items-center justify-between rounded-md px-3 py-1.5"
                style={{ border: "1px dashed hsl(0 0% 28%)" }}
              >
                <span className="text-[11px] text-muted-foreground">Unclaimed</span>
                <button
                  type="button"
                  onClick={() => claimMutation.mutate()}
                  disabled={claimMutation.isPending}
                  className="text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
                >
                  Take ownership
                </button>
              </div>
            )}

            {/* Participant avatars */}
            {totalParticipants > 0 && (
              <div className="flex items-center gap-2.5 px-4 pb-2.5">
                <div className="flex items-center -space-x-1.5">
                  {shownParticipants.map((p) =>
                    p.type === "agent" ? (
                      <div
                        key={p.id}
                        className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-white shrink-0"
                        style={{
                          background: agentColor(p.name),
                          borderColor: "var(--card, #161a20)",
                        }}
                        title={p.name ?? "Agent"}
                      >
                        <svg viewBox="0 0 20 20" width="11" height="11" fill="currentColor" aria-hidden>
                          <rect x="3" y="9" width="14" height="9" rx="2" />
                          <rect x="7" y="5.5" width="6" height="4" rx="1" />
                          <circle cx="7.5" cy="13" r="1.3" />
                          <circle cx="12.5" cy="13" r="1.3" />
                        </svg>
                      </div>
                    ) : (
                      <div
                        key={p.id}
                        className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                        style={{
                          background: "hsl(220 14% 28%)",
                          borderColor: "var(--card, #161a20)",
                        }}
                        title={p.id}
                      >
                        {toInitials(p.id)}
                      </div>
                    ),
                  )}
                  {hiddenCount > 0 && (
                    <div
                      className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-semibold text-muted-foreground shrink-0"
                      style={{ background: "hsl(0 0% 20%)", borderColor: "var(--card, #161a20)" }}
                    >
                      +{hiddenCount}
                    </div>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground/60">
                  {totalParticipants} participant{totalParticipants !== 1 ? "s" : ""}
                  {participants.humans.length > 0 && ` · ${participants.humans.length} human${participants.humans.length !== 1 ? "s" : ""}`}
                  {participants.agents.length > 0 && ` · ${participants.agents.length} agent${participants.agents.length !== 1 ? "s" : ""}`}
                </span>
              </div>
            )}

            {/* AI Summary banner */}
            {thread.summaryText && (
              <div
                className="mx-4 mb-2 rounded-lg border border-border/60 overflow-hidden"
                style={{ background: "hsl(221 15% 18%)" }}
              >
                <button
                  type="button"
                  onClick={() => setSummaryExpanded((v) => !v)}
                  className="flex items-center gap-2 w-full px-3 py-2 text-left"
                >
                  {summaryExpanded ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                  )}
                  <span className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider shrink-0">
                    AI Summary
                  </span>
                  {!summaryExpanded && (
                    <span className="text-[12px] text-muted-foreground truncate flex-1 ml-1">
                      {thread.summaryText}
                    </span>
                  )}
                </button>
                {summaryExpanded && (
                  <div className="px-4 pb-3 space-y-1.5 border-t border-border/40">
                    <p className="text-xs text-muted-foreground leading-relaxed pt-2">
                      {thread.summaryText}
                    </p>
                    {thread.summaryNext && (
                      <p className="text-[11px] text-muted-foreground/70 italic">
                        Next: {thread.summaryNext}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Phase stepper */}
            <div className="flex items-center justify-center gap-0 px-4 pb-3.5 pt-1">
              {PHASES.map((phase, i) => {
                const isDone = i < phaseIndex;
                const isActive = i === phaseIndex;
                return (
                  <div key={phase} className="flex items-center">
                    <div className="flex flex-col items-center gap-1.5">
                      <div
                        className={cn(
                          "rounded-full transition-all",
                          isDone && "w-2.5 h-2.5",
                          isActive && "w-3 h-3",
                          !isDone && !isActive && "w-2 h-2",
                        )}
                        style={{
                          background: isDone ? "#4FB67E" : isActive ? "#3b82f6" : "hsl(0 0% 35%)",
                          boxShadow: isActive ? "0 0 0 3px rgba(59,130,246,0.25)" : undefined,
                        }}
                      />
                      <span
                        className="text-[10px] font-medium whitespace-nowrap"
                        style={{ color: isActive ? "#60a5fa" : isDone ? "#4FB67E" : "hsl(0 0% 45%)" }}
                      >
                        {PHASE_LABELS[phase]}
                      </span>
                    </div>
                    {i < PHASES.length - 1 && (
                      <div
                        className="h-px mb-4 mx-1.5"
                        style={{
                          width: "48px",
                          background: i < phaseIndex ? "#4FB67E" : "hsl(0 0% 22%)",
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Tab bar */}
            <div
              role="tablist"
              aria-label="Thread sections"
              className="flex border-t border-border/60"
            >
              {(["thread", "scope", "branches"] as CenterTab[]).map((tab) => {
                let badge: number | null = null;
                if (tab === "scope") badge = thread.pendingItemCount > 0 ? thread.pendingItemCount : null;
                if (tab === "branches") badge = branchCount > 0 ? branchCount : null;

                return (
                  <button
                    key={tab}
                    id={`center-tab-${tab}`}
                    role="tab"
                    type="button"
                    aria-selected={centerTab === tab}
                    aria-controls={`center-tabpanel-${tab}`}
                    tabIndex={centerTab === tab ? 0 : -1}
                    onKeyDown={(e) => handleTabKeyDown(e, tab)}
                    onClick={() => {
                      setCenterTab(tab);
                      if (tab === "thread") setMobileTab("thread");
                      else if (tab === "scope") setMobileTab("scope");
                      else if (tab === "branches") setMobileTab("branches");
                    }}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors capitalize",
                      "focus-visible:outline-2 focus-visible:outline-primary",
                      centerTab === tab
                        ? "text-foreground border-b-2 border-foreground"
                        : "text-muted-foreground hover:text-foreground border-b-2 border-transparent",
                    )}
                    data-testid={`center-tab-${tab}`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {badge != null && (
                      <span
                        className="inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums"
                        style={{ background: "rgba(59,130,246,0.2)", color: "#60a5fa" }}
                      >
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab panels */}
          <div className="flex-1 min-h-0 relative overflow-hidden">
            {/* Thread panel — scroll handled internally */}
            <div
              id="center-tabpanel-thread"
              role="tabpanel"
              aria-labelledby="center-tab-thread"
              className={cn("absolute inset-0", centerTab !== "thread" && "hidden")}
            >
              <ThreadTab
                threadId={thread.id}
                companyId={selectedCompanyId!}
                entries={thread.entries}
                isLoading={isLoading}
                isError={isError}
                onRetry={refetch}
                onOpenAttachment={openAttachmentInViewer}
              />
            </div>

            {/* Scope panel */}
            <div
              id="center-tabpanel-scope"
              role="tabpanel"
              aria-labelledby="center-tab-scope"
              className={cn("absolute inset-0 overflow-auto p-4", centerTab !== "scope" && "hidden")}
              data-testid="thread-tabpanel-scope"
            >
              <ScopeTab
                summaryText={thread.summaryText}
                summaryNext={thread.summaryNext}
                items={scopeItems}
                planSteps={(((thread as unknown as { planSteps?: Array<{ title: string }> }).planSteps) ?? []).map((s) => s.title)}
                isLoading={isLoading}
                isError={isError}
                onRetry={refetch}
                onItemClick={(item) => {
                  const extracted = extractedItemById.get(item.id);
                  if (extracted) openScopeItemInViewer(extracted);
                }}
                companyId={selectedCompanyId ?? undefined}
                discussionId={resolvedId ?? undefined}
              />
            </div>

            {/* Branches panel */}
            <div
              id="center-tabpanel-branches"
              role="tabpanel"
              aria-labelledby="center-tab-branches"
              className={cn("absolute inset-0 overflow-auto p-4", centerTab !== "branches" && "hidden")}
              data-testid="thread-tabpanel-branches"
            >
              <BranchesTab
                items={scopeItems}
                companyId={selectedCompanyId ?? undefined}
                discussionId={resolvedId ?? undefined}
              />
            </div>
          </div>
        </div>

        {!viewerCollapsed && (
          <div
            role="separator"
            aria-label="Resize viewer"
            aria-orientation="vertical"
            onPointerDown={startViewerResize}
            onPointerMove={resizeViewer}
            onPointerUp={stopViewerResize}
            onPointerCancel={stopViewerResize}
            className={cn(
              "relative z-20 h-full w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-border/70",
              mobileTab !== "viewer" ? "hidden md:block" : "block",
            )}
          />
        )}

        {/* Right viewer panel */}
        <div
          className={cn(
            "relative shrink-0 h-full overflow-hidden bg-muted/20 transition-[width] duration-200",
            embedded ? "rounded-xl border border-border bg-background shadow-sm" : "border-l border-border",
            mobileTab !== "viewer" ? "hidden md:block" : "block",
          )}
          style={{ width: viewerCollapsed ? 46 : viewerWidth }}
          data-testid="thread-right-viewer"
          data-pane="viewer"
          data-collapsed={viewerCollapsed ? "true" : "false"}
          data-width={viewerCollapsed ? "46" : String(viewerWidth)}
        >
          {viewerCollapsed ? (
            <ThreadCollapsedTabStrip
              tabs={viewerTabs}
              activeKey={activeViewerKey}
              onActivate={setActiveViewerKey}
              onExpand={() => setViewerCollapsed(false)}
            />
          ) : (
            <ThreadViewer
              thread={thread}
              tabs={viewerTabs}
              activeKey={activeViewerKey}
              onActivate={setActiveViewerKey}
              onClose={closeViewerTab}
              onOpenTab={openViewerTab}
              onOpenScopePanel={() => { setCenterTab("scope"); setMobileTab("scope"); }}
              onToggleCollapse={() => setViewerCollapsed(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   ConnectionPill
   ════════════════════════════════════════════════════════════════════════ */

function ConnectionPill({ state }: { state: "connecting" | "open" | "reconnecting" | "offline" }) {
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
    return <div aria-live="polite" className="sr-only">{announce}</div>;
  }

  return (
    <div data-testid="thread-connection-pill" className="shrink-0 flex items-center justify-center">
      <span className={cn(
        "my-1 inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-[11px] font-medium",
        state === "offline"
          ? "bg-destructive/10 text-destructive"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
      )}>
        <span className={cn("h-1.5 w-1.5 rounded-full", state === "offline" ? "bg-destructive" : "bg-amber-500 animate-pulse")} aria-hidden />
        {state === "offline" ? "You're offline" : "Reconnecting…"}
      </span>
      <div aria-live="polite" className="sr-only">{announce}</div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Thread Left Rail
   ════════════════════════════════════════════════════════════════════════ */

function ThreadLeftRail({ companyId, currentThreadId }: { companyId: string; currentThreadId: string }) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const { data } = useQuery({
    queryKey: ["threads", companyId, "list"],
    queryFn: () => threadsApi.list(companyId),
    enabled: !!companyId,
    retry: false,
  });
  const threads = (data?.discussions ?? []) as ThreadListItem[];
  // Only show active threads in the rail (archived threads are in the board's Archived column)
  const activeThreads = threads.filter((t) => t.status !== "archived");

  const archiveMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      threadsApi.setStatus(companyId, id, "archived"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["threads", companyId] });
      pushToast({ title: "Thread archived", tone: "success" });
    },
    onError: () => pushToast({ title: "Failed to archive thread", tone: "warn" }),
  });

  return (
    <div className="p-2">
      <div className="flex items-center justify-between px-2 mb-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Discussions
        </p>
        <span className="text-[10px] text-muted-foreground tabular-nums">{activeThreads.length}</span>
      </div>
      <nav className="space-y-0.5" aria-label="Thread index">
        {activeThreads.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">No threads yet</p>
        ) : (
          activeThreads.map((t) => {
            const isActive = t.id === currentThreadId;
            return (
              <div
                key={t.id}
                className="group relative"
              >
                <Link
                  to={`/discussions/${t.id}`}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors pr-7",
                    isActive ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", PHASE_DOT[t.phase] ?? "bg-muted-foreground")} aria-hidden />
                  <span className="flex-1 truncate">{t.title}</span>
                  {t.pendingItemCount > 0 && (
                    <span className="shrink-0 rounded-full bg-blue-500/15 px-1.5 text-[9px] font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                      {t.pendingItemCount}
                    </span>
                  )}
                </Link>
                {/* Hover-revealed kebab menu */}
                <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        data-testid={`thread-rail-kebab-${t.id}`}
                        onClick={(e) => e.preventDefault()}
                        className="flex items-center justify-center h-5 w-5 rounded hover:bg-muted transition-colors"
                        aria-label={`Thread options for ${t.title}`}
                      >
                        <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start">
                      <DropdownMenuItem
                        onSelect={() => archiveMutation.mutate({ id: t.id })}
                        data-testid={`thread-rail-archive-${t.id}`}
                      >
                        <Archive className="h-4 w-4" />
                        Archive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })
        )}
      </nav>
    </div>
  );
}
