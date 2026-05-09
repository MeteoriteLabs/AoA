import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMemoryViewMode } from "../useMemoryViewMode";

describe("useMemoryViewMode", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to 'list' when nothing is stored", () => {
    const { result } = renderHook(() => useMemoryViewMode());
    expect(result.current.mode).toBe("list");
  });

  it("persists across mounts via localStorage", () => {
    const { result, unmount } = renderHook(() => useMemoryViewMode());
    act(() => result.current.setMode("table"));
    unmount();
    const { result: r2 } = renderHook(() => useMemoryViewMode());
    expect(r2.current.mode).toBe("table");
  });

  it("ignores invalid stored values and falls back to 'list'", () => {
    localStorage.setItem("aoa:memory:view-mode", "treeview");
    const { result } = renderHook(() => useMemoryViewMode());
    expect(result.current.mode).toBe("list");
  });

  it("rejects invalid setMode arguments at runtime", () => {
    const { result } = renderHook(() => useMemoryViewMode());
    act(() => result.current.setMode("table"));
    expect(result.current.mode).toBe("table");
    // Calling with an invalid value (forced via cast) should be a no-op.
    act(() => result.current.setMode("garbage" as unknown as "list"));
    expect(result.current.mode).toBe("table");
  });

  it("survives a quota-exceeded localStorage write without throwing", () => {
    const setItem = localStorage.setItem;
    localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    try {
      const { result } = renderHook(() => useMemoryViewMode());
      // Should not throw
      act(() => result.current.setMode("cards"));
      // In-memory state still reflects the call even when persistence fails.
      expect(result.current.mode).toBe("cards");
    } finally {
      localStorage.setItem = setItem;
    }
  });
});
