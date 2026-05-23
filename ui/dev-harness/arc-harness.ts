/**
 * arc-harness.ts — Standalone visual test harness for the trunk-and-arcs git graph.
 *
 * Imports the REAL layout (git-arc-layout) and the REAL draw functions
 * (git-arc-draw) and renders a set of controlled scenarios on separate
 * canvases so we can eyeball overlap / clipping / scaling bugs that unit
 * tests (which only check coordinates) cannot catch.
 *
 * Build:  npx esbuild ui/dev-harness/arc-harness.ts --bundle --format=iife \
 *           --outfile=ui/dev-harness/arc-harness.bundle.js
 * View:   browse goto file://./ui/dev-harness/arc-harness.html
 */

import {
  computeArcLayout,
  getLayoutBounds,
  computeFitTransform,
} from "../src/components/workspace/git-arc-layout";
import {
  drawTrunk,
  drawArcLines,
  drawArcLabels,
  drawCommitNode,
  drawCardLabel,
  drawCardBadges,
  drawLabelDots,
  drawTagPills,
  drawHeadLabel,
} from "../src/components/workspace/git-arc-draw";
import type {
  GitGraphData,
  GitBranchInfo,
  GitCommitNode,
} from "@armyofagents/shared";

// ---------------------------------------------------------------------------
// Data palette + builders
// ---------------------------------------------------------------------------

const PALETTE = [
  "#4FB67E", // green
  "#D9A938", // amber
  "#6470DC", // indigo
  "#C264B8", // magenta
  "#46A6C7", // cyan
  "#E07A5F", // coral
];

interface FeatureSpec {
  name: string;
  commits: number;
  merged: boolean;
  status?: string | null;
  identifier?: string | null;
  title?: string | null;
  pr?: GitBranchInfo["pr"];
  conflicts?: boolean;
  tags?: string[];
}

interface BuildOpts {
  defaultBranch?: string;
  /** When true, advance the trunk between branch points so arcs spread out. */
  spread?: boolean;
}

let _id = 0;
function mkCommit(
  parents: string[],
  o: { isMerge?: boolean; tags?: string[] } = {},
): GitCommitNode {
  const s = `x${_id++}`;
  return {
    sha: s,
    parentShas: parents,
    shortSha: s,
    message: "m",
    author: "a",
    committedAt: "2024-01-01T00:00:00Z",
    branchNames: [],
    isMerge: !!o.isMerge,
    tags: o.tags ?? [],
  };
}

function mkBranchInfo(f: Partial<FeatureSpec> & { name: string }, tipSha: string): GitBranchInfo {
  return {
    name: f.name,
    isLocal: true,
    isRemote: true,
    aheadCount: 0,
    behindCount: 0,
    lastCommitSha: tipSha,
    lastCommitMessage: "",
    lastCommitAt: "2024-01-01T00:00:00Z",
    lastCommitAuthor: "a",
    linkedWorkspaceId: f.identifier ? "w-" + f.name : null,
    linkedIssueId: f.identifier ? "i-" + f.name : null,
    linkedIssueIdentifier: f.identifier ?? null,
    linkedIssueTitle: f.title ?? null,
    linkedIssueStatus: f.status ?? null,
    linkedIssueWorkMode: null,
    pr: f.pr ?? null,
    overlays: { hasConflicts: !!f.conflicts, isDiverged: false, isBehindRemote: false },
    tags: f.tags ?? [],
  };
}

function build(
  features: FeatureSpec[],
  opts: BuildOpts = {},
): { graph: GitGraphData; branches: GitBranchInfo[] } {
  _id = 0;
  const chrono: GitCommitNode[] = [];
  let trunkTip = mkCommit([]);
  chrono.push(trunkTip);

  const fdefs: GitGraphData["branches"] = [];
  const binfos: GitBranchInfo[] = [];

  features.forEach((f, idx) => {
    const adv = opts.spread ? 1 + (idx % 3) : 0;
    for (let i = 0; i < adv; i++) {
      const t = mkCommit([trunkTip.sha]);
      chrono.push(t);
      trunkTip = t;
    }
    let pf = trunkTip; // branch point = current trunk tip
    for (let i = 0; i < f.commits; i++) {
      const fc = mkCommit([pf.sha], { tags: i === f.commits - 1 ? f.tags : undefined });
      chrono.push(fc);
      pf = fc;
    }
    if (f.merged) {
      const m = mkCommit([trunkTip.sha, pf.sha], { isMerge: true });
      chrono.push(m);
      trunkTip = m;
    }
    fdefs.push({
      name: f.name,
      laneIndex: idx + 1,
      color: PALETTE[idx % PALETTE.length]!,
      tipSha: pf.sha,
    });
    binfos.push(mkBranchInfo(f, pf.sha));
  });

  // trailing trunk commits so the trunk extends past the last branch
  for (let i = 0; i < 2; i++) {
    const t = mkCommit([trunkTip.sha]);
    chrono.push(t);
    trunkTip = t;
  }

  const defName = opts.defaultBranch ?? "main";
  const commits = [...chrono].reverse(); // newest-first
  const branches: GitGraphData["branches"] = [
    { name: defName, laneIndex: 0, color: "#6470DC", tipSha: trunkTip.sha },
    ...fdefs,
  ];
  const graph: GitGraphData = { defaultBranch: defName, commits, branches };
  const mainInfo = mkBranchInfo(
    { name: defName, status: "in_progress", identifier: "AOA-1", title: "main work" },
    trunkTip.sha,
  );
  return { graph, branches: [mainInfo, ...binfos] };
}

// ---------------------------------------------------------------------------
// Render — mirrors GitGraphCanvas.redraw() (static, no flow pulse)
// ---------------------------------------------------------------------------

function render(
  canvas: HTMLCanvasElement,
  graph: GitGraphData,
  branches: GitBranchInfo[],
  activeOnly = false,
) {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Mirror the component's default ("active") visibility when requested:
  // trunk + task branches that are not done/cancelled.
  const shownBranches = activeOnly
    ? branches.filter(
        (b) =>
          b.name === graph.defaultBranch ||
          (b.linkedIssueId != null &&
            b.linkedIssueStatus !== "done" &&
            b.linkedIssueStatus !== "cancelled"),
      )
    : branches;

  const layout = computeArcLayout(graph, branches);
  const t = computeFitTransform(getLayoutBounds(layout), cw, ch);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.setTransform(t.k * dpr, 0, 0, t.k * dpr, t.x * dpr, t.y * dpr);

  const visibleNames = new Set(shownBranches.map((b) => b.name));
  visibleNames.add(graph.defaultBranch);
  const branchByName = new Map(branches.map((b) => [b.name, b]));
  const taskByTip = new Map<string, GitBranchInfo>();
  for (const b of branches) {
    if (b.lastCommitSha && b.linkedIssueId && !taskByTip.has(b.lastCommitSha)) {
      taskByTip.set(b.lastCommitSha, b);
    }
  }
  const trunkColor =
    graph.branches.find((b) => b.name === graph.defaultBranch)?.color ?? "#6470DC";
  const canvasRightInLayout = (cw - t.x) / t.k;

  const visibleNodes = layout.nodes.filter((n) =>
    n.isTrunk
      ? visibleNames.has(graph.defaultBranch)
      : n.arcBranchName != null && visibleNames.has(n.arcBranchName),
  );

  drawTrunk(ctx, layout.nodes, layout.trunkY, trunkColor);
  drawArcLines(ctx, layout.arcs, visibleNames, canvasRightInLayout, layout.trunkY);

  const cardBranchNames = new Set<string>();
  for (const node of visibleNodes) {
    const branchStatus =
      node.branchName != null
        ? (branchByName.get(node.branchName)?.linkedIssueStatus ?? null)
        : null;
    drawCommitNode(ctx, node, 0, branchStatus);
    if (node.isTaskTip) {
      let branch = node.branchName ? branchByName.get(node.branchName) : undefined;
      if (!branch?.linkedIssueId) branch = taskByTip.get(node.sha);
      if (branch?.linkedIssueId) {
        drawCardLabel(ctx, node, branch);
        drawCardBadges(ctx, node, branch);
        drawLabelDots(ctx, node, branch);
        if (node.arcBranchName) cardBranchNames.add(node.arcBranchName);
      }
    }
  }
  for (const node of visibleNodes) {
    if (node.tags.length > 0) drawTagPills(ctx, node);
  }
  const defaultTip = visibleNodes.find((n) => n.isDefault && n.branchName != null);
  if (defaultTip) drawHeadLabel(ctx, defaultTip);
  drawArcLabels(ctx, layout.arcs, visibleNames, cardBranchNames);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const passingPr: GitBranchInfo["pr"] = {
  number: 12,
  url: "#",
  reviewState: "open",
  ciStatus: "passing",
  ciUrl: "#",
  commentCount: 2,
  labels: [
    { name: "bug", color: "#ef4444" },
    { name: "p1", color: "#D9A938" },
  ],
};
const plainPr: GitBranchInfo["pr"] = {
  number: 8,
  url: "#",
  reviewState: "changes_requested",
  ciStatus: null,
  ciUrl: null,
  commentCount: 0,
  labels: [{ name: "feature", color: "#4FB67E" }],
};

const SCENARIOS: Array<{
  title: string;
  data: { graph: GitGraphData; branches: GitBranchInfo[] };
  activeOnly?: boolean;
}> = [
  {
    title: "1 — Single merged feature (closed arc)",
    data: build([
      { name: "feat/login", commits: 2, merged: true, status: "done", identifier: "AOA-2", title: "Login flow rework" },
    ]),
  },
  {
    title: "2 — Single open feature (arc + rail + dashed tail)",
    data: build([
      { name: "feat/api", commits: 3, merged: false, status: "in_progress", identifier: "AOA-3", title: "API gateway" },
    ]),
  },
  {
    title: "3 — Mixed: merged + open + blocked (3 branches, spread)",
    data: build(
      [
        { name: "feat/login", commits: 2, merged: true, status: "done", identifier: "AOA-2", title: "Login flow" },
        { name: "feat/api", commits: 3, merged: false, status: "in_progress", identifier: "AOA-3", title: "API gateway" },
        { name: "fix/crash", commits: 1, merged: false, status: "blocked", identifier: "AOA-4", title: "Null crash fix" },
      ],
      { spread: true },
    ),
  },
  {
    title: "4 — 8 branches (moderate load, spread)",
    data: build(
      Array.from({ length: 8 }, (_, i) => ({
        name: `feat/branch-${i + 1}`,
        commits: 1 + (i % 3),
        merged: i % 3 === 0,
        status: ["in_progress", "in_review", "blocked", "done"][i % 4],
        identifier: `AOA-${10 + i}`,
        title: `Feature number ${i + 1}`,
      })),
      { spread: true },
    ),
  },
  {
    // Mirrors the live Engineering dept: 5 active + 14 done + 14 git-only.
    // With the default "active" view, only the 5 active branches + trunk render.
    title: "5 — STRESS: 33 branches, DEFAULT active view (5 active shown; 14 done + 14 git-only hidden)",
    activeOnly: true,
    data: build(
      [
        // Older history first (left): 14 done (merged) + 14 git-only branches.
        ...Array.from({ length: 14 }, (_, i) => ({
          name: `feat/done-${i + 1}`,
          commits: 1 + (i % 2),
          merged: true,
          status: "done",
          identifier: `AOA-${200 + i}`,
          title: `Completed work ${i + 1}`,
        })),
        ...Array.from({ length: 14 }, (_, i) => ({
          name: `chore/git-only-${i + 1}`,
          commits: 1,
          merged: i % 2 === 0,
          status: null,
        })),
        // Newest (right): 5 active task branches — these are what the default
        // view keeps; right-align brings them + HEAD into view.
        ...Array.from({ length: 5 }, (_, i) => ({
          name: `feat/active-${i + 1}`,
          commits: 1 + (i % 2),
          merged: false,
          status: ["in_progress", "in_review", "blocked", "in_progress", "in_review"][i],
          identifier: `AOA-${100 + i}`,
          title: `Active task ${i + 1}`,
        })),
      ],
      { spread: true },
    ),
  },
  {
    title: "6 — Very long branch names + titles (overflow test)",
    data: build(
      [
        { name: "feat/extremely-long-branch-name-that-overflows-everything-here", commits: 2, merged: false, status: "in_progress", identifier: "AOA-100", title: "An extremely long task title that should be truncated cleanly" },
        { name: "release/2026.05.23-candidate-build-with-very-long-suffix", commits: 1, merged: true, status: "done", identifier: "AOA-101", title: "Release candidate build pipeline" },
      ],
      { spread: true },
    ),
  },
  {
    title: "7 — All merged (closed arcs only)",
    data: build(
      Array.from({ length: 5 }, (_, i) => ({
        name: `feat/done-${i + 1}`,
        commits: 1 + (i % 2),
        merged: true,
        status: "done",
        identifier: `AOA-${20 + i}`,
        title: `Completed work ${i + 1}`,
      })),
      { spread: true },
    ),
  },
  {
    title: "8 — Badges: CI ✓ / PR / conflict ⚠ / labels / tags",
    data: build(
      [
        { name: "feat/ci-pass", commits: 2, merged: false, status: "in_review", identifier: "AOA-30", title: "CI passing PR", pr: passingPr },
        { name: "feat/pr-only", commits: 2, merged: false, status: "in_progress", identifier: "AOA-31", title: "Open PR no CI", pr: plainPr },
        { name: "fix/conflict", commits: 1, merged: false, status: "blocked", identifier: "AOA-32", title: "Has conflicts", conflicts: true },
        { name: "release/v2", commits: 1, merged: true, status: "done", identifier: "AOA-33", title: "Tagged release", tags: ["v2.0.0"] },
      ],
      { spread: true },
    ),
  },
];

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function boot() {
  const root = document.getElementById("root")!;
  for (const sc of SCENARIOS) {
    const section = document.createElement("div");
    section.className = "scenario";
    const h = document.createElement("div");
    h.className = "title";
    h.textContent = sc.title;
    const canvas = document.createElement("canvas");
    section.appendChild(h);
    section.appendChild(canvas);
    root.appendChild(section);
    // Render after layout so clientWidth/Height are known
    requestAnimationFrame(() =>
      render(canvas, sc.data.graph, sc.data.branches, sc.activeOnly ?? false),
    );
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
