import { describe, it, expect } from "vitest";
import type { GitBranchInfo } from "@armyofagents/shared";
import {
  resolveNodeRender,
  hitRegionAt,
  type HitRegion,
} from "../components/workspace/git-arc-hit";
import type { ArcCommitLayout } from "../components/workspace/git-arc-layout";

function mkNode(p: Partial<ArcCommitLayout> & { sha: string }): ArcCommitLayout {
  return {
    sha: p.sha, x: p.x ?? 0, y: p.y ?? 0, isMerge: p.isMerge ?? false,
    isTrunk: p.isTrunk ?? false, arcBranchName: p.arcBranchName ?? null,
    branchName: p.branchName ?? null, isTaskTip: p.isTaskTip ?? false,
    isBranchTip: p.isBranchTip ?? false, issueStatus: p.issueStatus ?? null,
    isDone: p.isDone ?? false, isRemoteOnly: p.isRemoteOnly ?? false,
    isDefault: p.isDefault ?? false, tags: p.tags ?? [], laneColor: p.laneColor ?? "#7E8AA8",
  };
}
function mkBranch(name: string, issueId: string | null): GitBranchInfo {
  return {
    name, lastCommitSha: "s", isLocal: true, isRemote: true, aheadCount: 0, behindCount: 0,
    lastCommitMessage: "", lastCommitAt: "", lastCommitAuthor: "",
    linkedWorkspaceId: null, linkedIssueId: issueId, linkedIssueIdentifier: issueId ? "AOA-1" : null,
    linkedIssueTitle: null, linkedIssueStatus: null, linkedIssueWorkMode: null,
    pr: null, overlays: { hasConflicts: false, isDiverged: false, isBehindRemote: false }, tags: [],
  };
}

describe("resolveNodeRender", () => {
  const branchByName = new Map([["feat/x", mkBranch("feat/x", "i1")]]);
  const taskByTip = new Map([["s1", mkBranch("feat/x", "i1")]]);

  it("a visible task tip draws a card (asDot false)", () => {
    const node = mkNode({ sha: "s1", isTaskTip: true, branchName: "feat/x" });
    const r = resolveNodeRender(node, new Set(["feat/x"]), branchByName, taskByTip, new Set());
    expect(r.asDot).toBe(false);
    expect(r.taskVisible).toBe(true);
    expect(r.taskBranch?.name).toBe("feat/x");
  });

  it("a task tip filtered OUT draws a plain dot (asDot true)", () => {
    const node = mkNode({ sha: "s1", isTaskTip: true, branchName: "feat/x" });
    const r = resolveNodeRender(node, new Set(["main"]), branchByName, taskByTip, new Set());
    expect(r.asDot).toBe(true);
    expect(r.taskVisible).toBe(false);
  });

  it("a stacked tip is always asDot", () => {
    const node = mkNode({ sha: "s1", isTaskTip: true, branchName: "feat/x" });
    const r = resolveNodeRender(node, new Set(["feat/x"]), branchByName, taskByTip, new Set(["s1"]));
    expect(r.asDot).toBe(true);
  });
});

describe("hitRegionAt", () => {
  const regions: HitRegion[] = [
    { shape: "poly", pts: [[0, 100], [200, 100]], threshold: 8, target: { kind: "trunkLine" } },
    { shape: "rect", x: 90, y: 90, w: 20, h: 20, target: { kind: "commit", sha: "c1" } },
  ];

  it("returns the topmost (last-pushed) region on overlap", () => {
    expect(hitRegionAt(regions, 100, 100)).toEqual({ kind: "commit", sha: "c1" });
  });
  it("hits the poly within threshold when no rect overlaps", () => {
    expect(hitRegionAt(regions, 40, 104)).toEqual({ kind: "trunkLine" });
  });
  it("returns null when nothing is near", () => {
    expect(hitRegionAt(regions, 400, 400)).toBeNull();
  });
});
