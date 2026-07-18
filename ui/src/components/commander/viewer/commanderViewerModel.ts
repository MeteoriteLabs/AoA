// Pure state logic for the Commander viewer panel.
// No React imports — unit-tested directly (pattern: commanderInputModel.ts).
import { toSafeBrowserUrl } from "@armyofagents/shared";
import type { CommanderInputRef, CommanderOutputRef, ShowRef } from "@armyofagents/shared";

export interface ViewerTab {
  /** Stable tab identity: `artifact:<id>:<versionId|latest>` | `reply:<messageId>` | `browser:<url>` | `task:<issueId>` */
  id: string;
  kind: "artifact" | "reply" | "browser" | "task" | "discussion" | "approval" | "inbox" | "note";
  title: string;
  /** artifact id, message id for replies, url for browser tabs, or issue id for task tabs */
  refId: string;
  versionId?: string | null;
  /** reply tabs only — markdown body */
  replyContent?: string;
  /** browser tabs only — the url loaded in the sandboxed iframe */
  url?: string;
  inputRef?: CommanderInputRef;
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

export function chipLabel(ref: ShowRef): string {
  return ref.title ?? `${ref.kind} ${ref.id.slice(0, 8)}`;
}

function artifactTabId(ref: ShowRef): string {
  return `artifact:${ref.id}:${ref.versionId ?? "latest"}`;
}

export function openRefTab(
  state: ConversationViewerState,
  ref: ShowRef,
): ConversationViewerState {
  switch (ref.kind) {
    case "artifact": {
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
    case "task":
      return openTaskTab(state, ref.id, chipLabel(ref));
    case "discussion":
    case "approval": {
      const id = `${ref.kind}:${ref.id}`;
      if (state.tabs.some((t) => t.id === id)) return { ...state, activeId: id, expanded: true };
      const tab: ViewerTab = { id, kind: ref.kind, title: chipLabel(ref), refId: ref.id };
      return { tabs: [...state.tabs, tab], activeId: id, expanded: true };
    }
    case "url":
      return openBrowserTab(state, ref.id); // openBrowserTab already scheme-gates via toSafeBrowserUrl
    default:
      // asset | output | memory_item — no Commander tab body yet (Phase 3). Never mis-render as artifact.
      return state;
  }
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

export function openInputRefTab(
  state: ConversationViewerState,
  ref: CommanderInputRef,
): ConversationViewerState {
  if (ref.kind === "task") {
    return openTaskTab(state, ref.id, ref.label);
  }
  if (ref.kind === "artifact") {
    return openRefTab(state, {
      v: 1,
      kind: "artifact",
      id: ref.id,
      title: ref.label,
      action: "referenced",
    } as CommanderOutputRef);
  }
  if (
    ref.kind !== "discussion" &&
    ref.kind !== "approval" &&
    ref.kind !== "inbox" &&
    ref.kind !== "note"
  ) {
    return state;
  }

  const id = `${ref.kind}:${ref.id}`;
  if (state.tabs.some((t) => t.id === id)) return { ...state, activeId: id, expanded: true };
  const tab: ViewerTab = {
    id,
    kind: ref.kind,
    title: ref.label,
    refId: ref.id,
    inputRef: ref,
  };
  return { tabs: [...state.tabs, tab], activeId: id, expanded: true };
}

export function openBrowserTab(
  state: ConversationViewerState,
  rawUrl: string,
): ConversationViewerState {
  // Scheme-gate before the url ever reaches a tab model / iframe src.
  // BrowserViewer also gates at render — this is defense-in-depth.
  const url = toSafeBrowserUrl(rawUrl) || "about:blank";
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
export function shouldAutoOpen(ref: ShowRef, isMobile: boolean): boolean {
  return ref.action === "created" && !isMobile;
}

const refKey = (r: ShowRef) => `${r.v}|${r.kind}|${r.id}|${r.versionId ?? ""}`;

/**
 * Merge two lists of refs, deduplicating by `kind|id|versionId`.
 * "created" wins over "referenced" for the same key; the existing entry wins
 * on all other ties (preserving ordering stability).
 */
export function mergeRefs(
  existing: ShowRef[],
  incoming: ShowRef[],
): ShowRef[] {
  const map = new Map<string, ShowRef>();
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
  messages: ReadonlyArray<{ outputRefs?: ShowRef[] | null }>,
): ShowRef[] {
  return mergeRefs(
    [],
    messages.flatMap((m) => m.outputRefs ?? []),
  );
}
