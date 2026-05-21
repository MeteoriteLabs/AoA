import { Pin } from "lucide-react";
import type { ConversationRow } from "../../api/internal-agent";
import { cn } from "../../lib/utils";
import { SessionOverflowMenu } from "./SessionOverflowMenu";

export interface SessionRowProps {
  conversation: ConversationRow;
  isActive: boolean;
  onSelect: () => void;
  onPin: (pinned: boolean) => void;
  onRename: (title: string) => void;
  onArchive: () => void;
  onDelete: () => void;
}

export function SessionRow({
  conversation,
  isActive,
  onSelect,
  onPin,
  onRename,
  onArchive,
  onDelete,
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

      {/* Hover-revealed overflow menu */}
      <SessionOverflowMenu
        conversation={conversation}
        onPin={onPin}
        onRename={onRename}
        onArchive={onArchive}
        onDelete={onDelete}
      />
    </div>
  );
}
