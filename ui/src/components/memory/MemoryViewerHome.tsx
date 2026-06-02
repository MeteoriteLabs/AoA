import { MemoryHomeDashboard } from "./MemoryHomeDashboard";
import type { MemoryTab } from "../../lib/memoryTabs";

interface MemoryViewerHomeProps {
  companyId: string;
  onOpenTab?: (tab: MemoryTab) => void;
}

export function MemoryViewerHome({ companyId, onOpenTab }: MemoryViewerHomeProps) {
  return (
    <div className="h-full min-h-0 overflow-auto" data-testid="memory-viewer-home">
      <MemoryHomeDashboard
        companyId={companyId}
        variant="viewer"
        showQuickJump
        onOpenTab={onOpenTab}
      />
      <section
        data-testid="memory-home-graph-slot"
        className="border-t border-border p-4"
      >
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Graph
        </div>
        <div className="mt-2 rounded-md border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
          Memory graph will appear here after relation and graph APIs are implemented.
        </div>
      </section>
    </div>
  );
}
