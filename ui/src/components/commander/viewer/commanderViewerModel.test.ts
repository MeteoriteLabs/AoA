import { describe, it, expect } from "vitest";
import {
  emptyViewerState,
  openRefTab,
  openReplyTab,
  openBrowserTab,
  closeTab,
  shouldAutoOpen,
  chipLabel,
  collectConversationRefs,
  mergeRefs,
  type ConversationViewerState,
} from "./commanderViewerModel";
import type { CommanderOutputRef } from "@armyofagents/shared";

const ref = (id: string, action: "created" | "referenced" = "created", title: string | null = "Plan"): CommanderOutputRef =>
  ({ v: 1, kind: "artifact", id, action, title } as CommanderOutputRef);

describe("commanderViewerModel", () => {
  it("openRefTab adds a tab and focuses it; reopening focuses without duplicating", () => {
    let s: ConversationViewerState = emptyViewerState();
    s = openRefTab(s, ref("a1"));
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(s.tabs[0]!.id);
    expect(s.expanded).toBe(true);
    const again = openRefTab(s, ref("a1"));
    expect(again.tabs).toHaveLength(1);
  });

  it("closeTab removes and re-focuses neighbor (home when empty)", () => {
    let s = openRefTab(openRefTab(emptyViewerState(), ref("a1")), ref("a2"));
    const closing = s.tabs.find((t) => t.refId === "a2")!;
    s = closeTab(s, closing.id);
    expect(s.tabs).toHaveLength(1);
    expect(s.activeId).toBe(s.tabs[0]!.id);
    s = closeTab(s, s.tabs[0]!.id);
    expect(s.tabs).toHaveLength(0);
    expect(s.activeId).toBe("home");
  });

  it("openReplyTab opens a markdown tab keyed by message id", () => {
    let s = openReplyTab(emptyViewerState(), "msg-1", "# Hello");
    expect(s.tabs[0]).toMatchObject({ kind: "reply", refId: "msg-1" });
    s = openReplyTab(s, "msg-1", "# Hello");
    expect(s.tabs).toHaveLength(1); // focus, not duplicate
  });

  it("openBrowserTab opens a browser tab titled by hostname, expands, dedupes", () => {
    let s = emptyViewerState();
    s = openBrowserTab(s, "https://example.com/path");
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toMatchObject({ kind: "browser", url: "https://example.com/path", title: "example.com" });
    expect(s.expanded).toBe(true);
    expect(s.activeId).toBe(s.tabs[0]!.id);
    const again = openBrowserTab(s, "https://example.com/path");
    expect(again.tabs).toHaveLength(1); // dedup, focus
  });

  it("openBrowserTab falls back to the raw url as title when the url cannot be parsed", () => {
    const s = openBrowserTab(emptyViewerState(), "not a url");
    expect(s.tabs[0]).toMatchObject({ kind: "browser", title: "not a url", url: "not a url" });
  });

  it("shouldAutoOpen: created+desktop only", () => {
    expect(shouldAutoOpen(ref("a", "created"), false)).toBe(true);
    expect(shouldAutoOpen(ref("a", "created"), true)).toBe(false);
    expect(shouldAutoOpen(ref("a", "referenced"), false)).toBe(false);
  });

  it("chipLabel falls back to kind + short id", () => {
    expect(chipLabel(ref("a1", "created", "GTM Plan"))).toBe("GTM Plan");
    expect(chipLabel(ref("abcdef123456", "created", null))).toBe("artifact abcdef12");
  });

  it("collectConversationRefs dedupes across messages, created wins", () => {
    const refs = collectConversationRefs([
      { outputRefs: [ref("a1", "referenced")] },
      { outputRefs: [ref("a1", "created"), ref("a2", "referenced")] },
      { outputRefs: null },
    ]);
    expect(refs).toHaveLength(2);
    expect(refs.find((r) => r.id === "a1")!.action).toBe("created");
  });

  describe("mergeRefs", () => {
    it("created wins over referenced for same kind|id|versionId key", () => {
      const existing = [ref("a1", "referenced")];
      const incoming = [ref("a1", "created")];
      const result = mergeRefs(existing, incoming);
      expect(result).toHaveLength(1);
      expect(result[0]!.action).toBe("created");
    });

    it("existing wins when incoming is also referenced (no promotion)", () => {
      const existing = [ref("a1", "referenced")];
      const incoming = [ref("a1", "referenced")];
      const result = mergeRefs(existing, incoming);
      expect(result).toHaveLength(1);
    });

    it("distinct versionIds are kept as separate entries", () => {
      const r1: CommanderOutputRef = { v: 1, kind: "artifact", id: "a1", versionId: "v1", action: "created", title: "Plan" } as unknown as CommanderOutputRef;
      const r2: CommanderOutputRef = { v: 1, kind: "artifact", id: "a1", versionId: "v2", action: "created", title: "Plan v2" } as unknown as CommanderOutputRef;
      const result = mergeRefs([r1], [r2]);
      expect(result).toHaveLength(2);
    });

    it("existing entry wins in a tie (no incoming promotion for non-created)", () => {
      const existing = [ref("a1", "created")];
      const incoming = [ref("a1", "referenced")];
      const result = mergeRefs(existing, incoming);
      expect(result).toHaveLength(1);
      expect(result[0]!.action).toBe("created");
    });
  });
});
