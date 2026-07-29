import { Plus, RotateCcw } from "lucide-react";
import type { UserRole } from "@armyofagents/shared";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Button } from "../ui/button";
import { AddWidgetMenu } from "./AddWidgetMenu";
import type { UseBoardEditResult } from "./useBoardEdit";

export interface ArrangeToolbarProps {
  boardEdit: UseBoardEditResult;
  role: UserRole | null;
}

/**
 * The floating arrange-mode toolbar (Plan 7 Task 3): a fixed, bottom-center
 * pill that replaces the old inline header morph (the "Customize board"
 * button turning into "Done") with a dedicated surface for every arrange-mode
 * affordance — Add widget, Reset, the Saving…/Unsaved/Retry status, and Done.
 * The pinned header (`HomeBoardControls`) now shows only the customize icon
 * — inert while arranging — so the header never reflows/shifts the Create
 * button next to it (the founder complaint Plan 7 responds to).
 *
 * Mounted by `HomeBoard`, gated on its own `editableNow` (editing &&
 * activeBreakpoint==="lg" && !isSaving) — the exact same gate that already
 * freezes drag/resize/remove on the grid tiles, so this floating toolbar
 * unmounts in lockstep with them on company-switch / drop-below-lg /
 * isSaving. See HomeBoard's own comment on that gate for the full rationale
 * (in particular: this means the toolbar — Done included — briefly
 * disappears during the in-flight-save window, same as the tiles'
 * affordances; a failed save re-mounts it with the error + Retry).
 *
 * `position: fixed` + a bottom offset keeps it clear of the board's last row.
 */
export function ArrangeToolbar({ boardEdit, role }: ArrangeToolbarProps) {
  const { lg, dirty, isSaving, isResetting, saveError, resetError, exitEdit, retrySave, addWidget, resetBoard } =
    boardEdit;

  return (
    <div
      role="toolbar"
      aria-label="Arrange board"
      className="fixed inset-x-0 bottom-6 z-30 mx-auto flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center justify-center gap-2 rounded-full border border-border bg-card px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.4),0_16px_36px_rgba(0,0,0,0.3)]"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add widget
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label="Add widget" side="top" align="center">
          <AddWidgetMenu boardKeys={lg.map((item) => item.i)} role={role} onAdd={addWidget} />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Reset is reachable directly here with no confirm — unlike the
          customize dropdown's view-mode "Reset to default" (which DOES
          confirm; see HomeBoardControls), this button is only reachable
          while already mid-arrange, matching the retired AddWidgetTray's own
          unconfirmed Reset row. */}
      <Button type="button" variant="outline" size="sm" onClick={resetBoard} disabled={isResetting}>
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        Reset
      </Button>

      {saveError != null && (
        <span className="text-sm text-destructive">
          Couldn't save your changes.{" "}
          <button type="button" onClick={retrySave} className="underline">
            Retry
          </button>
        </span>
      )}
      {saveError == null && resetError != null && (
        <span className="text-sm text-destructive">
          Couldn't reset your board.{" "}
          <button type="button" onClick={resetBoard} className="underline">
            Retry
          </button>
        </span>
      )}
      {saveError == null && resetError == null && isSaving && (
        <span className="text-sm text-muted-foreground">Saving…</span>
      )}
      {saveError == null && resetError == null && !isSaving && dirty && (
        <span className="text-sm text-muted-foreground">Unsaved changes</span>
      )}

      <Button type="button" size="sm" disabled={isSaving} onClick={exitEdit}>
        Done
      </Button>
    </div>
  );
}
