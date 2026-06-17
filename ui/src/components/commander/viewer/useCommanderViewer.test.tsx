import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { CommanderOutputRef } from "@armyofagents/shared";
import { useCommanderViewer } from "./useCommanderViewer";

const ref = (id: string): CommanderOutputRef => ({
  v: 1,
  kind: "artifact",
  id,
  action: "created",
});

describe("useCommanderViewer — stale-closure safety", () => {
  // The SSE stream calls viewer.onLiveRef from inside a memoized sendText
  // closure (InternalAgentPanel), so the api object it holds can be renders
  // old. The hook must read live state at call time — successive calls on the
  // SAME captured api object must accumulate tabs, not clobber each other.
  it("accumulates tabs across successive calls on a stale api object", () => {
    const { result } = renderHook(() => useCommanderViewer("conv-1"));
    const staleApi = result.current; // captured once, like the memoized sendText closure

    act(() => {
      staleApi.onLiveRef(ref("a1"), false);
    });
    act(() => {
      staleApi.onLiveRef(ref("a2"), false); // same stale object — must see a1's tab
    });

    expect(result.current.state.tabs.map((t) => t.refId)).toEqual(["a1", "a2"]);
    expect(result.current.state.activeId).toBe("artifact:a2:latest");
    expect(result.current.state.expanded).toBe(true);
  });

  it("does not drop user-opened tabs when a stale closure delivers a live ref", () => {
    const { result } = renderHook(() => useCommanderViewer("conv-1"));
    const staleApi = result.current;

    // User opens a tab via chips (fresh closure path) after staleApi was captured.
    act(() => {
      result.current.openRef(ref("manual"));
    });
    // Live ref arrives through the old captured object.
    act(() => {
      staleApi.onLiveRef(ref("live"), false);
    });

    expect(result.current.state.tabs.map((t) => t.refId)).toEqual(["manual", "live"]);
  });

  it("badges without expanding on mobile, reading live state", () => {
    const { result } = renderHook(() => useCommanderViewer("conv-1"));
    const staleApi = result.current;

    act(() => {
      staleApi.onLiveRef(ref("m1"), true);
    });
    act(() => {
      staleApi.onLiveRef(ref("m2"), true);
    });

    expect(result.current.state.tabs.map((t) => t.refId)).toEqual(["m1", "m2"]);
    expect(result.current.state.expanded).toBe(false);
    expect(result.current.state.activeId).toBe("home");
    expect(result.current.pendingBadge).toBe(2);
  });
});
