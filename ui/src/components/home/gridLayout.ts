import { collides, moveElement } from "react-grid-layout";
import type { LayoutItem } from "react-grid-layout";
import type { HomeBoardLayoutItem, UserRole } from "@armyofagents/shared";
import { HOME_BOARD_LG_COLS, HOME_BOARD_MAX_ROWS } from "@armyofagents/shared";
import { getDefaultLayout } from "./defaultLayout";
import { getWidget } from "./widgets/registry";
import type { WidgetKey, WidgetSize } from "./widgets/types";

/**
 * Pure layout helpers for the Home widget board (Task B3). These operate only
 * on plain data — no React, no RGL component — so they're unit-testable
 * without rendering anything (see __tests__/home/gridLayout.test.ts).
 *
 * Packing strategy: a single deterministic row-major "next-fit" shelf-packer
 * (packRowMajorNextFit) backs all three exports below. An item is placed on
 * the current row if it fits in the remaining column width; otherwise a new
 * row opens directly below the tallest item placed so far on the current
 * row. This guarantees `x + w <= cols` and zero overlaps by construction, and
 * is fully deterministic given (item order, sizes, cols) — intentionally not
 * delegating to react-grid-layout's own `verticalCompactor`, whose exact
 * item-by-item placement order isn't part of its documented public contract
 * (see RGL_V2_API.md); `collides` (a documented, stable primitive) IS reused
 * below for overlap detection.
 */

interface SizedItem {
  i: WidgetKey;
  w: number;
  h: number;
}

function packRowMajorNextFit(items: readonly SizedItem[], cols: number): HomeBoardLayoutItem[] {
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  const packed: HomeBoardLayoutItem[] = [];

  for (const item of items) {
    const w = Math.min(item.w, cols); // defensive: callers already clamp width to cols
    if (cursorX > 0 && cursorX + w > cols) {
      // Doesn't fit on the current row — open a new row (next-fit: never
      // revisit an earlier, already-closed row looking for gaps).
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }
    packed.push({ i: item.i, x: cursorX, y: cursorY, w, h: item.h });
    cursorX += w;
    rowHeight = Math.max(rowHeight, item.h);
  }
  return packed;
}

/**
 * Pick the allowed {w,h} entry nearest to `size` (squared-distance,
 * first-minimal wins). Exported for reuse by useBoardEdit's onResizeStop
 * snapping (Task C1) — the same "clamp to nearest allowed footprint" logic
 * used here for reconcile, so it isn't duplicated.
 */
export function nearestAllowedSize(size: WidgetSize, allowed: readonly WidgetSize[]): WidgetSize {
  let best: WidgetSize = allowed[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of allowed) {
    const distance = (candidate.w - size.w) ** 2 + (candidate.h - size.h) ** 2;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function hasOverlap(items: readonly HomeBoardLayoutItem[]): boolean {
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      if (collides(items[a]!, items[b]!)) return true;
    }
  }
  return false;
}

/**
 * Flow `getDefaultLayout(role)` keys into a 4-col grid at each widget's
 * registry `defaultSize`, via deterministic row-major next-fit packing.
 */
export function buildDefaultLg(role: UserRole | null): HomeBoardLayoutItem[] {
  const items = getDefaultLayout(role).map((key) => {
    const def = getWidget(key);
    // getDefaultLayout only ever returns registered keys (see
    // defaultLayout.test.ts), so def is always defined here.
    const size = def!.defaultSize;
    return { i: key, w: size.w, h: size.h };
  });
  return packRowMajorNextFit(items, HOME_BOARD_LG_COLS);
}

/**
 * Reconcile a saved lg array against the live registry:
 *  - DROP items whose `i` is not a currently-registered widget key (a
 *    retired widget).
 *  - CLAMP each `{w,h}` to the nearest entry in that widget's current
 *    `allowedSizes` (a widget's size options may have changed since save).
 *  - NEVER auto-add a widget missing from `saved` — saved membership is
 *    authoritative; newly-shipped widgets surface only via the add-widget
 *    tray (Task C2).
 * If a clamp introduces an overlap, the whole (already-dropped-and-clamped)
 * set is re-packed deterministically rather than left invalid.
 */
export function reconcileLg(saved: readonly HomeBoardLayoutItem[], role: UserRole | null): HomeBoardLayoutItem[] {
  const clamped: HomeBoardLayoutItem[] = [];
  for (const item of saved) {
    const def = getWidget(item.i);
    if (!def) continue; // retired/unknown widget key — drop defensively (design §11)
    const size = nearestAllowedSize({ w: item.w, h: item.h }, def.allowedSizes);
    clamped.push({ i: item.i, x: item.x, y: item.y, w: size.w, h: size.h });
  }

  if (!hasOverlap(clamped)) return clamped;

  // A clamp shrank/grew a footprint into a neighbor. Re-pack everything
  // deterministically: sort into reading order (top-to-bottom, left-to-
  // right) to stay as close to the user's saved arrangement as possible,
  // falling back to the role's canonical widget order only to break ties
  // (e.g. duplicate/corrupted saved positions) so the result never depends
  // on saved-array insertion order.
  const roleOrder = getDefaultLayout(role);
  const orderIndex = (key: WidgetKey) => {
    const idx = roleOrder.indexOf(key);
    return idx === -1 ? roleOrder.length : idx;
  };
  const ordered = [...clamped].sort(
    (a, b) => a.y - b.y || a.x - b.x || orderIndex(a.i) - orderIndex(b.i),
  );
  return packRowMajorNextFit(ordered, HOME_BOARD_LG_COLS);
}

/**
 * Derive a narrower breakpoint (md: cols=2, sm: cols=1) from the canonical lg
 * layout: clamp each item's width to the column count and re-flow with the
 * same deterministic packer, preserving lg order. md/sm are never persisted —
 * they're always a pure function of lg (Task D1).
 */
export function projectToBreakpoint(lg: readonly HomeBoardLayoutItem[], cols: number): HomeBoardLayoutItem[] {
  const items = lg.map((item) => ({ i: item.i, w: Math.min(item.w, cols), h: item.h }));
  return packRowMajorNextFit(items, cols);
}

function isWithinBounds(items: readonly HomeBoardLayoutItem[], cols: number): boolean {
  return items.every(
    (item) => item.x >= 0 && item.y >= 0 && item.x + item.w <= cols && item.y + item.h <= HOME_BOARD_MAX_ROWS,
  );
}

/**
 * Re-normalize react-grid-layout's LayoutItem shape back down to our clean
 * {i,x,y,w,h} — moveElement mutates internal bookkeeping fields onto items
 * it touches (notably `moved: true`), which must never leak into the draft:
 * it'd survive into the save payload and make layoutsEqual/toEqual
 * comparisons see phantom differences.
 */
function toHomeBoardLayoutItems(items: readonly LayoutItem[]): HomeBoardLayoutItem[] {
  return items.map((item) => ({
    i: item.i as WidgetKey,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
  }));
}

/**
 * Safety net shared by moveTileKeyboard/cycleTileSize: if RGL's moveElement
 * cascade ever left something invalid (shouldn't happen per its documented
 * collision handling, but a keyboard-driven mutation must never hand back a
 * broken draft), fall back to the same deterministic row-major packer used
 * everywhere else in this file rather than surfacing an inconsistent layout.
 */
function ensureValid(items: readonly HomeBoardLayoutItem[], cols: number): HomeBoardLayoutItem[] {
  if (isWithinBounds(items, cols) && !hasOverlap(items)) return items as HomeBoardLayoutItem[];
  return packRowMajorNextFit(items, cols);
}

/**
 * Keyboard-driven nudge (Task D2): move `key`'s tile by (dx, dy) grid cells.
 * Blocked (returns the SAME array reference, so callers can cheaply detect a
 * no-op) at grid bounds: x>=0, x+w<=cols, y>=0 (plus the HOME_BOARD_MAX_ROWS
 * sanity ceiling the server validator also enforces).
 *
 * On a valid move, a newly-colliding neighbor is cascaded out of the way via
 * react-grid-layout's own moveElement — collision-aware repositioning
 * WITHOUT a full-board vertical compact. This distinction matters: compact()
 * would silently undo a "move down" by pulling the tile straight back up to
 * fill the gap it just vacated, defeating the whole point of an explicit
 * keyboard nudge. moveElement mutates its inputs in place, so every item is
 * cloned first — the caller's arrays (which may be the SAME object
 * references as useBoardEdit's baseline snapshot) must never be mutated.
 */
export function moveTileKeyboard(
  lg: readonly HomeBoardLayoutItem[],
  key: WidgetKey,
  dx: number,
  dy: number,
  cols: number,
): HomeBoardLayoutItem[] {
  const current = lg.find((item) => item.i === key);
  if (!current) return lg as HomeBoardLayoutItem[];

  const nextX = current.x + dx;
  const nextY = current.y + dy;
  const inBounds = nextX >= 0 && nextX + current.w <= cols && nextY >= 0 && nextY + current.h <= HOME_BOARD_MAX_ROWS;
  if (!inBounds) return lg as HomeBoardLayoutItem[]; // blocked at bounds — no-op

  const cloned: LayoutItem[] = lg.map((item) => ({ ...item }));
  const target = cloned.find((item) => item.i === key)!;
  const result = moveElement(cloned, target, nextX, nextY, true, false, "vertical", cols);
  return ensureValid(toHomeBoardLayoutItems(result), cols);
}

/**
 * Keyboard-driven resize (Task D2): step `key`'s tile forward through its
 * `allowedSizes` (wrapping past the end back to the first), clamping x so
 * the new footprint stays in bounds, then cascading away any neighbor the
 * resize now overlaps (same moveElement approach as moveTileKeyboard, for
 * the same reason — no global compaction). Returns the SAME array reference
 * for a no-op (unknown key, or a single-entry allowedSizes with nothing to
 * cycle to).
 */
export function cycleTileSize(
  lg: readonly HomeBoardLayoutItem[],
  key: WidgetKey,
  allowedSizes: readonly WidgetSize[],
  cols: number,
): HomeBoardLayoutItem[] {
  if (allowedSizes.length === 0) return lg as HomeBoardLayoutItem[];
  const current = lg.find((item) => item.i === key);
  if (!current) return lg as HomeBoardLayoutItem[];

  const currentIndex = allowedSizes.findIndex((size) => size.w === current.w && size.h === current.h);
  const nextSize = allowedSizes[(currentIndex + 1) % allowedSizes.length]!;
  if (nextSize.w === current.w && nextSize.h === current.h) return lg as HomeBoardLayoutItem[]; // nothing to cycle to

  const cloned: LayoutItem[] = lg.map((item) => ({ ...item }));
  const target = cloned.find((item) => item.i === key)!;
  target.w = nextSize.w;
  target.h = nextSize.h;
  target.x = Math.max(0, Math.min(target.x, cols - nextSize.w));
  const result = moveElement(cloned, target, target.x, target.y, true, false, "vertical", cols);
  return ensureValid(toHomeBoardLayoutItems(result), cols);
}
