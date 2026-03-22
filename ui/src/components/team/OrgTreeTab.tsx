import { useRef, useState, useMemo, useCallback, useEffect } from "react";
import type { UnifiedOrgNode } from "@paperclipai/shared";
import { AgentIcon } from "../AgentIconPicker";
import { adapterLabels, roleLabels } from "../agent-config-primitives";
import { Network } from "lucide-react";
import { cn } from "@/lib/utils";

// Layout constants
const CARD_W = 200;
const CARD_H = 100;
const GAP_X = 32;
const GAP_Y = 80;
const PADDING = 60;

// ── Layout types ────────────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  nodeType: "agent" | "user";
  name: string;
  role: string;
  status: string;
  // Agent fields
  adapterType?: string;
  icon?: string;
  pendingApproval?: boolean;
  // User fields
  avatarUrl?: string;
  userRole?: string;
  departmentName?: string;
  // Position
  x: number;
  y: number;
  children: LayoutNode[];
}

// ── Layout algorithm (reused from OrgChart.tsx) ─────────────────────────

function subtreeWidth(node: UnifiedOrgNode): number {
  if (node.children.length === 0) return CARD_W;
  const childrenW = node.children.reduce((sum: number, c: UnifiedOrgNode) => sum + subtreeWidth(c), 0);
  const gaps = (node.children.length - 1) * GAP_X;
  return Math.max(CARD_W, childrenW + gaps);
}

function layoutTree(node: UnifiedOrgNode, x: number, y: number): LayoutNode {
  const totalW = subtreeWidth(node);
  const layoutChildren: LayoutNode[] = [];

  if (node.children.length > 0) {
    const childrenW = node.children.reduce((sum: number, c: UnifiedOrgNode) => sum + subtreeWidth(c), 0);
    const gaps = (node.children.length - 1) * GAP_X;
    let cx = x + (totalW - childrenW - gaps) / 2;

    for (const child of node.children) {
      const cw = subtreeWidth(child);
      layoutChildren.push(layoutTree(child, cx, y + CARD_H + GAP_Y));
      cx += cw + GAP_X;
    }
  }

  return {
    id: node.id,
    nodeType: node.nodeType,
    name: node.name,
    role: node.role,
    status: node.status,
    adapterType: node.adapterType,
    icon: node.icon,
    pendingApproval: node.pendingApproval,
    avatarUrl: node.avatarUrl,
    userRole: node.userRole,
    departmentName: node.departmentName,
    x: x + (totalW - CARD_W) / 2,
    y,
    children: layoutChildren,
  };
}

function layoutForest(roots: UnifiedOrgNode[]): LayoutNode[] {
  if (roots.length === 0) return [];
  let x = PADDING;
  const y = PADDING;
  const result: LayoutNode[] = [];
  for (const root of roots) {
    const w = subtreeWidth(root);
    result.push(layoutTree(root, x, y));
    x += w + GAP_X;
  }
  return result;
}

function flattenLayout(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  function walk(n: LayoutNode) {
    result.push(n);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

function collectEdges(nodes: LayoutNode[]): Array<{ parent: LayoutNode; child: LayoutNode }> {
  const edges: Array<{ parent: LayoutNode; child: LayoutNode }> = [];
  function walk(n: LayoutNode) {
    for (const c of n.children) {
      edges.push({ parent: n, child: c });
      walk(c);
    }
  }
  nodes.forEach(walk);
  return edges;
}

// ── Status dot colors ────────────────────────────────────────────────────

const statusDotColor: Record<string, string> = {
  running: "#22d3ee",
  active: "#4ade80",
  paused: "#facc15",
  idle: "#facc15",
  error: "#f87171",
  terminated: "#a3a3a3",
};
const defaultDotColor = "#a3a3a3";

const ROLE_LABELS: Record<string, string> = {
  founder: "Founder",
  team_lead: "Team Lead",
  team_member: "Member",
};

// ── Component ────────────────────────────────────────────────────────────

export interface OrgTreeTabProps {
  orgTree: UnifiedOrgNode[];
  onNodeClick: (id: string, nodeType: "agent" | "user") => void;
}

export function OrgTreeTab({ orgTree, onNodeClick }: OrgTreeTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const layout = useMemo(() => layoutForest(orgTree), [orgTree]);
  const allNodes = useMemo(() => flattenLayout(layout), [layout]);
  const edges = useMemo(() => collectEdges(layout), [layout]);

  const bounds = useMemo(() => {
    if (allNodes.length === 0) return { width: 800, height: 600 };
    let maxX = 0;
    let maxY = 0;
    for (const n of allNodes) {
      maxX = Math.max(maxX, n.x + CARD_W);
      maxY = Math.max(maxY, n.y + CARD_H);
    }
    return { width: maxX + PADDING, height: maxY + PADDING };
  }, [allNodes]);

  // Center chart on first load
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current || allNodes.length === 0 || !containerRef.current) return;
    hasInitialized.current = true;

    const container = containerRef.current;
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;

    const scaleX = (containerW - 40) / bounds.width;
    const scaleY = (containerH - 40) / bounds.height;
    const fitZoom = Math.min(scaleX, scaleY, 1);

    const chartW = bounds.width * fitZoom;
    const chartH = bounds.height * fitZoom;

    setZoom(fitZoom);
    setPan({
      x: (containerW - chartW) / 2,
      y: (containerH - chartH) / 2,
    });
  }, [allNodes, bounds]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-org-card]")) return;
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
    },
    [dragging],
  );

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(Math.max(zoom * factor, 0.2), 2);

      const scale = newZoom / zoom;
      setPan({
        x: mouseX - scale * (mouseX - pan.x),
        y: mouseY - scale * (mouseY - pan.y),
      });
      setZoom(newZoom);
    },
    [zoom, pan],
  );

  const zoomTo = useCallback(
    (factor: number) => {
      const newZoom = Math.min(Math.max(zoom * factor, 0.2), 2);
      const container = containerRef.current;
      if (container) {
        const cx = container.clientWidth / 2;
        const cy = container.clientHeight / 2;
        const scale = newZoom / zoom;
        setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) });
      }
      setZoom(newZoom);
    },
    [zoom, pan],
  );

  const fitToScreen = useCallback(() => {
    if (!containerRef.current) return;
    const cW = containerRef.current.clientWidth;
    const cH = containerRef.current.clientHeight;
    const scaleX = (cW - 40) / bounds.width;
    const scaleY = (cH - 40) / bounds.height;
    const fitZoom = Math.min(scaleX, scaleY, 1);
    const chartW = bounds.width * fitZoom;
    const chartH = bounds.height * fitZoom;
    setZoom(fitZoom);
    setPan({ x: (cW - chartW) / 2, y: (cH - chartH) / 2 });
  }, [bounds]);

  // Empty state
  if (orgTree.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center" data-testid="org-tree-empty">
        <Network className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm text-muted-foreground">
          Add agents and invite teammates to build your org chart
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-[calc(100vh-12rem)] overflow-hidden relative bg-muted/20 border border-border rounded-lg"
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      data-testid="org-tree-canvas"
    >
      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <button
          className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-accent transition-colors"
          onClick={() => zoomTo(1.2)}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-accent transition-colors"
          onClick={() => zoomTo(0.8)}
          aria-label="Zoom out"
        >
          &minus;
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-[10px] hover:bg-accent transition-colors"
          onClick={fitToScreen}
          title="Fit to screen"
          aria-label="Fit chart to screen"
        >
          Fit
        </button>
      </div>

      {/* SVG layer for edges */}
      <svg className="absolute inset-0 pointer-events-none" style={{ width: "100%", height: "100%" }}>
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {edges.map(({ parent, child }) => {
            const x1 = parent.x + CARD_W / 2;
            const y1 = parent.y + CARD_H;
            const x2 = child.x + CARD_W / 2;
            const y2 = child.y;
            const midY = (y1 + y2) / 2;

            return (
              <path
                key={`${parent.id}-${child.id}`}
                d={`M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`}
                fill="none"
                stroke="var(--border)"
                strokeWidth={1.5}
              />
            );
          })}
        </g>
      </svg>

      {/* Card layer */}
      <div
        className="absolute inset-0"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {allNodes.map((node) =>
          node.nodeType === "agent" ? (
            <AgentNodeCard key={node.id} node={node} onClick={onNodeClick} />
          ) : (
            <HumanNodeCard key={node.id} node={node} onClick={onNodeClick} />
          ),
        )}
      </div>
    </div>
  );
}

// ── Agent node card ──────────────────────────────────────────────────────

function AgentNodeCard({
  node,
  onClick,
}: {
  node: LayoutNode;
  onClick: (id: string, nodeType: "agent" | "user") => void;
}) {
  const dotColor = statusDotColor[node.status] ?? defaultDotColor;

  return (
    <div
      data-org-card
      data-testid={`org-node-${node.id}`}
      data-node-type="agent"
      className={cn(
        "absolute bg-card border rounded-lg shadow-sm hover:shadow-md hover:border-foreground/20 transition-[box-shadow,border-color] duration-150 cursor-pointer select-none border-l-[3px] border-l-blue-400",
        node.pendingApproval && "opacity-50",
      )}
      style={{
        left: node.x,
        top: node.y,
        width: CARD_W,
        minHeight: CARD_H,
        borderTopColor: "var(--border)",
        borderRightColor: "var(--border)",
        borderBottomColor: "var(--border)",
      }}
      onClick={() => onClick(node.id, "agent")}
    >
      <div className="flex items-center px-4 py-3 gap-3">
        <div className="relative shrink-0">
          <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
            <AgentIcon icon={node.icon} className="h-4.5 w-4.5 text-foreground/70" />
          </div>
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card"
            style={{ backgroundColor: dotColor }}
          />
        </div>
        <div className="flex flex-col items-start min-w-0 flex-1">
          <span className="text-sm font-semibold text-foreground leading-tight truncate w-full">
            {node.name}
          </span>
          <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">
            {roleLabels[node.role] ?? node.role}
          </span>
          {node.adapterType && (
            <span className="text-[10px] text-muted-foreground/60 font-mono leading-tight mt-1">
              {adapterLabels[node.adapterType] ?? node.adapterType}
            </span>
          )}
        </div>
      </div>
      {node.pendingApproval && (
        <div className="px-4 pb-2">
          <span className="text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 px-1.5 py-0.5 rounded">
            Pending
          </span>
        </div>
      )}
    </div>
  );
}

// ── Human node card ──────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function HumanNodeCard({
  node,
  onClick,
}: {
  node: LayoutNode;
  onClick: (id: string, nodeType: "agent" | "user") => void;
}) {
  return (
    <div
      data-org-card
      data-testid={`org-node-${node.id}`}
      data-node-type="user"
      className="absolute bg-card border rounded-lg shadow-sm hover:shadow-md hover:border-foreground/20 transition-[box-shadow,border-color] duration-150 cursor-pointer select-none border-l-[3px] border-l-green-400"
      style={{
        left: node.x,
        top: node.y,
        width: CARD_W,
        minHeight: CARD_H,
        borderTopColor: "var(--border)",
        borderRightColor: "var(--border)",
        borderBottomColor: "var(--border)",
      }}
      onClick={() => onClick(node.id, "user")}
    >
      <div className="flex items-center px-4 py-3 gap-3">
        <div className="shrink-0">
          {node.avatarUrl ? (
            <img
              src={node.avatarUrl}
              alt={node.name}
              className="w-9 h-9 rounded-full object-cover"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="text-xs font-semibold text-green-700 dark:text-green-300">
                {getInitials(node.name)}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-start min-w-0 flex-1">
          <span className="text-sm font-semibold text-foreground leading-tight truncate w-full">
            {node.name}
          </span>
          {node.userRole && (
            <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">
              {ROLE_LABELS[node.userRole] ?? node.userRole}
            </span>
          )}
          {node.departmentName && (
            <span className="text-[10px] text-muted-foreground/60 leading-tight mt-1">
              {node.departmentName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
