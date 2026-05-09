import { describe, it, expect } from "vitest";
import {
  openOrActivate,
  closeTab,
  type MemoryTab,
  type TabsState,
} from "../memoryTabs";

const tab = (id: string, kind: "memory_item" | "asset" = "memory_item"): MemoryTab => ({
  id,
  kind,
  title: id.toUpperCase(),
});

const empty: TabsState = { tabs: [], activeId: null };

describe("memoryTabs reducer", () => {
  describe("openOrActivate", () => {
    it("appends a new tab and activates it when state is empty", () => {
      const next = openOrActivate(empty, tab("a"));
      expect(next.tabs.map((t) => t.id)).toEqual(["a"]);
      expect(next.activeId).toBe("a");
    });

    it("appends and activates a new tab when already has tabs", () => {
      const s1 = openOrActivate(empty, tab("a"));
      const s2 = openOrActivate(s1, tab("b"));
      expect(s2.tabs.map((t) => t.id)).toEqual(["a", "b"]);
      expect(s2.activeId).toBe("b");
    });

    it("activates an existing tab without duplicating it", () => {
      const s1 = openOrActivate(empty, tab("a"));
      const s2 = openOrActivate(s1, tab("b"));
      const s3 = openOrActivate(s2, tab("a"));
      expect(s3.tabs.map((t) => t.id)).toEqual(["a", "b"]);
      expect(s3.activeId).toBe("a");
    });

    it("treats memory_item and asset with the same id as different tabs", () => {
      const s1 = openOrActivate(empty, tab("x", "memory_item"));
      const s2 = openOrActivate(s1, tab("x", "asset"));
      expect(s2.tabs.length).toBe(2);
      expect(s2.activeId).toBe("x");
      expect(s2.tabs[1].kind).toBe("asset");
    });
  });

  describe("closeTab", () => {
    it("removes the tab and activates the previous tab when closing the active one", () => {
      const s = { tabs: [tab("a"), tab("b"), tab("c")], activeId: "b" };
      const next = closeTab(s, "b", "memory_item");
      expect(next.tabs.map((t) => t.id)).toEqual(["a", "c"]);
      expect(next.activeId).toBe("a");
    });

    it("activates the new first tab when closing the FIRST active tab", () => {
      const s = { tabs: [tab("a"), tab("b")], activeId: "a" };
      const next = closeTab(s, "a", "memory_item");
      expect(next.tabs.map((t) => t.id)).toEqual(["b"]);
      expect(next.activeId).toBe("b");
    });

    it("returns null activeId when closing the only tab", () => {
      const s = { tabs: [tab("a")], activeId: "a" };
      const next = closeTab(s, "a", "memory_item");
      expect(next.tabs).toEqual([]);
      expect(next.activeId).toBeNull();
    });

    it("does not change activeId when closing an INACTIVE tab", () => {
      const s = { tabs: [tab("a"), tab("b")], activeId: "a" };
      const next = closeTab(s, "b", "memory_item");
      expect(next.tabs.map((t) => t.id)).toEqual(["a"]);
      expect(next.activeId).toBe("a");
    });

    it("returns the same state shape when closing a tab that does not exist", () => {
      const s = { tabs: [tab("a")], activeId: "a" };
      const next = closeTab(s, "z", "memory_item");
      expect(next).toEqual(s);
    });

    it("disambiguates tabs that share an id but differ by kind", () => {
      const s = {
        tabs: [tab("x", "memory_item"), tab("x", "asset")],
        activeId: "x",
      };
      // Close the asset tab — memory_item with same id remains.
      const next = closeTab(s, "x", "asset");
      expect(next.tabs.length).toBe(1);
      expect(next.tabs[0].kind).toBe("memory_item");
      // activeId is the asset's id; once removed, activate the previous remaining tab.
      expect(next.activeId).toBe("x");
    });
  });
});
