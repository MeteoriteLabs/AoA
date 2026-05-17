/**
 * GitGraphCanvas — D3 + Canvas renderer for the Git Command Centre.
 *
 * D3 computes lane layout; Canvas draws it; React owns pointer events.
 * Hit testing converts DOM coordinates through the D3 zoom transform.
 *
 * Animation loop (RAF) only runs when running/in_review tasks are present.
 * Stops when document is hidden or no active nodes remain.
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import type { GitBranchInfo, GitGraphData } from "@armyofagents/shared";
import type { HoveredNode } from "./GitHoverCard";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const X_SPACING = 60;   // px between commits (horizontal)
const Y_SPACING = 60;   // px between branch lanes (vertical)
const COMMIT_R = 7;     // commit circle radius
const CARD_W = 24;      // task card marker width
const CARD_H = 16;      // task card marker height
const PAD_TOP = 32;
const PAD_LEFT = 24;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommitLayout {
  sha: string;
  x: number;
  y: number;
  isMerge: boolean;
  branchName: string | null;
  isTaskTip: boolean;
  tags: string[];
  laneColor: string;
}

interface EdgeLayout {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  isMerge: boolean;
}

interface LayoutResult {
  nodes: CommitLayout[];
  edges: EdgeLayout[];
  laneY: Map<string, number>;
  totalWidth: number;
  totalHeight: number;
}

export interface GitGraphCanvasProps {
  branches: GitBranchInfo[];
  graph: GitGraphData;
  filter: "all" | "running" | "blocked" | "prs";
  onHover: (node: HoveredNode | null, position: { x: number; y: number }) => void;
  onClick: (node: HoveredNode) => void;
}

// ---------------------------------------------------------------------------
// Layout computation
// ---------------------------------------------------------------------------

function computeLayout(graph: GitGraphData, branches: GitBranchInfo[]): LayoutResult {
  const laneColors = new Map(graph.branches.map((b) => [b.name, b.color]));
  const taskTips = new Set(branches.filter((b) => b.linkedIssueId).map((b) => b.lastCommitSha));

  // Lane Y assignment
  const laneY = new Map<string, number>();
  graph.branches.forEach((b, idx) => {
    laneY.set(b.name, PAD_TOP + idx * Y_SPACING);
  });

  // Build tip→lane map: FIRST branch wins for shared tips (so default branch
  // takes priority over later branches at the same commit).
  const tipShaToLane = new Map<string, string>();
  for (const b of graph.branches) {
    if (!tipShaToLane.has(b.tipSha)) {
      tipShaToLane.set(b.tipSha, b.name);
    }
  }

  // Propagate lanes backward through parent links.
  // git log is topological (newest → oldest), so when we reach a parent we can
  // safely assign its lane from the first child that claimed it.
  const commitLane = new Map<string, string>(tipShaToLane);
  for (const commit of graph.commits) {
    const lane = commitLane.get(commit.sha);
    if (!lane) continue;
    for (const parentSha of commit.parentShas) {
      if (!commitLane.has(parentSha)) {
        commitLane.set(parentSha, lane);
      }
    }
  }

  // Assign X: left-to-right = newest first in git log (index 0 is newest)
  // Flip so oldest is left (most natural for a history graph)
  const maxIdx = Math.max(0, graph.commits.length - 1);

  const nodes: CommitLayout[] = graph.commits.map((commit, idx) => {
    const laneName = commitLane.get(commit.sha) ?? graph.defaultBranch;
    const y = laneY.get(laneName) ?? PAD_TOP;
    const x = PAD_LEFT + (maxIdx - idx) * X_SPACING;
    const color = laneColors.get(laneName) ?? "#7E8AA8";

    return {
      sha: commit.sha,
      x,
      y,
      isMerge: commit.isMerge,
      // branchName only set at explicit branch tips (used for hover + task card)
      branchName: tipShaToLane.get(commit.sha) ?? null,
      isTaskTip: taskTips.has(commit.sha),
      tags: commit.tags,
      laneColor: color,
    };
  });

  const nodeByShá = new Map(nodes.map((n) => [n.sha, n]));

  // Edges
  const edges: EdgeLayout[] = [];
  for (const commit of graph.commits) {
    const to = nodeByShá.get(commit.sha);
    if (!to) continue;
    for (const parentSha of commit.parentShas) {
      const from = nodeByShá.get(parentSha);
      if (!from) continue;
      edges.push({
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        color: to.laneColor,
        isMerge: commit.isMerge,
      });
    }
  }

  const totalWidth = PAD_LEFT * 2 + (graph.commits.length > 0 ? maxIdx * X_SPACING : 400);
  const totalHeight = PAD_TOP * 2 + graph.branches.length * Y_SPACING;

  return { nodes, edges, laneY, totalWidth, totalHeight };
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawEdges(ctx: CanvasRenderingContext2D, edges: EdgeLayout[]) {
  for (const e of edges) {
    ctx.beginPath();
    if (e.isMerge && e.fromY !== e.toY) {
      // Bezier curve for merges
      const mx = (e.fromX + e.toX) / 2;
      ctx.moveTo(e.fromX, e.fromY);
      ctx.bezierCurveTo(mx, e.fromY, mx, e.toY, e.toX, e.toY);
    } else if (e.fromY !== e.toY) {
      // Angled line for branch divergence
      ctx.moveTo(e.fromX, e.fromY);
      ctx.lineTo(e.toX, e.toY);
    } else {
      ctx.moveTo(e.fromX, e.fromY);
      ctx.lineTo(e.toX, e.toY);
    }
    ctx.strokeStyle = e.color + "99"; // 60% alpha
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function drawCommitNode(
  ctx: CanvasRenderingContext2D,
  node: CommitLayout,
  animPhase: number,
  isRunning: boolean,
) {
  if (node.isTaskTip) {
    // Task card marker (rounded rectangle)
    const x = node.x - CARD_W / 2;
    const y = node.y - CARD_H / 2;
    const r = 4;
    ctx.beginPath();
    ctx.roundRect(x, y, CARD_W, CARD_H, r);
    ctx.fillStyle = node.laneColor + "40";
    ctx.strokeStyle = node.laneColor;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    // Pulse ring when running
    if (isRunning) {
      const pulse = Math.abs(Math.sin(animPhase));
      ctx.beginPath();
      ctx.roundRect(x - 3, y - 3, CARD_W + 6, CARD_H + 6, r + 2);
      ctx.strokeStyle = node.laneColor + Math.round(pulse * 0x99).toString(16).padStart(2, "0");
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  } else if (node.isMerge) {
    // Diamond for merge commits
    const s = COMMIT_R;
    ctx.beginPath();
    ctx.moveTo(node.x, node.y - s);
    ctx.lineTo(node.x + s, node.y);
    ctx.lineTo(node.x, node.y + s);
    ctx.lineTo(node.x - s, node.y);
    ctx.closePath();
    ctx.fillStyle = node.laneColor + "80";
    ctx.strokeStyle = node.laneColor;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  } else {
    // Regular commit circle
    ctx.beginPath();
    ctx.arc(node.x, node.y, COMMIT_R, 0, Math.PI * 2);
    ctx.fillStyle = node.laneColor + "60";
    ctx.strokeStyle = node.laneColor;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
  }

  // Tag pip (small amber dot above)
  if (node.tags.length > 0) {
    ctx.beginPath();
    ctx.arc(node.x + COMMIT_R, node.y - COMMIT_R, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#D9A938";
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

function hitTest(
  nodes: CommitLayout[],
  cx: number,
  cy: number,
): CommitLayout | null {
  // Scan back-to-front (last drawn = top-most)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    if (n.isTaskTip) {
      if (
        cx >= n.x - CARD_W / 2 - 4 &&
        cx <= n.x + CARD_W / 2 + 4 &&
        cy >= n.y - CARD_H / 2 - 4 &&
        cy <= n.y + CARD_H / 2 + 4
      ) {
        return n;
      }
    } else {
      const dist = Math.sqrt((cx - n.x) ** 2 + (cy - n.y) ** 2);
      if (dist <= COMMIT_R + 4) return n;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GitGraphCanvas({
  branches,
  graph,
  filter,
  onHover,
  onClick,
}: GitGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const initialPanApplied = useRef(false);
  const rafRef = useRef<number | null>(null);
  const animPhaseRef = useRef(0);

  const branchByName = useMemo(
    () => new Map(branches.map((b) => [b.name, b]),
    ), [branches],
  );

  // Filter branches for display
  const visibleBranches = useMemo(() => {
    if (filter === "all") return branches;
    return branches.filter((b) => {
      if (filter === "running") return b.linkedIssueStatus === "in_progress";
      if (filter === "blocked") return b.linkedIssueStatus === "blocked";
      if (filter === "prs") return !!b.pr;
      return true;
    });
  }, [branches, filter]);

  const visibleNames = useMemo(
    () => new Set(visibleBranches.map((b) => b.name)),
    [visibleBranches],
  );

  // Check if any tasks are actively running (drives RAF loop)
  const hasActiveNodes = useMemo(
    () => branches.some((b) => b.linkedIssueStatus === "in_progress" || b.linkedIssueStatus === "in_review"),
    [branches],
  );

  const layout = useMemo(() => computeLayout(graph, branches), [graph, branches]);

  // Always-current layout ref so the ResizeObserver callback can read totalWidth
  // without closing over a stale value (ResizeObserver callback dependency is redraw).
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Reset initial-pan flag whenever graph data changes so new data re-anchors
  // to the newest commits automatically.
  useEffect(() => {
    initialPanApplied.current = false;
  }, [graph]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t = transformRef.current;
    // Scale D3's CSS-pixel transform into physical pixels so hit-testing
    // and rendering stay consistent regardless of devicePixelRatio.
    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.setTransform(t.k * dpr, 0, 0, t.k * dpr, t.x * dpr, t.y * dpr);

    // Filter nodes/edges to visible branches
    const visibleNodes = layout.nodes.filter(
      (n) => !n.branchName || visibleNames.has(n.branchName),
    );
    const visibleEdges = layout.edges.filter(
      (e) => true, // keep all edges for now — filtered at node level
    );

    // Draw edges first (behind nodes)
    drawEdges(ctx, visibleEdges);

    // Draw nodes
    for (const node of visibleNodes) {
      const isRunning =
        node.branchName != null &&
        branchByName.get(node.branchName)?.linkedIssueStatus === "in_progress";
      drawCommitNode(ctx, node, animPhaseRef.current, isRunning);
    }

    ctx.restore();
  }, [layout, visibleNames, branchByName]);

  // RAF loop for animations (Issue 5 fix: cancelAnimationFrame + visibilityState)
  useEffect(() => {
    if (!hasActiveNodes) return;

    function tick() {
      if (document.visibilityState === "hidden") {
        rafRef.current = null;
        return;
      }
      animPhaseRef.current += 0.05;
      redraw();
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [hasActiveNodes, redraw]);

  // Static redraw when no animation
  useEffect(() => {
    if (!hasActiveNodes) redraw();
  }, [hasActiveNodes, redraw]);

  // Resize handler
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const obs = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      // No ctx.scale(dpr, dpr) — redraw applies DPR inside setTransform.

      // Apply initial pan here, inside the ResizeObserver, because this is the
      // earliest point at which the canvas has guaranteed non-zero dimensions.
      // layoutRef.current is always fresh (assigned in the render body above).
      const totalWidth = layoutRef.current.totalWidth;
      if (!initialPanApplied.current && zoomRef.current && w > 0 && totalWidth > w) {
        // Pan so the newest commits (rightmost) land near the right edge.
        const initialX = w - totalWidth - PAD_LEFT;
        const t = d3.zoomIdentity.translate(initialX, 0);
        d3.select(canvas).call(zoomRef.current.transform, t);
        initialPanApplied.current = true;
      }

      redraw();
    });
    obs.observe(parent);
    return () => obs.disconnect();
  }, [redraw]);

  // D3 zoom behavior
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        transformRef.current = event.transform;
        redraw();
      });

    zoomRef.current = zoom;
    d3.select(canvas).call(zoom);
    return () => {
      d3.select(canvas).on(".zoom", null);
      zoomRef.current = null;
    };
  }, [redraw]);

  // Pointer move — hit test + hover
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;

      // Transform DOM coords → canvas-space (inverse zoom transform)
      const cx = (e.clientX - rect.left - t.x) / t.k;
      const cy = (e.clientY - rect.top - t.y) / t.k;

      const hit = hitTest(layout.nodes, cx, cy);
      if (!hit) {
        onHover(null, { x: e.clientX, y: e.clientY });
        return;
      }

      const branch = hit.branchName ? branchByName.get(hit.branchName) : undefined;

      if (hit.isTaskTip && branch) {
        onHover({ type: "task", branch }, { x: e.clientX, y: e.clientY });
      } else if (hit.isMerge) {
        const commit = graph.commits.find((c) => c.sha === hit.sha);
        if (commit) onHover({ type: "merge", commit }, { x: e.clientX, y: e.clientY });
      } else {
        const commit = graph.commits.find((c) => c.sha === hit.sha);
        if (commit) onHover({ type: "commit", commit }, { x: e.clientX, y: e.clientY });
      }
    },
    [layout.nodes, branchByName, graph.commits, onHover],
  );

  const handleMouseLeave = useCallback(() => {
    onHover(null, { x: 0, y: 0 });
  }, [onHover]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const t = transformRef.current;
      const cx = (e.clientX - rect.left - t.x) / t.k;
      const cy = (e.clientY - rect.top - t.y) / t.k;

      const hit = hitTest(layout.nodes, cx, cy);
      if (!hit) return;

      const branch = hit.branchName ? branchByName.get(hit.branchName) : undefined;
      if (hit.isTaskTip && branch) {
        onClick({ type: "task", branch });
      } else if (hit.isMerge) {
        const commit = graph.commits.find((c) => c.sha === hit.sha);
        if (commit) onClick({ type: "merge", commit });
      } else {
        const commit = graph.commits.find((c) => c.sha === hit.sha);
        if (commit) onClick({ type: "commit", commit });
      }
    },
    [layout.nodes, branchByName, graph.commits, onClick],
  );

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-crosshair"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    />
  );
}
