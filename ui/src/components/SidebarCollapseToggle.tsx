import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarCollapseToggleProps {
  collapsed: boolean;
  onToggle: () => void;
  /**
   * Anchor — the LEFT offset where the button visually centers on the sidebar
   * border. Pass the current sidebar width; the button positions itself half
   * over (sidebarWidth - 13px) so it straddles the border between sidebar and
   * main content.
   */
  sidebarWidth: number;
  /**
   * Top offset — defaults to 15px so the button vertically centers in the
   * sidebar's 56px header row, aligned with the AoA. wordmark.
   */
  top?: number;
  className?: string;
}

export function SidebarCollapseToggle({
  collapsed,
  onToggle,
  sidebarWidth,
  top = 15,
  className,
}: SidebarCollapseToggleProps) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className={cn(
        "absolute z-10 inline-flex size-[26px] items-center justify-center rounded-md",
        "border border-border-strong bg-card-2 text-very-dim",
        "shadow-[0_2px_6px_rgba(0,0,0,0.4)]",
        "transition-[background,color,border-color,transform] duration-[120ms]",
        "hover:scale-105 hover:border-brand hover:bg-card hover:text-text",
        "focus-visible:outline-none focus-visible:border-brand focus-visible:ring-[3px] focus-visible:ring-brand-focus-ring",
        className,
      )}
      style={{ top, left: `calc(${sidebarWidth}px - 13px)` }}
    >
      <Icon className="size-3.5" />
    </button>
  );
}
