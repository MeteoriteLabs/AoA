import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HomeBoardLayoutItem, UserRole } from "@armyofagents/shared";
import { HOME_BOARD_LG_COLS } from "@armyofagents/shared";
import type { EventCallback, Layout, ResponsiveLayouts } from "react-grid-layout";
import { useHomeBoardLayout } from "../../hooks/useHomeBoardLayout";
import { buildDefaultLg, cycleTileSize, moveTileKeyboard, nearestAllowedSize, reconcileLg } from "./gridLayout";
import { getWidget } from "./widgets/registry";
import type { WidgetKey } from "./widgets/types";

/**
 * Value-equality for two lg arrays: same set of {i,x,y,w,h}, independent of
 * array order (RGL's own layout arrays aren't guaranteed to preserve our
 * insertion order). Exported for unit tests and reused as the core
 * "differs from baseline" gate throughout this hook.
 */
export function layoutsEqual(
  a: readonly HomeBoardLayoutItem[],
  b: readonly HomeBoardLayoutItem[],
): boolean {
  if (a.length !== b.length) return false;
  const byKey = new Map(b.map((item) => [item.i, item]));
  return a.every((itemA) => {
    const itemB = byKey.get(itemA.i);
    return (
      !!itemB &&
      itemA.x === itemB.x &&
      itemA.y === itemB.y &&
      itemA.w === itemB.w &&
      itemA.h === itemB.h
    );
  });
}

/** The lowest free row across a set of items — where a freshly-added widget lands before compaction pulls it into place. */
function bottomEdge(items: readonly HomeBoardLayoutItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
}

export interface UseBoardEditResult {
  /** The lg to render: the draft while editing, else the computed (saved-reconciled or role-default) layout. */
  lg: HomeBoardLayoutItem[];
  editing: boolean;
  /** True when the draft differs (by value) from the baseline snapshot taken at startEdit/resetBoard. */
  dirty: boolean;
  isSaving: boolean;
  isResetting: boolean;
  saveError: unknown;
  /**
   * The RGL breakpoint currently in effect ("lg" | "md" | "sm"). Task D1:
   * editing is enforced lg-only — callers (HomeBoard/HomeBoardControls) gate
   * every mutating edit affordance (drag, resize, remove, add, keyboard
   * move/resize, and starting edit mode at all) on `activeBreakpoint ===
   * "lg"`, since only the lg layout is canonical/persisted; md/sm are
   * always-derived projections (see gridLayout.ts projectToBreakpoint).
   */
  activeBreakpoint: string;
  /** Latest human-readable description of a keyboard move/resize (Task D2), for an aria-live region. Empty until the first keyboard operation this edit session. */
  announcement: string;
  startEdit: () => void;
  /** Flushes: saves the draft if dirty, otherwise just closes edit mode. No-op while a save is in flight. */
  exitEdit: () => void;
  /** Re-attempts the same save after a failure. */
  retrySave: () => void;
  removeWidget: (key: WidgetKey) => void;
  addWidget: (key: WidgetKey) => void;
  /** Deletes the persisted layout, falls back to the role default, and marks the draft clean (no re-save on exit). */
  resetBoard: () => void;
  onLayoutChange: (current: Layout, all: ResponsiveLayouts) => void;
  onBreakpointChange: (breakpoint: string, cols: number) => void;
  onResizeStop: EventCallback;
  /** Keyboard a11y (Task D2): nudge a focused tile by (dx,dy) grid cells. No-op unless editing at the lg breakpoint, or when blocked at bounds. */
  moveWidget: (key: WidgetKey, dx: number, dy: number) => void;
  /** Keyboard a11y (Task D2): step a focused tile forward through its allowedSizes (wrapping). No-op unless editing at the lg breakpoint. */
  cycleWidgetSize: (key: WidgetKey) => void;
}

/**
 * Owns Home board edit-mode state: whether we're editing, a DRAFT `lg`
 * layout separate from the persisted query, and the save-on-exit discipline
 * (Task C1). This is deliberately the ONLY place that composes
 * useHomeBoardLayout with the gridLayout reconcile/default helpers — HomeBoard
 * just consumes the result.
 *
 * The draft discipline (see plan Task C1 — encoded here exactly):
 *  1. startEdit() snapshots the current computed lg as BOTH the draft and a
 *     baseline.
 *  2. onLayoutChange is ignored unless editing && initialized &&
 *     activeBreakpoint==='lg', and only updates the draft when the new lg
 *     differs BY VALUE from the baseline — RGL fires onLayoutChange on
 *     mount/breakpoint-sync/StrictMode double-invoke, and those are not user
 *     edits. `initialized` specifically absorbs the first post-startEdit
 *     call (the mount/sync echo for this edit session) unconditionally,
 *     regardless of its value, then flips true for every call after.
 *  3. onResizeStop snaps the resized item's {w,h} to the nearest allowed
 *     footprint before committing to the draft.
 *  4. removeWidget drops an item from the draft.
 *  5. addWidget appends a widget at its defaultSize (RGL's own compactor
 *     places it once rendered).
 *  6. A background query refetch never overwrites a DIRTY draft — the query
 *     result (sourceLg) is only adopted (resyncing draft+baseline) while
 *     editing and NOT dirty, since there's nothing to lose in that case.
 *  7. exitEdit calls save(draft) immediately when dirty (not debounced).
 *     While a save is in flight, re-entry/exit/reset are no-ops. On failure,
 *     the draft + dirty state are kept and saveError is exposed with a
 *     retry. On success, editing clears and the draft resets to null (the
 *     persisted/query-derived lg takes back over). When NOT dirty, exit just
 *     closes edit mode without saving — this is what makes Reset (Task C2)
 *     safe: resetBoard marks the draft clean, so the exit that follows it
 *     does not re-upsert the layout it just asked the server to delete.
 *  8. The draft is scoped to companyId: if companyId changes while a draft
 *     exists, it's discarded unconditionally (editing/draft/baseline all
 *     reset) — a stale draft must never be saved against a new company.
 *  9. dirty = draft differs (by value) from the baseline.
 */
export function useBoardEdit(
  companyId: string | null | undefined,
  role: UserRole | null,
): UseBoardEditResult {
  const {
    layout: savedLayout,
    saveAsync,
    isSaving,
    reset: resetMutation,
    isResetting,
  } = useHomeBoardLayout(companyId);

  const sourceLg = useMemo(
    () => (savedLayout ? reconcileLg(savedLayout, role) : buildDefaultLg(role)),
    [savedLayout, role],
  );

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<HomeBoardLayoutItem[] | null>(null);
  const [activeBreakpoint, setActiveBreakpoint] = useState<string>("lg");
  const [initialized, setInitialized] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [announcement, setAnnouncement] = useState("");
  const baselineRef = useRef<HomeBoardLayoutItem[] | null>(null);

  const dirty =
    editing && draft !== null && baselineRef.current !== null
      ? !layoutsEqual(draft, baselineRef.current)
      : false;

  // Rule 8 — company scoping: discard the draft unconditionally when
  // companyId changes, so a stale draft can never be saved against the new
  // company (useHomeBoardLayout(companyId) itself has already switched to
  // querying/mutating the new company by this same render).
  const companyIdRef = useRef(companyId);
  useEffect(() => {
    if (companyIdRef.current === companyId) return;
    companyIdRef.current = companyId;
    setEditing(false);
    setDraft(null);
    baselineRef.current = null;
    setSaveError(null);
    setAnnouncement("");
  }, [companyId]);

  // Rule 6 — adopt a fresh source layout (e.g. a background refetch) only
  // when there's nothing to lose: editing but not dirty. A dirty draft is
  // never touched here. Gated on sourceLg's REFERENCE actually changing
  // (tracked via lastSourceLgRef) rather than merely "dirty is false right
  // now" — otherwise resetBoard's own optimistic draft (clean by
  // construction, but intentionally ahead of the still-stale sourceLg until
  // the delete's invalidation/refetch lands) would get immediately
  // overwritten back to the pre-reset value by this same effect.
  const lastSourceLgRef = useRef(sourceLg);
  useEffect(() => {
    if (lastSourceLgRef.current === sourceLg) return; // sourceLg didn't actually change
    lastSourceLgRef.current = sourceLg;
    if (!editing || dirty) return;
    setDraft(sourceLg);
    baselineRef.current = sourceLg;
  }, [editing, dirty, sourceLg]);

  const startEdit = useCallback(() => {
    if (isSaving) return; // rule 7 — no re-entry while a save is in flight
    setDraft(sourceLg);
    baselineRef.current = sourceLg;
    setInitialized(false);
    setSaveError(null);
    setAnnouncement("");
    setEditing(true);
  }, [isSaving, sourceLg]);

  const attemptSave = useCallback(() => {
    if (isSaving) return;
    if (!editing) return;
    if (!draft || !dirty) {
      // Nothing to persist — either there's no draft, or it matches the
      // baseline (including a baseline a just-completed Reset marked
      // clean). Exiting without saving here is what prevents the
      // delete-then-upsert race documented in Task C2.
      setEditing(false);
      setDraft(null);
      baselineRef.current = null;
      setSaveError(null);
      return;
    }
    saveAsync(draft)
      .then(() => {
        setEditing(false);
        setDraft(null);
        baselineRef.current = null;
        setSaveError(null);
      })
      .catch((err: unknown) => {
        setSaveError(err);
      });
  }, [dirty, draft, editing, isSaving, saveAsync]);

  const exitEdit = useCallback(() => attemptSave(), [attemptSave]);
  const retrySave = useCallback(() => attemptSave(), [attemptSave]);

  const removeWidget = useCallback(
    (key: WidgetKey) => {
      if (!editing) return;
      setDraft((prev) => (prev ?? []).filter((item) => item.i !== key));
    },
    [editing],
  );

  const addWidget = useCallback(
    (key: WidgetKey) => {
      if (!editing) return;
      setDraft((prev) => {
        const current = prev ?? [];
        if (current.some((item) => item.i === key)) return current; // already on the board
        const def = getWidget(key);
        if (!def) return current; // unknown key — defensive no-op
        return [
          ...current,
          { i: key, x: 0, y: bottomEdge(current), w: def.defaultSize.w, h: def.defaultSize.h },
        ];
      });
    },
    [editing],
  );

  const resetBoard = useCallback(() => {
    if (isSaving || isResetting) return;
    resetMutation();
    const next = buildDefaultLg(role);
    setDraft(next);
    baselineRef.current = next; // marks the draft clean — exit must not re-save
    setSaveError(null);
  }, [isResetting, isSaving, resetMutation, role]);

  const onBreakpointChange = useCallback((breakpoint: string) => {
    setActiveBreakpoint(breakpoint);
  }, []);

  const onLayoutChange = useCallback(
    (_current: Layout, all: ResponsiveLayouts) => {
      if (!editing || activeBreakpoint !== "lg") return;
      if (!initialized) {
        // The first onLayoutChange after startEdit is RGL's mount/breakpoint-
        // sync echo (or a StrictMode double-invoke) — never a user edit.
        // Absorb it unconditionally and start trusting the callback from the
        // next call on.
        setInitialized(true);
        return;
      }
      const baseline = baselineRef.current;
      if (!baseline) return;
      const newLg = (all.lg ?? []) as unknown as HomeBoardLayoutItem[];
      if (layoutsEqual(newLg, baseline)) return; // spurious echo — never dirty on a no-op
      setDraft(newLg);
    },
    [editing, activeBreakpoint, initialized],
  );

  const onResizeStop: EventCallback = useCallback(
    (layout, _oldItem, newItem) => {
      if (!editing || activeBreakpoint !== "lg") return;
      if (!newItem) return;
      const def = getWidget(newItem.i as WidgetKey);
      if (!def) return;
      const snapped = nearestAllowedSize({ w: newItem.w, h: newItem.h }, def.allowedSizes);
      const next: HomeBoardLayoutItem[] = layout.map((item) =>
        item.i === newItem.i
          ? { i: item.i as WidgetKey, x: item.x, y: item.y, w: snapped.w, h: snapped.h }
          : { i: item.i as WidgetKey, x: item.x, y: item.y, w: item.w, h: item.h },
      );
      setDraft(next);
    },
    [editing, activeBreakpoint],
  );

  // Task D2 — keyboard a11y. Both moveWidget/cycleWidgetSize are gated
  // exactly like every other mutating edit affordance: editing AND at the lg
  // breakpoint (Task D1 — edit is lg-only). Each delegates the actual
  // move/resize-with-collision-cascade math to gridLayout.ts (pure,
  // independently unit-tested) and only sets an announcement when something
  // actually changed — a move blocked at bounds stays silent rather than
  // announcing a no-op.
  const moveWidget = useCallback(
    (key: WidgetKey, dx: number, dy: number) => {
      if (!editing || activeBreakpoint !== "lg") return;
      setDraft((prev) => {
        const current = prev ?? [];
        const next = moveTileKeyboard(current, key, dx, dy, HOME_BOARD_LG_COLS);
        if (next === current) return current; // blocked at bounds — no-op, no announcement
        const def = getWidget(key);
        const moved = next.find((item) => item.i === key);
        if (def && moved) {
          setAnnouncement(`${def.title} moved to column ${moved.x + 1}, row ${moved.y + 1}`);
        }
        return next;
      });
    },
    [editing, activeBreakpoint],
  );

  const cycleWidgetSize = useCallback(
    (key: WidgetKey) => {
      if (!editing || activeBreakpoint !== "lg") return;
      const def = getWidget(key);
      if (!def) return;
      setDraft((prev) => {
        const current = prev ?? [];
        const next = cycleTileSize(current, key, def.allowedSizes, HOME_BOARD_LG_COLS);
        if (next === current) return current; // only one allowed size — no-op, no announcement
        const resized = next.find((item) => item.i === key);
        if (resized) {
          setAnnouncement(`${def.title} resized to ${resized.w} by ${resized.h}`);
        }
        return next;
      });
    },
    [editing, activeBreakpoint],
  );

  return {
    lg: editing && draft ? draft : sourceLg,
    editing,
    dirty,
    isSaving,
    isResetting,
    saveError,
    activeBreakpoint,
    announcement,
    startEdit,
    exitEdit,
    retrySave,
    removeWidget,
    addWidget,
    resetBoard,
    onLayoutChange,
    onBreakpointChange,
    onResizeStop,
    moveWidget,
    cycleWidgetSize,
  };
}
