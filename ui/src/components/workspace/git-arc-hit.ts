/**
 * git-arc-hit.ts — pure hit-region registry for the Git Command Centre Map.
 *
 * buildHitRegions() produces an ordered list of regions that mirrors exactly
 * what GitGraphCanvas.redraw() draws (same layout + filter inputs + the shared
 * resolveNodeRender decision). hitRegionAt() walks them topmost-first. No DOM,
 * no canvas, no React — fully unit-testable.
 */

import type { GitBranchInfo } from "@armyofagents/shared";
import type { ArcCommitLayout, ArcLayoutResult, TipStack } from "./git-arc-layout";
import { computeStackCardLayout } from "./git-arc-layout";
import { CARD_W, CARD_H, COMMIT_R, pointToSegmentDistance } from "./git-arc-draw";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type HitTarget =
  | { kind: "task"; branchName: string }
  | { kind: "plainTip"; branchName: string }
  | { kind: "commit"; sha: string }
  | { kind: "merge"; sha: string }
  | { kind: "tag"; name: string; sha: string }
  | { kind: "trunkLine" }
  | { kind: "showMore" };

export type HitRegion =
  | { shape: "rect"; x: number; y: number; w: number; h: number; target: HitTarget }
  | { shape: "poly"; pts: Array<[number, number]>; threshold: number; target: HitTarget };

/** Topmost-first hit test: regions pushed later (drawn on top) win. */
export function hitRegionAt(
  regions: HitRegion[],
  cx: number,
  cy: number,
): HitTarget | null {
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i]!;
    if (r.shape === "rect") {
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return r.target;
    } else {
      for (let j = 0; j < r.pts.length - 1; j++) {
        const d = pointToSegmentDistance(
          cx, cy, r.pts[j]![0], r.pts[j]![1], r.pts[j + 1]![0], r.pts[j + 1]![1],
        );
        if (d <= r.threshold) return r.target;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-node draw decision — SHARED by redraw() and buildHitRegions() so the hit
// area can never disagree with what's drawn.
// ---------------------------------------------------------------------------

export interface NodeRender {
  isStacked: boolean;
  /** The task branch whose tip is this commit (or null). */
  taskBranch: GitBranchInfo | null;
  /** True when that task passes the active filter (in visibleNames). */
  taskVisible: boolean;
  /** True when the node renders as a plain dot rather than a card. */
  asDot: boolean;
}

export function resolveNodeRender(
  node: ArcCommitLayout,
  visibleNames: Set<string>,
  branchByName: Map<string, GitBranchInfo>,
  taskBranchByTipSha: Map<string, GitBranchInfo>,
  stackedShas: Set<string>,
): NodeRender {
  const isStacked = stackedShas.has(node.sha);
  let taskBranch: GitBranchInfo | null =
    (node.branchName ? branchByName.get(node.branchName) : undefined) ?? null;
  if (!taskBranch?.linkedIssueId) {
    taskBranch = taskBranchByTipSha.get(node.sha) ?? null;
  }
  const taskVisible =
    !!taskBranch?.linkedIssueId && visibleNames.has(taskBranch.name);
  const asDot = isStacked || (node.isTaskTip && !taskVisible);
  return { isStacked, taskBranch, taskVisible, asDot };
}
