import { RotateCcw } from "lucide-react";
import { listWidgets } from "./widgets/registry";
import type { WidgetKey } from "./widgets/types";
import { Button } from "../ui/button";

export interface AddWidgetTrayProps {
  /** Widget keys currently on the board (the edit draft) — excluded from the offered list. */
  boardKeys: readonly WidgetKey[];
  /** Adds a widget at its registry defaultSize (the board's own compaction places it). */
  onAdd: (key: WidgetKey) => void;
  /** Deletes the persisted layout and falls back to the role default (marks the draft clean). */
  onReset: () => void;
  resetting?: boolean;
}

/**
 * The add-widget tray (Task C2): lists every team-visible registered widget
 * NOT already on the board, plus a Reset-to-default control. Purely
 * presentational — HomeBoard owns whether it's shown/hidden and wires
 * boardKeys/onAdd/onReset from useBoardEdit.
 */
export function AddWidgetTray({ boardKeys, onAdd, onReset, resetting }: AddWidgetTrayProps) {
  const onBoard = new Set(boardKeys);
  const available = listWidgets().filter((def) => !onBoard.has(def.key));

  return (
    <div
      role="menu"
      aria-label="Add widget"
      className="w-64 rounded-md border border-border bg-card p-2 shadow-md"
    >
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Add widget
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={resetting}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Reset
        </Button>
      </div>

      {available.length === 0 ? (
        <p className="px-2 py-3 text-sm text-muted-foreground">
          All widgets are already on your board.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {available.map((def) => {
            const Icon = def.icon;
            return (
              <li key={def.key}>
                <button
                  type="button"
                  onClick={() => onAdd(def.key)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text transition-colors hover:bg-accent/50"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span>{def.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
