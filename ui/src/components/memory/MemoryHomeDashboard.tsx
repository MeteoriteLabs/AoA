import { Search } from "lucide-react";
import { PendingReviewBanner } from "./PendingReviewBanner";
import { LayerTilesPanel } from "./LayerTilesPanel";
import { MemoryRecentsStrip } from "./MemoryRecentsStrip";

interface MemoryHomeDashboardProps {
  companyId: string;
}

/**
 * The Memory Home view, embedded in the explorer's center pane when the
 * synthetic 🏠 Home node is selected in the tree. Per spec §6:
 * - pending banner (self-hides at 0)
 * - quick-jump button (opens MemoryQuickSwitcher via custom event)
 * - layer tiles (4)
 * - recents strip (last 14d)
 *
 * The right pane (handled by MemoryExplorer) shows the future graph viz
 * placeholder when this dashboard is rendered.
 */
export function MemoryHomeDashboard({ companyId }: MemoryHomeDashboardProps) {
  return (
    <div className="h-full overflow-auto">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <PendingReviewBanner companyId={companyId} />

        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("memory:open-quick-switcher"))
          }
          aria-haspopup="dialog"
          className="w-full flex items-center gap-2 pl-9 pr-3 h-10 rounded-md border border-input bg-background text-sm text-muted-foreground text-left hover:bg-accent/30 transition-colors relative"
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          Quick-jump to a memory item or file…
        </button>

        <LayerTilesPanel companyId={companyId} />

        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">
            Recent
          </div>
          <MemoryRecentsStrip companyId={companyId} />
        </div>
      </div>
    </div>
  );
}
