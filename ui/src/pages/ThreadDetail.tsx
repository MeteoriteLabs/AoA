import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { useLiveUpdates } from "../context/LiveUpdatesProvider";
import { threadsApi, type ThreadListItem, type ThreadDetail as ThreadDetailType } from "../api/threads";
import { api } from "../api/client";
import {
  RefreshCw, Flag, Link2, Brain, X, ArrowRight, PanelRightClose, PanelRightOpen,
  Pencil, ChevronDown, ChevronRight, Pause, Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ThreadTab } from "../components/threads/ThreadTab";
import { ScopeTab } from "../components/threads/ScopeTab";
import { BranchesTab } from "../components/threads/BranchesTab";
import type { ScopeItem } from "../components/threads/scopeGrouping";

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

const AUTONOMY: Record<number, { label: string; color: string; bgColor: string }> = {
  1: { label: "Manual", color: "#D9A938", bgColor: "rgba(217,169,56,0.15)" },
  2: { label: "Semi",   color: "#60a5fa", bgColor: "rgba(96,165,250,0.15)" },
  3: { label: "Auto",   color: "#4FB67E", bgColor: "rgba(79,182,126,0.15)" },
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

export function ThreadDetail({ embedded = false }: { embedded?: boolean } = {}) {
  const { threadId, discussionId } = useParams<{ threadId?: string; discussionId?: string }>();
  const resolvedId = threadId ?? discussionId;
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs, setSubtitle, setEntityColor } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [mobileTab, setMobileTab] = useState<MobileTab>("thread");
  const [centerTab, setCenterTab] = useState<CenterTab>("thread");
  const [viewerItem, setViewerItem] = useState<ScopeItem | null>(null);
  const [viewerCollapsed, setViewerCollapsed] = useState(false);

  // Header state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [showTitleEdit, setShowTitleEdit] = useState(false);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const centerHeadingRef = useRef<HTMLHeadingElement>(null);

  // Query
  const { data: thread, isLoading, isError, refetch } = useQuery({
    queryKey: ["threads", selectedCompanyId, resolvedId],
    queryFn: () => threadsApi.detail(selectedCompanyId!, resolvedId!),
    enabled: !!selectedCompanyId && !!resolvedId,
    retry: false,
  });

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

  // Loading / error
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 p-6" data-testid="thread-detail-skeleton">
        <div className="h-6 rounded-md bg-muted animate-pulse w-1/2" />
        <div className="h-4 rounded-md bg-muted animate-pulse w-3/4" />
        <div className="h-32 rounded-md bg-muted animate-pulse" />
      </div>
    );
  }

  if (isError || !thread) {
    return (
      <div className="flex flex-col items-center gap-4 py-20" data-testid="thread-error-state">
        <p className="text-sm text-muted-foreground">Couldn&apos;t load this thread.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  // Phase computations
  const phaseIndex = PHASES.indexOf(thread.phase as Phase);
  const nextPhase = NEXT_PHASE[thread.phase as Phase];
  const phaseButtonLabel = PHASE_BTN[thread.phase as Phase];
  const autonomyInfo = thread.autonomyLevel != null ? AUTONOMY[thread.autonomyLevel] : null;

  // Participant avatars (first 5)
  const allParticipants: Array<{ type: "human" | "agent"; id: string; name: string | null }> = [
    ...participants.humans.map((id) => ({ type: "human" as const, id, name: null })),
    ...participants.agents.map(({ id, name }) => ({ type: "agent" as const, id, name })),
  ];
  const shownParticipants = allParticipants.slice(0, 5);
  const hiddenCount = Math.max(0, allParticipants.length - 5);

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="thread-detail">
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
      <div className="flex flex-1 min-h-0 overflow-hidden">

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
            mobileTab === "thread" || mobileTab === "scope" || mobileTab === "branches"
              ? "flex"
              : "hidden md:flex",
          )}
          data-testid="thread-center-panel"
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
                {/* Autonomy pill */}
                {autonomyInfo && (
                  <button
                    type="button"
                    title="Autonomy level (click to change — stub)"
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={{ color: autonomyInfo.color, background: autonomyInfo.bgColor }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: autonomyInfo.color }}
                    />
                    {autonomyInfo.label}
                  </button>
                )}

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

                {/* Pause/resume stub */}
                <button
                  type="button"
                  title="Pause crew (stub)"
                  className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                >
                  <Pause className="h-3.5 w-3.5" />
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
                  setViewerItem(item);
                  setMobileTab("viewer");
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

        {/* Right viewer panel */}
        <div
          className={cn(
            "shrink-0 h-full overflow-hidden border-l border-border bg-muted/20 transition-[width] duration-200",
            viewerCollapsed ? "w-[46px]" : "w-[340px]",
            mobileTab !== "viewer" ? "hidden md:block" : "block",
          )}
          data-testid="thread-right-viewer"
          data-collapsed={viewerCollapsed ? "true" : "false"}
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
              onOpenScope={() => { setCenterTab("scope"); setMobileTab("scope"); }}
              onCollapse={() => setViewerCollapsed(true)}
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
            );
          })
        )}
      </nav>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   Thread Viewer Panel
   ════════════════════════════════════════════════════════════════════════ */

const AUTONOMY_BANNER: Record<number, { label: string; text: string }> = {
  0: { label: "L0 · Manual", text: "Agents act only when you explicitly ask." },
  1: { label: "L1 · Assist", text: "Agents suggest; you approve each step." },
  2: { label: "L2 · Drive", text: "Agents drive Discuss → Scope → Assign autonomously." },
};

const ITEM_TYPE_COLORS: Record<string, string> = {
  task:     "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  decision: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  insight:  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  reference:"bg-stone-200 text-stone-800 dark:bg-stone-800/30 dark:text-stone-300",
  artifact: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  context:  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  preference:"bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

interface ThreadViewerPanelProps {
  thread: ThreadDetailType;
  companyId: string;
  item?: ScopeItem | null;
  onClose?: () => void;
  onOpenScope?: () => void;
  onCollapse?: () => void;
  previewUrl?: string;
  previewHtml?: string;
}

function ThreadViewerPanel({ thread, companyId, item, onClose, onOpenScope, onCollapse, previewUrl, previewHtml }: ThreadViewerPanelProps) {
  const { pushToast } = useToast();

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

  if (previewUrl || previewHtml) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 h-9 border-b border-border shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Preview</span>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close preview" className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <iframe
          title={`Viewer for thread: ${thread.title}`}
          srcDoc={previewHtml}
          src={previewHtml ? undefined : previewUrl}
          className="w-full flex-1 border-0"
          sandbox={previewHtml ? "allow-same-origin allow-scripts" : "allow-same-origin allow-scripts allow-popups"}
        />
      </div>
    );
  }

  if (item) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 h-9 border-b border-border shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.type}</span>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close item" className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="p-4 space-y-3 overflow-auto">
          <h3 className="text-sm font-semibold leading-snug">{item.title}</h3>
          <div className="flex flex-wrap gap-1.5">
            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", ITEM_TYPE_COLORS[item.type] ?? "bg-muted text-muted-foreground")}>
              {item.type}
            </span>
            <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
              {item.status}
            </span>
          </div>
          {item.description && <p className="text-xs leading-relaxed text-muted-foreground">{item.description}</p>}
          {onOpenScope && (
            <button type="button" onClick={onOpenScope} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors">
              Open in Scope <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    );
  }

  const autonomy = thread.autonomyLevel != null ? AUTONOMY_BANNER[thread.autonomyLevel] : null;
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 h-9 border-b border-border shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Viewer</span>
        {onCollapse && (
          <button type="button" onClick={onCollapse} aria-label="Collapse viewer" className="text-muted-foreground hover:text-foreground">
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="p-3 space-y-4 overflow-auto">
        <section>
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Jump to</p>
          <div className="space-y-1">
            {thread.goalId && (
              <Link to={`/goals/${thread.goalId}`} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors">
                <Flag className="h-3 w-3 shrink-0" />
                <span className="flex-1">Linked goal</span>
                <ArrowRight className="h-3 w-3 opacity-60" />
              </Link>
            )}
            {linkedCount > 0 && (
              <Link to={`/discussions/${thread.id}`} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors">
                <Link2 className="h-3 w-3 shrink-0" />
                <span className="flex-1">Linked threads</span>
                <span className="rounded-full bg-muted px-1.5 text-[9px] font-semibold tabular-nums">{linkedCount}</span>
              </Link>
            )}
            <Link to="/memory" className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors">
              <Brain className="h-3 w-3 shrink-0" />
              <span className="flex-1">Memory</span>
              <ArrowRight className="h-3 w-3 opacity-60" />
            </Link>
          </div>
        </section>
        <section>
          <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Quick actions</p>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={onOpenScope} className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors">Open Scope</button>
            <button type="button" onClick={copyLink} className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors">Copy link</button>
          </div>
        </section>
        {autonomy && (
          <div className="rounded-md border border-teal-500/20 bg-teal-500/5 px-3 py-2 text-[11px] leading-relaxed text-teal-700 dark:text-teal-300">
            <span className="font-semibold">{autonomy.label}</span> · {autonomy.text}
          </div>
        )}
        <p className="px-1 text-[11px] text-muted-foreground">Select a Scope item to preview it here.</p>
      </div>
    </div>
  );
}
