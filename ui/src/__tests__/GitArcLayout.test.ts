import { describe, it, expect } from "vitest";
import type { GitGraphData, GitBranchInfo } from "@armyofagents/shared";
import {
  findTrunkShas,
  findBranchPoint,
  findMergePoint,
  getFeatureCommitShas,
  computeArcHeight,
  assignArcDirections,
  computeArcLayout,
} from "../components/workspace/git-arc-layout";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkCommit(
  sha: string,
  parentShas: string[],
  isMerge = false,
  tags: string[] = [],
) {
  return {
    sha,
    parentShas,
    shortSha: sha.slice(0, 7),
    message: `commit ${sha}`,
    author: "test",
    committedAt: "2024-01-01T00:00:00Z",
    branchNames: [] as string[],
    isMerge,
    tags,
  };
}

/**
 * Standard test fixture:
 *
 *   main:    c1 ← c2 ← merge ← c3
 *   feat/x:       c1 ← f1 ← f2
 *
 * merge has parentShas ["c2", "f2"] → it is the merge commit on main.
 *
 * Graph commits array (newest first): c3, merge, c2, f2, f1, c1
 */
function makeGraph(): GitGraphData {
  return {
    defaultBranch: "main",
    commits: [
      mkCommit("c3",    ["merge"]),
      mkCommit("merge", ["c2", "f2"], true),
      mkCommit("c2",    ["c1"]),
      mkCommit("f2",    ["f1"]),
      mkCommit("f1",    ["c1"]),
      mkCommit("c1",    []),
    ],
    branches: [
      { name: "main",   laneIndex: 0, color: "#6470DC", tipSha: "c3" },
      { name: "feat/x", laneIndex: 1, color: "#4FB67E", tipSha: "f2" },
    ],
  };
}

function makeBranches(): GitBranchInfo[] {
  const base: Omit<GitBranchInfo, "name" | "lastCommitSha"> = {
    isLocal: true, isRemote: true, aheadCount: 0, behindCount: 0,
    lastCommitMessage: "", lastCommitAt: "2024-01-01T00:00:00Z",
    lastCommitAuthor: "test",
    linkedWorkspaceId: null, linkedIssueId: null,
    linkedIssueIdentifier: null, linkedIssueTitle: null,
    linkedIssueStatus: null, linkedIssueWorkMode: null,
    pr: null,
    overlays: { hasConflicts: false, isDiverged: false, isBehindRemote: false },
    tags: [],
  };
  return [
    { ...base, name: "main",   lastCommitSha: "c3" },
    { ...base, name: "feat/x", lastCommitSha: "f2" },
  ];
}

// ---------------------------------------------------------------------------
// findTrunkShas
// ---------------------------------------------------------------------------

describe("findTrunkShas", () => {
  it("returns main commits via first-parent only", () => {
    const graph = makeGraph();
    const trunk = findTrunkShas(graph);
    // main tip c3 → merge → c2 → c1 (first-parent chain)
    expect(trunk.has("c3")).toBe(true);
    expect(trunk.has("merge")).toBe(true);
    expect(trunk.has("c2")).toBe(true);
    expect(trunk.has("c1")).toBe(true);
  });

  it("does NOT include feature branch commits", () => {
    const graph = makeGraph();
    const trunk = findTrunkShas(graph);
    expect(trunk.has("f1")).toBe(false);
    expect(trunk.has("f2")).toBe(false);
  });

  it("returns empty set when default branch not found", () => {
    const graph: GitGraphData = {
      defaultBranch: "missing",
      commits: [mkCommit("c1", [])],
      branches: [{ name: "main", laneIndex: 0, color: "#fff", tipSha: "c1" }],
    };
    expect(findTrunkShas(graph).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findBranchPoint
// ---------------------------------------------------------------------------

describe("findBranchPoint", () => {
  it("returns the correct branch point SHA for feat/x", () => {
    const graph = makeGraph();
    const trunkShas = findTrunkShas(graph);
    const commitMap = new Map(graph.commits.map((c) => [c.sha, c]));
    const branchPoint = findBranchPoint(commitMap, trunkShas, "f2");
    expect(branchPoint).toBe("c1");
  });

  it("returns fallback when feature tip is already on trunk", () => {
    const graph = makeGraph();
    const trunkShas = findTrunkShas(graph);
    const commitMap = new Map(graph.commits.map((c) => [c.sha, c]));
    // c3 IS on trunk — branch point should be c3 itself
    const branchPoint = findBranchPoint(commitMap, trunkShas, "c3");
    expect(branchPoint).toBe("c3");
  });
});

// ---------------------------------------------------------------------------
// findMergePoint
// ---------------------------------------------------------------------------

describe("findMergePoint", () => {
  it("finds the merge commit when branch is merged", () => {
    const graph = makeGraph();
    const trunkShas = findTrunkShas(graph);
    const commitMap = new Map(graph.commits.map((c) => [c.sha, c]));
    const featureShas = new Set(getFeatureCommitShas(commitMap, trunkShas, "f2"));
    const result = findMergePoint(graph.commits, trunkShas, featureShas);
    expect(result).toBe("merge");
  });

  it("returns null for an open (unmerged) branch", () => {
    const graph = makeGraph();
    const trunkShas = findTrunkShas(graph);
    // Pretend feat/x tip is "f3" (not in commits) — no merge commit points to it
    const featureShas = new Set(["f3"]);
    const result = findMergePoint(graph.commits, trunkShas, featureShas);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getFeatureCommitShas  ★ D3 — direct test block added
// ---------------------------------------------------------------------------

describe("getFeatureCommitShas", () => {
  it("returns only non-trunk commits reachable from feature tip", () => {
    const graph = makeGraph();
    const trunkShas = findTrunkShas(graph);
    const commitMap = new Map(graph.commits.map((c) => [c.sha, c]));
    const shas = getFeatureCommitShas(commitMap, trunkShas, "f2");
    expect(shas).toContain("f1");
    expect(shas).toContain("f2");
    expect(shas).not.toContain("c1");
    expect(shas).not.toContain("c2");
    expect(shas).not.toContain("merge");
  });

  it("returns empty array when tip is on trunk", () => {
    const graph = makeGraph();
    const trunkShas = findTrunkShas(graph);
    const commitMap = new Map(graph.commits.map((c) => [c.sha, c]));
    const shas = getFeatureCommitShas(commitMap, trunkShas, "c3");
    expect(shas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeArcHeight
// ---------------------------------------------------------------------------

describe("computeArcHeight", () => {
  it("returns 68px for 1 commit (base 60 + 8×1)", () => {  // ★ D2 — description fixed
    expect(computeArcHeight(1)).toBe(68);
  });

  it("caps at 120px for many commits", () => {
    expect(computeArcHeight(10)).toBe(120);
    expect(computeArcHeight(100)).toBe(120);
  });

  it("returns base 60 for 0 commits", () => {
    expect(computeArcHeight(0)).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// assignArcDirections
// ---------------------------------------------------------------------------

describe("assignArcDirections", () => {
  it("alternates up/down correctly for 4 branches", () => {
    const branches = [
      { name: "feat/a" },
      { name: "feat/b" },
      { name: "feat/c" },
      { name: "feat/d" },
    ];
    const dirs = assignArcDirections(branches);
    expect(dirs.get("feat/a")).toBe("up");
    expect(dirs.get("feat/b")).toBe("down");
    expect(dirs.get("feat/c")).toBe("up");
    expect(dirs.get("feat/d")).toBe("down");
  });

  it("handles empty list", () => {
    expect(assignArcDirections([]).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeArcLayout — integration
// ---------------------------------------------------------------------------

describe("computeArcLayout", () => {
  it("produces one arc for feat/x and trunk nodes for main", () => {
    const graph = makeGraph();
    const branches = makeBranches();
    const result = computeArcLayout(graph, branches);

    expect(result.arcs).toHaveLength(1);
    expect(result.arcs[0]!.branchName).toBe("feat/x");
    expect(result.arcs[0]!.isOpen).toBe(false); // feat/x is merged
  });

  it("trunk nodes sit at TRUNK_Y", () => {
    const graph = makeGraph();
    const branches = makeBranches();
    const result = computeArcLayout(graph, branches);
    const trunkNodes = result.nodes.filter((n) => n.isTrunk);
    for (const n of trunkNodes) {
      expect(n.y).toBe(result.trunkY);
    }
  });

  it("feature branch commits have y !== TRUNK_Y (they arc away)", () => {
    const graph = makeGraph();
    const branches = makeBranches();
    const result = computeArcLayout(graph, branches);
    const f1 = result.nodes.find((n) => n.sha === "f1");
    const f2 = result.nodes.find((n) => n.sha === "f2");
    expect(f1).toBeDefined();
    expect(f2).toBeDefined();
    // f1 and f2 should arc above trunk (direction "up" for first branch)
    expect(f1!.y).not.toBe(result.trunkY);
    expect(f2!.y).not.toBe(result.trunkY);
  });

  it("nodes are ordered newest-X-right oldest-X-left", () => {
    const graph = makeGraph();
    const branches = makeBranches();
    const result = computeArcLayout(graph, branches);
    // c3 is newest (index 0) → highest X; c1 is oldest (index 5) → lowest X
    const c3 = result.nodes.find((n) => n.sha === "c3")!;
    const c1 = result.nodes.find((n) => n.sha === "c1")!;
    expect(c3.x).toBeGreaterThan(c1.x);
  });

  it("open branch produces an arc with isOpen=true", () => {
    // Make a graph where feat/y is NOT merged into main
    const graph: GitGraphData = {
      defaultBranch: "main",
      commits: [
        mkCommit("c2", ["c1"]),
        mkCommit("f1", ["c1"]),
        mkCommit("c1", []),
      ],
      branches: [
        { name: "main",   laneIndex: 0, color: "#6470DC", tipSha: "c2" },
        { name: "feat/y", laneIndex: 1, color: "#4FB67E", tipSha: "f1" },
      ],
    };
    const branches: GitBranchInfo[] = [
      {
        name: "main", lastCommitSha: "c2",
        isLocal: true, isRemote: true, aheadCount: 0, behindCount: 0,
        lastCommitMessage: "", lastCommitAt: "2024-01-01T00:00:00Z", lastCommitAuthor: "test",
        linkedWorkspaceId: null, linkedIssueId: null, linkedIssueIdentifier: null,
        linkedIssueTitle: null, linkedIssueStatus: null, linkedIssueWorkMode: null,
        pr: null, overlays: { hasConflicts: false, isDiverged: false, isBehindRemote: false }, tags: [],
      },
      {
        name: "feat/y", lastCommitSha: "f1",
        isLocal: true, isRemote: true, aheadCount: 0, behindCount: 0,
        lastCommitMessage: "", lastCommitAt: "2024-01-01T00:00:00Z", lastCommitAuthor: "test",
        linkedWorkspaceId: null, linkedIssueId: null, linkedIssueIdentifier: null,
        linkedIssueTitle: null, linkedIssueStatus: null, linkedIssueWorkMode: null,
        pr: null, overlays: { hasConflicts: false, isDiverged: false, isBehindRemote: false }, tags: [],
      },
    ];
    const result = computeArcLayout(graph, branches);
    expect(result.arcs).toHaveLength(1);
    expect(result.arcs[0]!.isOpen).toBe(true);
    expect(result.arcs[0]!.mergePointX).toBeNull();
  });
});
