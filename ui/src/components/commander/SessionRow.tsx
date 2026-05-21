import { Pin, MoreVertical } from "lucide-react";
import type { ConversationRow } from "../../api/internal-agent";
import { cn } from "../../lib/utils";

export interface SessionRowProps {
  conversation: ConversationRow;
  isActive: boolean;
  onSelect: () => void;
  onArchive: () => void;
  // TODO(Task 5): replace ⋮ archive shortcut with <SessionOverflowMenu/>
}

export function SessionRow({
  conversation,
  isActive,
  onSelect,
  onArchive,
}: SessionRowProps) {
  const title = conversation.title ?? "New chat";

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "group relative flex items-center gap-2 px-3 cursor-pointer transition-colors",
        "h-[var(--row-compact)]",
        // Base hover
        "hover:bg-hd",
        // Active: edge-to-edge bg + 1px top/bottom border — NO inset padding shift
        // so the indicator column stays at the same x-position as inactive rows.
        isActive
          ? "bg-[color:color-mix(in_srgb,var(--card-2)_80%,transparent)] border-y border-border"
          : "border-y border-transparent",
      )}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {/* Indicator: fixed 12px box so pin and circle baselines align (Design C) */}
      <div className="w-3 h-3 flex items-center justify-center shrink-0">
        {conversation.pinned ? (
          <Pin className="h-3 w-3 text-very-dim" />
        ) : isActive ? (
          /* Active: filled 9px brand dot */
          <span className="h-[9px] w-[9px] rounded-full bg-brand block" />
        ) : (
          /* Inactive: 9px outline dot */
          <span className="h-[9px] w-[9px] rounded-full border-[1.5px] border-[color:var(--very-dim)] block" />
        )}
      </div>

      {/* Title */}
      <span className="flex-1 min-w-0 truncate text-sm text-dim">
        {title}
      </span>

      {/* Hover-revealed ⋮ overflow button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onArchive();
        }}
        className="hidden group-hover:flex items-center justify-center p-0.5 rounded hover:bg-black/10 transition-colors shrink-0"
        title="More options"
      >
        <MoreVertical className="h-3.5 w-3.5 text-dim" />
      </button>
    </div>
  );
}
