// Pure state logic for the Commander viewer panel.
// No React imports — unit-tested directly (pattern: commanderInputModel.ts).
import type { CommanderOutputRef } from "@armyofagents/shared";

export interface ViewerTab {
  /** Stable tab identity: `artifact:<id>:<versionId|latest>` | `reply:<messageId>` | `browser:<url>` | `task:<issueId>` */
  id: string;
  kind: "artifact" | "reply" | "browser" | "task";
  title: string;
  /** artifact id, message id for replies, url for browser tabs, or issue id for task tabs */
  refId: string;
  versionId?: string | null;
  /** reply tabs only — markdown body */
  replyContent?: string;
  /** browser tabs only — the url loaded in the sandboxed iframe */
  url?: string;
}

export interface ConversationViewerState {
  tabs: ViewerTab[];
  /** active tab id, or the literal "home" */
  activeId: string;
  expanded: boolean;
}

export function emptyViewerState(): ConversationViewerState {
  return { tabs: [], activeId: "home", expanded: false };
}

export function chipLabel(ref: CommanderOutputRef): string {
  return ref.title ?? `${ref.kind} ${ref.id.slice(0, 8)}`;
}

function artifactTabId(ref: CommanderOutputRef): string {
  return `artifact:${ref.id}:${ref.versionId ?? "latest"}`;
}

export function openRefTab(
  state: ConversationViewerState,
  ref: CommanderOutputRef,
): ConversationViewerState {
  const id = artifactTabId(ref);
  const existing = state.tabs.find((t) => t.id === id);
  if (existing) return { ...state, activeId: id, expanded: true };
  const tab: ViewerTab = {
    id,
    kind: "artifact",
    title: chipLabel(ref),
    refId: ref.id,
    versionId: ref.versionId ?? null,
  };
  return { tabs: [...state.tabs, tab], activeId: id, expanded: true };
}

export function openReplyTab(
  state: ConversationViewerState,
  messageId: string,
  content: string,
): ConversationViewerState {
  const id = `reply:${messageId}`;
  if (state.tabs.some((t) => t.id === id)) return { ...state, activeId: id, expanded: true };
  const tab: ViewerTab = { id, kind: "reply", title: "Commander reply", refId: messageId, replyContent: content };
  return { tabs: [...state.tabs, tab], activeId: id, expanded: true };
}

export function openTaskTab(
  state: ConversationViewerState,
  issueId: string,
  title: string,
): ConversationViewerState {
  const id = `task:${issueId}`;
  if (state.tabs.some((t) => t.id === id)) return { ...state, activeId: id, expanded: true };
  const tab: ViewerTab = { id, kind: "task", title, refId: issueId };
  return { tabs: [...state.tabs, tab], activeId: id, expanded: true };
}

export function openBrowserTab(
  state: ConversationViewerState,
  url: string,
): ConversationViewerState {
  const id = `browser:${url}`;
  if (state.tabs.some((t) => t.id === id)) return { ...state, activeId: id, expanded: true };
  let title = url;
  try {
    title = new URL(url).hostname || url;
  } catch {
    // Unparseable url — keep the raw string as the title.
  }
  const tab: ViewerTab = { id, kind: "browser", title, refId: url, url };
  return { tabs: [...state.tabs, tab], activeId: id, expanded: true };
}

export function closeTab(state: ConversationViewerState, tabId: string): ConversationViewerState {
  const idx = state.tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) return state;
  const tabs = state.tabs.filter((t) => t.id !== tabId);
  let activeId = state.activeId;
  if (activeId === tabId) {
    const neighbor = tabs[idx] ?? tabs[idx - 1];
    activeId = neighbor ? neighbor.id : "home";
  }
  return { ...state, tabs, activeId };
}

export function setActive(state: ConversationViewerState, tabId: string): ConversationViewerState {
  return { ...state, activeId: tabId, expanded: true };
}

export function setExpanded(state: ConversationViewerState, expanded: boolean): ConversationViewerState {
  return { ...state, expanded };
}

/** Auto-open rule (design §2 #2 + #6): created refs, desktop only. */
export function shouldAutoOpen(ref: CommanderOutputRef, isMobile: boolean): boolean {
  return ref.action === "created" && !isMobile;
}

const refKey = (r: CommanderOutputRef) => `${r.kind}|${r.id}|${r.versionId ?? ""}`;

/**
 * Merge two lists of refs, deduplicating by `kind|id|versionId`.
 * "created" wins over "referenced" for the same key; the existing entry wins
 * on all other ties (preserving ordering stability).
 */
export function mergeRefs(
  existing: CommanderOutputRef[],
  incoming: CommanderOutputRef[],
): CommanderOutputRef[] {
  const map = new Map<string, CommanderOutputRef>();
  for (const r of existing) map.set(refKey(r), r);
  for (const r of incoming) {
    const k = refKey(r);
    const prev = map.get(k);
    if (!prev || (prev.action === "referenced" && r.action === "created")) map.set(k, r);
  }
  return [...map.values()];
}

/** Home-tab "Recent from this conversation": dedupe across loaded messages, created wins. */
export function collectConversationRefs(
  messages: ReadonlyArray<{ outputRefs?: CommanderOutputRef[] | null }>,
): CommanderOutputRef[] {
  return mergeRefs(
    [],
    messages.flatMap((m) => m.outputRefs ?? []),
  );
}
