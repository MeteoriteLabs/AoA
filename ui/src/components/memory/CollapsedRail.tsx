import { PanelLeftOpen, PanelRightOpen } from "lucide-react";

interface CollapsedRailProps {
  onExpand: () => void;
  direction: "left" | "right"; // which way the chevron points (toward content)
}

/**
 * Vertical bar shown when a memory explorer pane (tree or viewer) is
 * collapsed. Clicking expands the pane back to its previous size.
 */
export function CollapsedRail({ onExpand, direction }: CollapsedRailProps) {
  // direction="right" means the rail sits on the LEFT of the screen
  // (it's the collapsed tree pane), so the icon is the "open left panel" affordance
  const Icon = direction === "right" ? PanelLeftOpen : PanelRightOpen;
  return (
    <button
      type="button"
      onClick={onExpand}
      className="h-full w-full flex items-start justify-center pt-3 hover:bg-accent/30 transition-colors group"
      aria-label="Expand pane"
    >
      <Icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
    </button>
  );
}
