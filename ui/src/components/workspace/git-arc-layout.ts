/**
 * git-arc-layout.ts — Pure layout functions for the trunk-and-arcs git graph.
 *
 * Zero canvas/DOM dependencies. Fully unit-testable.
 * Imported by GitGraphCanvas.tsx for layout computation.
 */

import type { GitGraphData, GitBranchInfo } from "@armyofagents/shared";

// ---------------------------------------------------------------------------
// Layout constants (exported so canvas drawing code can reference them)
// ---------------------------------------------------------------------------

export const TRUNK_Y = 200;          // trunk vertical centre in layout space
export const PAD_LEFT = 24;          // left padding before first commit
export const X_SPACING = 60;         // horizontal pixels between commits

const BASE_ARC_HEIGHT = 60;          // minimum arc height (px)
const ARC_HEIGHT_PER_COMMIT = 8;     // px added per extra feature commit
const MAX_ARC_HEIGHT = 120;          // maximum arc height (px)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ArcCommitLayout {
  sha: string;
  x: number;
  y: number;
  isMerge: boolean;
  /** True if this commit sits on the main trunk line. */
  isTrunk: boolean;
  /**
   * Which arc (feature branch) this commit visually belongs to.
   * Null for trunk commits.
   */
  arcBranchName: string | null;
  /**
   * Set only for TIP commits — the branch whose tip SHA this is.
   * Used for hover-card / label lookup.
   */
  branchName: string | null;
  isTaskTip: boolean;
  isBranchTip: boolean;
  issueStatus: string | null;
  /** True when the branch is done/cancelled — drives 0.15 opacity. */
  isDone: boolean;
  isRemoteOnly: boolean;
  /** True when this is the tip of the default branch (for HEAD label). */
  isDefault: boolean;
  tags: string[];
  laneColor: string;
}

export interface ArcDefinition {
  branchName: string;
  direction: "up" | "down";
  /** X coordinate on trunk where arc originates. */
  branchPointX: number;
  /** X coordinate on trunk where arc merges back. Null = open branch. */
  mergePointX: number | null;
  /** Absolute Y of the arc's peak. */
  apexY: number;
  isOpen: boolean;
  color: string;
  isDone: boolean;
}

export interface ArcLayoutResult {
  nodes: ArcCommitLayout[];
  arcs: ArcDefinition[];
  trunkY: number;
  totalWidth: number;
  totalHeight: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Returns the set of SHAs on the default branch using FIRST-PARENT traversal.
 * Must be first-parent only: all-ancestors traversal would pull merged feature
 * commits into the trunk set and break findBranchPoint.
 */
export function findTrunkShas(graph: GitGraphData): Set<string> {
  const defaultBranch = graph.branches.find((b) => b.name === graph.defaultBranch);
  if (!defaultBranch) return new Set();
  const commitMap = new Map(graph.commits.map((c) => [c.sha, c]));
  const result = new Set<string>();
  let current: string | undefined = defaultBranch.tipSha;
  let guard = 0;
  while (current && guard < 500) {
    result.add(current);
    current = commitMap.get(current)?.parentShas[0];
    guard++;
  }
  return result;
}

/**
 * Walks a feature branch tip backwards until a trunk SHA is found.
 * Returns that SHA as the branch point.
 * Graceful fallback: if none found within 500 steps, returns the tip itself.
 */
export function findBranchPoint(
  commitMap: Map<string, { sha: string; parentShas: string[] }>,
  trunkShas: Set<string>,
  featureTipSha: string,
): string {
  const visited = new Set<string>();
  const queue: string[] = [featureTipSha];
  let guard = 0;
  while (queue.length > 0 && guard < 500) {
    const sha = queue.shift()!;
    if (visited.has(sha)) continue;
    visited.add(sha);
    if (trunkShas.has(sha)) return sha;
    const commit = commitMap.get(sha);
    if (!commit) continue;
    for (const p of commit.parentShas) {
      if (trunkShas.has(p)) return p;
      if (!visited.has(p)) queue.push(p);
    }
    guard++;
  }
  return featureTipSha; // fallback
}

/**
 * Returns all commit SHAs reachable from featureTipSha that are NOT on trunk.
 * These are the commits that belong to the feature branch arc.
 */
export function getFeatureCommitShas(
  commitMap: Map<string, { sha: string; parentShas: string[] }>,
  trunkShas: Set<string>,
  featureTipSha: string,
): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [featureTipSha];
  while (queue.length > 0) {
    const sha = queue.shift()!;
    if (visited.has(sha) || trunkShas.has(sha)) continue;
    visited.add(sha);
    result.push(sha);
    const commit = commitMap.get(sha);
    if (commit) {
      for (const p of commit.parentShas) {
        if (!visited.has(p) && !trunkShas.has(p)) queue.push(p);
      }
    }
  }
  return result;
}

/**
 * Finds the merge commit on the trunk that merged the given feature branch.
 * Returns null if the branch is not yet merged.
 */
export function findMergePoint(
  commits: Array<{ sha: string; parentShas: string[]; isMerge: boolean }>,
  trunkShas: Set<string>,
  featureShas: Set<string>,
): string | null {
  for (const commit of commits) {
    if (!commit.isMerge || !trunkShas.has(commit.sha)) continue;
    for (const p of commit.parentShas) {
      if (featureShas.has(p)) return commit.sha;
    }
  }
  return null;
}

/**
 * Arc height in px: base + 8px per feature commit, capped at 120px.
 */
export function computeArcHeight(featureCommitCount: number): number {
  return Math.min(
    BASE_ARC_HEIGHT + ARC_HEIGHT_PER_COMMIT * featureCommitCount,
    MAX_ARC_HEIGHT,
  );
}

/**
 * Assigns alternating up/down directions to feature branches by their
 * list index. Index 0 → "up", 1 → "down", 2 → "up", …
 */
export function assignArcDirections(
  featureBranches: Array<{ name: string }>,
): Map<string, "up" | "down"> {
  const result = new Map<string, "up" | "down">();
  featureBranches.forEach((b, i) => {
    result.set(b.name, i % 2 === 0 ? "up" : "down");
  });
  return result;
}

// ---------------------------------------------------------------------------
// Internal Y helpers
// ---------------------------------------------------------------------------

/** Y on a closed (merged) arc using sine interpolation. t ∈ [0,1]. */
function closedArcY(t: number, trunkY: number, apexY: number): number {
  return trunkY + Math.sin(t * Math.PI) * (apexY - trunkY);
}

/** Y on an open (rail) arc: curve from branchPoint to railStart, then flat. */
function openArcY(
  commitX: number,
  branchPointX: number,
  railStartX: number,
  trunkY: number,
  apexY: number,
): number {
  if (commitX >= railStartX) return apexY;
  const span = railStartX - branchPointX;
  if (span <= 0) return apexY;
  const t = Math.max(0, Math.min(1, (commitX - branchPointX) / span));
  return trunkY + Math.sin(t * Math.PI * 0.5) * (apexY - trunkY);
}

// ---------------------------------------------------------------------------
// Main layout function
// ---------------------------------------------------------------------------

export function computeArcLayout(
  graph: GitGraphData,
  branches: GitBranchInfo[],
): ArcLayoutResult {
  const branchColors = new Map(graph.branches.map((b) => [b.name, b.color]));
  const branchInfoMap = new Map(branches.map((b) => [b.name, b]));

  // X assignment: graph.commits[0] is newest → highest X, last is oldest → lowest X
  const maxIdx = Math.max(0, graph.commits.length - 1);
  const commitXMap = new Map<string, number>();
  graph.commits.forEach((c, idx) => {
    commitXMap.set(c.sha, PAD_LEFT + (maxIdx - idx) * X_SPACING);
  });

  const commitMap = new Map(graph.commits.map((c) => [c.sha, c]));

  // Trunk SHAs (first-parent walk from default tip)
  const trunkShas = findTrunkShas(graph);

  // Feature branches = everything except default
  const featureBranches = graph.branches.filter((b) => b.name !== graph.defaultBranch);
  const directions = assignArcDirections(featureBranches);

  // Helper sets
  const doneBranches = new Set(
    branches
      .filter((b) => b.linkedIssueStatus === "done" || b.linkedIssueStatus === "cancelled")
      .map((b) => b.name),
  );
  const remoteOnlyBranches = new Set(
    branches.filter((b) => !b.isLocal && b.isRemote).map((b) => b.name),
  );
  // NOTE: uses lastCommitSha from GitBranchInfo (enriched list) not tipSha from graph.
  // These can diverge if data is stale. A missing task badge is the failure mode.
  const taskTipShas = new Set(
    branches.filter((b) => b.linkedIssueId).map((b) => b.lastCommitSha),
  );

  // tipSha → first branch name (default branch wins for shared tips)
  const tipShaToName = new Map<string, string>();
  for (const gb of graph.branches) {
    if (!tipShaToName.has(gb.tipSha)) tipShaToName.set(gb.tipSha, gb.name);
  }

  // ── Build arc definitions + pre-compute per-commit Y ──────────────────────

  const arcs: ArcDefinition[] = [];
  const shaToArcBranch = new Map<string, string>(); // sha → feature branch name
  const shaToArcY = new Map<string, number>();       // sha → pre-computed Y

  for (const fb of featureBranches) {
    const color = branchColors.get(fb.name) ?? "#7E8AA8";
    const direction = directions.get(fb.name) ?? "up";
    const isDone = doneBranches.has(fb.name);

    const featureCommitShas = getFeatureCommitShas(commitMap, trunkShas, fb.tipSha);
    const featureShaSet = new Set(featureCommitShas);

    const branchPointSha = findBranchPoint(commitMap, trunkShas, fb.tipSha);
    const branchPointX = commitXMap.get(branchPointSha) ?? PAD_LEFT;

    const mergePointSha = findMergePoint(graph.commits, trunkShas, featureShaSet);
    const mergePointX =
      mergePointSha != null ? (commitXMap.get(mergePointSha) ?? null) : null;

    const arcHeight = computeArcHeight(featureCommitShas.length);
    const apexY = direction === "up" ? TRUNK_Y - arcHeight : TRUNK_Y + arcHeight;

    // Rail starts 60px right of branch point for open arcs
    const railStartX = branchPointX + 60;

    arcs.push({
      branchName: fb.name,
      direction,
      branchPointX,
      mergePointX,
      apexY,
      isOpen: mergePointX == null,
      color,
      isDone,
    });

    // Pre-compute Y for each feature commit
    for (const sha of featureCommitShas) {
      shaToArcBranch.set(sha, fb.name);
      const cx = commitXMap.get(sha) ?? branchPointX;
      let cy: number;
      if (mergePointX != null && mergePointX > branchPointX) {
        const t = (cx - branchPointX) / (mergePointX - branchPointX);
        cy = closedArcY(Math.max(0, Math.min(1, t)), TRUNK_Y, apexY);
      } else {
        cy = openArcY(cx, branchPointX, railStartX, TRUNK_Y, apexY);
      }
      shaToArcY.set(sha, cy);
    }
  }

  // ── Build nodes ───────────────────────────────────────────────────────────

  const nodes: ArcCommitLayout[] = graph.commits.map((commit) => {
    const isTrunk = trunkShas.has(commit.sha);
    const x = commitXMap.get(commit.sha) ?? PAD_LEFT;
    const arcBranchName = shaToArcBranch.get(commit.sha) ?? null;
    const y = isTrunk ? TRUNK_Y : (shaToArcY.get(commit.sha) ?? TRUNK_Y);

    const tipBranchName = tipShaToName.get(commit.sha) ?? null;
    const tipBranchInfo = tipBranchName ? branchInfoMap.get(tipBranchName) : undefined;

    const colorBranchName = arcBranchName ?? graph.defaultBranch;
    const laneColor = branchColors.get(colorBranchName) ?? "#7E8AA8";

    const isDone = arcBranchName
      ? doneBranches.has(arcBranchName)
      : doneBranches.has(graph.defaultBranch);
    const isRemoteOnly = arcBranchName ? remoteOnlyBranches.has(arcBranchName) : false;

    return {
      sha: commit.sha,
      x,
      y,
      isMerge: commit.isMerge,
      isTrunk,
      arcBranchName,
      branchName: tipBranchName,
      isTaskTip: taskTipShas.has(commit.sha),
      isBranchTip: tipShaToName.has(commit.sha),
      issueStatus: (tipBranchInfo?.linkedIssueStatus as string | null | undefined) ?? null,
      isDone,
      isRemoteOnly,
      isDefault: tipBranchName === graph.defaultBranch,
      tags: commit.tags,
      laneColor,
    };
  });

  const totalWidth =
    PAD_LEFT * 2 + (graph.commits.length > 0 ? maxIdx * X_SPACING : 400);
  const totalHeight = TRUNK_Y * 2 + MAX_ARC_HEIGHT + 80;

  return { nodes, arcs, trunkY: TRUNK_Y, totalWidth, totalHeight };
}
