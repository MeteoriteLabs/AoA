import { X } from "lucide-react";
import { Responsive, useContainerWidth, verticalCompactor } from "react-grid-layout";
import type { UserRole } from "@armyofagents/shared";
import { getWidget } from "./widgets/registry";
import { WidgetErrorBoundary } from "./WidgetErrorBoundary";
import { useBoardEdit } from "./useBoardEdit";
import { projectToBreakpoint } from "./gridLayout";
import { Button } from "../ui/button";

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

/**
 * The Home widget board: a react-grid-layout tile grid with an edit mode
 * (Task C1). The canonical desktop (lg) layout is either the user's saved
 * layout (reconciled against the live registry) or the role default while
 * read-only; while editing it's the draft owned by useBoardEdit. md/sm are
 * always *derived* from lg at render, never persisted (Task D1).
 *
 * The "Edit board"/"Done" toggle here is TEMPORARY — Task D3 relocates it
 * (plus Add widget/Reset/dirty state) into the pinned page header. It's kept
 * here for now purely so edit mode is reachable and testable.
 */
export function HomeBoard({ companyId, role }: { companyId: string; role: UserRole | null }) {
  const {
    lg,
    editing,
    dirty,
    isSaving,
    saveError,
    startEdit,
    exitEdit,
    retrySave,
    removeWidget,
    onLayoutChange,
    onBreakpointChange,
    onResizeStop,
  } = useBoardEdit(companyId, role);
  const { width, mounted, containerRef } = useContainerWidth();

  const layouts = {
    lg,
    md: projectToBreakpoint(lg, COLS.md),
    sm: projectToBreakpoint(lg, COLS.sm),
  };

  return (
    <div>
      {/* TEMPORARY edit controls — Task D3 moves these into the pinned header. */}
      <div className="mb-2 flex items-center justify-end gap-2">
        {editing && saveError != null && (
          <span className="text-sm text-destructive">
            Couldn't save your changes.{" "}
            <button type="button" onClick={retrySave} className="underline">
              Retry
            </button>
          </span>
        )}
        {editing && saveError == null && isSaving && (
          <span className="text-sm text-muted-foreground">Saving…</span>
        )}
        {editing && saveError == null && !isSaving && dirty && (
          <span className="text-sm text-muted-foreground">Unsaved changes</span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isSaving}
          onClick={editing ? exitEdit : startEdit}
        >
          {editing ? "Done" : "Edit board"}
        </Button>
      </div>

      <div ref={containerRef}>
        {mounted && (
          <Responsive
            width={width}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            layouts={layouts}
            rowHeight={104}
            margin={[12, 12]}
            compactor={verticalCompactor}
            dragConfig={{ enabled: editing, cancel: REMOVE_BUTTON_CANCEL_SELECTOR }}
            resizeConfig={{ enabled: editing }}
            onLayoutChange={onLayoutChange}
            onBreakpointChange={onBreakpointChange}
            onResizeStop={onResizeStop}
          >
            {lg.map((item) => {
              const def = getWidget(item.i);
              if (!def) return null; // unknown key — skip defensively (design §11)
              const Widget = def.Component;
              return (
                <div key={item.i} className="relative h-full w-full">
                  {editing && (
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
