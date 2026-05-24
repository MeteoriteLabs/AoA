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
import { placeArcLabels } from "./git-arc-labels";

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

// ---------------------------------------------------------------------------
// Region geometry constants (generous so the hit area always covers the glyph)
// ---------------------------------------------------------------------------

const PAD = 4;
const BADGE_EXT = 26;   // card → right, covers CI/PR/conflict badges
const LABEL_EXT = 24;   // card → down, covers the 2 label lines
const STACK_LABEL_EXT = 36; // stacked card → right, covers the id label
const SYNC_EXT_DEFAULT = 30; // node → up on the default tip (clears HEAD + sync)
const SYNC_EXT = 18;    // node → up on a normal tip (sync marker)
const TAG_W = 90;       // node → right, covers up to 2 tag pills
const ARC_THRESHOLD = 8;
const TRUNK_THRESHOLD = 8;
const HEAD_W = 24;        // approx px width of the "HEAD" label at 9px monospace

function hasSync(b: GitBranchInfo | null | undefined): boolean {
  return !!b && ((b.aheadCount ?? 0) > 0 || (b.behindCount ?? 0) > 0);
}

export interface BuildHitRegionsArgs {
  layout: ArcLayoutResult;
  visibleNames: Set<string>;
  arcVisibleNames: Set<string>;
  visibleStacks: TipStack[];
  stackedShas: Set<string>;
  branchByName: Map<string, GitBranchInfo>;
  taskBranchByTipSha: Map<string, GitBranchInfo>;
  trunkSpan: { minX: number; maxX: number } | null;
  defaultBranch: string;
}

/** Build the ordered hit-region list. Order = draw order (later = on top), so
 * hitRegionAt() walks it in reverse and stack cards/pills beat nodes beat lines. */
export function buildHitRegions(args: BuildHitRegionsArgs): HitRegion[] {
  const {
    layout, visibleNames, arcVisibleNames, visibleStacks, stackedShas,
    branchByName, taskBranchByTipSha, trunkSpan, defaultBranch,
  } = args;
  const regions: HitRegion[] = [];

  // 1. Trunk line (bottom of the stack).
  if (trunkSpan) {
    regions.push({
      shape: "poly",
      pts: [[trunkSpan.minX, layout.trunkY], [trunkSpan.maxX, layout.trunkY]],
      threshold: TRUNK_THRESHOLD,
      target: { kind: "trunkLine" },
    });
  }

  // 2. Arc lines (incl. done/cancelled — they are hittable whenever visible).
  for (const arc of layout.arcs) {
    if (!arcVisibleNames.has(arc.branchName)) continue;
    if (arc.points.length < 2) continue;
    const b = branchByName.get(arc.branchName);
    const target: HitTarget = b?.linkedIssueId
      ? { kind: "task", branchName: arc.branchName }
      : { kind: "plainTip", branchName: arc.branchName };
    regions.push({ shape: "poly", pts: arc.points, threshold: ARC_THRESHOLD, target });
  }

  // 3. Nodes (dots/cards) + their tags. Mirror redraw's visibleNodes filter.
  // Track which branches drew a task card so their arc name label is skipped
  // below (drawArcLabels suppresses labels for card-labelled branches).
  const cardBranchNames = new Set<string>();
  for (const node of layout.nodes) {
    const visible = node.isTrunk
      ? visibleNames.has(defaultBranch)
      : node.arcBranchName != null && visibleNames.has(node.arcBranchName);
    if (!visible) continue;

    const r = resolveNodeRender(node, visibleNames, branchByName, taskBranchByTipSha, stackedShas);

    // Tag pills (separate target — to the right of the node).
    if (node.tags.length > 0) {
      regions.push({
        shape: "rect",
        x: node.x + COMMIT_R + 4, y: node.y - 8, w: TAG_W, h: 16,
        target: { kind: "tag", name: node.tags[0]!, sha: node.sha },
      });
    }

    if (!r.asDot && r.taskBranch?.linkedIssueId) {
      // Card UNIT: card box + label (below) + badges (right) + sync (above).
      const syncUp = hasSync(r.taskBranch)
        ? (node.isDefault ? SYNC_EXT_DEFAULT : SYNC_EXT)
        : PAD;
      const top = node.y - CARD_H / 2 - syncUp;
      regions.push({
        shape: "rect",
        x: node.x - CARD_W / 2 - PAD,
        y: top,
        w: CARD_W + PAD + BADGE_EXT,
        h: (node.y + CARD_H / 2 + LABEL_EXT) - top,
        target: { kind: "task", branchName: r.taskBranch.name },
      });
      if (node.arcBranchName) cardBranchNames.add(node.arcBranchName);
    } else {
      // Plain dot/diamond. Resolve its target and extend up for a sync marker.
      const tipBranch = node.branchName ? branchByName.get(node.branchName) : undefined;
      const syncUp = hasSync(tipBranch ?? r.taskBranch)
        ? (node.isDefault ? SYNC_EXT_DEFAULT : SYNC_EXT)
        : PAD;
      let target: HitTarget;
      if (node.isMerge) target = { kind: "merge", sha: node.sha };
      else if (node.isBranchTip && tipBranch && !tipBranch.linkedIssueId)
        target = { kind: "plainTip", branchName: tipBranch.name };
      else target = { kind: "commit", sha: node.sha };
      const top = node.y - COMMIT_R - syncUp;
      regions.push({
        shape: "rect",
        x: node.x - COMMIT_R - PAD,
        y: top,
        w: 2 * (COMMIT_R + PAD),
        h: (node.y + COMMIT_R + PAD) - top,
        target,
      });
    }
  }

  // 4. Stacks (top of the stack so they win): each fanned card + the "+N" pill.
  for (const stack of visibleStacks) {
    for (const c of computeStackCardLayout(stack)) {
      regions.push({
        shape: "rect",
        x: c.x - CARD_W / 2 - PAD,
        y: c.y - CARD_H / 2 - PAD,
        w: CARD_W + PAD + STACK_LABEL_EXT,
        h: CARD_H + 2 * PAD,
        target: { kind: "task", branchName: c.branchName },
      });
    }
    if (
      stack.branchNames.length > computeStackCardLayout(stack).length ||
      (stack.extraNames?.length ?? 0) > 0
    ) {
      regions.push({
        shape: "rect",
        x: stack.x + 50, y: stack.y + 8, w: 54, h: 15,
        target: { kind: "showMore" },
      });
    }
  }

  // 5. Arc name labels — positions from the shared placeArcLabels pass so the
  // hit box lands on the exact de-overlapped spot the draw used (single source).
  const placedArcLabels = placeArcLabels(layout.arcs, arcVisibleNames, cardBranchNames);
  for (const arc of layout.arcs) {
    const p = placedArcLabels.get(arc.branchName);
    if (!p) continue;
    const b = branchByName.get(arc.branchName);
    regions.push({
      shape: "rect",
      x: p.x - PAD,
      y: p.y - 9 - PAD,
      w: p.w + 2 * PAD,
      h: 9 + 2 * PAD,
      target: b?.linkedIssueId
        ? { kind: "task", branchName: arc.branchName }
        : { kind: "plainTip", branchName: arc.branchName },
    });
  }

  // 6. HEAD label above the default-branch tip — mirrors drawHeadLabel.
  const headNode = layout.nodes.find((n) => n.isDefault && n.branchName != null);
  if (headNode) {
    const labelY = headNode.isTaskTip
      ? headNode.y - CARD_H / 2 - 8
      : headNode.y - COMMIT_R - 8;
    const tb = headNode.branchName ? branchByName.get(headNode.branchName) : undefined;
    const headTarget: HitTarget = tb?.linkedIssueId
      ? { kind: "task", branchName: tb.name }
      : tb
        ? { kind: "plainTip", branchName: tb.name }
        : { kind: "commit", sha: headNode.sha };
    regions.push({
      shape: "rect",
      x: headNode.x - HEAD_W / 2 - PAD,
      y: labelY - 9 - PAD,
      w: HEAD_W + 2 * PAD,
      h: 9 + 2 * PAD,
      target: headTarget,
    });
  }

  return regions;
}
