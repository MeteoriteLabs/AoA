/**
 * GitGraphCanvas — D3 + Canvas renderer for the Git Command Centre.
 *
 * Uses a trunk-and-arcs layout: main branch is a central horizontal spine;
 * feature branches arc above and below as bezier curves.
 *
 * Exposed via forwardRef as GitGraphCanvasHandle for imperative zoom controls.
 * Animation loop (RAF) only runs when running/in_review tasks are present.
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
import {
  computeArcLayout,
  type ArcCommitLayout,
  type ArcDefinition,
  PAD_LEFT,
} from "./git-arc-layout";

// ---------------------------------------------------------------------------
// Drawing constants
// ---------------------------------------------------------------------------

const COMMIT_R = 5;
const CARD_W = 28;
const CARD_H = 18;

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


export interface GitGraphCanvasProps {
  branches: GitBranchInfo[];
  graph: GitGraphData;
  filter: "all" | "running" | "blocked" | "prs" | "merged";
  onHover: (node: HoveredNode | null, position: { x: number; y: number }) => void;
  onClick: (node: HoveredNode) => void;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawCommitNode(
  ctx: CanvasRenderingContext2D,
  node: ArcCommitLayout,
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
  node: ArcCommitLayout,
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
  node: ArcCommitLayout,
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

function drawTagPills(ctx: CanvasRenderingContext2D, node: ArcCommitLayout) {
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

function drawHeadLabel(ctx: CanvasRenderingContext2D, node: ArcCommitLayout) {
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


function drawTrunk(
  ctx: CanvasRenderingContext2D,
  nodes: ArcCommitLayout[],
  trunkY: number,
  color: string,
) {
  const trunkNodes = nodes.filter((n) => n.isTrunk);
  if (trunkNodes.length < 2) return;
  const minX = Math.min(...trunkNodes.map((n) => n.x));
  const maxX = Math.max(...trunkNodes.map((n) => n.x));
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(minX, trunkY);
  ctx.lineTo(maxX, trunkY);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.7;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.restore();
}

function drawArcLines(
  ctx: CanvasRenderingContext2D,
  arcs: ArcDefinition[],
  visibleNames: Set<string>,
  canvasRightInLayout: number,
  trunkY: number,
) {
  for (const arc of arcs) {
    if (!visibleNames.has(arc.branchName)) continue;

    ctx.save();
    ctx.strokeStyle = arc.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = arc.isDone ? 0.15 : 0.7;
    ctx.setLineDash([]);

    if (!arc.isOpen && arc.mergePointX != null) {
      // Closed arc: two-segment cubic bezier
      const span = arc.mergePointX - arc.branchPointX;
      const apexX = (arc.branchPointX + arc.mergePointX) / 2;
      const offset = span * 0.25;

      ctx.beginPath();
      ctx.moveTo(arc.branchPointX, trunkY);
      ctx.bezierCurveTo(
        arc.branchPointX + offset, trunkY,
        apexX, arc.apexY,
        apexX, arc.apexY,
      );
      ctx.bezierCurveTo(
        apexX, arc.apexY,
        arc.mergePointX - offset, trunkY,
        arc.mergePointX, trunkY,
      );
      ctx.stroke();
    } else {
      // Open arc: curve up to rail height, then flat rail with dashed tail
      const railStartX = arc.branchPointX + 60;
      const curveOffset = railStartX - arc.branchPointX;
      const tailX = canvasRightInLayout - 20;

      ctx.beginPath();
      ctx.moveTo(arc.branchPointX, trunkY);
      ctx.bezierCurveTo(
        arc.branchPointX + curveOffset * 0.4, trunkY,
        railStartX, arc.apexY,
        railStartX, arc.apexY,
      );
      ctx.lineTo(tailX, arc.apexY);
      ctx.stroke();

      // Dashed tail at right edge
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(tailX, arc.apexY);
      ctx.lineTo(canvasRightInLayout, arc.apexY);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawArcLabels(
  ctx: CanvasRenderingContext2D,
  arcs: ArcDefinition[],
  visibleNames: Set<string>,
) {
  ctx.save();
  ctx.font = `9px "Courier New", monospace`;

  for (const arc of arcs) {
    if (!visibleNames.has(arc.branchName)) continue;
    if (arc.isDone) continue; // labels only for active arcs

    const labelX =
      arc.isOpen || arc.mergePointX == null
        ? arc.branchPointX + 80
        : (arc.branchPointX + arc.mergePointX) / 2;
    const labelY = arc.direction === "up" ? arc.apexY - 8 : arc.apexY + 14;

    ctx.globalAlpha = 0.7;
    ctx.fillStyle = arc.color;
    const name =
      arc.branchName.length > 22
        ? arc.branchName.slice(0, 21) + "…"
        : arc.branchName;
    ctx.fillText(name, labelX - ctx.measureText(name).width / 2, labelY);
  }

  ctx.restore();
}

function drawLabelDots(
  ctx: CanvasRenderingContext2D,
  node: ArcCommitLayout,
  branch: GitBranchInfo,
) {
  const labels = branch.pr?.labels;
  if (!labels || labels.length === 0) return;
  const maxDots = Math.min(labels.length, 3);
  const startX = node.x - CARD_W / 2;
  const dotY = node.y + CARD_H / 2 + 28; // below card label text
  ctx.save();
  for (let i = 0; i < maxDots; i++) {
    const color = labels[i]!.color;
    ctx.fillStyle = color.startsWith("#") ? color : `#${color}`;
    ctx.beginPath();
    ctx.rect(startX + i * 8, dotY, 5, 5);
    ctx.fill();
  }
  ctx.restore();
}

function drawFlowPulse(
  ctx: CanvasRenderingContext2D,
  arcs: ArcDefinition[],
  trunkNodes: ArcCommitLayout[],
  branchByName: Map<string, GitBranchInfo>,
  animPhase: number,
  visibleNames: Set<string>,
  trunkY: number,
  defaultBranch: string,
) {
  ctx.save();

  // Helper: sample two-segment closed arc at t ∈ [0,1]
  function closedArcPoint(arc: ArcDefinition, t: number): [number, number] {
    const span = arc.mergePointX! - arc.branchPointX;
    const apexX = (arc.branchPointX + arc.mergePointX!) / 2;
    const offset = span * 0.25;
    if (t <= 0.5) {
      const tt = t * 2;
      const u = 1 - tt;
      const bx =
        u ** 3 * arc.branchPointX +
        3 * u ** 2 * tt * (arc.branchPointX + offset) +
        3 * u * tt ** 2 * apexX +
        tt ** 3 * apexX;
      const by =
        u ** 3 * trunkY +
        3 * u ** 2 * tt * trunkY +
        3 * u * tt ** 2 * arc.apexY +
        tt ** 3 * arc.apexY;
      return [bx, by];
    } else {
      const tt = (t - 0.5) * 2;
      const u = 1 - tt;
      const bx =
        u ** 3 * apexX +
        3 * u ** 2 * tt * apexX +
        3 * u * tt ** 2 * (arc.mergePointX! - offset) +
        tt ** 3 * arc.mergePointX!;
      const by =
        u ** 3 * arc.apexY +
        3 * u ** 2 * tt * arc.apexY +
        3 * u * tt ** 2 * trunkY +
        tt ** 3 * trunkY;
      return [bx, by];
    }
  }

  const t = ((animPhase * 0.3) % (Math.PI * 2)) / (Math.PI * 2);

  // Trunk pulse for default branch
  const defaultInfo = branchByName.get(defaultBranch);
  if (
    defaultInfo &&
    (defaultInfo.linkedIssueStatus === "in_progress" ||
      defaultInfo.linkedIssueStatus === "in_review") &&
    trunkNodes.length >= 2
  ) {
    const minX = Math.min(...trunkNodes.map((n) => n.x));
    const maxX = Math.max(...trunkNodes.map((n) => n.x));
    const dotX = minX + t * (maxX - minX);
    const dotColor = defaultInfo.linkedIssueStatus === "in_progress" ? "#4FB67E" : "#D9A938";
    ctx.beginPath(); ctx.arc(dotX, trunkY, 4, 0, Math.PI * 2);
    ctx.fillStyle = dotColor; ctx.globalAlpha = 0.85; ctx.fill();
    ctx.beginPath(); ctx.arc(dotX, trunkY, 7, 0, Math.PI * 2);
    ctx.fillStyle = dotColor + "30"; ctx.fill();
  }

  // Arc pulses
  for (const arc of arcs) {
    if (!visibleNames.has(arc.branchName)) continue;
    const info = branchByName.get(arc.branchName);
    if (!info) continue;
    const isRunning = info.linkedIssueStatus === "in_progress";
    const isInReview = info.linkedIssueStatus === "in_review";
    if (!isRunning && !isInReview) continue;

    const dotColor = isRunning ? "#4FB67E" : "#D9A938";
    let dotX: number;
    let dotY: number;

    if (!arc.isOpen && arc.mergePointX != null) {
      [dotX, dotY] = closedArcPoint(arc, t);
    } else {
      // Open arc: 30% curve, 70% rail
      const railStartX = arc.branchPointX + 60;
      const curveOffset = railStartX - arc.branchPointX;
      if (t <= 0.3) {
        const tt = t / 0.3;
        const u = 1 - tt;
        dotX =
          u ** 3 * arc.branchPointX +
          3 * u ** 2 * tt * (arc.branchPointX + curveOffset * 0.4) +
          3 * u * tt ** 2 * railStartX +
          tt ** 3 * railStartX;
        dotY =
          u ** 3 * trunkY +
          3 * u ** 2 * tt * trunkY +
          3 * u * tt ** 2 * arc.apexY +
          tt ** 3 * arc.apexY;
      } else {
        const railT = (t - 0.3) / 0.7;
        dotX = railStartX + railT * 300;
        dotY = arc.apexY;
      }
    }

    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fillStyle = dotColor; ctx.fill();
    ctx.beginPath(); ctx.arc(dotX, dotY, 7, 0, Math.PI * 2);
    ctx.fillStyle = dotColor + "30"; ctx.fill();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

function hitTest(
  nodes: ArcCommitLayout[],
  cx: number,
  cy: number,
): ArcCommitLayout | null {
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

function hitTestArc(
  arcs: ArcDefinition[],
  visibleNames: Set<string>,
  cx: number,
  cy: number,
  trunkY: number,
  threshold = 8,
): ArcDefinition | null {
  let best: ArcDefinition | null = null;
  let bestDist = threshold;

  for (const arc of arcs) {
    if (!visibleNames.has(arc.branchName)) continue;
    if (arc.isDone) continue;

    const points: Array<[number, number]> = [];

    if (!arc.isOpen && arc.mergePointX != null) {
      const span = arc.mergePointX - arc.branchPointX;
      const apexX = (arc.branchPointX + arc.mergePointX) / 2;
      const offset = span * 0.25;

      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        if (t <= 0.5) {
          const tt = t * 2;
          const u = 1 - tt;
          points.push([
            u ** 3 * arc.branchPointX + 3 * u ** 2 * tt * (arc.branchPointX + offset) + 3 * u * tt ** 2 * apexX + tt ** 3 * apexX,
            u ** 3 * trunkY + 3 * u ** 2 * tt * trunkY + 3 * u * tt ** 2 * arc.apexY + tt ** 3 * arc.apexY,
          ]);
        } else {
          const tt = (t - 0.5) * 2;
          const u = 1 - tt;
          points.push([
            u ** 3 * apexX + 3 * u ** 2 * tt * apexX + 3 * u * tt ** 2 * (arc.mergePointX! - offset) + tt ** 3 * arc.mergePointX!,
            u ** 3 * arc.apexY + 3 * u ** 2 * tt * arc.apexY + 3 * u * tt ** 2 * trunkY + tt ** 3 * trunkY,
          ]);
        }
      }
    } else {
      const railStartX = arc.branchPointX + 60;
      const curveOffset = railStartX - arc.branchPointX;
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        if (t <= 0.5) {
          const tt = t * 2;
          const u = 1 - tt;
          points.push([
            u ** 3 * arc.branchPointX + 3 * u ** 2 * tt * (arc.branchPointX + curveOffset * 0.4) + 3 * u * tt ** 2 * railStartX + tt ** 3 * railStartX,
            u ** 3 * trunkY + 3 * u ** 2 * tt * trunkY + 3 * u * tt ** 2 * arc.apexY + tt ** 3 * arc.apexY,
          ]);
        } else {
          const railT = (t - 0.5) * 2;
          points.push([railStartX + railT * 200, arc.apexY]);
        }
      }
    }

    for (const [px, py] of points) {
      const d = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
      if (d < bestDist) {
        bestDist = d;
        best = arc;
      }
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

    // Filter branches
    const visibleBranches = useMemo(() => {
      if (filter === "all") return branches;
      if (filter === "running") return branches.filter((b) => b.linkedIssueStatus === "in_progress");
      if (filter === "blocked") return branches.filter((b) => b.linkedIssueStatus === "blocked");
      if (filter === "prs")     return branches.filter((b) => !!b.pr);
      if (filter === "merged")  return branches.filter(
        (b) => b.linkedIssueStatus === "done" || b.linkedIssueStatus === "cancelled",
      );
      return branches;
    }, [branches, filter]);

    const visibleNames = useMemo(() => {
      const names = new Set(visibleBranches.map((b) => b.name));
      names.add(graph.defaultBranch); // trunk always visible
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

    const layout = useMemo(
      () => computeArcLayout(graph, branches),
      [graph, branches],
    );

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

      // Canvas right edge in layout space (for open-arc rail endpoint)
      const canvasRightInLayout = (canvas.width / dpr - t.x) / t.k;

      // Default branch color for trunk line
      const trunkColor =
        graph.branches.find((b) => b.name === graph.defaultBranch)?.color ?? "#6470DC";

      // Filter nodes: trunk always shown; arc nodes filtered by arcBranchName
      const visibleNodes = layout.nodes.filter((n) => {
        if (n.isTrunk) return visibleNames.has(graph.defaultBranch);
        return n.arcBranchName != null && visibleNames.has(n.arcBranchName);
      });

      // 1. Trunk line
      drawTrunk(ctx, layout.nodes, layout.trunkY, trunkColor);

      // 2. Arc lines (bezier + rail)
      drawArcLines(ctx, layout.arcs, visibleNames, canvasRightInLayout, layout.trunkY);

      // 3. Flow pulse dots
      if (hasActiveNodes) {
        const trunkNodes = layout.nodes.filter((n) => n.isTrunk);
        drawFlowPulse(
          ctx,
          layout.arcs,
          trunkNodes,
          branchByName,
          animPhaseRef.current,
          visibleNames,
          layout.trunkY,
          graph.defaultBranch,
        );
      }

      // 4. Commit nodes + task labels + badges + label dots
      for (const node of visibleNodes) {
        const branchStatus =
          node.branchName != null
            ? (branchByName.get(node.branchName)?.linkedIssueStatus ?? null)
            : null;
        drawCommitNode(ctx, node, animPhaseRef.current, branchStatus);

        if (node.isTaskTip) {
          let branch = node.branchName ? branchByName.get(node.branchName) : undefined;
          if (!branch?.linkedIssueId) branch = taskBranchByTipSha.get(node.sha);
          if (branch?.linkedIssueId) {
            drawCardLabel(ctx, node, branch);
            drawCardBadges(ctx, node, branch);
            drawLabelDots(ctx, node, branch);
          }
        }
      }

      // 5. Tag pills
      for (const node of visibleNodes) {
        if (node.tags.length > 0) drawTagPills(ctx, node);
      }

      // 6. HEAD label on default branch tip
      const defaultTip = visibleNodes.find((n) => n.isDefault && n.branchName != null);
      if (defaultTip) drawHeadLabel(ctx, defaultTip);

      // 7. Arc labels (branch name near apex)
      drawArcLabels(ctx, layout.arcs, visibleNames);

      ctx.restore();
    }, [layout, visibleNames, branchByName, graph.defaultBranch, graph.branches, hasActiveNodes]);

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
          // No node — check if cursor is over a branch arc
          const arcHit = hitTestArc(layout.arcs, visibleNames, cx, cy, layout.trunkY);
          if (arcHit) {
            canvas.style.cursor = "pointer";
            const branch = branchByName.get(arcHit.branchName);
            if (branch) {
              onHover(
                branch.linkedIssueId
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
      [layout.nodes, layout.arcs, visibleNames, branchByName, taskBranchByTipSha, graph.commits, onHover],
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
