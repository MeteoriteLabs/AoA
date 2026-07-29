import { collides } from "react-grid-layout";
import type { HomeBoardLayoutItem, UserRole } from "@armyofagents/shared";
import { HOME_BOARD_LG_COLS } from "@armyofagents/shared";
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
