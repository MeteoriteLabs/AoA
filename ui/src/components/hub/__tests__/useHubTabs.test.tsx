import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHubTabs, HUB_TABS_MAX } from "../useHubTabs";
import { HOME_TAB, approvalTab, taskTab, type HubTab } from "../hubViewerModel";

const storageKey = (companyId: string) => `aoa:hub:tabs:${companyId}`;

describe("useHubTabs", () => {
  beforeEach(() => localStorage.clear());

  it("seeds with the Home tab active", () => {
    const { result } = renderHook(() => useHubTabs("c1"));
    expect(result.current.tabs).toEqual([HOME_TAB]);
    expect(result.current.activeKey).toBe("home");
  });

  it("openTab adds a tab and activates it", () => {
    const { result } = renderHook(() => useHubTabs("c1"));
    act(() => result.current.openTab(approvalTab("a1")));
    expect(result.current.tabs.map((t) => t.key)).toEqual(["home", "approval:a1"]);
    expect(result.current.activeKey).toBe("approval:a1");
  });

  it("opening the same key twice does not duplicate and re-activates", () => {
    const { result } = renderHook(() => useHubTabs("c1"));
    act(() => result.current.openTab(approvalTab("a1")));
    act(() => result.current.openTab(taskTab("t1")));
    expect(result.current.activeKey).toBe("task:t1");
    // Re-open the first tab.
    act(() => result.current.openTab(approvalTab("a1")));
    expect(result.current.tabs.map((t) => t.key)).toEqual([
      "home",
      "approval:a1",
      "task:t1",
    ]);
    expect(result.current.activeKey).toBe("approval:a1");
  });

  it("closing the active tab re-activates next.at(-1)", () => {
    const { result } = renderHook(() => useHubTabs("c1"));
    act(() => result.current.openTab(approvalTab("a1")));
    act(() => result.current.openTab(taskTab("t1")));
    expect(result.current.activeKey).toBe("task:t1");
    act(() => result.current.closeTab("task:t1"));
    // task:t1 removed → last remaining tab (approval:a1) becomes active.
    expect(result.current.tabs.map((t) => t.key)).toEqual(["home", "approval:a1"]);
    expect(result.current.activeKey).toBe("approval:a1");
  });

  it("closing a non-active tab leaves the active key untouched", () => {
    const { result } = renderHook(() => useHubTabs("c1"));
    act(() => result.current.openTab(approvalTab("a1")));
    act(() => result.current.openTab(taskTab("t1")));
    expect(result.current.activeKey).toBe("task:t1");
    act(() => result.current.closeTab("approval:a1"));
    expect(result.current.tabs.map((t) => t.key)).toEqual(["home", "task:t1"]);
    expect(result.current.activeKey).toBe("task:t1");
  });

  it("closing Home is a no-op (non-closeable, stays)", () => {
    const { result } = renderHook(() => useHubTabs("c1"));
    act(() => result.current.activateTab("home"));
    act(() => result.current.closeTab("home"));
    expect(result.current.tabs).toEqual([HOME_TAB]);
    expect(result.current.activeKey).toBe("home");
  });

  it("activateTab switches the active key", () => {
    const { result } = renderHook(() => useHubTabs("c1"));
    act(() => result.current.openTab(approvalTab("a1")));
    act(() => result.current.activateTab("home"));
    expect(result.current.activeKey).toBe("home");
  });

  it("persists the versioned blob and rehydrates on a fresh mount", () => {
    const { result, unmount } = renderHook(() => useHubTabs("c1"));
    act(() => result.current.openTab(approvalTab("a1")));
    act(() => result.current.openTab(taskTab("t1")));

    const raw = localStorage.getItem(storageKey("c1"));
    expect(raw).toBeTruthy();
    const blob = JSON.parse(raw!);
    expect(blob.version).toBe(1);
    expect(blob.tabs.map((t: HubTab) => t.key)).toEqual([
      "home",
      "approval:a1",
      "task:t1",
    ]);

    unmount();
    const { result: r2 } = renderHook(() => useHubTabs("c1"));
    expect(r2.current.tabs.map((t) => t.key)).toEqual([
      "home",
      "approval:a1",
      "task:t1",
    ]);
  });

  it("does not persist when companyId is undefined", () => {
    const { result } = renderHook(() => useHubTabs(undefined));
    act(() => result.current.openTab(approvalTab("a1")));
    // No key should have been written.
    expect(localStorage.length).toBe(0);
  });

  it("rehydrates to [HOME_TAB] on a version mismatch", () => {
    localStorage.setItem(
      storageKey("c1"),
      JSON.stringify({ version: 0, tabs: [HOME_TAB, approvalTab("a1")] }),
    );
    const { result } = renderHook(() => useHubTabs("c1"));
    expect(result.current.tabs).toEqual([HOME_TAB]);
  });

  it("rehydrates to [HOME_TAB] on malformed JSON (no throw)", () => {
    localStorage.setItem(storageKey("c1"), "{not valid json");
    expect(() => renderHook(() => useHubTabs("c1"))).not.toThrow();
    const { result } = renderHook(() => useHubTabs("c1"));
    expect(result.current.tabs).toEqual([HOME_TAB]);
  });

  it("rehydrates to [HOME_TAB] on a shape mismatch", () => {
    localStorage.setItem(
      storageKey("c1"),
      JSON.stringify({ version: 1, tabs: "not-an-array" }),
    );
    const { result } = renderHook(() => useHubTabs("c1"));
    expect(result.current.tabs).toEqual([HOME_TAB]);
  });

  it("always restores Home first even if the blob omits it", () => {
    localStorage.setItem(
      storageKey("c1"),
      JSON.stringify({ version: 1, tabs: [approvalTab("a1"), taskTab("t1")] }),
    );
    const { result } = renderHook(() => useHubTabs("c1"));
    expect(result.current.tabs[0]).toEqual(HOME_TAB);
    expect(result.current.tabs.map((t) => t.key)).toEqual([
      "home",
      "approval:a1",
      "task:t1",
    ]);
  });

  it("de-dupes a persisted Home entry rather than adding a second one", () => {
    localStorage.setItem(
      storageKey("c1"),
      JSON.stringify({ version: 1, tabs: [HOME_TAB, approvalTab("a1")] }),
    );
    const { result } = renderHook(() => useHubTabs("c1"));
    const homeCount = result.current.tabs.filter((t) => t.key === "home").length;
    expect(homeCount).toBe(1);
    expect(result.current.tabs[0]).toEqual(HOME_TAB);
  });

  it("caps the restored set at HUB_TABS_MAX, keeping Home + the newest", () => {
    const many: HubTab[] = [HOME_TAB];
    for (let i = 0; i < 20; i++) many.push(taskTab(`t${i}`));
    localStorage.setItem(
      storageKey("c1"),
      JSON.stringify({ version: 1, tabs: many }),
    );
    const { result } = renderHook(() => useHubTabs("c1"));
    expect(result.current.tabs.length).toBe(HUB_TABS_MAX);
    expect(result.current.tabs[0]).toEqual(HOME_TAB);
    // The oldest closeable tabs are dropped; the newest survive.
    const keys = result.current.tabs.map((t) => t.key);
    expect(keys).toContain("task:t19");
    expect(keys).not.toContain("task:t0");
  });

  it("survives a quota-exceeded persist without throwing", () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    try {
      const { result } = renderHook(() => useHubTabs("c1"));
      expect(() =>
        act(() => result.current.openTab(approvalTab("a1"))),
      ).not.toThrow();
      expect(result.current.tabs.map((t) => t.key)).toEqual([
        "home",
        "approval:a1",
      ]);
    } finally {
      localStorage.setItem = original;
    }
  });
});
