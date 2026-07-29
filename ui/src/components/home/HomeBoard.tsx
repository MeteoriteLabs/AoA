import { X } from "lucide-react";
import { Responsive, useContainerWidth, verticalCompactor } from "react-grid-layout";
import type { UserRole } from "@armyofagents/shared";
import { getWidget } from "./widgets/registry";
import { WidgetErrorBoundary } from "./WidgetErrorBoundary";
import type { UseBoardEditResult } from "./useBoardEdit";
import { projectToBreakpoint } from "./gridLayout";

// Native v2 RGL API (see RGL_V2_API.md) — breakpoints/cols are fixed, not
// props, since Home's board only ever has 3 tiers (lg/md/sm) and doesn't
// need to be configurable per caller.
const BREAKPOINTS = { lg: 1024, md: 640, sm: 0 };
const COLS = { lg: 4, md: 2, sm: 1 };

// CSS selector passed to dragConfig.cancel so a click on the remove button
// never gets swallowed as a drag-start by react-draggable's DraggableCore
// (which otherwise treats mousedown anywhere on the tile, other than the
// resize handle, as a potential drag).
const REMOVE_BUTTON_CANCEL_SELECTOR = ".home-board-tile-remove";

// Task D2 — keyboard a11y: arrow key -> (dx,dy) grid-cell nudge. Shift+Arrow
// (any direction) instead cycles the tile's size — direction is irrelevant
// there, it just needs to be a documented modifier+key combo.
const ARROW_KEY_DELTAS: Record<string, readonly [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

/**
 * The Home widget board: a react-grid-layout tile grid with an edit mode
 * (Task C1). The canonical desktop (lg) layout is either the user's saved
 * layout (reconciled against the live registry) or the role default while
 * read-only; while editing it's the draft owned by useBoardEdit. md/sm are
 * always *derived* from lg at render, never persisted (Task D1).
 *
 * Task D3: the `useBoardEdit` hook is owned by the caller (Dashboard), not
 * by this component — the pinned page header (HomeBoardControls) needs the
 * SAME edit session (draft/dirty/save state) to render its Edit board/Done/
 * Add widget/Reset controls, so Dashboard computes one `boardEdit` and
 * shares it with both HomeBoardControls (header) and this component (grid)
 * as a plain prop. HomeBoard itself only renders the grid, the per-tile
 * remove `×` button, and keyboard move/resize handling (Task D2) — none of
 * which need to live in the header.
 */
export function HomeBoard({
  companyId,
  role,
  boardEdit,
}: {
  companyId: string;
  role: UserRole | null;
  boardEdit: UseBoardEditResult;
}) {
  const {
    lg,
    editing,
    activeBreakpoint,
    announcement,
    removeWidget,
    onLayoutChange,
    onBreakpointChange,
    onResizeStop,
    moveWidget,
    cycleWidgetSize,
  } = boardEdit;
  const { width, mounted, containerRef } = useContainerWidth();

  // Task D1: editing is enforced lg-only (the persisted layout is the
  // canonical desktop lg array — md/sm are always-derived projections, never
  // edited). `editing` alone isn't enough to gate drag/resize/remove/
  // keyboard: if the viewport shrinks below 1024px mid-edit-session
  // (activeBreakpoint flips away from "lg"), every mutating affordance
  // freezes until it's back at lg — the user can still hit "Done" to
  // exit/save (see HomeBoardControls), they just can't keep
  // dragging/resizing/adding/nudging below desktop width.
  const editableNow = editing && activeBreakpoint === "lg";

  const layouts = {
    lg,
    md: projectToBreakpoint(lg, COLS.md),
    sm: projectToBreakpoint(lg, COLS.sm),
  };

  return (
    // Plan 4 Task 4 (a11y sweep): a labeled landmark so assistive tech can
    // name/jump to the widget grid as a whole, independent of the per-tile
    // labels below.
    <div role="region" aria-label="Home widget board">
      {/* Task D2 keyboard a11y: announces each keyboard move/resize. Always
          mounted (not conditionally rendered) so screen readers are already
          watching it before the first announcement ever lands. */}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

      <div ref={containerRef}>
        {mounted && lg.length === 0 && (
          // Plan 4 Task 6: every widget removed (in edit mode, or a saved
          // empty layout on a later visit) — a plain, centered nudge rather
          // than blank space. Points at whichever affordance is currently
          // reachable: "Add widget" while editing at lg, "Edit board"
          // otherwise (mirrors HomeBoardControls' own editableNow gating).
          <div className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border p-12 text-center">
            <p className="text-sm font-medium">Your board is empty</p>
            <p className="text-sm text-muted-foreground">
              {editableNow ? "Use Add widget above to add one." : "Click Edit board above to add a widget."}
            </p>
          </div>
        )}
        {mounted && lg.length > 0 && (
          <Responsive
            width={width}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            layouts={layouts}
            rowHeight={104}
            margin={[12, 12]}
            compactor={verticalCompactor}
            dragConfig={{ enabled: editableNow, cancel: REMOVE_BUTTON_CANCEL_SELECTOR }}
            resizeConfig={{ enabled: editableNow }}
            onLayoutChange={onLayoutChange}
            onBreakpointChange={onBreakpointChange}
            onResizeStop={onResizeStop}
          >
            {lg.map((item) => {
              const def = getWidget(item.i);
              if (!def) return null; // unknown key — skip defensively (design §11)
              const Widget = def.Component;
              // Included in the accessible name so an assistive-tech user
              // gets the current position/size just from focusing the tile,
              // in addition to the aria-live announcement on each change.
              const tileLabel = `${def.title} tile, column ${item.x + 1}, row ${item.y + 1}, size ${item.w} by ${item.h}`;
              return (
                <div
                  key={item.i}
                  className="relative h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus-ring"
                  tabIndex={editableNow ? 0 : undefined}
                  role={editableNow ? "group" : undefined}
                  aria-label={editableNow ? tileLabel : undefined}
                  onKeyDown={
                    editableNow
                      ? (event) => {
                          const delta = ARROW_KEY_DELTAS[event.key];
                          if (!delta) return;
                          // Also prevents arrow keys from scrolling the page
                          // out from under a focused tile.
                          event.preventDefault();
                          if (event.shiftKey) {
                            cycleWidgetSize(item.i);
                          } else {
                            moveWidget(item.i, delta[0], delta[1]);
                          }
                        }
                      : undefined
                  }
                >
                  {editableNow && (
                    <button
                      type="button"
                      onClick={() => removeWidget(item.i)}
                      aria-label={`Remove ${def.title}`}
                      className="home-board-tile-remove absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                  {/* Key includes companyId so a switch remounts the boundary — a
                      widget that errored for one company recovers when you change
                      companies. */}
                  <WidgetErrorBoundary key={`${item.i}-${companyId}`}>
                    <Widget companyId={companyId} role={role} editing={editing} size={{ w: item.w, h: item.h }} />
                  </WidgetErrorBoundary>
                </div>
              );
            })}
          </Responsive>
        )}
      </div>
    </div>
  );
}
