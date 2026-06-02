import { useQuery } from "@tanstack/react-query";
import { Loader2, Network } from "lucide-react";
import { memoryApi } from "../../api/memory";
import { queryKeys } from "../../lib/queryKeys";

interface MemoryGraphViewerProps {
  companyId: string;
  itemId?: string | null;
}

export function MemoryGraphViewer({ companyId, itemId }: MemoryGraphViewerProps) {
  const isItemGraph = Boolean(itemId);
  const graphQuery = useQuery({
    queryKey: itemId
      ? queryKeys.memory.neighbors(companyId, itemId)
      : ["memory", companyId, "company-graph-shell"],
    queryFn: () => memoryApi.neighbors(companyId, itemId!, { depth: 1 }),
    enabled: Boolean(companyId && itemId),
  });

  if (!isItemGraph) {
    return (
      <div className="h-full flex flex-col">
        <div className="border-b border-border px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Network className="h-4 w-4" />
            Company graph
          </div>
        </div>
        <div className="flex-1 min-h-0 p-5">
          <div className="rounded-md border border-border bg-card p-4">
            <div className="text-sm font-medium">Graph workspace</div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Full company graph visualization is staged for the Sigma.js graph slice. Memory item tabs already show local backlinks from the graph API.
            </p>
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
          {graphQuery.data.nodes.length} nodes · {graphQuery.data.edges.length} edges
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-5">
        <div className="grid gap-3">
          {graphQuery.data.edges.map((edge) => {
            const from = graphQuery.data.nodes.find((node) => node.type === edge.from.type && node.id === edge.from.id);
            const to = graphQuery.data.nodes.find((node) => node.type === edge.to.type && node.id === edge.to.id);
            return (
              <div key={edge.id} className="rounded-md border border-border bg-card p-3">
                <div className="text-xs font-medium">{edge.kind}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {from?.label ?? edge.from.id} → {to?.label ?? edge.to.id}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
