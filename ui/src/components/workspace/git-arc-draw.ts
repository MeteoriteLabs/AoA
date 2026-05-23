/**
 * git-arc-draw.ts — Canvas drawing functions for the trunk-and-arcs git graph.
 *
 * Extracted from GitGraphCanvas.tsx so both the React component AND the
 * standalone visual test harness can use the exact same drawing code.
 * Pure canvas drawing — no React, no DOM events, no D3.
 */

import type { GitBranchInfo } from "@armyofagents/shared";
import type { ArcCommitLayout, ArcDefinition } from "./git-arc-layout";

// ---------------------------------------------------------------------------
// Path helpers (shared by drawArcLines, drawFlowPulse, hit testing)
// ---------------------------------------------------------------------------

/**
 * Stroke a smooth Catmull-Rom curve that PASSES THROUGH every point. Because it
 * passes through (not near) the points, commit dots placed at those points are
 * always on the line. Falls back to a straight line for < 3 points.
 */
export function strokeSmoothPath(
  ctx: CanvasRenderingContext2D,
  points: Array<[number, number]>,
) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0]![0], points[0]![1]);
  if (points.length === 2) {
    ctx.lineTo(points[1]![0], points[1]![1]);
    ctx.stroke();
    return;
  }
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
  }
  ctx.stroke();
}

/**
 * Point at parameter t ∈ [0,1] along a polyline (linear interpolation by
 * cumulative segment length). Used by the flow pulse and hit testing so they
 * follow the exact same path the line is drawn on.
 */
export function polylinePointAt(
  points: Array<[number, number]>,
  t: number,
): [number, number] {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0]!;
  const clamped = Math.max(0, Math.min(1, t));
  let total = 0;
  const segLen: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1]![0] - points[i]![0];
    const dy = points[i + 1]![1] - points[i]![1];
    const len = Math.hypot(dx, dy);
    segLen.push(len);
    total += len;
  }
  if (total === 0) return points[0]!;
  let target = clamped * total;
  for (let i = 0; i < segLen.length; i++) {
    if (target <= segLen[i]!) {
      const f = segLen[i] === 0 ? 0 : target / segLen[i]!;
      return [
        points[i]![0] + (points[i + 1]![0] - points[i]![0]) * f,
        points[i]![1] + (points[i + 1]![1] - points[i]![1]) * f,
      ];
    }
    target -= segLen[i]!;
  }
  return points[points.length - 1]!;
}

// ---------------------------------------------------------------------------
// Drawing constants
// ---------------------------------------------------------------------------

export const COMMIT_R = 5;
export const CARD_W = 28;
export const CARD_H = 18;

/** Single source of truth for task-status → color. Used by the canvas
 * (statusDotColor) and the legend, so they never drift apart. */
export const STATUS_COLORS = {
  in_progress: "#4FB67E",
  in_review: "#D9A938",
  blocked: "#ef4444",
  done: "#7E8AA8",
  cancelled: "#7E8AA8",
  planning: "#D9A938",
} as const;

export function statusDotColor(status: string | null, fallback: string): string {
  if (status && status in STATUS_COLORS) {
    return STATUS_COLORS[status as keyof typeof STATUS_COLORS];
  }
  return fallback;
}

export function drawCommitNode(
  ctx: CanvasRenderingContext2D,
  node: ArcCommitLayout,
  animPhase: number,
  branchStatus: string | null,
) {
  const doneAlpha = node.isDone ? 0.45 : 1;

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

export function drawCardLabel(
  ctx: CanvasRenderingContext2D,
  node: ArcCommitLayout,
  branch: GitBranchInfo,
) {
  ctx.save();
  ctx.globalAlpha = node.isDone ? 0.45 : 1;

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

export function drawCardBadges(
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

export function drawTagPills(ctx: CanvasRenderingContext2D, node: ArcCommitLayout) {
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

export function drawHeadLabel(ctx: CanvasRenderingContext2D, node: ArcCommitLayout) {
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


export function drawTrunk(
  ctx: CanvasRenderingContext2D,
  nodes: ArcCommitLayout[],
  trunkY: number,
  color: string,
  defaultBranch: string,
) {
  const trunkNodes = nodes.filter((n) => n.isTrunk);
  if (trunkNodes.length < 2) return;
  const minX = Math.min(...trunkNodes.map((n) => n.x));
  const maxX = Math.max(...trunkNodes.map((n) => n.x));
  ctx.save();
  // Glow underlay
  ctx.beginPath();
  ctx.moveTo(minX, trunkY);
  ctx.lineTo(maxX, trunkY);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 8;
  ctx.setLineDash([]);
  ctx.stroke();
  // Solid trunk
  ctx.beginPath();
  ctx.moveTo(minX, trunkY);
  ctx.lineTo(maxX, trunkY);
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  // Label at the left end
  ctx.globalAlpha = 0.85;
  ctx.font = `bold 9px "Courier New", monospace`;
  ctx.fillStyle = color;
  ctx.fillText(defaultBranch, minX, trunkY - 8);
  ctx.restore();
}

export function drawArcLines(
  ctx: CanvasRenderingContext2D,
  arcs: ArcDefinition[],
  visibleNames: Set<string>,
) {
  for (const arc of arcs) {
    if (!visibleNames.has(arc.branchName)) continue;
    if (arc.points.length < 2) continue;

    ctx.save();
    ctx.strokeStyle = arc.color;
    ctx.lineWidth = 2;
    ctx.globalAlpha = arc.isDone ? 0.4 : 0.7;
    ctx.setLineDash([]);

    if (arc.isOpen) {
      const solid = arc.points.slice(0, -1);
      const tail = arc.points[arc.points.length - 1]!;
      strokeSmoothPath(ctx, solid);
      const lastSolid = solid[solid.length - 1]!;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(lastSolid[0], lastSolid[1]);
      ctx.lineTo(tail[0], tail[1]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      strokeSmoothPath(ctx, arc.points);
    }
    ctx.restore();
  }
}

export function drawArcLabels(
  ctx: CanvasRenderingContext2D,
  arcs: ArcDefinition[],
  visibleNames: Set<string>,
  /**
   * Branch names that already render a task card. Those cards show the task
   * identifier + title, so drawing the arc name label too just collides with
   * the card. Only plain (no-task) branches get an arc name label.
   */
  cardBranchNames: Set<string>,
) {
  ctx.save();
  ctx.font = `9px "Courier New", monospace`;

  // Track placed label rects (in layout space) to avoid two plain-branch
  // labels landing on the same spot. Simple vertical nudge on collision.
  const placed: Array<{ x: number; y: number; w: number }> = [];

  for (const arc of arcs) {
    if (!visibleNames.has(arc.branchName)) continue;
    if (arc.isDone) continue; // labels only for active arcs
    if (cardBranchNames.has(arc.branchName)) continue; // card already labels it

    const labelX =
      arc.isOpen || arc.mergePointX == null
        ? arc.branchPointX + 80
        : (arc.branchPointX + arc.mergePointX) / 2;
    const baseY = arc.direction === "up" ? arc.apexY - 8 : arc.apexY + 14;

    const name =
      arc.branchName.length > 18
        ? arc.branchName.slice(0, 17) + "…"
        : arc.branchName;
    const w = ctx.measureText(name).width;
    const drawX = labelX - w / 2;

    // Nudge vertically if this label would overlap an already-placed one.
    let labelY = baseY;
    const step = arc.direction === "up" ? -11 : 11;
    let guard = 0;
    while (
      guard < 6 &&
      placed.some(
        (p) =>
          Math.abs(p.y - labelY) < 10 &&
          drawX < p.x + p.w + 4 &&
          drawX + w > p.x - 4,
      )
    ) {
      labelY += step;
      guard++;
    }
    placed.push({ x: drawX, y: labelY, w });

    ctx.globalAlpha = 0.7;
    ctx.fillStyle = arc.color;
    ctx.fillText(name, drawX, labelY);
  }

  ctx.restore();
}

export function drawLabelDots(
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

export function drawFlowPulse(
  ctx: CanvasRenderingContext2D,
  arcs: ArcDefinition[],
  trunkNodes: ArcCommitLayout[],
  branchByName: Map<string, GitBranchInfo>,
  animPhase: number,
  visibleNames: Set<string>,
  trunkY: number,
  _defaultBranch: string,
) {
  ctx.save();

  const t = ((animPhase * 0.3) % (Math.PI * 2)) / (Math.PI * 2);

  // Always-on trunk pulse: a bright dot travels left→right along the trunk.
  if (trunkNodes.length >= 2) {
    const minX = Math.min(...trunkNodes.map((n) => n.x));
    const maxX = Math.max(...trunkNodes.map((n) => n.x));
    const dotX = minX + t * (maxX - minX);
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(dotX, trunkY, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.beginPath(); ctx.arc(dotX, trunkY, 9, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff22"; ctx.fill();
    ctx.globalAlpha = 1;
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
    const [dotX, dotY] = polylinePointAt(arc.points, t);

    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fillStyle = dotColor; ctx.fill();
    ctx.beginPath(); ctx.arc(dotX, dotY, 7, 0, Math.PI * 2);
    ctx.fillStyle = dotColor + "30"; ctx.fill();
  }

  ctx.restore();
}
