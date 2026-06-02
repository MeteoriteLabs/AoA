import { useMemo } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  hierarchy,
  pack,
} from "d3";
import type {
  CompanyBrainNode,
  CompanyBrainOverviewResponse,
} from "@armyofagents/shared";
import { graphNodeColor } from "./graphTheme";

interface CompanyGraphD3ViewProps {
  graph: CompanyBrainOverviewResponse;
}

interface LayoutNode {
  key: string;
  label: string;
  type: CompanyBrainNode["type"];
  x?: number;
  y?: number;
}

interface LayoutLink {
  source: string | LayoutNode;
  target: string | LayoutNode;
}

interface ClusterDatum {
  name: string;
  type?: CompanyBrainNode["type"];
  node?: CompanyBrainNode;
  children?: ClusterDatum[];
}

const WIDTH = 720;
const HEIGHT = 420;

function nodeKey(node: Pick<CompanyBrainNode, "type" | "id">): string {
  return `${node.type}:${node.id}`;
}

function nodeTypeLabel(type: string): string {
  return type.replace(/_/g, " ");
}

function coordinates(node: LayoutNode, index: number, total: number) {
  if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
    return { x: node.x as number, y: node.y as number };
  }
  const angle = (index / Math.max(total, 1)) * Math.PI * 2;
  return {
    x: WIDTH / 2 + Math.cos(angle) * 120,
    y: HEIGHT / 2 + Math.sin(angle) * 120,
  };
}

export function CompanyGraphNetworkView({ graph }: CompanyGraphD3ViewProps) {
  const layout = useMemo(() => {
    const nodes: LayoutNode[] = graph.nodes.map((node) => ({
      key: nodeKey(node),
      label: node.label,
      type: node.type,
    }));
    const links: LayoutLink[] = graph.edges.map((edge) => ({
      source: nodeKey(edge.from),
      target: nodeKey(edge.to),
    }));

    const simulation = forceSimulation<LayoutNode>(nodes)
      .force("link", forceLink<LayoutNode, LayoutLink>(links).id((node) => node.key).distance(90))
      .force("charge", forceManyBody().strength(-180))
      .force("collide", forceCollide<LayoutNode>().radius(24))
      .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
      .stop();

    for (let i = 0; i < 120; i += 1) simulation.tick();
    simulation.stop();

    return { nodes, links };
  }, [graph]);

  const nodesByKey = new Map(layout.nodes.map((node) => [node.key, node]));

  return (
    <section
      className="h-full min-h-0 overflow-hidden rounded-md border border-border bg-card text-text"
      data-testid="company-graph-network-view"
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Network graph view"
        preserveAspectRatio="xMidYMid meet"
        className="h-full min-h-0 w-full bg-background text-text"
      >
        {layout.links.map((link, index) => {
          const sourceKey = typeof link.source === "string" ? link.source : link.source.key;
          const targetKey = typeof link.target === "string" ? link.target : link.target.key;
          const source = nodesByKey.get(sourceKey);
          const target = nodesByKey.get(targetKey);
          if (!source || !target) return null;
          const s = coordinates(source, index, layout.nodes.length);
          const t = coordinates(target, index + 1, layout.nodes.length);
          return (
            <line
              key={`${sourceKey}-${targetKey}-${index}`}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke="var(--border-strong, #3a3a3a)"
              strokeWidth="1.2"
              opacity="0.7"
            />
          );
        })}
        {layout.nodes.map((node, index) => {
          const point = coordinates(node, index, layout.nodes.length);
          return (
            <g key={node.key} transform={`translate(${point.x} ${point.y})`}>
              <circle r={node.type === "memory_item" ? 10 : 8} fill={graphNodeColor(node.type)} />
              <text
                x="14"
                y="4"
                fill="currentColor"
                className="text-[11px]"
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

export function CompanyGraphClusterView({ graph }: CompanyGraphD3ViewProps) {
  const circles = useMemo(() => {
    const groups = new Map<CompanyBrainNode["type"], CompanyBrainNode[]>();
    for (const node of graph.nodes) {
      groups.set(node.type, [...(groups.get(node.type) ?? []), node]);
    }

    const data: ClusterDatum = {
      name: "Company map",
      children: Array.from(groups.entries()).map(([type, nodes]) => ({
        name: nodeTypeLabel(type),
        type,
        children: nodes.map((node) => ({
          name: node.label,
          type: node.type,
          node,
        })),
      })),
    };

    const root = pack<ClusterDatum>()
      .size([WIDTH, HEIGHT])
      .padding(10)(
        hierarchy(data)
          .sum((datum) => (datum.node ? 1 : 0.25))
          .sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
      );

    return root.descendants();
  }, [graph]);

  return (
    <section
      className="h-full min-h-0 overflow-hidden rounded-md border border-border bg-card text-text"
      data-testid="company-graph-cluster-view"
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Cluster graph view"
        preserveAspectRatio="xMidYMid meet"
        className="h-full min-h-0 w-full bg-background text-text"
      >
        {circles.slice(1).map((circle) => {
          const isLeaf = Boolean(circle.data.node);
          const color = graphNodeColor(circle.data.type ?? "memory_item");
          return (
            <g key={`${circle.data.name}-${circle.x}-${circle.y}`} transform={`translate(${circle.x} ${circle.y})`}>
              <circle
                r={circle.r}
                fill={isLeaf ? color : `color-mix(in srgb, ${color} 14%, transparent)`}
                stroke={isLeaf ? "transparent" : `color-mix(in srgb, ${color} 55%, transparent)`}
                strokeWidth={isLeaf ? 0 : 1.2}
              />
              {(isLeaf || circle.r > 34) && (
                <text
                  textAnchor="middle"
                  y={isLeaf ? 3 : -circle.r + 18}
                  fill="currentColor"
                  className={isLeaf ? "text-[9px]" : "text-[11px] font-medium"}
                >
                  {circle.data.name.slice(0, isLeaf ? 18 : 24)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </section>
  );
}
