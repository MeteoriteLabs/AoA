import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Network } from "lucide-react";
import { memoryApi } from "../../api/memory";
import { queryKeys } from "../../lib/queryKeys";
import { CompanyGraphCanvas } from "./graph/CompanyGraphCanvas";
import { LocalGraphPreview } from "./graph/LocalGraphPreview";
import { UsedByAgentsPanel } from "./graph/UsedByAgentsPanel";

interface MemoryGraphViewerProps {
  companyId: string;
  itemId?: string | null;
  onOpenMemoryItem?: (item: { id: string; title: string }) => void;
}

export function MemoryGraphViewer({
  companyId,
  itemId,
  onOpenMemoryItem,
}: MemoryGraphViewerProps) {
  const isItemGraph = Boolean(itemId);
  const companyGraphQuery = useQuery({
    queryKey: queryKeys.memory.companyGraph(companyId),
    queryFn: () => memoryApi.companyGraph(companyId, {
      includeStructural: true,
      limit: 100,
    }),
    enabled: Boolean(companyId && !isItemGraph),
  });
  const graphQuery = useQuery({
    queryKey: itemId
      ? queryKeys.memory.neighbors(companyId, itemId)
      : ["memory", companyId, "company-graph-shell"],
    queryFn: () => memoryApi.neighbors(companyId, itemId!, { depth: 1 }),
    enabled: Boolean(companyId && itemId),
  });
  const usageQuery = useQuery({
    queryKey: itemId
      ? queryKeys.memory.usage(companyId, itemId)
      : ["memory", companyId, "company-graph-usage-shell"],
    queryFn: () => memoryApi.usage(companyId, itemId!),
    enabled: Boolean(companyId && itemId),
  });

  if (!isItemGraph) {
    let graphContent: ReactNode;
    if (companyGraphQuery.isLoading) {
      graphContent = (
        <div className="flex min-h-[420px] items-center justify-center rounded-md border border-border bg-card/40 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading company graph
        </div>
      );
    } else if (companyGraphQuery.isError || !companyGraphQuery.data) {
      graphContent = (
        <div className="flex min-h-[420px] items-center justify-center rounded-md border border-border bg-card/40 text-sm text-muted-foreground">
          Could not load company graph.
        </div>
      );
    } else {
      graphContent = (
        <CompanyGraphCanvas
          graph={companyGraphQuery.data}
          onOpenMemoryItem={onOpenMemoryItem}
        />
      );
    }

    return (
      <div className="h-full flex flex-col">
        <div className="border-b border-border px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Network className="h-4 w-4" />
            Map
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-5">
          <div className="grid gap-3">
            {graphContent}
          </div>
        </div>
      </div>
    );
  }

  if (graphQuery.isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading graph
      </div>
    );
  }

  if (graphQuery.isError || !graphQuery.data) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Could not load graph.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-border px-5 py-3">
        <div className="text-sm font-semibold">{graphQuery.data.center.label}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          {graphQuery.data.nodes.length} nodes / {graphQuery.data.edges.length} edges
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-5">
        <div className="grid gap-4">
          <LocalGraphPreview
            graph={graphQuery.data}
            centerId={itemId!}
            onOpenMemoryItem={onOpenMemoryItem}
          />
          <UsedByAgentsPanel
            usage={usageQuery.data?.agents ?? []}
            isLoading={usageQuery.isLoading}
          />
        </div>
      </div>
    </div>
  );
}
