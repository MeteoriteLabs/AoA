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

  // All API functions read the CURRENT state from statesRef at call time
  // instead of closing over the render-time `state` snapshot. This matters for
  // the live-ref path: SSE events are dispatched from inside a memoized
  // sendText closure (InternalAgentPanel), so the `viewer` object it captured
  // may be several renders old. A render-time snapshot there would compute the
  // next state from a stale base and silently drop tabs opened since (e.g. two
  // created refs in one stream, or chips clicked between sends). For fresh
  // closures this is identical to the snapshot read — every update() forces a
  // re-render.
  const readState = useCallback(
    () => statesRef.current.get(key) ?? emptyViewerState(),
    [key],
  );

  const update = useCallback(
    (next: ConversationViewerState) => {
      statesRef.current.set(key, next);
      force((n) => n + 1);
    },
    [key],
  );

  return {
    state,
    openRef: (ref) => update(openRefTab(readState(), ref)),
    openReply: (messageId, content) => update(openReplyTab(readState(), messageId, content)),
    onLiveRef: (ref, isMobile) => {
      const current = readState();
      if (shouldAutoOpen(ref, isMobile)) {
        update(openRefTab(current, ref));
      } else if (ref.action === "created") {
        // Mobile: add the tab silently, badge the pill (§2 #6).
        update({
          ...openRefTab(current, ref),
          expanded: current.expanded,
          activeId: current.activeId,
        });
        setPendingBadge((n) => n + 1);
      }
    },
    activate: (tabId) => update(setActive(readState(), tabId)),
    close: (tabId) => update(closeTab(readState(), tabId)),
    expand: () => update(setExpanded(readState(), true)),
    collapse: () => update(setExpanded(readState(), false)),
    pendingBadge,
    clearBadge: () => setPendingBadge(0),
  };
}
