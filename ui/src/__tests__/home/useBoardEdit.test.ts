import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { HomeBoardLayoutItem } from "@armyofagents/shared";

// Stable mock fns (never reassigned — only reconfigured via
// mockResolvedValue/mockRejectedValueOnce/etc). useBoardEdit's callbacks
// close over whatever `useHomeBoardLayout` returns; reassigning the fn
// reference itself would go stale inside an already-memoized useCallback
// until the next render, so tests reconfigure behavior on the SAME fn
// instance instead of swapping references.
const mocks = vi.hoisted(() => ({
  layout: null as HomeBoardLayoutItem[] | null,
  isSaving: false,
  isResetting: false,
  saveAsync: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("../../hooks/useHomeBoardLayout", () => ({
  useHomeBoardLayout: () => ({
    layout: mocks.layout,
    schemaVersion: null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
    save: vi.fn(),
    saveAsync: mocks.saveAsync,
    isSaving: mocks.isSaving,
    saveError: null,
    reset: mocks.reset,
    resetAsync: vi.fn(),
    isResetting: mocks.isResetting,
    resetError: null,
  }),
}));

import { useBoardEdit, layoutsEqual } from "../../components/home/useBoardEdit";
import { buildDefaultLg } from "../../components/home/gridLayout";

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "22222222-2222-2222-2222-222222222222";

describe("layoutsEqual", () => {
  it("is true for identical arrays", () => {
    const a: HomeBoardLayoutItem[] = [{ i: "budget", x: 0, y: 0, w: 1, h: 1 }];
    expect(layoutsEqual(a, [...a])).toBe(true);
  });

  it("is true regardless of item order", () => {
    const a: HomeBoardLayoutItem[] = [
      { i: "budget", x: 0, y: 0, w: 1, h: 1 },
      { i: "agents-now", x: 1, y: 0, w: 1, h: 1 },
    ];
    expect(layoutsEqual(a, [a[1]!, a[0]!])).toBe(true);
  });

  it("is false when a position differs", () => {
    const a: HomeBoardLayoutItem[] = [{ i: "budget", x: 0, y: 0, w: 1, h: 1 }];
    const b: HomeBoardLayoutItem[] = [{ i: "budget", x: 1, y: 0, w: 1, h: 1 }];
    expect(layoutsEqual(a, b)).toBe(false);
  });

  it("is false when a size differs", () => {
    const a: HomeBoardLayoutItem[] = [{ i: "budget", x: 0, y: 0, w: 1, h: 1 }];
    const b: HomeBoardLayoutItem[] = [{ i: "budget", x: 0, y: 0, w: 2, h: 1 }];
    expect(layoutsEqual(a, b)).toBe(false);
  });

  it("is false when the item sets differ in length", () => {
    const a: HomeBoardLayoutItem[] = [{ i: "budget", x: 0, y: 0, w: 1, h: 1 }];
    const b: HomeBoardLayoutItem[] = [...a, { i: "agents-now", x: 1, y: 0, w: 1, h: 1 }];
    expect(layoutsEqual(a, b)).toBe(false);
  });
});

describe("useBoardEdit", () => {
  beforeEach(() => {
    mocks.layout = null;
    mocks.isSaving = false;
    mocks.isResetting = false;
    mocks.saveAsync.mockReset().mockResolvedValue({ layout: [], schemaVersion: 1 });
    mocks.reset.mockReset();
  });

  it("is not editing by default and renders the computed (role-default) lg", () => {
    const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
    expect(result.current.editing).toBe(false);
    expect(result.current.dirty).toBe(false);
    expect(result.current.lg).toEqual(buildDefaultLg("founder"));
  });

  it("startEdit snapshots the current lg as both draft and baseline (not dirty immediately)", () => {
    const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
    act(() => result.current.startEdit());
    expect(result.current.editing).toBe(true);
    expect(result.current.dirty).toBe(false);
    expect(result.current.lg).toEqual(buildDefaultLg("founder"));
  });

  describe("onLayoutChange gating", () => {
    it("is ignored entirely before editing starts", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      const before = result.current.lg;
      act(() => {
        result.current.onLayoutChange([], { lg: [{ i: "budget", x: 3, y: 3, w: 1, h: 1 }] });
      });
      expect(result.current.lg).toEqual(before);
      expect(result.current.dirty).toBe(false);
    });

    it("ignores the first call after startEdit (RGL's mount/sync echo) even if it looks different from baseline", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      const baseline = result.current.lg;
      const spuriousDifferent = [{ i: "budget", x: 3, y: 3, w: 1, h: 1 }];

      act(() => {
        result.current.onLayoutChange([], { lg: spuriousDifferent });
      });

      expect(result.current.lg).toEqual(baseline);
      expect(result.current.dirty).toBe(false);
    });

    it("a later call equal to baseline (spurious echo) does not dirty the draft", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      const baseline = result.current.lg;

      act(() => {
        result.current.onLayoutChange([], { lg: baseline }); // 1st call -> consumed as init echo
      });
      act(() => {
        result.current.onLayoutChange([], { lg: baseline }); // 2nd call -> equals baseline
      });

      expect(result.current.dirty).toBe(false);
    });

    it("a real change (differs from baseline) after the init echo dirties the draft", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      const baseline = result.current.lg;

      act(() => {
        result.current.onLayoutChange([], { lg: baseline }); // consume init echo
      });
      const moved = baseline.map((item, idx) => (idx === 0 ? { ...item, x: item.x + 1 } : item));
      act(() => {
        result.current.onLayoutChange([], { lg: moved });
      });

      expect(result.current.dirty).toBe(true);
      expect(result.current.lg).toEqual(moved);
    });

    it("is ignored while the active breakpoint is not lg", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      const baseline = result.current.lg;
      act(() => {
        result.current.onLayoutChange([], { lg: baseline }); // consume init echo
        result.current.onBreakpointChange("md", 2);
      });

      const moved = [{ i: baseline[0]!.i, x: 9, y: 9, w: 1, h: 1 }];
      act(() => {
        result.current.onLayoutChange([], { lg: moved });
      });

      expect(result.current.dirty).toBe(false);
      expect(result.current.lg).toEqual(baseline);
    });
  });

  describe("onResizeStop", () => {
    it("snaps the resized item to the nearest allowed size before committing to the draft", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());

      // agents-now only allows [{w:1,h:1},{w:2,h:1}] — a raw resize to
      // {w:2,h:2} must snap to the nearest, {w:2,h:1}.
      const rawResized = result.current.lg.map((item) =>
        item.i === "agents-now" ? { ...item, w: 2, h: 2 } : item,
      );
      const newItem = rawResized.find((item) => item.i === "agents-now")!;

      act(() => {
        result.current.onResizeStop(rawResized, null, newItem, null, new Event("mouseup"), null);
      });

      const resized = result.current.lg.find((item) => item.i === "agents-now")!;
      expect({ w: resized.w, h: resized.h }).toEqual({ w: 2, h: 1 });
      expect(result.current.dirty).toBe(true);
    });

    it("is ignored before editing starts", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      const before = result.current.lg;
      const newItem = { i: "agents-now", x: 0, y: 0, w: 2, h: 2 };
      act(() => {
        result.current.onResizeStop([newItem, ...before.filter((i) => i.i !== "agents-now")], null, newItem, null, new Event("mouseup"), null);
      });
      expect(result.current.lg).toEqual(before);
    });
  });

  describe("removeWidget / addWidget", () => {
    it("removeWidget drops the item from the draft and dirties it", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      const before = result.current.lg.length;

      act(() => result.current.removeWidget("budget"));

      expect(result.current.lg).toHaveLength(before - 1);
      expect(result.current.lg.some((item) => item.i === "budget")).toBe(false);
      expect(result.current.dirty).toBe(true);
    });

    it("addWidget appends a widget missing from the draft at its registry defaultSize", () => {
      mocks.layout = [{ i: "budget", x: 0, y: 0, w: 1, h: 1 }];
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());

      act(() => result.current.addWidget("agents-now"));

      const added = result.current.lg.find((item) => item.i === "agents-now");
      expect(added).toBeDefined();
      expect({ w: added!.w, h: added!.h }).toEqual({ w: 1, h: 1 }); // agents-now defaultSize
      expect(result.current.lg).toHaveLength(2);
      expect(result.current.dirty).toBe(true);
    });

    it("addWidget is a no-op for a widget already on the board", () => {
      mocks.layout = [{ i: "budget", x: 0, y: 0, w: 1, h: 1 }];
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());

      act(() => result.current.addWidget("budget"));

      expect(result.current.lg).toHaveLength(1);
    });

    it("removeWidget/addWidget are no-ops before editing starts", () => {
      mocks.layout = [{ i: "budget", x: 0, y: 0, w: 1, h: 1 }];
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));

      act(() => {
        result.current.removeWidget("budget");
        result.current.addWidget("agents-now");
      });

      expect(result.current.lg).toEqual([{ i: "budget", x: 0, y: 0, w: 1, h: 1 }]);
    });
  });

  describe("exitEdit / save-on-exit", () => {
    it("does not call save when the draft is not dirty", async () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());

      await act(async () => {
        result.current.exitEdit();
      });

      expect(mocks.saveAsync).not.toHaveBeenCalled();
      expect(result.current.editing).toBe(false);
    });

    it("calls save with the draft when dirty, and clears editing + dirty on success", async () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      act(() => result.current.removeWidget("budget"));
      expect(result.current.dirty).toBe(true);

      await act(async () => {
        result.current.exitEdit();
      });

      expect(mocks.saveAsync).toHaveBeenCalledTimes(1);
      const [savedLayout] = mocks.saveAsync.mock.calls[0]!;
      expect((savedLayout as HomeBoardLayoutItem[]).some((item) => item.i === "budget")).toBe(false);
      expect(result.current.editing).toBe(false);
      expect(result.current.dirty).toBe(false);
    });

    it("a failed save keeps editing + dirty and exposes saveError; retry re-attempts and can succeed", async () => {
      mocks.saveAsync.mockRejectedValueOnce(new Error("network down"));
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      act(() => result.current.removeWidget("budget"));

      await act(async () => {
        result.current.exitEdit();
      });

      expect(result.current.editing).toBe(true);
      expect(result.current.dirty).toBe(true);
      expect(result.current.saveError).toBeTruthy();

      // Retry re-attempts the same draft; the mock now resolves (queued
      // rejection was consumed above), so it should succeed this time.
      await act(async () => {
        result.current.retrySave();
      });

      expect(mocks.saveAsync).toHaveBeenCalledTimes(2);
      expect(result.current.editing).toBe(false);
      expect(result.current.dirty).toBe(false);
      expect(result.current.saveError).toBeFalsy();
    });
  });

  describe("resetBoard", () => {
    it("calls the reset mutation, falls back to the role default, and marks the draft clean", () => {
      mocks.layout = [{ i: "budget", x: 0, y: 0, w: 1, h: 1 }];
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      act(() => result.current.removeWidget("budget"));
      expect(result.current.dirty).toBe(true);

      act(() => result.current.resetBoard());

      expect(mocks.reset).toHaveBeenCalledTimes(1);
      expect(result.current.lg).toEqual(buildDefaultLg("founder"));
      expect(result.current.dirty).toBe(false);
    });

    it("a subsequent exitEdit does not re-save (no delete-then-upsert race)", async () => {
      mocks.layout = [{ i: "budget", x: 0, y: 0, w: 1, h: 1 }];
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());

      act(() => result.current.resetBoard());
      expect(result.current.dirty).toBe(false);

      await act(async () => {
        result.current.exitEdit();
      });

      expect(mocks.saveAsync).not.toHaveBeenCalled();
      expect(result.current.editing).toBe(false);
    });
  });

  describe("background refetch vs a dirty draft", () => {
    it("does not clobber a dirty draft when the underlying saved layout changes", () => {
      const { result, rerender } = renderHook(
        ({ companyId, role }) => useBoardEdit(companyId, role),
        { initialProps: { companyId: COMPANY_A, role: "founder" as const } },
      );
      act(() => result.current.startEdit());
      act(() => result.current.removeWidget("budget"));
      expect(result.current.dirty).toBe(true);
      const dirtyDraft = result.current.lg;

      // Simulate a background refetch changing the saved layout underneath us.
      mocks.layout = [{ i: "my-tasks", x: 0, y: 0, w: 2, h: 1 }];
      rerender({ companyId: COMPANY_A, role: "founder" });

      expect(result.current.lg).toEqual(dirtyDraft);
      expect(result.current.dirty).toBe(true);
    });

    it("adopts the refreshed source when the draft is clean (not dirty)", () => {
      const { result, rerender } = renderHook(
        ({ companyId, role }) => useBoardEdit(companyId, role),
        { initialProps: { companyId: COMPANY_A, role: "founder" as const } },
      );
      act(() => result.current.startEdit());
      expect(result.current.dirty).toBe(false);

      const refreshed: HomeBoardLayoutItem[] = [{ i: "my-tasks", x: 0, y: 0, w: 2, h: 1 }];
      mocks.layout = refreshed;
      act(() => rerender({ companyId: COMPANY_A, role: "founder" }));

      expect(result.current.lg).toEqual(refreshed);
      expect(result.current.dirty).toBe(false);
    });
  });

  describe("company scoping", () => {
    it("discards the draft when companyId changes mid-edit (never saves the old company's layout)", async () => {
      const { result, rerender } = renderHook(
        ({ companyId, role }) => useBoardEdit(companyId, role),
        { initialProps: { companyId: COMPANY_A, role: "founder" as const } },
      );
      act(() => result.current.startEdit());
      act(() => result.current.removeWidget("budget"));
      expect(result.current.dirty).toBe(true);

      act(() => {
        rerender({ companyId: COMPANY_B, role: "founder" });
      });

      expect(result.current.editing).toBe(false);
      expect(result.current.dirty).toBe(false);

      // A stray exitEdit call after the switch must never fire a save.
      await act(async () => {
        result.current.exitEdit();
      });
      expect(mocks.saveAsync).not.toHaveBeenCalled();
    });
  });
});
