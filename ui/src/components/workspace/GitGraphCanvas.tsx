/**
 * GitGraphCanvas — D3 + Canvas renderer for the Git Command Centre.
 *
 * D3 computes lane layout; Canvas draws it; React owns pointer events.
 * Hit testing converts DOM coordinates through the D3 zoom transform.
 *
 * Exposed via forwardRef as GitGraphCanvasHandle for imperative zoom controls
 * (zoomIn / zoomOut / resetZoom) from the parent toolbar.
 *
 * Animation loop (RAF) only runs when running/in_review tasks are present.
 * Stops when document is hidden or no active nodes remain.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import * as d3 from "d3";
import type { GitBranchInfo, GitGraphData } from "@armyofagents/shared";
import type { HoveredNode } from "./GitHoverCard";

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const X_SPACING = 60;   // px between commits (horizontal)
const Y_SPACING = 60;   // px between branch lanes (vertical)
const COMMIT_R = 5;     // commit circle radius
const CARD_W = 28;      // task card marker width
const CARD_H = 18;      // task card marker height
const PAD_TOP = 32;
const PAD_LEFT = 24;

// Status → dot color
function statusDotColor(status: string | null, fallback: string): string {
  if (status === "in_progress") return "#4FB67E";
  if (status === "in_review") return "#D9A938";
  if (status === "blocked") return "#ef4444";
  if (status === "done" || status === "cancelled") return "#7E8AA8";
  if (status === "planning") return "#D9A938";
  return fallback;
}

// ---------------------------------------------------------------------------
// Public handle (for toolbar zoom controls)
// ---------------------------------------------------------------------------

export interface GitGraphCanvasHandle {
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommitLayout {
  sha: string;
  x: number;
  y: number;
  isMerge: boolean;
  /** The branch this commit's lane belongs to (set for every commit, not just tips). */
  laneName: string;
  /** Non-null only for tip commits — the branch whose tip is this SHA. */
  branchName: string | null;
  isTaskTip: boolean;
  /** True when this commit is the tip of any branch (task or plain). */
  isBranchTip: boolean;
  /** Issue status of the linked task (only meaningful at task-tip nodes). */
  issueStatus: string | null;
  /** True when the branch this commit belongs to is done/cancelled (for fading). */
  isDone: boolean;
  /** True when the branch exists only on the remote, not locally. */
  isRemoteOnly: boolean;
  /** True when this node is the tip of the default branch (for HEAD label). */
  isDefault: boolean;
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
  isDone: boolean;
  isRemoteOnly: boolean;
  /** Lane name — used for visibility filtering. */
  laneName: string;
}

interface LayoutResult {
  nodes: CommitLayout[];
  edges: EdgeLayout[];
  laneY: Map<string, number>;
  /** X range of all nodes belonging to each lane (for flow pulse). */
  laneRangeX: Map<string, { min: number; max: number }>;
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
  const branchMap = new Map(branches.map((b) => [b.name, b]));

  // Lane Y assignment
  const laneY = new Map<string, number>();
  graph.branches.forEach((b, idx) => {
    laneY.set(b.name, PAD_TOP + idx * Y_SPACING);
  });

  // First-occurrence tip→lane (default branch wins for shared tips)
  const tipShaToLane = new Map<string, string>();
  for (const b of graph.branches) {
    if (!tipShaToLane.has(b.tipSha)) {
      tipShaToLane.set(b.tipSha, b.name);
    }
  }

  // Propagate lanes backward through parent links (topological order: newest → oldest)
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

  // Pre-compute per-lane branch info
  const doneBranches = new Set(
    branches
      .filter((b) => b.linkedIssueStatus === "done" || b.linkedIssueStatus === "cancelled")
      .map((b) => b.name),
  );
  const remoteOnlyBranches = new Set(
    branches.filter((b) => !b.isLocal && b.isRemote).map((b) => b.name),
  );

  // Assign X: left-to-right = newest first in git log → flip so oldest is left
  const maxIdx = Math.max(0, graph.commits.length - 1);

  const nodes: CommitLayout[] = graph.commits.map((commit, idx) => {
    const laneName = commitLane.get(commit.sha) ?? graph.defaultBranch;
    const y = laneY.get(laneName) ?? PAD_TOP;
    const x = PAD_LEFT + (maxIdx - idx) * X_SPACING;
    const color = laneColors.get(laneName) ?? "#7E8AA8";

    const tipBranchName = tipShaToLane.get(commit.sha) ?? null;
    const tipBranch = tipBranchName ? branchMap.get(tipBranchName) : undefined;

    return {
      sha: commit.sha,
      x,
      y,
      isMerge: commit.isMerge,
      laneName,
      branchName: tipBranchName,
      isTaskTip: taskTips.has(commit.sha),
      isBranchTip: tipShaToLane.has(commit.sha),
      issueStatus: (tipBranch?.linkedIssueStatus as string | null | undefined) ?? null,
      isDone: doneBranches.has(laneName),
      isRemoteOnly: remoteOnlyBranches.has(laneName),
      isDefault: tipBranchName === graph.defaultBranch,
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
    const laneName = commitLane.get(commit.sha) ?? graph.defaultBranch;
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
        isDone: doneBranches.has(laneName),
        isRemoteOnly: remoteOnlyBranches.has(laneName),
        laneName,
      });
    }
  }

  // Lane X ranges (for flow pulse positioning)
  const laneRangeX = new Map<string, { min: number; max: number }>();
  for (const node of nodes) {
    const lane = commitLane.get(node.sha) ?? graph.defaultBranch;
    const existing = laneRangeX.get(lane);
    if (!existing) {
      laneRangeX.set(lane, { min: node.x, max: node.x });
    } else {
      if (node.x < existing.min) existing.min = node.x;
      if (node.x > existing.max) existing.max = node.x;
    }
  }

  const totalWidth = PAD_LEFT * 2 + (graph.commits.length > 0 ? maxIdx * X_SPACING : 400);
  const totalHeight = PAD_TOP * 2 + graph.branches.length * Y_SPACING;

  return { nodes, edges, laneY, laneRangeX, totalWidth, totalHeight };
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawEdges(ctx: CanvasRenderingContext2D, edges: EdgeLayout[]) {
  for (const e of edges) {
    ctx.save();
    const alpha = e.isDone ? 0.15 : 0.6;
    ctx.globalAlpha = alpha;

    if (e.isRemoteOnly) {
      ctx.setLineDash([6, 4]);
    } else {
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    if (e.isMerge && e.fromY !== e.toY) {
      const mx = (e.fromX + e.toX) / 2;
      ctx.moveTo(e.fromX, e.fromY);
      ctx.bezierCurveTo(mx, e.fromY, mx, e.toY, e.toX, e.toY);
    } else {
      ctx.moveTo(e.fromX, e.fromY);
      ctx.lineTo(e.toX, e.toY);
    }
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }
}

function drawCommitNode(
  ctx: CanvasRenderingContext2D,
  node: CommitLayout,
  animPhase: number,
  branchStatus: string | null,
) {
  const doneAlpha = node.isDone ? 0.25 : 1;

  if (node.isTaskTip) {
    const cardX = node.x - CARD_W / 2;
    const cardY = node.y - CARD_H / 2;
    const r = 4;

    ctx.save();
    ctx.globalAlpha = doneAlpha;

    // Determine border + fill color based on issue status
    const borderColor = statusDotColor(node.issueStatus, node.laneColor);
    const fillColor = "#0f0e0d"; // near-black, matches canvas bg

    // Outer ring(s) based on status
    if (branchStatus === "in_progress") {
      // Double animated pulse ring (outer + inner)
      const pulse = (Math.sin(animPhase) + 1) / 2;
      // Outer ring
      ctx.beginPath();
      ctx.roundRect(cardX - 6, cardY - 6, CARD_W + 12, CARD_H + 12, r + 4);
      ctx.strokeStyle = node.laneColor + Math.round(pulse * 0x33).toString(16).padStart(2, "0");
      ctx.lineWidth = 1;
      ctx.stroke();
      // Inner ring
      ctx.beginPath();
      ctx.roundRect(cardX - 3, cardY - 3, CARD_W + 6, CARD_H + 6, r + 2);
      ctx.strokeStyle = node.laneColor + Math.round(pulse * 0x66).toString(16).padStart(2, "0");
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (branchStatus === "in_review") {
      // Single amber static ring
      ctx.beginPath();
      ctx.roundRect(cardX - 3, cardY - 3, CARD_W + 6, CARD_H + 6, r + 2);
      ctx.strokeStyle = "#D9A93866";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (branchStatus === "blocked") {
      // Static red ring
      ctx.beginPath();
      ctx.roundRect(cardX - 3, cardY - 3, CARD_W + 6, CARD_H + 6, r + 2);
      ctx.strokeStyle = "#ef444466";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (branchStatus === "planning") {
      // Dashed amber ring
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.roundRect(cardX - 3, cardY - 3, CARD_W + 6, CARD_H + 6, r + 2);
      ctx.strokeStyle = "#D9A93855";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Card background + border
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, CARD_W, CARD_H, r);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Status dot (left side)
    const dotColor = statusDotColor(node.issueStatus, node.laneColor);
    ctx.beginPath();
    ctx.arc(cardX + 10, node.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    // Three micro-lines (right side, representing content preview)
    ctx.strokeStyle = borderColor + "99";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    const lineX1 = cardX + 18;
    const lineX2 = cardX + CARD_W - 5;
    ctx.beginPath(); ctx.moveTo(lineX1, node.y - 4); ctx.lineTo(lineX2, node.y - 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lineX1, node.y);     ctx.lineTo(lineX2, node.y);     ctx.stroke();
    ctx.beginPath(); ctx.moveTo(lineX1, node.y + 4); ctx.lineTo(lineX2, node.y + 4); ctx.stroke();
    ctx.lineCap = "butt";

    ctx.restore();
  } else if (node.isMerge) {
    // Diamond for merge commits
    ctx.save();
    ctx.globalAlpha = doneAlpha;
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
    ctx.restore();
  } else {
    // Regular commit circle
    ctx.save();
    ctx.globalAlpha = doneAlpha;
    if (node.isBranchTip && !node.isTaskTip) {
      // Plain branch tip — slightly larger dashed circle
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.arc(node.x, node.y, COMMIT_R + 2, 0, Math.PI * 2);
    } else if (node.isRemoteOnly) {
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.arc(node.x, node.y, COMMIT_R, 0, Math.PI * 2);
    } else {
      ctx.beginPath();
      ctx.arc(node.x, node.y, COMMIT_R, 0, Math.PI * 2);
    }
    ctx.fillStyle = node.laneColor + "60";
    ctx.strokeStyle = node.laneColor;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
}

function drawCardLabel(
  ctx: CanvasRenderingContext2D,
  node: CommitLayout,
  branch: GitBranchInfo,
) {
  ctx.save();
  ctx.globalAlpha = node.isDone ? 0.25 : 1;

  const baseX = node.x - CARD_W / 2;
  const baseY = node.y + CARD_H / 2;

  // Line 1: task identifier (monospace, muted)
  if (branch.linkedIssueIdentifier) {
    ctx.font = `7px "Courier New", monospace`;
    ctx.fillStyle = "#7E8AA8";
    ctx.fillText(branch.linkedIssueIdentifier, baseX, baseY + 9);
  }

  // Line 2: truncated title
  if (branch.linkedIssueTitle) {
    ctx.font = `8px Inter, sans-serif`;
    ctx.fillStyle = "#cccccc";
    const title =
      branch.linkedIssueTitle.length > 14
        ? branch.linkedIssueTitle.slice(0, 13) + "…"
        : branch.linkedIssueTitle;
    ctx.fillText(title, baseX, baseY + 19);
  }

  ctx.restore();
}

function drawCardBadges(
  ctx: CanvasRenderingContext2D,
  node: CommitLayout,
  branch: GitBranchInfo,
) {
  const rightEdgeX = node.x + CARD_W / 2;

  // 1. CI passing badge — filled green circle with ✓
  if (branch.pr?.ciStatus === "passing") {
    const cx = rightEdgeX + 8;
    const cy = node.y - CARD_H / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#4FB67E";
    ctx.fill();
    ctx.font = "bold 6px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("✓", cx, cy);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    ctx.restore();
    return; // CI badge takes priority
  }

  // 2. PR badge — small indigo rect
  if (branch.pr) {
    const bx = rightEdgeX + 4;
    const by = node.y - 4.5;
    const bw = 18;
    const bh = 9;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 2);
    ctx.fillStyle = "#6470DC33";
    ctx.fill();
    ctx.strokeStyle = "#6470DC";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.font = "bold 6px sans-serif";
    ctx.fillStyle = "#8490e8";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("PR", bx + bw / 2, by + bh / 2);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    ctx.restore();
    return;
  }

  // 3. Conflict warning
  if (branch.overlays?.hasConflicts) {
    ctx.save();
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#ffa040";
    ctx.fillText("⚠", rightEdgeX + 5, node.y + 4);
    ctx.restore();
  }
}

function drawTagPills(ctx: CanvasRenderingContext2D, node: CommitLayout) {
  if (node.tags.length === 0) return;

  ctx.save();
  ctx.font = "bold 9px 'Courier New', monospace";

  let offsetX = node.x + COMMIT_R + 4;
  const pillH = 14;
  const pillY = node.y - pillH / 2;

  for (const tag of node.tags.slice(0, 2)) {
    const textW = ctx.measureText(tag).width;
    const pillW = textW + 10;
    const pillR = 7;

    ctx.beginPath();
    ctx.roundRect(offsetX, pillY, pillW, pillH, pillR);
    ctx.fillStyle = "rgba(217,169,56,0.15)";
    ctx.fill();
    ctx.strokeStyle = "rgba(217,169,56,0.5)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#D9A938";
    ctx.fillText(tag, offsetX + 5, pillY + 9.5);

    offsetX += pillW + 4;
  }
  ctx.restore();
}

function drawHeadLabel(ctx: CanvasRenderingContext2D, node: CommitLayout) {
  ctx.save();
  ctx.font = "9px 'Courier New', monospace";
  ctx.fillStyle = "#7E8AA8";
  ctx.globalAlpha = 0.9;
  // Use card half-height for task-tip nodes, commit radius for plain nodes
  const labelY = node.isTaskTip
    ? node.y - CARD_H / 2 - 8
    : node.y - COMMIT_R - 8;
  const labelW = ctx.measureText("HEAD").width;
  ctx.fillText("HEAD", node.x - labelW / 2, labelY);
  ctx.restore();
}


function drawFlowPulse(
  ctx: CanvasRenderingContext2D,
  laneY: Map<string, number>,
  laneRangeX: Map<string, { min: number; max: number }>,
  branchMap: Map<string, GitBranchInfo>,
  animPhase: number,
  visibleNames: Set<string>,
) {
  ctx.save();
  for (const [name, y] of laneY) {
    if (!visibleNames.has(name)) continue; // respect filter
    const branch = branchMap.get(name);
    if (!branch) continue;
    const isRunning = branch.linkedIssueStatus === "in_progress";
    const isInReview = branch.linkedIssueStatus === "in_review";
    if (!isRunning && !isInReview) continue;

    const range = laneRangeX.get(name);
    if (!range || range.max - range.min < X_SPACING) continue;

    const span = range.max - range.min;
    // t loops 0→1 continuously
    const t = ((animPhase * 0.3) % (Math.PI * 2)) / (Math.PI * 2);
    const dotX = range.min + t * span;

    const dotColor = isRunning ? "#4FB67E" : "#D9A938";
    ctx.beginPath();
    ctx.arc(dotX, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    // Glow
    ctx.beginPath();
    ctx.arc(dotX, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = dotColor + "30";
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

function hitTest(
  nodes: CommitLayout[],
  cx: number,
  cy: number,
): CommitLayout | null {
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

/** Perpendicular distance from point (px,py) to segment (ax,ay)→(bx,by). */
function pointToSegmentDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.sqrt((px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2);
}

/** Returns the lane name of the edge the cursor is closest to (within threshold px). */
function hitTestEdge(
  edges: EdgeLayout[],
  cx: number,
  cy: number,
  threshold = 6,
): EdgeLayout | null {
  let best: EdgeLayout | null = null;
  let bestDist = threshold;
  for (const e of edges) {
    if (e.isDone) continue; // skip faded done edges — not worth hovering
    let dist: number;
    if (e.isMerge && e.fromY !== e.toY) {
      // Bezier approximation: sample 8 points along the cubic and take the min
      const mx = (e.fromX + e.toX) / 2;
      let minD = Infinity;
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const u = 1 - t;
        // Cubic bezier: P0=from, P1=(mx,fromY), P2=(mx,toY), P3=to
        const bx =
          u ** 3 * e.fromX +
          3 * u ** 2 * t * mx +
          3 * u * t ** 2 * mx +
          t ** 3 * e.toX;
        const by =
          u ** 3 * e.fromY +
          3 * u ** 2 * t * e.fromY +
          3 * u * t ** 2 * e.toY +
          t ** 3 * e.toY;
        const d = Math.sqrt((cx - bx) ** 2 + (cy - by) ** 2);
        if (d < minD) minD = d;
      }
      dist = minD;
    } else {
      dist = pointToSegmentDist(cx, cy, e.fromX, e.fromY, e.toX, e.toY);
    }
    if (dist < bestDist) {
      bestDist = dist;
      best = e;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const GitGraphCanvas = forwardRef<GitGraphCanvasHandle, GitGraphCanvasProps>(
  function GitGraphCanvas({ branches, graph, filter, onHover, onClick }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const transformRef = useRef(d3.zoomIdentity);
    const zoomRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
    const initialPanApplied = useRef(false);
    const rafRef = useRef<number | null>(null);
    const animPhaseRef = useRef(0);

    const branchByName = useMemo(
      () => new Map(branches.map((b) => [b.name, b])),
      [branches],
    );

    // Map tipSha → task branch (for collision fix when branches share a tip SHA)
    const taskBranchByTipSha = useMemo(() => {
      const m = new Map<string, GitBranchInfo>();
      for (const b of branches) {
        if (b.lastCommitSha && b.linkedIssueId && !m.has(b.lastCommitSha)) {
          m.set(b.lastCommitSha, b);
        }
      }
      return m;
    }, [branches]);

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

    // Always keep the default branch visible as the backbone even when filtering.
    const visibleNames = useMemo(() => {
      const names = new Set(visibleBranches.map((b) => b.name));
      names.add(graph.defaultBranch); // main always shows for context
      return names;
    }, [visibleBranches, graph.defaultBranch]);

    // Check if any tasks are actively running/in_review (drives RAF loop)
    const hasActiveNodes = useMemo(
      () =>
        branches.some(
          (b) => b.linkedIssueStatus === "in_progress" || b.linkedIssueStatus === "in_review",
        ),
      [branches],
    );

    const layout = useMemo(() => computeLayout(graph, branches), [graph, branches]);

    // Always-current layout ref — prevents stale closure in ResizeObserver
    const layoutRef = useRef(layout);
    layoutRef.current = layout;

    // Reset initial-pan flag whenever graph data changes
    useEffect(() => {
      initialPanApplied.current = false;
    }, [graph]);

    // ── Imperative zoom handle ──────────────────────────────────────────────

    useImperativeHandle(ref, () => ({
      zoomIn() {
        const canvas = canvasRef.current;
        if (!canvas || !zoomRef.current) return;
        d3.select(canvas).call(zoomRef.current.scaleBy, 1.4);
      },
      zoomOut() {
        const canvas = canvasRef.current;
        if (!canvas || !zoomRef.current) return;
        d3.select(canvas).call(zoomRef.current.scaleBy, 1 / 1.4);
      },
      resetZoom() {
        const canvas = canvasRef.current;
        if (!canvas || !zoomRef.current) return;
        d3.select(canvas).call(zoomRef.current.transform, d3.zoomIdentity);
      },
    }));

    // ── Redraw ──────────────────────────────────────────────────────────────

    const redraw = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const t = transformRef.current;
      const dpr = window.devicePixelRatio || 1;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.setTransform(t.k * dpr, 0, 0, t.k * dpr, t.x * dpr, t.y * dpr);

      // Visible nodes + edges — filter by laneName so ALL commits in hidden
      // lanes disappear, not just tips.
      const visibleNodes = layout.nodes.filter((n) => visibleNames.has(n.laneName));
      const visibleEdges = layout.edges.filter((e) => visibleNames.has(e.laneName));

      // 1. Edges (behind everything)
      drawEdges(ctx, visibleEdges);

      // 2. Flow pulse dots (on top of edges, under nodes)
      if (hasActiveNodes) {
        drawFlowPulse(ctx, layout.laneY, layout.laneRangeX, branchByName, animPhaseRef.current, visibleNames);
      }

      // 3. Commit nodes + task labels
      for (const node of visibleNodes) {
        const branchStatus =
          node.branchName != null
            ? (branchByName.get(node.branchName)?.linkedIssueStatus ?? null)
            : null;
        drawCommitNode(ctx, node, animPhaseRef.current, branchStatus);

        // Draw task labels + external badges for task cards
        if (node.isTaskTip) {
          let branch = node.branchName ? branchByName.get(node.branchName) : undefined;
          if (!branch?.linkedIssueId) branch = taskBranchByTipSha.get(node.sha);
          if (branch?.linkedIssueId) {
            drawCardLabel(ctx, node, branch);
            drawCardBadges(ctx, node, branch);
          }
        }
      }

      // 4. Tag pills (above nodes)
      for (const node of visibleNodes) {
        if (node.tags.length > 0) drawTagPills(ctx, node);
      }

      // 5. HEAD label on default branch tip
      const defaultTip = visibleNodes.find((n) => n.isDefault && n.branchName !== null);
      if (defaultTip) drawHeadLabel(ctx, defaultTip);

      ctx.restore();
    }, [layout, visibleNames, branchByName, graph.defaultBranch, hasActiveNodes]);

    // ── RAF loop ────────────────────────────────────────────────────────────

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

    // ── Resize handler ──────────────────────────────────────────────────────

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

        const totalWidth = layoutRef.current.totalWidth;
        if (!initialPanApplied.current && zoomRef.current && w > 0 && totalWidth > w) {
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

    // ── D3 zoom ─────────────────────────────────────────────────────────────

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const zoom = d3
        .zoom<HTMLCanvasElement, unknown>()
        .scaleExtent([0.2, 4])
        .on("start", () => {
          canvas.style.cursor = "grabbing";
        })
        .on("zoom", (event: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
          transformRef.current = event.transform;
          redraw();
        })
        .on("end", () => {
          canvas.style.cursor = "grab";
        });

      zoomRef.current = zoom;
      d3.select(canvas).call(zoom);
      return () => {
        d3.select(canvas).on(".zoom", null);
        zoomRef.current = null;
      };
    }, [redraw]);

    // ── Pointer events ──────────────────────────────────────────────────────

    const handleMouseMove = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const t = transformRef.current;
        const cx = (e.clientX - rect.left - t.x) / t.k;
        const cy = (e.clientY - rect.top - t.y) / t.k;

        const hit = hitTest(layout.nodes, cx, cy);

        if (!hit) {
          // No node — check if cursor is over a branch line
          const visEdges = layout.edges.filter((ed) => visibleNames.has(ed.laneName));
          const edgeHit = hitTestEdge(visEdges, cx, cy);
          if (edgeHit) {
            canvas.style.cursor = "pointer";
            const branch = branchByName.get(edgeHit.laneName);
            if (branch) {
              const hoverType = branch.linkedIssueId ? "task" : "plain_tip";
              onHover(
                hoverType === "task"
                  ? { type: "task", branch }
                  : { type: "plain_tip", branch },
                { x: e.clientX, y: e.clientY },
              );
            } else {
              onHover(null, { x: e.clientX, y: e.clientY });
            }
          } else {
            canvas.style.cursor = "grab";
            onHover(null, { x: e.clientX, y: e.clientY });
          }
          return;
        }

        // Node hit — update cursor
        canvas.style.cursor = "pointer";

        // 1. Task tip — handle SHA collision (main + feature branch at same commit)
        if (hit.isTaskTip) {
          let branch = hit.branchName ? branchByName.get(hit.branchName) : undefined;
          if (!branch?.linkedIssueId) {
            // tipShaToLane assigned this SHA to a non-task branch first (e.g. main).
            // Fall back to the task branch that actually owns this tip SHA.
            branch = taskBranchByTipSha.get(hit.sha);
          }
          if (branch?.linkedIssueId) {
            onHover({ type: "task", branch }, { x: e.clientX, y: e.clientY });
            return;
          }
          // SHA flagged as task tip but we couldn't resolve the branch — fall through
        }

        // 2. Non-task branch tip → plain_tip
        if (hit.branchName) {
          const branch = branchByName.get(hit.branchName);
          if (branch) {
            onHover({ type: "plain_tip", branch }, { x: e.clientX, y: e.clientY });
            return;
          }
        }

        // 3. Merge commit
        if (hit.isMerge) {
          const commit = graph.commits.find((c) => c.sha === hit.sha);
          if (commit) {
            onHover({ type: "merge", commit }, { x: e.clientX, y: e.clientY });
            return;
          }
        }

        // 4. Regular commit
        const commit = graph.commits.find((c) => c.sha === hit.sha);
        if (commit) {
          onHover({ type: "commit", commit }, { x: e.clientX, y: e.clientY });
        }
      },
      [layout.nodes, layout.edges, visibleNames, branchByName, taskBranchByTipSha, graph.commits, onHover],
    );

    const handleMouseLeave = useCallback(() => {
      const canvas = canvasRef.current;
      if (canvas) canvas.style.cursor = "grab";
      // Don't null immediately — GitCommandCentre uses a 200ms grace period timer
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

        if (hit.isTaskTip) {
          let branch = hit.branchName ? branchByName.get(hit.branchName) : undefined;
          if (!branch?.linkedIssueId) {
            branch = taskBranchByTipSha.get(hit.sha);
          }
          if (branch?.linkedIssueId) {
            onClick({ type: "task", branch });
            return;
          }
        }

        if (hit.branchName) {
          const branch = branchByName.get(hit.branchName);
          if (branch) {
            onClick({ type: "plain_tip", branch });
            return;
          }
        }

        if (hit.isMerge) {
          const commit = graph.commits.find((c) => c.sha === hit.sha);
          if (commit) { onClick({ type: "merge", commit }); return; }
        }

        const commit = graph.commits.find((c) => c.sha === hit.sha);
        if (commit) onClick({ type: "commit", commit });
      },
      [layout.nodes, branchByName, taskBranchByTipSha, graph.commits, onClick],
    );

    return (
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
      />
    );
  },
);
