import { useCallback, useRef, useState } from "react";
import type { CommanderOutputRef } from "@armyofagents/shared";
import {
  closeTab,
  emptyViewerState,
  openRefTab,
  openReplyTab,
  setActive,
  setExpanded,
  shouldAutoOpen,
  type ConversationViewerState,
} from "./commanderViewerModel";

export interface CommanderViewerApi {
  state: ConversationViewerState;
  openRef: (ref: CommanderOutputRef) => void;
  openReply: (messageId: string, content: string) => void;
  onLiveRef: (ref: CommanderOutputRef, isMobile: boolean) => void;
  activate: (tabId: string) => void;
  close: (tabId: string) => void;
  expand: () => void;
  collapse: () => void;
  /** count of created refs that landed while collapsed (mobile pill badge) */
  pendingBadge: number;
  clearBadge: () => void;
}

export function useCommanderViewer(conversationId: string | null): CommanderViewerApi {
  // Page-lifetime memory: per-conversation states survive switching chats,
  // die on hard reload (no storage by design — §2 #4).
  const statesRef = useRef(new Map<string, ConversationViewerState>());
  const key = conversationId ?? "__none__";
  const [, force] = useState(0);
  const [pendingBadge, setPendingBadge] = useState(0);

  const state = statesRef.current.get(key) ?? emptyViewerState();

  const update = useCallback(
    (next: ConversationViewerState) => {
      statesRef.current.set(key, next);
      force((n) => n + 1);
    },
    [key],
  );

  return {
    state,
    openRef: (ref) => update(openRefTab(state, ref)),
    openReply: (messageId, content) => update(openReplyTab(state, messageId, content)),
    onLiveRef: (ref, isMobile) => {
      if (shouldAutoOpen(ref, isMobile)) {
        update(openRefTab(state, ref));
      } else if (ref.action === "created") {
        // Mobile: add the tab silently, badge the pill (§2 #6).
        update({ ...openRefTab(state, ref), expanded: state.expanded, activeId: state.activeId });
        setPendingBadge((n) => n + 1);
      }
    },
    activate: (tabId) => update(setActive(state, tabId)),
    close: (tabId) => update(closeTab(state, tabId)),
    expand: () => update(setExpanded(state, true)),
    collapse: () => update(setExpanded(state, false)),
    pendingBadge,
    clearBadge: () => setPendingBadge(0),
  };
}
