import { describe, it, expect, beforeEach } from "vitest";
import {
  getInboxNestingEnabled,
  setInboxNestingEnabled,
  subscribeInboxNestingChange,
  getCollapsedSet,
  toggleCollapsed,
  computeVisibleOrderedIds,
} from "@/lib/inbox";

describe("inbox nesting helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("nesting toggle persists to localStorage", () => {
    expect(getInboxNestingEnabled()).toBe(false);
    setInboxNestingEnabled(true);
    expect(getInboxNestingEnabled()).toBe(true);
    expect(localStorage.getItem("aoa:inbox:nestingEnabled")).toBe("1");
  });

  it("nesting toggle off persists '0' to localStorage", () => {
    setInboxNestingEnabled(true);
    setInboxNestingEnabled(false);
    expect(getInboxNestingEnabled()).toBe(false);
    expect(localStorage.getItem("aoa:inbox:nestingEnabled")).toBe("0");
  });

  it("collapsed set toggles", () => {
    expect(getCollapsedSet().has("p1")).toBe(false);
    toggleCollapsed("p1");
    expect(getCollapsedSet().has("p1")).toBe(true);
    toggleCollapsed("p1");
    expect(getCollapsedSet().has("p1")).toBe(false);
  });

  it("collapsed set persists to localStorage", () => {
    toggleCollapsed("p1");
    toggleCollapsed("p2");
    const raw = localStorage.getItem("aoa:inbox:collapsed:set");
    expect(raw).not.toBeNull();
    const arr = JSON.parse(raw!);
    expect(arr).toContain("p1");
    expect(arr).toContain("p2");
  });

  it("subscribe fires on toggle", () => {
    let received: boolean | null = null;
    const unsubscribe = subscribeInboxNestingChange((v) => {
      received = v;
    });
    setInboxNestingEnabled(true);
    expect(received).toBe(true);
    unsubscribe();
  });

  it("subscribe stops firing after unsubscribe", () => {
    let count = 0;
    const unsubscribe = subscribeInboxNestingChange(() => {
      count++;
    });
    setInboxNestingEnabled(true);
    expect(count).toBe(1);
    unsubscribe();
    setInboxNestingEnabled(false);
    expect(count).toBe(1); // no additional calls
  });

  it("computeVisibleOrderedIds skips children of collapsed parents", () => {
    const topLevel = [{ id: "p1" }, { id: "p2" }];
    const children = new Map([["p1", [{ id: "c1" }, { id: "c2" }]]]);
    const collapsed = new Set(["p1"]);
    expect(computeVisibleOrderedIds(topLevel, children, collapsed)).toEqual(["p1", "p2"]);
  });

  it("computeVisibleOrderedIds expands non-collapsed parents", () => {
    const topLevel = [{ id: "p1" }, { id: "p2" }];
    const children = new Map([["p1", [{ id: "c1" }]]]);
    const collapsed = new Set<string>();
    expect(computeVisibleOrderedIds(topLevel, children, collapsed)).toEqual(["p1", "c1", "p2"]);
  });

  it("computeVisibleOrderedIds handles empty children map", () => {
    const topLevel = [{ id: "p1" }, { id: "p2" }];
    const children = new Map<string, Array<{ id: string }>>();
    const collapsed = new Set<string>();
    expect(computeVisibleOrderedIds(topLevel, children, collapsed)).toEqual(["p1", "p2"]);
  });

  it("computeVisibleOrderedIds handles empty topLevel", () => {
    const topLevel: Array<{ id: string }> = [];
    const children = new Map<string, Array<{ id: string }>>();
    const collapsed = new Set<string>();
    expect(computeVisibleOrderedIds(topLevel, children, collapsed)).toEqual([]);
  });

  it("computeVisibleOrderedIds includes all children when none collapsed", () => {
    const topLevel = [{ id: "p1" }, { id: "p2" }];
    const children = new Map([
      ["p1", [{ id: "c1" }, { id: "c2" }]],
      ["p2", [{ id: "c3" }]],
    ]);
    const collapsed = new Set<string>();
    expect(computeVisibleOrderedIds(topLevel, children, collapsed)).toEqual([
      "p1", "c1", "c2", "p2", "c3",
    ]);
  });
});
