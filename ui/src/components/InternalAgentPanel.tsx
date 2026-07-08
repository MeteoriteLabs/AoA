import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AtSign,
  Bot,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquarePlus,
  Mic,
  PanelLeft,
  Send,
  Square,
  X,
  Zap,
} from "lucide-react";
import { useAgentPanel } from "../context/AgentPanelContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCommanderContextScope } from "../context/CommanderContextScopeContext";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";
import { useLocation, useNavigate } from "../lib/router";
import { useBreakpoint } from "../lib/useBreakpoint";
import {
  internalAgentApi,
  streamAgentChat,
  conversationMessagesApi,
  commanderConversationsApi,
  confirmAction,
  type AgentMessage,
  type ConfirmActionDecision,
  type AgentGreeting,
  type SSEEvent,
} from "../api/internal-agent";
import { queryKeys } from "../lib/queryKeys";
import { cn, relativeTime } from "../lib/utils";
import { COMMANDER_PANEL_CARD } from "./commander/commanderChrome";
import { Button } from "@/components/ui/button";
import { MarkdownBody } from "./MarkdownBody";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { ChatPaneCaption } from "./commander/ChatPaneCaption";
import { CommanderEmptyState } from "./commander/CommanderEmptyState";
import { CommanderReasoningBlock } from "./commander/CommanderReasoningBlock";
import { InputAddMenu } from "./commander/InputAddMenu";
import { MemoryContextStrip } from "./commander/MemoryContextStrip";
import { SkillPicker } from "./commander/SkillPicker";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { useCommanderViewerCollapsed } from "./commander/useCommanderViewerCollapsed";
import { useCommanderCockpitCollapsed } from "./commander/useCommanderCockpitCollapsed";
import { CommanderCockpitPanel } from "./commander/cockpit/CommanderCockpitPanel";
import {
  CommanderViewerPanel,
  CommanderViewerDetail,
  buildViewerTabModels,
  OutputRefChips,
  collectConversationRefs,
  mergeRefs,
  shouldAutoOpen,
  useCommanderViewer,
} from "./commander/viewer";
import {
  CommanderInput,
  type CommanderInputHandle,
  type SlashState,
} from "./commander/CommanderInput";
import type { CommanderInputRef, CompanySkillListItem } from "@armyofagents/shared";
import {
  MAX_COMMANDER_INPUT_REFS,
  appendCommanderInputRef,
  appendCommanderInputRefsToMessage,
  commanderInputRefKey,
  commanderInputRefKindLabel,
} from "@armyofagents/shared";
import type { CommanderContextScope } from "@armyofagents/shared";
import type { CommanderOutputRef } from "@armyofagents/shared";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/* ------------------------------------------------------------------ */
/*  Auto-scroll proximity helper (exported for unit-testing)          */
/* ------------------------------------------------------------------ */

/** Returns true if the scroll container is close enough to the bottom to auto-scroll. */
export function shouldAutoScroll(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
  thresholdPx = 120,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= thresholdPx;
}

/* ------------------------------------------------------------------ */
/*  Abort cleanup helper (exported for unit-testing)                  */
/* ------------------------------------------------------------------ */

/**
 * Returns a cleanup function that calls `abort()` on whatever AbortController
 * is stored in `abortRef` at the time the cleanup runs.  This is the exact
 * logic used inside `AgentPanelContent`'s unmount useEffect (B1).
 *
 * Exported so the behaviour can be unit-tested against the real production
 * code rather than a test-local replica.
 */
export function createAbortCleanup(
  abortRef: React.MutableRefObject<AbortController | null>,
): () => void {
  return () => {
    abortRef.current?.abort();
  };
}

export interface CommanderInputRefState {
  refs: CommanderInputRef[];
  duplicateKey: string | null;
}

export function buildCommanderInputRefState(
  refs: readonly CommanderInputRef[],
  ref: CommanderInputRef,
): CommanderInputRefState {
  const result = appendCommanderInputRef(refs, ref);
  return {
    refs: result.refs,
    duplicateKey: result.added ? null : result.existingKey ?? commanderInputRefKey(ref),
  };
}

export interface CommanderInputRefOpenDeps {
  openPreview: (source: "center" | "right-panel") => void;
  openTask: (issueId: string, title: string) => void;
  openArtifact: (id: string, title: string) => void;
  openInputRef: (ref: CommanderInputRef) => void;
  navigate: (href: string) => void;
}

export function openCommanderInputRef(
  ref: CommanderInputRef,
  deps: CommanderInputRefOpenDeps,
): void {
  if (
    ref.kind === "task" ||
    ref.kind === "artifact" ||
    ref.kind === "discussion" ||
    ref.kind === "approval" ||
    ref.kind === "inbox" ||
    ref.kind === "note"
  ) {
    deps.openPreview("right-panel");
    deps.openInputRef(ref);
    return;
  }
  if (ref.route) {
    deps.navigate(ref.route);
  }
}

/* ------------------------------------------------------------------ */
/*  Tool call display names                                            */
/* ------------------------------------------------------------------ */

const TOOL_LABELS: Record<string, string> = {
  list_tasks: "Checking your tasks...",
  get_task: "Looking up task details...",
  create_task: "Creating a task...",
  update_task: "Updating a task...",
  list_goals: "Reviewing goals...",
  list_agents: "Checking agents...",
  list_departments: "Looking at departments...",
  create_department: "Creating a department...",
  search_memory: "Searching memory...",
  create_discussion: "Starting a discussion...",
  list_discussions: "Checking discussions...",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidOrNull(value: string | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

function surfaceFromPath(parts: string[]): NonNullable<CommanderContextScope["surface"]> {
  if (parts.includes("issues") || parts.includes("tasks")) return "task";
  if (parts.includes("goals") || parts.includes("objectives")) return "goal";
  const section = parts[1] ?? parts[0] ?? "commander";
  if (section === "projects") return "project";
  if (section === "goals" || section === "objectives") return "goal";
  if (section === "issues" || section === "tasks") return "task";
  if (section === "memory") return "memory";
  if (section === "discussions" || section === "threads") return "discussion";
  if (section === "budget" || section === "costs") return "budget";
  if (section === "team" || section === "agents") return "team";
  if (section === "settings") return "settings";
  if (section === "home") return "home";
  if (section === "commander") return "commander";
  return "commander";
}

export function buildCommanderContextScopeFromPath(pathname: string): CommanderContextScope {
  const parts = pathname.split("/").filter(Boolean);
  const projectIndex = parts.indexOf("projects");
  const goalIndex = parts.indexOf("goals");
  const issueIndex = parts.indexOf("issues");
  const memoryIndex = parts.indexOf("memory");
  const projectId = projectIndex >= 0 ? uuidOrNull(parts[projectIndex + 1]) : null;
  const goalId = goalIndex >= 0 ? uuidOrNull(parts[goalIndex + 1]) : null;
  const taskId = issueIndex >= 0 ? uuidOrNull(parts[issueIndex + 1]) : null;

  return {
    surface: surfaceFromPath(parts),
    route: pathname.slice(0, 500),
    ...(projectId ? { projectId } : {}),
    ...(goalId ? { goalId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(memoryIndex >= 0 ? { memoryFolderPath: "Company" } : {}),
  };
}

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Running ${name.replaceAll("_", " ")}...`;
}

export function completedToolLabel(name: string): string {
  const label = TOOL_LABELS[name] ?? name.replace(/_+/g, " ");
  return `Used ${label.replace(/\.\.\.$/, "").replace(/^Running\s+/i, "")}`;
}

/* ------------------------------------------------------------------ */
/*  Confirmation card entity-line derivation                           */
/* ------------------------------------------------------------------ */

/** Verbs we treat as action verbs; anything else falls back to "run <action>". */
const KNOWN_VERBS = new Set([
  "update", "create", "delete", "set", "add", "remove", "reset",
  "enable", "disable", "send", "archive", "restore", "approve",
  "reject", "assign", "unassign", "move", "copy", "list", "get",
  "fetch", "run", "start", "stop", "pause", "resume",
]);

/**
 * Derives a human-readable entity line from an action identifier.
 *
 * Examples:
 *   "update_company_identity" → "This will update company identity"
 *   "create_task"             → "This will create task"
 *   "foo_bar_baz"             → "This will run foo bar baz"
 *
 * The result is truncated to 80 characters (including "This will ").
 */
export function deriveConfirmEntityLine(action: string): string {
  const parts = action.split("_");
  const verb = parts[0] ?? "";
  const entityParts = parts.slice(1);
  let line: string;
  if (KNOWN_VERBS.has(verb.toLowerCase())) {
    const entity = entityParts.join(" ");
    line = `This will ${verb} ${entity}`.trim();
  } else {
    const humanized = parts.join(" ");
    line = `This will run ${humanized}`;
  }
  if (line.length > 80) {
    return line.slice(0, 79) + "…";
  }
  return line;
}

/* ------------------------------------------------------------------ */
/*  Message types for local rendering                                  */
/* ------------------------------------------------------------------ */

export interface ToolCallEntry {
  id: number;
  name: string;
  status: "running" | "done";
  success?: boolean;
  summary?: string;
  open?: boolean;
}

export interface LocalMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  streamingDone: boolean;
  toolCalls?: ToolCallEntry[];
  reasoning?: string;
  actionConfirm?: {
    confirmId: string;
    action: string;
    description: string;
    status: "pending" | "approving" | "approved" | "rejected" | "failed";
    errorMessage?: string;
  };
  optionsPrompt?: {
    promptId: string;
    question: string;
    options: string[];
    dismissed: boolean;
  };
  outputRefs?: CommanderOutputRef[];
  createdAt: string;
  durationMs?: number;
}

function serverToLocal(m: AgentMessage): LocalMessage {
  const calls = Array.isArray(m.toolCalls) ? m.toolCalls : [];
  const toolCalls: ToolCallEntry[] | undefined =
    calls.length > 0
      ? calls.map((c, i) => ({
          id: i,
          name: c.name,
          status: "done" as const,
          ...(c.success !== undefined ? { success: c.success } : {}),
          ...(c.summary !== undefined ? { summary: c.summary } : {}),
        }))
      : undefined;
  return {
    id: m.id,
    role: m.role === "tool" ? "system" : m.role,
    content: m.content ?? "",
    streamingDone: true,
    outputRefs: (m.outputRefs ?? undefined) as CommanderOutputRef[] | undefined,
    ...(toolCalls ? { toolCalls } : {}),
    ...(m.reasoning ? { reasoning: m.reasoning } : {}),
    createdAt: m.createdAt,
  };
}

export function mergeServerMessagesWithTransientLocal(
  serverMessages: AgentMessage[],
  localMessages: LocalMessage[],
): LocalMessage[] {
  const localById = new Map(localMessages.map((m) => [m.id, m]));
  const serverIds = new Set(serverMessages.map((m) => m.id));
  // Carry the live-only "Worked for Xs" durationMs from the streamed local
  // message onto its persisted server counterpart. The streamed message has a
  // client temp id (≠ the server id), so match by content. This keeps the
  // caption visible after the post-turn server sync; it is still absent after a
  // hard reload (no local message to carry from) — duration is not persisted,
  // by design (it lives on internal_agent_runs, not internal_agent_messages).
  const localDurationByContent = new Map<string, number>();
  for (const lm of localMessages) {
    if (lm.role === "assistant" && typeof lm.durationMs === "number" && lm.content.trim().length > 0) {
      localDurationByContent.set(lm.content, lm.durationMs);
    }
  }
  const merged = serverMessages.map((m) => {
    const base = serverToLocal(m);
    const carriedDuration =
      base.role === "assistant" ? localDurationByContent.get(base.content) : undefined;
    return {
      ...base,
      ...(carriedDuration !== undefined ? { durationMs: carriedDuration } : {}),
      actionConfirm: localById.get(m.id)?.actionConfirm,
      optionsPrompt: localById.get(m.id)?.optionsPrompt,
    };
  });

  const transientMessages = localMessages.filter(
    (m) =>
      !serverIds.has(m.id) &&
      (
        m.actionConfirm !== undefined ||
        m.optionsPrompt !== undefined ||
        (
          m.role === "assistant" &&
          m.content.trim().length > 0 &&
          !serverMessages.some(
            (serverMessage) =>
              serverMessage.role === "assistant" &&
              (serverMessage.content ?? "") === m.content,
          )
        )
      ),
  );

  return [...merged, ...transientMessages];
}

export function settleRunningToolCalls(messages: LocalMessage[], messageId: string): LocalMessage[] {
  return messages.map((m) => {
    if (m.id !== messageId || !m.toolCalls?.some((tc) => tc.status === "running")) {
      return m;
    }
    return {
      ...m,
      toolCalls: m.toolCalls.map((tc) => (
        tc.status === "running" ? { ...tc, status: "done" as const } : tc
      )),
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Panel content (shared between desktop inline & mobile sheet)       */
/* ------------------------------------------------------------------ */

interface AgentPanelContentProps {
  conversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  /**
   * Task 11: on mobile/tablet the sessions list lives in a left Sheet drawer.
   * When provided, the caption's "Sessions" button opens it. Undefined on
   * desktop/wide (the inline sidebar is shown instead).
   */
  onOpenSessions?: () => void;
  /**
   * Commander Viewer P1: when true, the right-hand viewer panel (artifact
   * tabs + home) is mounted next to the chat column. Only the full-page
   * Commander route passes this — the docked w-80 panel stays viewer-free.
   */
  enableViewerPanel?: boolean;
  /**
   * When true, wraps the chat column in the Commander rounded-card chrome.
   * Only the full-page Commander route passes this — the docked InternalAgentPanel
   * and mobile sheet stay card-free.
   */
  cardChrome?: boolean;
  /**
   * Phase 6 [A1]: Controlled sessions collapse state lifted from Commander.tsx.
   * Required for the openPreview choreography to collapse the sessions sidebar
   * (which lives as a sibling component outside this panel). Only provided by
   * the full-page Commander route; undefined in docked/mobile usage.
   */
  sessionsCollapsed?: boolean;
  onSetSessionsCollapsed?: (value: boolean) => void;
}

export function AgentPanelContent({ conversationId, onSelectConversation, onOpenSessions, enableViewerPanel, cardChrome = false, sessionsCollapsed, onSetSessionsCollapsed }: AgentPanelContentProps = {}) {
  const { selectedCompanyId } = useCompany();
  const { breadcrumbs } = useBreadcrumbs();
  const providedContextScope = useCommanderContextScope();
  const location = useLocation();
  const navigate = useNavigate();
  const { closePanel, setIsStreaming, setCurrentConversationId } = useAgentPanel();
  const queryClient = useQueryClient();

  const [messages, setMessages] = useState<LocalMessage[]>([]);
  // The rich input is uncontrolled (the contenteditable DOM owns the live
  // text). We only track empty-ness here to drive the Send button + placeholder.
  const [inputEmpty, setInputEmpty] = useState(true);
  const [inputRefs, setInputRefs] = useState<CommanderInputRef[]>([]);
  const [duplicateInputRefKey, setDuplicateInputRefKey] = useState<string | null>(null);
  const [streaming, setStreamingLocal] = useState(false);
  // Task 9: skill picker. `skillPickerOpen` = opened via the `+` menu (shows
  // all skills). `slashActive`/`slashQuery` = opened via a `/token` typed in
  // the textarea. The picker is open when either source is active.
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [slashActive, setSlashActive] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [pickerIndex, setPickerIndex] = useState(0);
  // The picker computes + reports its filtered list here so handleKeyDown can
  // clamp the active index and resolve the selected skill without re-filtering.
  const filteredSkillsRef = useRef<CompanySkillListItem[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<CommanderInputHandle>(null);
  const inputBarRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Abort any in-flight SSE stream when the component unmounts (B1).
  // Uses the exported createAbortCleanup helper (testable against production code).
  useEffect(() => createAbortCleanup(abortRef), []);

  const localIdRef = useRef(0);
  const toolCallIdRef = useRef(0);
  // Track which message id had its Copy button recently clicked (for checkmark feedback)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const companyId = selectedCompanyId ?? "";

  // Load conversation history
  const { data: conversation } = useQuery({
    queryKey: queryKeys.agentConversation(companyId),
    queryFn: () => internalAgentApi.getConversation(companyId),
    enabled: !!companyId,
  });

  // Fetch greeting (summary of background activity since last visit)
  const { data: greeting } = useQuery({
    queryKey: queryKeys.agentGreeting(companyId),
    queryFn: () => internalAgentApi.getGreeting(companyId),
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const { data: runtimeSettings } = useQuery({
    queryKey: ["internal-agent-runtime-settings", companyId],
    queryFn: () => internalAgentApi.getRuntimeSettings(companyId),
    enabled: !!companyId,
    staleTime: 60 * 1000,
  });
  const allowAlwaysEnabled = runtimeSettings?.runtimeAllowAlwaysEnabled ?? true;

  // Load history when switching to a specific conversation
  const { data: historyData } = useQuery({
    queryKey: ["conversation-messages", companyId, conversationId],
    queryFn: () =>
      companyId && conversationId
        ? conversationMessagesApi.list(companyId, conversationId)
        : Promise.resolve(null),
    enabled: !!companyId && !!conversationId,
  });

  // Commander Viewer P1: per-conversation tab state + mobile flag. The viewer
  // hook is always called (hooks rules) but the panel only mounts when
  // `enableViewerPanel` is set (full-page Commander route).
  const { useDrawerSessions, isWide } = useBreakpoint();
  const viewer = useCommanderViewer(conversationId ?? null);

  // Phase 1: resizable panel geometry + collapse persistence.
  const [viewerCollapsed, setViewerCollapsed] = useCommanderViewerCollapsed();
  const [cockpitCollapsed, setCockpitCollapsed] = useCommanderCockpitCollapsed();
  // Phase 1 (panel-redesign): cockpit is now a width-div sibling — NOT in the Group.
  // panelIds only covers the center Group panels: chat + optionally viewer.
  // Key uses "-v2" suffix to avoid restoring stale 3-panel geometry from old sessions.
  const panelIds = useMemo(
    () => [
      "commander-chat",
      ...(viewerCollapsed ? [] : ["commander-detail"]),
    ],
    [viewerCollapsed],
  );
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "aoa:commander:panel-sizes-v2",
    storage: localStorage,
    panelIds,
  });

  // Phase 6: open/close preview choreography (applyPreviewFocus parity).
  //
  // Pre-open snapshot: we capture sessions + cockpit collapsed state just before
  // opening so closePreview() can restore them (not force-expand if the user had
  // them already closed). Stored in a ref so it doesn't trigger re-renders.
  const preOpenSnapshotRef = useRef<{ sessions: boolean; cockpit: boolean } | null>(null);

  // openPreview(source):
  //   "center"       — chat-header toggle: collapse BOTH sessions + cockpit
  //   "right-panel"  — chip/cockpit/reply/browser/liveRef: collapse sessions only;
  //                    also collapse cockpit when NOT ultrawide (B6: tablet tier)
  const openPreview = useCallback((source: "center" | "right-panel") => {
    // Snapshot current state before collapsing
    const currentSessionsCollapsed = sessionsCollapsed ?? true;
    preOpenSnapshotRef.current = {
      sessions: currentSessionsCollapsed,
      cockpit: cockpitCollapsed,
    };

    // Expand the viewer
    setViewerCollapsed(false);
    viewer.expand();

    // Always collapse sessions
    onSetSessionsCollapsed?.(true);

    // Collapse cockpit: always for "center"; also for "right-panel" when not ultrawide
    if (source === "center" || !isWide) {
      setCockpitCollapsed(true);
    }
  }, [sessionsCollapsed, cockpitCollapsed, setViewerCollapsed, viewer, onSetSessionsCollapsed, setCockpitCollapsed, isWide]);

  // closePreview(): collapse viewer, restore sessions + cockpit to pre-open state.
  const closePreview = useCallback(() => {
    setViewerCollapsed(true);
    viewer.collapse();

    if (preOpenSnapshotRef.current !== null) {
      const { sessions, cockpit } = preOpenSnapshotRef.current;
      onSetSessionsCollapsed?.(sessions);
      setCockpitCollapsed(cockpit);
      preOpenSnapshotRef.current = null;
    }
  }, [setViewerCollapsed, viewer, onSetSessionsCollapsed, setCockpitCollapsed]);

  // Lightweight helpers still used for cockpit expand/collapse buttons (unchanged UX).
  const expandCockpit = useCallback(() => {
    setCockpitCollapsed(false);
    if (!isWide) setViewerCollapsed(true);
  }, [setCockpitCollapsed, setViewerCollapsed, isWide]);
  const collapseCockpit = useCallback(() => setCockpitCollapsed(true), [setCockpitCollapsed]);

  // Stable ref to openPreview for use inside stale SSE closures (onLiveRef).
  // The sendText / handleSSEEvent callbacks are memoized and capture viewer + other
  // values from the render they were created in, so we must NOT capture openPreview
  // by value in those closures — use this ref instead.
  const openPreviewRef = useRef(openPreview);
  openPreviewRef.current = openPreview;

  // Conversations list — same cache key as SessionsSidebar (no extra fetch)
  const { data: conversationsData } = useQuery({
    queryKey: ["commander-conversations", companyId],
    queryFn: () => commanderConversationsApi.list(companyId),
    enabled: !!companyId,
  });

  const allConversations = conversationsData?.conversations ?? [];

  // Active conversation row (for caption title/meta)
  const activeConv = useMemo(
    () => (conversationId ? allConversations.find((c) => c.id === conversationId) : undefined),
    [allConversations, conversationId],
  );

  // Top 2 most-recent conversations (by updatedAt) for empty-state recent chats,
  // excluding the currently-active one so the list isn't redundant.
  const recentChats = useMemo(
    () =>
      [...allConversations]
        .filter((c) => c.id !== conversationId)
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
        .slice(0, 2),
    [allConversations, conversationId],
  );

  // Reset messages when switching conversations
  useEffect(() => {
    if (!conversationId) return;
    setMessages([]);
    setStreamingLocal(false);
  }, [conversationId]);

  // Populate messages from history when historyData arrives.
  // conversationId is included so the effect re-fires when switching between
  // cached conversations (TanStack Query returns the same object reference on a
  // cache hit, so [historyData] alone would not trigger a re-run).
  useEffect(() => {
    if (!historyData?.messages?.length) return;
    const loaded: LocalMessage[] = historyData.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map(serverToLocal);
    setMessages(loaded);
  }, [historyData, conversationId]);

  // Sync server messages into local state (only when not streaming AND no specific conversation is selected)
  useEffect(() => {
    if (conversationId) return;
    if (streaming) return;
    if (!conversation) return;
    if (conversation.messages) {
      setMessages((prev) => {
        return mergeServerMessagesWithTransientLocal(
          conversation.messages ?? [],
          prev,
        );
      });
    }
    if (conversation.conversation?.id) {
      setCurrentConversationId(conversation.conversation.id);
    }
  }, [conversation, streaming, setCurrentConversationId, conversationId]);

  // Auto-scroll on new messages or streaming content/action card updates
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    if (shouldAutoScroll(el.scrollHeight, el.scrollTop, el.clientHeight)) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, messages[messages.length - 1]?.content, messages[messages.length - 1]?.actionConfirm]);

  // Focus input when panel opens
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, []);

  // Escape key closes panel on desktop — UNLESS the skill picker is open, in
  // which case the picker's own Escape handler closes it instead. The native
  // document listener can't see React's stopPropagation, so we guard via a ref.
  //
  // Task 11 (Eng E2): the mobile/tablet sessions Sheet is a Radix Dialog. Its
  // own Escape handler closes the drawer, but the native document listener below
  // would otherwise ALSO fire closePanel() on the same keystroke (double-fire).
  // Guard by early-returning whenever any Radix dialog/sheet is open in the DOM
  // (data-state="open"), so the drawer's Escape only closes the drawer.
  const pickerOpenRef = useRef(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pickerOpenRef.current) return;
        // Defer to any open Radix dialog/sheet (e.g. the sessions drawer or the
        // rename/delete dialogs) — let it own the Escape and skip closePanel().
        if (document.querySelector('[data-slot="sheet-content"],[role="dialog"][data-state="open"]')) {
          return;
        }
        closePanel();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closePanel]);

  const pageContext = breadcrumbs.length > 0 ? breadcrumbs.map((b) => b.label).join(" > ") : null;
  const contextScope = useMemo(
    () => providedContextScope ?? buildCommanderContextScopeFromPath(location.pathname),
    [providedContextScope, location.pathname],
  );

  const sendText = useCallback(
    async (text: string) => {
      if (!text || !companyId || streaming) return;

      setStreamingLocal(true);
      setIsStreaming(true);

      // Add user message
      const userMsg: LocalMessage = {
        id: `local-user-${Date.now()}-${++localIdRef.current}`,
        role: "user",
        content: text,
        streamingDone: true,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Prepare assistant message placeholder
      const assistantId = `local-assistant-${Date.now()}-${++localIdRef.current}`;
      const assistantMsg: LocalMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        streamingDone: false,
        toolCalls: [],
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const stream = streamAgentChat(companyId, text, pageContext, controller.signal, conversationId, contextScope);

        for await (const event of stream) {
          handleSSEEvent(event, assistantId);
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setMessages((prev) =>
            settleRunningToolCalls(prev, assistantId).map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content || "Sorry, something went wrong. Please try again.", streamingDone: true }
                : m,
            ),
          );
        }
      } finally {
        // Mark streaming done on the assistant message (fix #1: switch to markdown)
        setMessages((prev) =>
          settleRunningToolCalls(prev, assistantId).map((m) =>
            m.id === assistantId ? { ...m, streamingDone: true } : m,
          ),
        );
        setStreamingLocal(false);
        setIsStreaming(false);
        abortRef.current = null;
        // Refresh conversation from server
        queryClient.invalidateQueries({ queryKey: queryKeys.agentConversation(companyId) });
        queryClient.invalidateQueries({ queryKey: ["commander-conversations"] });
      }
    },
    [companyId, streaming, pageContext, setIsStreaming, queryClient, conversationId, contextScope],
  );

  const submitCommanderInput = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed && inputRefs.length === 0) return;
      const baseText = trimmed || "Use the referenced context.";
      const refsForTurn = inputRefs;
      setInputRefs([]);
      await sendText(appendCommanderInputRefsToMessage(baseText, refsForTurn));
    },
    [inputRefs, sendText],
  );

  const addInputRef = useCallback((ref: CommanderInputRef, suggestedPrompt?: string) => {
    const next = buildCommanderInputRefState(inputRefs, ref);
    setInputRefs(next.refs.slice(-MAX_COMMANDER_INPUT_REFS));
    setDuplicateInputRefKey(next.duplicateKey);
    if (suggestedPrompt && next.duplicateKey === null) {
      inputRef.current?.insertText(suggestedPrompt);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [inputRefs]);

  useEffect(() => {
    if (!duplicateInputRefKey) return;
    const timer = window.setTimeout(() => setDuplicateInputRefKey(null), 1200);
    return () => window.clearTimeout(timer);
  }, [duplicateInputRefKey]);

  const removeInputRef = useCallback((ref: CommanderInputRef) => {
    const key = commanderInputRefKey(ref);
    setInputRefs((prev) => prev.filter((item) => commanderInputRefKey(item) !== key));
    setDuplicateInputRefKey((current) => (current === key ? null : current));
  }, []);

  const handleOpenInputRef = useCallback(
    (ref: CommanderInputRef) => {
      openCommanderInputRef(ref, {
        openPreview,
        openTask: viewer.openTask,
        openArtifact: (id, title) => {
          viewer.openRef({ v: 1, kind: "artifact", id, title, action: "referenced" });
        },
        openInputRef: viewer.openInputRef,
        navigate,
      });
    },
    [navigate, openPreview, viewer],
  );

  const handleSend = useCallback(async () => {
    // Read the expanded directive text (skill tokens → full use_skill lines)
    // straight from the rich input; it clears itself on submit.
    const text = inputRef.current?.getText() ?? "";
    if (!text && inputRefs.length === 0) return;
    inputRef.current?.clear();
    await submitCommanderInput(text);
  }, [inputRefs.length, submitCommanderInput]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setStreamingLocal(false);
    setIsStreaming(false);
  }, [setIsStreaming]);

  // Not wrapped in useCallback intentionally — only called from handleSend's async loop,
  // and only uses setMessages (functional updater) + toolCallIdRef (ref). No stale closure risk.
  function handleSSEEvent(event: SSEEvent, assistantId: string) {
    switch (event.event) {
      case "content":
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content + ((event.data as { text?: string }).text ?? "") }
              : m,
          ),
        );
        break;

      case "thinking":
        // Show thinking indicator — content stays empty until real content arrives
        break;

      case "reasoning": {
        const text = (event.data as { text?: string }).text ?? "";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, reasoning: (m.reasoning ?? "") + text } : m,
          ),
        );
        break;
      }

      case "error": {
        const message =
          (event.data as { message?: string }).message ??
          "Commander hit an error. Please try again.";
        setMessages((prev) =>
          settleRunningToolCalls(prev, assistantId).map((m) =>
            m.id === assistantId && !m.content
              ? { ...m, content: message, streamingDone: true }
              : m,
          ),
        );
        break;
      }

      case "tool_call": {
        const name = (event.data as { name?: string }).name ?? "unknown";
        const callId = ++toolCallIdRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, toolCalls: [...(m.toolCalls ?? []), { id: callId, name, status: "running" }] }
              : m,
          ),
        );
        break;
      }

      case "tool_result": {
        // Fix #3: Mark only the FIRST running tool call with this name as done (by id order)
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const data = event.data as { name?: string; success?: boolean; summary?: string };
            const toolName = data.name;
            let found = false;
            const updated = (m.toolCalls ?? []).map((tc) => {
              if (!found && tc.name === toolName && tc.status === "running") {
                found = true;
                return { ...tc, status: "done" as const, success: data.success ?? true, summary: data.summary };
              }
              return tc;
            });
            return { ...m, toolCalls: updated };
          }),
        );
        // Commander Viewer P1: accumulate output refs on the streaming assistant
        // message + auto-open created refs (desktop) / badge the pill (mobile).
        // NOTE: this closure can be stale (sendText is memoized and captures the
        // handleSSEEvent from the render it was created in) — that is safe ONLY
        // because useCommanderViewer's API reads its live state from a ref at
        // call time, and setMessages uses a functional updater.
        const liveRefs = (event.data as { refs?: CommanderOutputRef[] }).refs;
        if (liveRefs && liveRefs.length > 0) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, outputRefs: mergeRefs(m.outputRefs ?? [], liveRefs) }
                : m,
            ),
          );
          for (const r of liveRefs) {
            // Phase 6 [A2]: if this ref would auto-open the viewer, run the
            // choreography first (right-panel: collapses sessions only, keeps
            // cockpit on ultrawide — do NOT yank both panels mid-stream).
            // openPreviewRef is a stable ref so it's safe inside this stale closure.
            if (enableViewerPanel && shouldAutoOpen(r, useDrawerSessions)) {
              openPreviewRef.current("right-panel");
            }
            viewer.onLiveRef(r, useDrawerSessions);
          }
        }
        break;
      }

      case "action_confirm": {
        const { confirmId, action, description } = event.data as {
          confirmId: string;
          action: string;
          description: string;
        };
        setMessages((prev) =>
          settleRunningToolCalls(prev, assistantId).map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  actionConfirm: { confirmId, action, description, status: "pending" },
                }
              : m,
          ),
        );
        break;
      }

      case "options_prompt": {
        const { promptId, question, options } = event.data as {
          promptId: string;
          question: string;
          options: string[];
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, optionsPrompt: { promptId, question, options, dismissed: false } }
              : m,
          ),
        );
        break;
      }

      case "done": {
        const durationMs = (event.data as { durationMs?: number }).durationMs;
        setMessages((prev) =>
          settleRunningToolCalls(prev, assistantId).map((m) =>
            m.id === assistantId && typeof durationMs === "number" ? { ...m, durationMs } : m,
          ),
        );
        break;
      }
    }
  }

  const sendConfirmMessage = useCallback(
    async (
      messageId: string,
      confirmId: string,
      decision: ConfirmActionDecision,
    ) => {
      const isDeny = decision === "deny";
      // 1. Optimistic UI: move status to "approving" / "rejected"
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.actionConfirm
            ? {
                ...m,
                actionConfirm: {
                  ...m.actionConfirm,
                  status: isDeny ? "rejected" : "approving",
                },
              }
            : m,
        ),
      );

      try {
        const result = await confirmAction(companyId, { confirmId, decision });

        // 2. Settle UI based on server result
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId && m.actionConfirm
              ? {
                  ...m,
                  actionConfirm: {
                    ...m.actionConfirm,
                    status:
                      result.result === "executed"
                        ? "approved"
                        : result.result === "rejected" || result.result === "denied"
                          ? "rejected"
                          : "failed",
                    errorMessage: result.error ?? undefined,
                  },
                }
              : m,
          ),
        );

        // 3. Refresh conversation so any new tool-result messages appear in chat
        queryClient.invalidateQueries({ queryKey: queryKeys.agentConversation(companyId) });
        queryClient.invalidateQueries({ queryKey: ["commander-conversations"] });
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId && m.actionConfirm
              ? {
                  ...m,
                  actionConfirm: {
                    ...m.actionConfirm,
                    status: "failed",
                    errorMessage: err instanceof Error ? err.message : "Network error",
                  },
                }
              : m,
          ),
        );
      }
    },
    [companyId, queryClient],
  );

  const handleReset = useCallback(async () => {
    if (!companyId || streaming) return;
    // Abort any in-flight stream
    abortRef.current?.abort();
    try {
      await internalAgentApi.resetConversation(companyId);
      setMessages([]);
      queryClient.invalidateQueries({ queryKey: queryKeys.agentConversation(companyId) });
    } catch {
      // ignore
    }
  }, [companyId, streaming, queryClient]);

  // Newest pending confirmation id — only the most-recent pending card pulses.
  const newestPendingConfirmId = useMemo(() => {
    let result: string | null = null;
    for (const m of messages) {
      if (m.actionConfirm?.status === "pending") {
        result = m.actionConfirm.confirmId;
      }
    }
    return result;
  }, [messages]);

  // Copy message content to clipboard with a transient checkmark.
  const handleCopyMessage = useCallback((msgId: string, content: string) => {
    void navigator.clipboard.writeText(content);
    setCopiedMessageId(msgId);
    setTimeout(() => setCopiedMessageId((prev) => (prev === msgId ? null : prev)), 1500);
  }, []);

  // The picker is open if triggered by a slash token OR the `+` menu.
  const pickerOpen = slashActive || skillPickerOpen;
  const pickerQuery = slashActive ? slashQuery : "";

  // Mirror picker-open into a ref so the native document Escape listener can
  // defer to the picker without re-subscribing on every toggle.
  useEffect(() => {
    pickerOpenRef.current = pickerOpen;
  }, [pickerOpen]);

  const closePicker = useCallback(() => {
    setSlashActive(false);
    setSlashQuery("");
    setSkillPickerOpen(false);
    setPickerIndex(0);
  }, []);

  // CommanderInput reports its empty/non-empty state so we can disable Send.
  const handleEmptyChange = useCallback((empty: boolean) => {
    setInputEmpty(empty);
  }, []);

  // CommanderInput reports the slash-command context at the caret. A `/` token
  // drives the slash-triggered picker; a `+`-menu-triggered picker is left
  // untouched (it isn't slash-driven).
  const handleSlashChange = useCallback((slash: SlashState) => {
    if (slash.active) {
      setSlashActive(true);
      setSlashQuery(slash.query);
    } else {
      setSlashActive(false);
      setSlashQuery("");
    }
    setPickerIndex(0);
  }, []);

  // Stable callback so SkillPicker's effect dep array doesn't re-fire every
  // parent render (an inline arrow would recreate on every render).
  const handleFilteredSkillsChange = useCallback(
    (skills: CompanySkillListItem[]) => {
      filteredSkillsRef.current = skills;
    },
    [],
  );

  const handleSelectSkill = useCallback(
    (skill: CompanySkillListItem) => {
      // The rich input inserts a colored atomic token (just the skill name);
      // it expands to the full use_skill directive on send. `slashActive`
      // tells it whether to replace a typed `/query` or insert inline.
      inputRef.current?.insertSkill(skill, slashActive);
      closePicker();
    },
    [slashActive, closePicker],
  );

  // Parent gets first crack at keydown (CommanderInput calls this before its
  // own Enter/Backspace handling). When the picker is open, picker nav wins and
  // we preventDefault so CommanderInput skips submit. When the picker is closed,
  // we do nothing here and let CommanderInput own Enter-to-send.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!pickerOpen) return;
    const list = filteredSkillsRef.current;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (list.length > 0) setPickerIndex((i) => Math.min(i + 1, list.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (list.length > 0) setPickerIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const skill = list[pickerIndex];
      if (skill) handleSelectSkill(skill);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closePicker();
    }
  };

  // Commander Viewer P1: deduped refs across the loaded conversation (feeds the
  // viewer's home tab). Cheap O(messages) — no memo needed.
  const conversationRefs = collectConversationRefs(messages);

  // The chat column is extracted into a const (instead of re-indenting the
  // ~400-line tree inside a new row wrapper) so the viewer-panel row below
  // stays a small, reviewable diff. Classes: original `flex flex-col h-full`
  // + `min-w-0 flex-1` so the column shrinks correctly next to the viewer.
  const chatColumn = (
    <div
      className={cn(
        "flex h-full min-w-0 flex-1 flex-col",
        cardChrome && `${COMMANDER_PANEL_CARD} overflow-hidden`,
      )}
    >
      {/* Chat pane caption strip. In full-page Commander (enableViewerPanel) it always
          renders so the "Open preview" toggle is reachable even before a session is
          selected (the default conversation shows messages with conversationId still
          null). In docked mode it shows only with an active conversation and never the
          toggle (no viewer there). */}
      {(conversationId || enableViewerPanel) && (
        <ChatPaneCaption
          title={activeConv?.title ?? "New chat"}
          messageCount={activeConv?.messageCount ?? messages.length}
          updatedAt={activeConv?.updatedAt}
          onOpenSessions={onOpenSessions}
          viewerOpen={!viewerCollapsed}
          onToggleViewer={
            enableViewerPanel
              ? (viewerCollapsed ? () => openPreview("center") : closePreview)
              : undefined
          }
        />
      )}

      {/* Mobile/tablet Sessions trigger — shown only when there is NO active
          conversation (the caption's Sessions button covers the active case).
          `lg:hidden` keeps the desktop layout completely unchanged. */}
      {!conversationId && !enableViewerPanel && onOpenSessions && (
        <div className="lg:hidden shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-background">
          <button
            type="button"
            data-commander-touch
            onClick={() => onOpenSessions()}
            aria-label="Open sessions"
            title="Sessions"
            className="p-1 rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
          <span className="text-xs text-muted-foreground select-none">Chats</span>
        </div>
      )}

      <MemoryContextStrip
        strictness="balanced"
        layers={["identity", "domain", "active_context", "working"]}
        surface={contextScope.surface ?? "commander"}
        hasWorkingContext={Boolean(contextScope.taskId || contextScope.goalId || contextScope.projectId || conversationId)}
      />

      {/* Mobile close button (absolute overlay, not in flow) */}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={closePanel}
        aria-label="Close Commander"
        className="md:hidden absolute top-2 right-2 z-10"
      >
        <X className="h-4 w-4" />
      </Button>

      {/* Messages (fix #11: aria-live for streaming accessibility) */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-3 py-3 min-h-0"
        aria-live="polite"
        aria-relevant="additions"
      >
        {/* Task 11: on wide (>= 1536px / Tailwind 2xl) cap the message column at
            880px centered. Below 2xl this wrapper is a no-op width-wise, so
            desktop width is unchanged. `h-full` preserves the empty-state's
            full-height vertical centering (it used to reference the scroll
            container directly). */}
        <div className="h-full space-y-3 2xl:max-w-[880px] 2xl:mx-auto">
        {messages.length === 0 && (
          <CommanderEmptyState
            greetingText={
              greeting
                ? (greeting.findingCount > 0 ? "Here's what happened" : greeting.greeting)
                : undefined
            }
            onPromptClick={sendText}
            recentChats={recentChats}
            onSelectChat={(id) => onSelectConversation?.(id)}
          />
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "group relative max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                msg.role === "user"
                  ? "bg-card text-card-foreground shadow-sm"
                  : "bg-muted",
              )}
            >
              {/* Hover Copy button — revealed on group-hover, top-right corner */}
              {msg.content && (
                <button
                  type="button"
                  data-commander-touch
                  aria-label="Copy message"
                  title="Copy"
                  onClick={() => handleCopyMessage(msg.id, msg.content)}
                  className={cn(
                    "absolute top-1 right-1 flex items-center justify-center rounded p-0.5",
                    "opacity-0 group-hover:opacity-100 transition-opacity",
                    "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {copiedMessageId === msg.id
                    ? <Check className="h-3.5 w-3.5" />
                    : <Copy className="h-3.5 w-3.5" />}
                </button>
              )}

              {/* Hover "open reply in viewer" pop-out — assistant bubbles only,
                  sits just left of the Copy button with identical hover reveal */}
              {msg.role === "assistant" && msg.content && (
                <button
                  type="button"
                  data-commander-touch
                  aria-label="Open reply in viewer"
                  title="Open reply in viewer"
                  onClick={() => { openPreview("right-panel"); viewer.openReply(msg.id, msg.content); }}
                  className={cn(
                    "absolute top-1 right-6 flex items-center justify-center rounded p-0.5",
                    "opacity-0 group-hover:opacity-100 transition-opacity",
                    "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              )}

              <span
                className={cn(
                  "pointer-events-none absolute bottom-1 right-2 text-[10px] text-muted-foreground",
                  "opacity-0 group-hover:opacity-100 transition-opacity",
                )}
              >
                {relativeTime(msg.createdAt)}
              </span>

              {/* Inline reasoning (collapsible Thinking block) */}
              {msg.role === "assistant" && msg.reasoning && (
                <CommanderReasoningBlock
                  text={msg.reasoning}
                  streaming={streaming && !msg.streamingDone}
                  defaultCollapsed={msg.streamingDone}
                />
              )}

              {/* Tool activity — inline, expandable, with status glyph */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="space-y-1 mb-2">
                  {msg.toolCalls.map((tc) => (
                    <div key={tc.id} className="text-xs">
                      <button
                        type="button"
                        data-testid={`commander-tool-activity-${tc.id}`}
                        disabled={!tc.summary}
                        aria-expanded={!!tc.open}
                        aria-controls={`tool-summary-${msg.id}-${tc.id}`}
                        onClick={() =>
                          setMessages((prev) =>
                            prev.map((m) =>
                              m.id === msg.id
                                ? { ...m, toolCalls: (m.toolCalls ?? []).map((t) => (t.id === tc.id ? { ...t, open: !t.open } : t)) }
                                : m,
                            ),
                          )
                        }
                        className="flex w-full items-center gap-1.5 text-left text-muted-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
                      >
                        {tc.status === "running" ? (
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                        ) : tc.success === false ? (
                          <AlertCircle className="h-3 w-3 shrink-0 text-red-500" />
                        ) : (
                          <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                        )}
                        <span className="truncate">
                          {tc.status === "running" ? toolLabel(tc.name) : completedToolLabel(tc.name)}
                        </span>
                        {tc.summary && (
                          <ChevronRight className={cn("h-3 w-3 shrink-0 transition-transform", tc.open && "rotate-90")} />
                        )}
                      </button>
                      {tc.open && tc.summary && (
                        <pre
                          id={`tool-summary-${msg.id}-${tc.id}`}
                          data-testid="commander-tool-summary"
                          className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 text-[11px] text-muted-foreground"
                        >
                          {tc.summary}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Message content (fix #1: plain text while streaming, markdown when done) */}
              {msg.content ? (
                msg.role === "user" ? (
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                ) : msg.streamingDone ? (
                  <MarkdownBody
                    className="prose-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_pre]:my-1 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs"
                    onLinkOpen={enableViewerPanel ? (url: string) => { openPreview("right-panel"); viewer.openBrowser(url); } : undefined}
                  >
                    {msg.content}
                  </MarkdownBody>
                ) : (
                  <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                )
              ) : msg.role === "assistant" && streaming && !msg.reasoning ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Thinking...
                </span>
              ) : null}

              {/* Commander Viewer P1: artifact handles under the reply text */}
              {msg.role === "assistant" && msg.outputRefs && msg.outputRefs.length > 0 && (
                <OutputRefChips
                  refs={msg.outputRefs}
                  onOpen={(ref) => { openPreview("right-panel"); viewer.openRef(ref); }}
                />
              )}

              {/* Live-only: durationMs comes from the done SSE event, not persisted
                  (it's on internal_agent_runs). Absent after reload by design. */}
              {msg.role === "assistant" && msg.streamingDone && typeof msg.durationMs === "number" && msg.durationMs > 0 && (
                <p data-testid="commander-worked-for" className="mt-1 text-[10px] text-muted-foreground">
                  Worked for {(msg.durationMs / 1000).toFixed(1)}s
                </p>
              )}

              {/* Action confirmation */}
              {msg.actionConfirm && (
                <div
                  className={cn(
                    "mt-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-2",
                    msg.actionConfirm.status === "pending" &&
                      msg.actionConfirm.confirmId === newestPendingConfirmId &&
                      "commander-pulse-border",
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-100">
                    <Zap className="h-3.5 w-3.5 shrink-0" />
                    <span>Action requires approval: <code className="font-mono">{msg.actionConfirm.action}</code></span>
                  </div>
                  {/* Entity line — derived from action, truncated to 80 chars */}
                  <p className="text-xs text-amber-800/70 dark:text-amber-200/70">
                    {(() => {
                      const line = deriveConfirmEntityLine(msg.actionConfirm.action);
                      const [prefix, ...rest] = line.split(" ");
                      const second = rest[0];
                      const third = rest[1];
                      const entity = rest.slice(2).join(" ");
                      return (
                        <>
                          {prefix} {second} {third}{entity ? " " : ""}
                          {entity && <strong className="font-medium">{entity}</strong>}
                        </>
                      );
                    })()}
                  </p>
                  {msg.actionConfirm.description !== msg.actionConfirm.action && (
                    <p className="text-xs text-muted-foreground">{msg.actionConfirm.description}</p>
                  )}
                  {msg.actionConfirm.status === "pending" ? (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        onClick={() => sendConfirmMessage(msg.id, msg.actionConfirm!.confirmId, "allow_once")}
                      >
                        <Check className="h-3 w-3 mr-1" />
                        Allow once
                      </Button>
                      {allowAlwaysEnabled && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => sendConfirmMessage(msg.id, msg.actionConfirm!.confirmId, "allow_always")}
                        >
                          <Check className="h-3 w-3 mr-1" />
                          Always allow
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => sendConfirmMessage(msg.id, msg.actionConfirm!.confirmId, "deny")}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Deny
                      </Button>
                    </div>
                  ) : msg.actionConfirm.status === "approving" ? (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-800 dark:text-amber-200">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Executing…
                    </span>
                  ) : msg.actionConfirm.status === "failed" ? (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-red-600 dark:text-red-400">Failed</span>
                      {msg.actionConfirm.errorMessage && (
                        <p className="text-xs text-muted-foreground">{msg.actionConfirm.errorMessage}</p>
                      )}
                    </div>
                  ) : (
                    <span
                      className={cn(
                        "text-xs font-medium",
                        msg.actionConfirm.status === "approved"
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400",
                      )}
                    >
                      {msg.actionConfirm.status === "approved" ? "Confirmed" : "Rejected"}
                    </span>
                  )}
                </div>
              )}

              {/* Options prompt */}
              {msg.optionsPrompt && !msg.optionsPrompt.dismissed && (
                <div className="mt-2 rounded-lg border border-border bg-background p-3 space-y-2 shadow-sm">
                  <p className="text-xs text-muted-foreground">
                    Commander is asking — pick one or type your answer below:
                  </p>
                  <p className="text-xs font-medium text-foreground">{msg.optionsPrompt.question}</p>
                  <div className="flex flex-wrap gap-2">
                    {msg.optionsPrompt.options.map((opt, i) => (
                      <button
                        key={`${msg.id}-opt-${i}-${opt}`}
                        type="button"
                        onClick={() => {
                          // Dismiss the panel
                          setMessages((prev) =>
                            prev.map((m) =>
                              m.id === msg.id && m.optionsPrompt
                                ? { ...m, optionsPrompt: { ...m.optionsPrompt, dismissed: true } }
                                : m,
                            ),
                          );
                          // Send the selected option as a user message
                          void sendText(opt);
                        }}
                        className={cn(
                          "px-3 py-1.5 rounded-full border text-xs transition-colors",
                          i === 0
                            ? "border-primary bg-primary/5 text-primary hover:bg-primary/10 font-medium"
                            : "border-border hover:bg-muted",
                        )}
                      >
                        {opt}
                        {i === 0 && <span className="ml-1 opacity-60">(recommended)</span>}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Clicking a chip sends it as your reply and dismisses this panel.
                  </p>
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input bar */}
      <div ref={inputBarRef} className="shrink-0 border-t border-border p-3 relative">
        {/* Task 9: skill picker — anchored above the input card */}
        <SkillPicker
          open={pickerOpen}
          query={pickerQuery}
          activeIndex={pickerIndex}
          onActiveIndexChange={setPickerIndex}
          onSelect={handleSelectSkill}
          onFilteredChange={handleFilteredSkillsChange}
          onClose={closePicker}
        />
        <div className="rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-brand-focus-ring focus-within:border-brand transition-shadow">
          {inputRefs.length > 0 && (
            <div
              className="flex flex-wrap gap-1.5 border-b border-border/70 px-2 py-2"
              data-testid="commander-input-refs"
            >
              {inputRefs.map((ref) => (
                <span
                  key={commanderInputRefKey(ref)}
                  className={cn(
                    "inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/60 px-2 py-1 text-[11px] text-foreground transition-colors",
                    duplicateInputRefKey === commanderInputRefKey(ref)
                      ? "border-brand bg-brand/10"
                      : "border-border",
                  )}
                >
                  <button
                    type="button"
                    aria-label={`Open ${ref.label} reference`}
                    title="Open reference"
                    className="inline-flex min-w-0 max-w-[220px] items-center gap-1 rounded text-left hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus-ring"
                    onClick={() => handleOpenInputRef(ref)}
                  >
                    <span className="shrink-0 font-medium text-muted-foreground">
                      {commanderInputRefKindLabel(ref.kind)}
                    </span>
                    <span className="min-w-0 truncate">{ref.label}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${ref.label} reference`}
                    title="Remove reference"
                    className="ml-0.5 rounded text-muted-foreground hover:text-foreground"
                    onClick={() => removeInputRef(ref)}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}
          {/* Rich input — renders skill selections as colored atomic tokens */}
          <CommanderInput
            ref={inputRef}
            placeholder="Ask the agent..."
            disabled={streaming}
            onSubmit={(text) => void submitCommanderInput(text)}
            onReferenceDrop={({ ref, prompt }) => addInputRef(ref, prompt)}
            onEmptyChange={handleEmptyChange}
            onSlashChange={handleSlashChange}
            onKeyDown={handleKeyDown}
            onBlur={(e) => {
              // Only close when focus leaves the whole input bar. Radix restores
              // focus to the `+` trigger after "Use a skill"; that target is inside
              // inputBarRef, so we must NOT close in that case. Skill-row clicks use
              // onMouseDown+preventDefault and never blur the input.
              const next = e.relatedTarget as Node | null;
              if (pickerOpen && !inputBarRef.current?.contains(next)) {
                closePicker();
              }
            }}
          />
          {/* Controls row */}
          <div className="flex items-center gap-1.5 px-2 pb-2">
            {/* + add menu (functional) */}
            <InputAddMenu
              onUseSkill={() => {
                setPickerIndex(0);
                setSkillPickerOpen(true);
                // Focus the textarea so ↑/↓/Enter drive the picker. Defer past
                // the dropdown's own focus-restore on close.
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              disabled={streaming}
            />

            {/* @mention (disabled, coming soon) */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="size-8 rounded-full flex items-center justify-center shrink-0 text-muted-foreground opacity-40 cursor-not-allowed"
                  >
                    <AtSign className="size-4" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Coming soon</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Voice (disabled, coming soon) */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="size-8 rounded-full flex items-center justify-center shrink-0 text-muted-foreground opacity-40 cursor-not-allowed"
                  >
                    <Mic className="size-4" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Coming soon</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Send / Stop */}
            {streaming ? (
              <button
                type="button"
                onClick={handleStop}
                aria-label="Stop generation"
                className="size-8 rounded-full flex items-center justify-center shrink-0 bg-[color:var(--error,#ef4444)] text-white hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-focus-ring"
              >
                <Square className="size-3.5 fill-current" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSend}
                disabled={inputEmpty && inputRefs.length === 0}
                aria-label="Send message"
                className="size-8 rounded-full flex items-center justify-center shrink-0 bg-brand text-white hover:bg-brand-hover transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-brand-focus-ring disabled:opacity-40 disabled:pointer-events-none"
              >
                <Send className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // No viewer panel (docked usage) — unchanged single column.
  if (!enableViewerPanel || !companyId) {
    return <div className="flex h-full min-h-0 flex-row overflow-hidden">{chatColumn}</div>;
  }

  // Mobile — unchanged: chat + floating pill/Sheet (no Group).
  if (useDrawerSessions) {
    return (
      <div className="flex h-full min-h-0 flex-row overflow-hidden">
        {chatColumn}
        <CommanderViewerPanel companyId={companyId} viewer={viewer} conversationRefs={conversationRefs} isMobile />
      </div>
    );
  }

  // Desktop — Phase 1 (panel-redesign): Group holds Chat+Viewer only.
  // Cockpit is a width-toggled <div> sibling to the right of the Group,
  // mirroring WorkspaceLayout.tsx:525-559. Expanded=300px, collapsed=48px rail.
  const tabModels = buildViewerTabModels(viewer.state);
  const activeTab = viewer.state.tabs.find((t) => t.id === viewer.state.activeId);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden gap-2">
      {/* Center group: Chat + optional Viewer only (cockpit is now a width-div sibling).
          The Group has no border/overflow-hidden — each inner panel provides its
          own COMMANDER_PANEL_CARD chrome. The Separator (w-2 transparent) acts as
          the 8px gap between the chat card and the viewer card. */}
      <Group
        orientation="horizontal"
        className="flex h-full min-w-0 flex-1"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
        data-testid="commander-center-group"
      >
        <Panel id="commander-chat" minSize="40%" className="flex h-full min-w-0 flex-col">
          {chatColumn}
        </Panel>
        {!viewerCollapsed && (
          <>
            {/* Separator renders its own `data-separator` + role="separator"
                attributes (a passed data-testid is ignored); tests target
                `[data-separator]`. */}
            <Separator
              id="commander-sep"
              className="w-2 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-brand/50 active:bg-brand/60"
            />
            <Panel
              id="commander-detail"
              defaultSize="40%"
              minSize="24%"
              maxSize="60%"
              className="flex h-full min-w-0"
            >
              <CommanderViewerDetail
                viewer={viewer}
                companyId={companyId}
                conversationRefs={conversationRefs}
                activeTab={activeTab}
                tabModels={tabModels}
                onCollapse={closePreview}
              />
            </Panel>
          </>
        )}
      </Group>
      {/* Right cockpit — width-toggled div mirroring WorkspaceLayout right panel.
          Expanded: w-[300px] showing the full CommanderCockpitPanel.
          Collapsed: w-[48px] showing the CommanderCockpitRail.
          COMMANDER_PANEL_CARD here (rounded-xl + border + shadow-sm + overflow-hidden)
          mirrors WorkspaceLayout's right panel card pattern exactly. The inner
          CommanderCockpitPanel/Rail provide their own structural chrome (header, etc.)
          but the card border/radius lives here on the container. */}
      <div
        className={cn(
          "shrink-0 h-full overflow-hidden transition-[width] duration-200",
          COMMANDER_PANEL_CARD,
          cockpitCollapsed ? "w-[48px]" : "w-[300px]",
        )}
        data-testid="commander-cockpit-container"
        data-collapsed={cockpitCollapsed ? "true" : "false"}
      >
        <CommanderCockpitPanel
          companyId={companyId}
          conversationId={conversationId}
          collapsed={cockpitCollapsed}
          onExpand={expandCockpit}
          onCollapse={collapseCockpit}
          onOpenTask={(issueId, title) => { openPreview("right-panel"); viewer.openTask(issueId, title); }}
          onAsk={(text) => void sendText(text)}
          onReference={addInputRef}
          onOpenInputRef={handleOpenInputRef}
          onOpenFullPage={(href) => navigate(href)}
          onOpenArtifact={(id, title) => {
            openPreview("right-panel");
            viewer.openRef({ v: 1, kind: "artifact", id, title, action: "referenced" });
          }}
          conversationRefs={conversationRefs}
          onOpenRef={(ref) => { openPreview("right-panel"); viewer.openRef(ref); }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Exported panel — desktop inline + mobile sheet (DA-23)             */
/* ------------------------------------------------------------------ */

export function InternalAgentPanel() {
  const { isOpen, closePanel } = useAgentPanel();
  const { isMobile } = useSidebar();

  // Mobile: full-screen sheet overlay (DA-23 mutual exclusion)
  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && closePanel()}>
        <SheetContent side="right" showCloseButton={false} className="w-full sm:max-w-full p-0">
          <SheetTitle className="sr-only">Commander</SheetTitle>
          <AgentPanelContent />
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: inline right panel
  if (!isOpen) return null;

  return (
    <div className="shrink-0 w-80 border-l border-border h-full overflow-hidden bg-background">
      <AgentPanelContent />
    </div>
  );
}
