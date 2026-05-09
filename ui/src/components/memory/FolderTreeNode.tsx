import { ChevronRight, ChevronDown, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FolderTreeNodeProps {
  label: string;
  icon?: string | LucideIcon;
  count?: number;
  depth: number;
  expanded: boolean;
  selected: boolean;
  hasChildren: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  tintClass?: string;
  /** Optional rightSlot rendered at the end of the row. Used for the kebab menu in 6.2b. */
  actions?: ReactNode;
  /** Optional native browser tooltip shown on hover (e.g. deep-nesting soft-warn). */
  tooltip?: string;
}

export function FolderTreeNode({
  label,
  icon,
  count,
  depth,
  expanded,
  selected,
  hasChildren,
  onToggleExpand,
  onSelect,
  tintClass,
  actions,
  tooltip,
}: FolderTreeNodeProps) {
  const indent = depth * 12 + 8;
  const Icon = typeof icon === "function" ? (icon as LucideIcon) : null;

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
      onClick={onSelect}
      title={tooltip}
      className={cn(
        "group flex items-center gap-1 py-1.5 pr-2 cursor-pointer text-xs leading-snug select-none",
        "relative",
        "hover:bg-muted/60 transition-colors duration-100",
        selected && "bg-brand/[0.08] text-[hsl(15_60%_75%)]",
        tintClass,
      )}
      style={{ paddingLeft: indent }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggleExpand();
        }}
        className="flex-shrink-0 inline-flex h-3.5 w-3.5 items-center justify-center text-muted-foreground"
        aria-label={hasChildren ? (expanded ? "Collapse" : "Expand") : undefined}
        tabIndex={hasChildren ? 0 : -1}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )
        ) : null}
      </button>
      <span className="flex-shrink-0 text-sm leading-none">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : (typeof icon === "string" ? icon : "📁")}
      </span>
      <span className="truncate flex-1">{label}</span>
      {count !== undefined && (
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {count}
        </span>
      )}
      {actions}
      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-[5px] rounded-full bg-brand shadow-[0_0_6px_rgba(184,45,28,0.55)]"
        />
      )}
    </div>
  );
}
