import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import { ExternalLink, Network } from "lucide-react";
import type {
  CompanyBrainEdge,
  CompanyBrainNode,
  CompanyBrainOverviewResponse,
} from "@armyofagents/shared";
import { Button } from "@/components/ui/button";

interface CompanyGraphCanvasProps {
  graph: CompanyBrainOverviewResponse;
  onOpenMemoryItem?: (item: { id: string; title: string }) => void;
}

interface ConnectedEdge {
  edge: CompanyBrainEdge;
  other: CompanyBrainNode;
}

function nodeKey(node: Pick<CompanyBrainNode, "type" | "id">): string {
  return `${node.type}:${node.id}`;
}

function nodeColor(type: CompanyBrainNode["type"]): string {
  switch (type) {
    case "memory_item":
      return "#38bdf8";
    case "department":
    case "project":
      return "#a78bfa";
    case "goal":
      return "#34d399";
    case "task":
      return "#fbbf24";
    case "agent":
      return "#f472b6";
    case "artifact":
      return "#fb7185";
    default:
      return "#94a3b8";
  }
}

function nodeSize(type: CompanyBrainNode["type"]): number {
  return type === "memory_item" ? 10 : 7;
}

function nodeTypeLabel(type: string): string {
  return type.replace(/_/g, " ");
}

function buildSigmaGraph(response: CompanyBrainOverviewResponse) {
  const next = new Graph();
  const total = Math.max(response.nodes.length, 1);
  response.nodes.forEach((node, index) => {
    const angle = (index / total) * Math.PI * 2;
    const radius = 1 + Math.sqrt(total) * 0.18;
    next.addNode(nodeKey(node), {
      label: node.label,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      size: nodeSize(node.type),
      color: nodeColor(node.type),
      nodeType: node.type,
      memoryId: node.type === "memory_item" ? node.id : null,
    });
  });

  for (const edge of response.edges) {
    const from = nodeKey(edge.from);
    const to = nodeKey(edge.to);
    if (!next.hasNode(from) || !next.hasNode(to) || next.hasEdge(edge.id)) continue;
    next.addDirectedEdgeWithKey(edge.id, from, to, {
      label: edge.kind,
      size: edge.sourceClass === "semantic" ? 2.2 : 1,
      color: edge.sourceClass === "semantic" ? "#e5e7eb" : "#64748b",
      edgeKind: edge.kind,
      sourceClass: edge.sourceClass,
    });
  }

  return next;
}

function connectedEdges(
  graph: CompanyBrainOverviewResponse,
  selectedKey: string,
): ConnectedEdge[] {
  const nodes = new Map(graph.nodes.map((node) => [nodeKey(node), node]));
  return graph.edges.flatMap((edge) => {
    const fromKey = nodeKey(edge.from);
    const toKey = nodeKey(edge.to);
    if (fromKey !== selectedKey && toKey !== selectedKey) return [];
    const other = nodes.get(fromKey === selectedKey ? toKey : fromKey);
    return other ? [{ edge, other }] : [];
  });
}

export function CompanyGraphCanvas({
  graph,
  onOpenMemoryItem,
}: CompanyGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(
    () => graph.nodes[0] ? nodeKey(graph.nodes[0]) : null,
  );

  const nodesByKey = useMemo(
    () => new Map(graph.nodes.map((node) => [nodeKey(node), node])),
    [graph.nodes],
  );
  const selectedNode =
    (selectedKey ? nodesByKey.get(selectedKey) : null) ?? graph.nodes[0] ?? null;
  const selectedNodeKey = selectedNode ? nodeKey(selectedNode) : null;
  const selectedRelations = selectedNodeKey
    ? connectedEdges(graph, selectedNodeKey)
    : [];

  useEffect(() => {
    if (!containerRef.current || graph.nodes.length === 0) return;

    const sigmaGraph = buildSigmaGraph(graph);
    const renderer = new Sigma(sigmaGraph, containerRef.current);
    renderer.on("clickNode", (event: { node: string }) => {
      setSelectedKey(event.node);
    });

    return () => {
      renderer.kill();
    };
  }, [graph]);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-md border border-dashed border-border bg-card/40 p-6 text-center">
        <div>
          <Network className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
          <div className="mt-3 text-sm font-medium">No visible graph relationships yet</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Approved memory links will appear here once the company brain has graph edges.
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="grid min-h-[420px] grid-cols-[minmax(0,1fr)_260px] overflow-hidden rounded-md border border-border bg-card">
      <div className="relative min-h-[420px] bg-background">
        <div ref={containerRef} className="absolute inset-0" data-testid="company-graph-sigma-canvas" />
        <div className="absolute left-3 top-3 rounded-md border border-border bg-card/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
          {graph.nodes.length} nodes / {graph.edges.length} edges
          {graph.truncated ? ` / limited to ${graph.limit}` : ""}
        </div>
      </div>

      <aside className="flex min-h-0 flex-col border-l border-border bg-card">
        <div className="border-b border-border px-3 py-2">
          <div className="text-xs font-semibold">Graph details</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {graph.nodes.length} nodes / {graph.edges.length} edges
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="grid gap-1.5">
            {graph.nodes.map((node) => {
              const key = nodeKey(node);
              const selected = selectedNodeKey === key;
              return (
                <div
                  key={key}
                  className={selected
                    ? "rounded-md border border-primary/50 bg-primary/10"
                    : "rounded-md border border-border bg-background"}
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-2 py-2 text-left"
                    aria-label={`Select ${node.label}`}
                    onClick={() => setSelectedKey(key)}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: nodeColor(node.type) }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{node.label}</span>
                      <span className="block text-[11px] capitalize text-muted-foreground">
                        {nodeTypeLabel(node.type)}
                      </span>
                    </span>
                  </button>
                  {node.type === "memory_item" && onOpenMemoryItem && (
                    <div className="border-t border-border/70 px-2 pb-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-full justify-start gap-1 px-1 text-xs"
                        aria-label={`Open ${node.label}`}
                        onClick={() => onOpenMemoryItem({ id: node.id, title: node.label })}
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden />
                        Open
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {selectedNode && (
          <div className="border-t border-border p-3" data-testid="company-graph-selected-node">
            <div className="text-xs font-semibold">{selectedNode.label}</div>
            <div className="mt-0.5 text-[11px] capitalize text-muted-foreground">
              {nodeTypeLabel(selectedNode.type)}
            </div>
            <div className="mt-3 grid gap-1.5">
              {selectedRelations.length === 0 ? (
                <div className="text-[11px] text-muted-foreground">No visible relations</div>
              ) : (
                selectedRelations.map(({ edge, other }) => (
                  <div
                    key={edge.id}
                    className="rounded-md border border-border bg-background px-2 py-1.5 text-[11px]"
                  >
                    {edge.kind} {other.label}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </aside>
    </section>
  );
}
