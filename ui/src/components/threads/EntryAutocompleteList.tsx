/**
 * EntryAutocompleteList — the @mention suggestion popover used by EntryComposer.
 *
 * The composer detects a trailing `@token` and renders this list with the
 * filtered suggestions (agents first, then users; capped at 8). Selection is
 * driven by keyboard (ArrowUp/Down + Enter, handled in the composer) or click.
 */
import { Bot, User as UserIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EntrySuggestion {
  id: string;
  name: string;
  type: "agent" | "user";
  /** Optional icon URL (agent.icon or user avatar). */
  icon?: string | null;
  /** Optional secondary text (e.g. email for users, role for agents). */
  subtitle?: string | null;
}

export interface EntryAutocompleteListProps {
  suggestions: EntrySuggestion[];
  selectionIndex: number;
  onSelect: (suggestion: EntrySuggestion) => void;
  onHover?: (index: number) => void;
}

export function EntryAutocompleteList({
  suggestions,
  selectionIndex,
  onSelect,
  onHover,
}: EntryAutocompleteListProps) {
  if (suggestions.length === 0) {
    return (
      <div
        className="absolute bottom-full left-0 mb-1 w-72 rounded-md border border-border bg-popover px-3 py-2 text-xs text-muted-foreground shadow-md"
        data-testid="entry-autocomplete-empty"
      >
        No matches
      </div>
    );
  }

  return (
    <ul
      className="absolute bottom-full left-0 mb-1 w-72 max-h-64 overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md"
      role="listbox"
      data-testid="entry-autocomplete"
    >
      {suggestions.map((s, i) => {
        const active = i === selectionIndex;
        return (
          <li
            key={`${s.type}-${s.id}`}
            role="option"
            aria-selected={active}
            // Use onMouseDown so the click fires before the input loses focus
            // (onClick would race with onBlur and we'd never get the selection).
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(s);
            }}
            onMouseEnter={() => onHover?.(i)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 cursor-pointer",
              active
                ? "bg-accent text-accent-foreground"
                : "text-foreground hover:bg-accent/60",
            )}
            data-testid={`entry-autocomplete-option-${s.name}`}
          >
            <span
              className={cn(
                "shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold",
                s.type === "agent"
                  ? "bg-violet-500/20 text-violet-300"
                  : "bg-slate-500/20 text-slate-300",
              )}
              aria-hidden="true"
            >
              {s.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.icon} alt="" className="w-5 h-5 rounded-full" />
              ) : s.type === "agent" ? (
                <Bot className="w-3 h-3" />
              ) : (
                <UserIcon className="w-3 h-3" />
              )}
            </span>
            <span className="flex-1 min-w-0 truncate font-medium">{s.name}</span>
            {s.subtitle && (
              <span className="shrink-0 text-[10px] text-muted-foreground/70 truncate max-w-[120px]">
                {s.subtitle}
              </span>
            )}
            <span
              className={cn(
                "shrink-0 text-[9px] uppercase tracking-wider font-semibold",
                s.type === "agent" ? "text-violet-400/70" : "text-slate-400/70",
              )}
            >
              {s.type === "agent" ? "Agent" : "User"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
