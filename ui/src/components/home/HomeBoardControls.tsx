import { useEffect, useState } from "react";
import type { UseBoardEditResult } from "./useBoardEdit";
import { AddWidgetTray } from "./AddWidgetTray";
import { Button } from "../ui/button";

export interface HomeBoardControlsProps {
  boardEdit: UseBoardEditResult;
}

/**
 * The Home board's edit chrome (Task D3): the "Edit board"/"Done" toggle, a
 * Saving…/dirty/Retry status indicator, and — edit-mode + lg-breakpoint only
 * (Task D1) — "Add widget" (opens AddWidgetTray) and Reset. Lives in
 * Dashboard's pinned header, above the grid; `HomeBoard` itself only renders
 * the grid + per-tile remove buttons/keyboard handling.
 *
 * Purely presentational: every piece of state and every callback comes from
 * the single `boardEdit` bundle Dashboard computes via `useBoardEdit` and
 * shares with `<HomeBoard boardEdit={boardEdit}>` — there is exactly one
 * edit session/draft, never two independently-owned ones. This used to be a
 * block inline in HomeBoard (see git history) — extracted verbatim (same
 * markup/behavior) so the header and the grid can render in different parts
 * of the page while still driving the same state.
 */
export function HomeBoardControls({ boardEdit }: HomeBoardControlsProps) {
  const {
    lg,
    editing,
    dirty,
    isSaving,
    isResetting,
    saveError,
    activeBreakpoint,
    startEdit,
    exitEdit,
    retrySave,
    addWidget,
    resetBoard,
  } = boardEdit;
  const [trayOpen, setTrayOpen] = useState(false);

  // Task D1: Add widget/Reset are mutating edit affordances too — hidden
  // below the lg breakpoint even mid-edit-session, exactly like HomeBoard's
  // drag/resize/remove/keyboard gating (see HomeBoard's `editableNow`).
  const editableNow = editing && activeBreakpoint === "lg";

  // Never let a stale tray-open flag resurface later (e.g. after a company
  // switch discards the current edit session mid-tray, or the viewport
  // drops below lg and the Add-widget affordance disappears).
  useEffect(() => {
    if (!editableNow) setTrayOpen(false);
  }, [editableNow]);

  return (
    <div className="flex items-center gap-2">
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
      {editableNow && (
        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setTrayOpen((open) => !open)}
          >
            Add widget
          </Button>
          {trayOpen && (
            <div className="absolute right-0 top-full z-20 mt-1">
              <AddWidgetTray
                boardKeys={lg.map((item) => item.i)}
                onAdd={addWidget}
                onReset={resetBoard}
                resetting={isResetting}
              />
            </div>
          )}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isSaving || (!editing && activeBreakpoint !== "lg")}
        title={!editing && activeBreakpoint !== "lg" ? "Edit on a larger screen (1024px+)" : undefined}
        onClick={editing ? exitEdit : startEdit}
      >
        {editing ? "Done" : "Edit board"}
      </Button>
    </div>
  );
}
