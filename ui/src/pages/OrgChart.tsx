import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useNavigate } from "@/lib/router";
import { useQuery, useQueries } from "@tanstack/react-query";
import { agentsApi, type OrgNode } from "../api/agents";
import { teamsApi } from "../api/teams";
import { projectsApi } from "../api/projects";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl } from "../lib/utils";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { AgentIcon } from "../components/AgentIconPicker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TeamOrgOverlay } from "../components/team/TeamOrgOverlay";
import { computeTeamBoxes, type LaidOutCard } from "../components/team/teamBoundingBox";
import { Network } from "lucide-react";
import type { Agent } from "@armyofagents/shared";
import { displayAgentRole } from "@armyofagents/shared";

// Layout constants
const CARD_W = 200;
const CARD_H = 100;
const GAP_X = 32;
const GAP_Y = 80;
const PADDING = 60;

// Cycling color palette for team overlays. Color assignment is keyed by a
// stable hash of the team's id (see `hashStringToInt` below), not the team's
// position in the list — adding/removing/reordering teams must not shuffle
// every other team's color, since founders find that visually jarring.
const TEAM_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
];

/**
 * Stable string-to-int hash. Used to key team-overlay colors by `team.id`
 * so the color a given team renders with is deterministic across team
 * roster changes — adding/removing one team won't recolor the others.
 *
 * Math.imul produces a 32-bit signed product (matching the classic
 * Java/string-hash multiply-by-31 algorithm); `| 0` keeps the running
 * accumulator in 32-bit signed range. We absolute-value the final result
 * because callers `% TEAM_COLORS.length` and a negative input would
 * produce a negative index.
 */
function hashStringToInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ── Tree layout types ───────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  name: string;
  role: string;
  status: string;
  x: number;
  y: number;
  children: LayoutNode[];
}

// ── Layout algorithm ────────────────────────────────────────────────────

/** Compute the width each subtree needs. */
function subtreeWidth(node: OrgNode): number {
  if (node.children.length === 0) return CARD_W;
  const childrenW = node.children.reduce((sum, c) => sum + subtreeWidth(c), 0);
  const gaps = (node.children.length - 1) * GAP_X;
  return Math.max(CARD_W, childrenW + gaps);
}

/** Recursively assign x,y positions. */
function layoutTree(node: OrgNode, x: number, y: number): LayoutNode {
  const totalW = subtreeWidth(node);
  const layoutChildren: LayoutNode[] = [];

  if (node.children.length > 0) {
    const childrenW = node.children.reduce((sum, c) => sum + subtreeWidth(c), 0);
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
    name: node.name,
    role: node.role,
    status: node.status,
    x: x + (totalW - CARD_W) / 2,
    y,
    children: layoutChildren,
  };
}

/** Layout all root nodes side by side. */
function layoutForest(roots: OrgNode[]): LayoutNode[] {
  if (roots.length === 0) return [];

  const totalW = roots.reduce((sum, r) => sum + subtreeWidth(r), 0);
  const gaps = (roots.length - 1) * GAP_X;
  let x = PADDING;
  const y = PADDING;

  const result: LayoutNode[] = [];
  for (const root of roots) {
    const w = subtreeWidth(root);
    result.push(layoutTree(root, x, y));
    x += w + GAP_X;
  }

  // Compute bounds and return
  return result;
}

/** Flatten layout tree to list of nodes. */
function flattenLayout(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  function walk(n: LayoutNode) {
    result.push(n);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

/** Collect all parent→child edges. */
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

// ── Status dot colors (raw hex for SVG) ─────────────────────────────────

const adapterLabels: Record<string, string> = {
  claude_local: "Claude",
  codex_local: "Codex",
  opencode_local: "OpenCode",
  cursor: "Cursor",
  openclaw: "OpenClaw",
  process: "Process",
  http: "HTTP",
};

const statusDotColor: Record<string, string> = {
  running: "#22d3ee",
  active: "#4ade80",
  paused: "#facc15",
  idle: "#facc15",
  error: "#f87171",
  terminated: "#a3a3a3",
};
const defaultDotColor = "#a3a3a3";

// ── Main component ──────────────────────────────────────────────────────

export function OrgChart() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const navigate = useNavigate();

  const { data: orgTree, isLoading } = useQuery({
    queryKey: queryKeys.org(selectedCompanyId!),
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents ?? []) m.set(a.id, a);
    return m;
  }, [agents]);

  // ── Department filter ────────────────────────────────────────────────
  const [deptFilter, setDeptFilter] = useState<string>("all");

  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const departments = useMemo(
    () => (projectsQuery.data ?? []).filter((p) => p.type === "department"),
    [projectsQuery.data],
  );

  const deptAgentsQuery = useQuery({
    queryKey: queryKeys.projects.agents(deptFilter),
    queryFn: () => projectsApi.listAgents(deptFilter, selectedCompanyId!),
    enabled: !!selectedCompanyId && deptFilter !== "all",
  });

  // Prune the org tree to only show agents in the selected department.
  const filteredOrgTree = useMemo<OrgNode[] | undefined>(() => {
    if (deptFilter === "all" || !orgTree) return orgTree;
    const allowed = new Set(
      (deptAgentsQuery.data ?? []).map((a) => a.agentId),
    );
    function prune(nodes: OrgNode[]): OrgNode[] {
      const result: OrgNode[] = [];
      for (const n of nodes) {
        const prunedChildren = prune(n.children);
        if (allowed.has(n.id) || prunedChildren.length > 0) {
          result.push({ ...n, children: prunedChildren });
        }
      }
      return result;
    }
    return prune(orgTree);
  }, [orgTree, deptFilter, deptAgentsQuery.data]);

  // ── Teams + members for overlay ──────────────────────────────────────
  const teamsQuery = useQuery({
    queryKey: queryKeys.teams.list(selectedCompanyId!),
    queryFn: () => teamsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const teamItems = useMemo(
    () => teamsQuery.data?.items ?? [],
    [teamsQuery.data],
  );

  const memberQueries = useQueries({
    queries: teamItems.map((t) => ({
      queryKey: queryKeys.teams.members(selectedCompanyId!, t.id),
      queryFn: () => teamsApi.listMembers(t.id),
      enabled: !!selectedCompanyId,
    })),
  });

  const memberships = useMemo(() => {
    const m = new Map<string, string>();
    teamItems.forEach((t, idx) => {
      const members = memberQueries[idx]?.data?.items ?? [];
      for (const mem of members) m.set(mem.agentId, t.id);
    });
    return m;
  }, [teamItems, memberQueries]);

  const teamMetas = useMemo(
    () =>
      teamItems.map((t) => ({
        id: t.id,
        name: t.name,
        // Hash-based keying so a team's color is stable across roster changes
        // (B2.1). Sequential `idx % TEAM_COLORS.length` would shuffle every
        // team's color whenever another team is added/removed.
        color: TEAM_COLORS[hashStringToInt(t.id) % TEAM_COLORS.length],
      })),
    [teamItems],
  );

  useEffect(() => {
    setBreadcrumbs([{ label: "Team" }]);
  }, [setBreadcrumbs]);

  // Layout computation — uses filteredOrgTree so dept filter narrows the chart.
  const layout = useMemo(
    () => layoutForest(filteredOrgTree ?? []),
    [filteredOrgTree],
  );
  const allNodes = useMemo(() => flattenLayout(layout), [layout]);
  const edges = useMemo(() => collectEdges(layout), [layout]);

  // Compute team bounding boxes from the laid-out cards.
  const teamBoxes = useMemo(() => {
    const cards: LaidOutCard[] = allNodes.map((n) => ({
      agentId: n.id,
      x: n.x,
      y: n.y,
      w: CARD_W,
      h: CARD_H,
    }));
    return computeTeamBoxes(cards, memberships, teamMetas);
  }, [allNodes, memberships, teamMetas]);

  // Compute SVG bounds
  const bounds = useMemo(() => {
    if (allNodes.length === 0) return { width: 800, height: 600 };
    let maxX = 0, maxY = 0;
    for (const n of allNodes) {
      maxX = Math.max(maxX, n.x + CARD_W);
      maxY = Math.max(maxY, n.y + CARD_H);
    }
    return { width: maxX + PADDING, height: maxY + PADDING };
  }, [allNodes]);

  // Pan & zoom state
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Compute the fit-to-container zoom + pan for the current bounds and apply
  // it. Single source of truth — used by the initial-mount effect, the
  // dept-filter-change effect (B2.2), and the "Fit" toolbar button.
  const fitToContainer = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
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
  }, [bounds]);

  // Center the chart on first load
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current || allNodes.length === 0 || !containerRef.current) return;
    hasInitialized.current = true;
    fitToContainer();
  }, [allNodes, fitToContainer]);

  // B2.2: re-fit the viewport whenever the dept filter changes. Pruning to a
  // small dept can leave the visible nodes off-screen relative to the
  // pre-filter pan/zoom; re-fitting keeps the user oriented. Skip the very
  // first render — the initial-mount effect above handles that.
  const lastFilterRef = useRef(deptFilter);
  useEffect(() => {
    if (lastFilterRef.current === deptFilter) return;
    lastFilterRef.current = deptFilter;
    if (!hasInitialized.current) return;
    fitToContainer();
  }, [deptFilter, fitToContainer]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Don't drag if clicking a card
    const target = e.target as HTMLElement;
    if (target.closest("[data-org-card]")) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.min(Math.max(zoom * factor, 0.2), 2);

    // Zoom toward mouse position
    const scale = newZoom / zoom;
    setPan({
      x: mouseX - scale * (mouseX - pan.x),
      y: mouseY - scale * (mouseY - pan.y),
    });
    setZoom(newZoom);
  }, [zoom, pan]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Network} message="Select a company to view the org chart." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="org-chart" />;
  }

  if (orgTree && orgTree.length === 0) {
    return <EmptyState icon={Network} message="No organizational hierarchy defined." />;
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-[calc(100vh-4rem)] overflow-hidden relative bg-muted/20 border border-border rounded-lg"
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Toolbar (top-left): department filter */}
      <div className="absolute top-3 left-3 z-10 flex gap-2 rounded bg-background/90 p-1 shadow-sm border border-border backdrop-blur">
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="h-7 w-[180px] text-xs" aria-label="Filter by department">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Zoom controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
        <button
          className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-accent transition-colors"
          onClick={() => {
            const newZoom = Math.min(zoom * 1.2, 2);
            const container = containerRef.current;
            if (container) {
              const cx = container.clientWidth / 2;
              const cy = container.clientHeight / 2;
              const scale = newZoom / zoom;
              setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) });
            }
            setZoom(newZoom);
          }}
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-accent transition-colors"
          onClick={() => {
            const newZoom = Math.max(zoom * 0.8, 0.2);
            const container = containerRef.current;
            if (container) {
              const cx = container.clientWidth / 2;
              const cy = container.clientHeight / 2;
              const scale = newZoom / zoom;
              setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) });
            }
            setZoom(newZoom);
          }}
          aria-label="Zoom out"
        >
          &minus;
        </button>
        <button
          className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-[10px] hover:bg-accent transition-colors"
          onClick={() => {
            fitToContainer();
          }}
          title="Fit to screen"
          aria-label="Fit chart to screen"
        >
          Fit
        </button>
      </div>

      {/* SVG layer for edges */}
      <svg
        className="absolute inset-0 pointer-events-none"
        style={{
          width: "100%",
          height: "100%",
        }}
      >
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
        {/* Render BEFORE org nodes so overlays sit behind cards. Reordering
            breaks the visual layering — team boxes would obscure the agent
            cards they group, instead of framing them. */}
        <TeamOrgOverlay boxes={teamBoxes} />

        {allNodes.map((node) => {
          const agent = agentMap.get(node.id);
          const dotColor = statusDotColor[node.status] ?? defaultDotColor;

          return (
            <div
              key={node.id}
              data-org-card
              className="absolute bg-card border border-border rounded-lg shadow-sm hover:shadow-md hover:border-foreground/20 transition-[box-shadow,border-color] duration-150 cursor-pointer select-none"
              style={{
                left: node.x,
                top: node.y,
                width: CARD_W,
                minHeight: CARD_H,
              }}
              onClick={() => navigate(agent ? agentUrl(agent) : `/agents/${node.id}`)}
            >
              <div className="flex items-center px-4 py-3 gap-3">
                {/* Agent icon + status dot */}
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                    <AgentIcon icon={agent?.icon} className="h-4.5 w-4.5 text-foreground/70" />
                  </div>
                  <span
                    className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card"
                    style={{ backgroundColor: dotColor }}
                  />
                </div>
                {/* Name + role + adapter type */}
                <div className="flex flex-col items-start min-w-0 flex-1">
                  <span className="text-sm font-semibold text-foreground leading-tight">
                    {node.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                    {agent?.title ?? displayAgentRole(node.role)}
                  </span>
                  {agent && (
                    <span className="text-[10px] text-muted-foreground/60 font-mono leading-tight mt-1">
                      {adapterLabels[agent.adapterType] ?? agent.adapterType}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

