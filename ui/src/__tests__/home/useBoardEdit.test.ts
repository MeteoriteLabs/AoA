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

  describe("activeBreakpoint (Task D1 — edit is lg-only)", () => {
    it("defaults to lg", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      expect(result.current.activeBreakpoint).toBe("lg");
    });

    it("tracks onBreakpointChange", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.onBreakpointChange("sm", 1));
      expect(result.current.activeBreakpoint).toBe("sm");

      act(() => result.current.onBreakpointChange("lg", 4));
      expect(result.current.activeBreakpoint).toBe("lg");
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

  // [P1] Resize snap is clobbered by RGL's post-resize onLayoutChange: RGL
  // fires onLayoutChange synchronously right after onResizeStop, with its
  // OWN internal layout state — which still reflects the raw, un-snapped
  // resize target, not the snap onResizeStop already computed. Before the
  // fix, onLayoutChange's setDraft(rawLg) unconditionally overwrote the
  // snap, leaving the draft holding a disallowed {w,h} the server validator
  // rejects (400 on save, and Retry just re-sends the same bad draft
  // forever). The fix clamps every item to nearestAllowedSize in
  // onLayoutChange BEFORE the baseline-diff/setDraft, and again
  // (defense-in-depth) in attemptSave before saveAsync.
  describe("onLayoutChange clamps disallowed sizes (P1 — RGL raw-emit clobber)", () => {
    it("keeps the onResizeStop snap when RGL's own onLayoutChange fires next with the RAW un-snapped layout", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      const baseline = result.current.lg;
      act(() => {
        result.current.onLayoutChange([], { lg: baseline }); // consume the init echo
      });

      // Real RGL order: onResizeStop fires first with the resize (agents-now
      // dragged to a disallowed {w:2,h:2}; allowedSizes are only
      // [{w:1,h:1},{w:2,h:1}]) and snaps it...
      const rawResized = baseline.map((item) =>
        item.i === "agents-now" ? { ...item, w: 2, h: 2 } : item,
      );
      const newItem = rawResized.find((item) => item.i === "agents-now")!;
      act(() => {
        result.current.onResizeStop(rawResized, null, newItem, null, new Event("mouseup"), null);
      });
      expect(result.current.lg.find((i) => i.i === "agents-now")).toMatchObject({ w: 2, h: 1 });

      // ...then RGL synchronously fires onLayoutChange with ITS OWN raw
      // internal layout (still {w:2,h:2} for agents-now) — this must NOT
      // clobber the snap.
      act(() => {
        result.current.onLayoutChange(rawResized, { lg: rawResized });
      });

      const afterLayoutChange = result.current.lg.find((i) => i.i === "agents-now")!;
      expect({ w: afterLayoutChange.w, h: afterLayoutChange.h }).toEqual({ w: 2, h: 1 });
      expect(result.current.dirty).toBe(true);
    });

    it("clamps a raw disallowed size from onLayoutChange even with no prior onResizeStop call", () => {
      // Guards against relying SOLELY on onResizeStop's own snap — the fix
      // must hold regardless of which RGL callback produced the disallowed
      // size.
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      const baseline = result.current.lg;
      act(() => {
        result.current.onLayoutChange([], { lg: baseline }); // consume the init echo
      });

      const rawLg = baseline.map((item) =>
        item.i === "agents-now" ? { ...item, w: 2, h: 2 } : item,
      );
      act(() => {
        result.current.onLayoutChange(rawLg, { lg: rawLg });
      });

      const agentsNow = result.current.lg.find((i) => i.i === "agents-now")!;
      expect({ w: agentsNow.w, h: agentsNow.h }).toEqual({ w: 2, h: 1 });
    });

    it("attemptSave (exitEdit) sends only allowed sizes — defense-in-depth even for an item onResizeStop's own snap doesn't touch", async () => {
      // onResizeStop's `next` mapping only snaps the item actually being
      // resized (newItem.i); every OTHER item in the same `layout` array
      // passes through unchanged. Simulate a bogus size landing on an
      // unrelated widget (budget) via that path, with no follow-up
      // onLayoutChange to clean it up, and prove attemptSave clamps it
      // anyway before the payload reaches saveAsync.
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      const baseline = result.current.lg;

      const bogusLayout = baseline.map((item) => {
        if (item.i === "agents-now") return { ...item, w: 2, h: 2 }; // being resized
        if (item.i === "budget") return { ...item, w: 3, h: 3 }; // bogus — not an allowed budget size
        return item;
      });
      const newItem = bogusLayout.find((item) => item.i === "agents-now")!;
      act(() => {
        result.current.onResizeStop(bogusLayout, null, newItem, null, new Event("mouseup"), null);
      });
      // Sanity: budget's bogus size DID make it into the draft — proves this
      // test actually exercises the gap (onResizeStop alone doesn't clamp
      // items other than the one being resized).
      expect(result.current.lg.find((i) => i.i === "budget")).toMatchObject({ w: 3, h: 3 });

      await act(async () => {
        result.current.exitEdit();
      });

      expect(mocks.saveAsync).toHaveBeenCalledTimes(1);
      const [savedLayout] = mocks.saveAsync.mock.calls[0]! as [HomeBoardLayoutItem[]];
      const savedBudget = savedLayout.find((i) => i.i === "budget")!;
      // budget's allowedSizes are [{w:1,h:1},{w:2,h:1}]; nearest to {w:3,h:3}
      // is {w:2,h:1} (squared distance 1+4=5 vs {w:1,h:1}'s 4+4=8).
      expect({ w: savedBudget.w, h: savedBudget.h }).toEqual({ w: 2, h: 1 });
      const savedAgentsNow = savedLayout.find((i) => i.i === "agents-now")!;
      expect({ w: savedAgentsNow.w, h: savedAgentsNow.h }).toEqual({ w: 2, h: 1 });
    });

    it("a drag (x/y only, size unchanged) through onLayoutChange is unaffected by the clamp", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      const baseline = result.current.lg;
      act(() => {
        result.current.onLayoutChange([], { lg: baseline }); // consume the init echo
      });

      const dragged = baseline.map((item, idx) => (idx === 0 ? { ...item, x: item.x + 1 } : item));
      act(() => {
        result.current.onLayoutChange(dragged, { lg: dragged });
      });

      expect(result.current.lg).toEqual(dragged);
      expect(result.current.dirty).toBe(true);
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

  // Plan 4 Task 5: the ONE genuine gap found in this file — startEdit/
  // exitEdit(attemptSave)/resetBoard are all individually guarded by
  // `isSaving` in the source (see useBoardEdit.ts rules 1/7 and resetBoard's
  // own `if (isSaving || isResetting) return;`), but nothing exercised that
  // guard while a save is ACTUALLY in flight (as opposed to before it starts
  // or after it settles). The other three cases this task asked for —
  // "failed save keeps dirty+editing+retrySave", "retry succeeds", and
  // "refetch-while-editing doesn't clobber a dirty draft" — are already
  // covered above (see "a failed save keeps editing..." in this describe,
  // and the "background refetch vs a dirty draft" describe below) and are
  // intentionally NOT duplicated here.
  describe("save-in-flight guards (isSaving)", () => {
    it("exitEdit/startEdit/resetBoard all no-op while a save is genuinely in flight — no second save, no re-entry", () => {
      const { result, rerender } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      act(() => result.current.removeWidget("budget"));
      expect(result.current.dirty).toBe(true);
      const draftWhileSaving = result.current.lg;

      // Simulate the underlying mutation now being in flight — this is the
      // window between saveAsync's call and its resolution that a single
      // exitEdit()-then-await-resolve test never observes.
      mocks.isSaving = true;
      rerender();

      act(() => result.current.exitEdit()); // attemptSave's `if (isSaving) return;` guard
      expect(mocks.saveAsync).not.toHaveBeenCalled();
      expect(result.current.editing).toBe(true); // exit was swallowed, not applied
      expect(result.current.lg).toEqual(draftWhileSaving); // draft untouched

      act(() => result.current.startEdit()); // startEdit's own `if (isSaving) return;` guard
      expect(result.current.editing).toBe(true);
      expect(result.current.dirty).toBe(true); // re-entry did not reset the draft/baseline
      expect(result.current.lg).toEqual(draftWhileSaving);

      act(() => result.current.resetBoard()); // resetBoard's `if (isSaving || isResetting) return;` guard
      expect(mocks.reset).not.toHaveBeenCalled();
      expect(result.current.lg).toEqual(draftWhileSaving);

      // retrySave is the exact same guarded attemptSave as exitEdit.
      act(() => result.current.retrySave());
      expect(mocks.saveAsync).not.toHaveBeenCalled();
    });

    it("resetBoard also no-ops while a reset is already in flight (isResetting)", () => {
      const { result, rerender } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());

      mocks.isResetting = true;
      rerender();

      act(() => result.current.resetBoard());
      expect(mocks.reset).not.toHaveBeenCalled();
      expect(result.current.editing).toBe(true); // still editing — reset was a no-op, not a crash
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

  describe("moveWidget (Task D2 — keyboard nudge)", () => {
    it("moves the widget in the draft by (dx,dy) and dirties it", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      const before = result.current.lg.find((item) => item.i === "budget")!;

      act(() => result.current.moveWidget("budget", 1, 0));

      const after = result.current.lg.find((item) => item.i === "budget")!;
      expect(after).toEqual({ ...before, x: before.x + 1 });
      expect(result.current.dirty).toBe(true);
    });

    it("sets an announcement naming the widget and its new position", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      act(() => result.current.moveWidget("budget", 1, 0));
      expect(result.current.announcement).toMatch(/Budget/);
    });

    it("is a no-op (including no announcement) when blocked at bounds", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      const before = result.current.lg;
      // The founder default's "budget" tile sits at x:0 (leftmost) — moving
      // left is blocked.
      expect(before.find((item) => item.i === "budget")!.x).toBe(0);

      act(() => result.current.moveWidget("budget", -1, 0));

      expect(result.current.lg).toEqual(before);
      expect(result.current.announcement).toBe("");
    });

    it("is a no-op before editing starts", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      const before = result.current.lg;
      act(() => result.current.moveWidget("budget", 1, 0));
      expect(result.current.lg).toEqual(before);
    });

    it("is ignored while the active breakpoint is not lg", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      act(() => result.current.onBreakpointChange("sm", 1));
      const before = result.current.lg;

      act(() => result.current.moveWidget("budget", 1, 0));

      expect(result.current.lg).toEqual(before);
    });
  });

  describe("cycleWidgetSize (Task D2 — keyboard resize)", () => {
    it("cycles the widget's size in the draft and dirties it", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());

      act(() => result.current.cycleWidgetSize("agents-now"));

      const item = result.current.lg.find((entry) => entry.i === "agents-now")!;
      expect({ w: item.w, h: item.h }).toEqual({ w: 2, h: 1 });
      expect(result.current.dirty).toBe(true);
    });

    it("sets an announcement naming the widget and its new size", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      act(() => result.current.cycleWidgetSize("agents-now"));
      expect(result.current.announcement).toMatch(/Agents working now/);
    });

    it("is a no-op before editing starts", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      const before = result.current.lg;
      act(() => result.current.cycleWidgetSize("agents-now"));
      expect(result.current.lg).toEqual(before);
    });

    it("is ignored while the active breakpoint is not lg", () => {
      const { result } = renderHook(() => useBoardEdit(COMPANY_A, "founder"));
      act(() => result.current.startEdit());
      act(() => result.current.onBreakpointChange("md", 2));
      const before = result.current.lg;

      act(() => result.current.cycleWidgetSize("agents-now"));

      expect(result.current.lg).toEqual(before);
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
