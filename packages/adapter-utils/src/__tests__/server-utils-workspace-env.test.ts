import { describe, expect, it } from "vitest";
import { applyAoaWorkspaceEnv } from "../server-utils.js";

describe("applyAoaWorkspaceEnv", () => {
  it("sets all 9 AoA workspace env keys when populated", () => {
    const env: Record<string, string> = {};
    applyAoaWorkspaceEnv(env, {
      workspaceCwd: "/tmp/wt",
      workspaceSource: "task",
      workspaceStrategy: "isolated",
      workspaceId: "ws_abc",
      workspaceRepoUrl: "https://github.com/example/repo.git",
      workspaceRepoRef: "main",
      workspaceBranch: "feat/x",
      workspaceWorktreePath: "/tmp/wt",
      agentHome: "/home/agent",
    });
    expect(env.AOA_WORKSPACE_CWD).toBe("/tmp/wt");
    expect(env.AOA_WORKSPACE_SOURCE).toBe("task");
    expect(env.AOA_WORKSPACE_STRATEGY).toBe("isolated");
    expect(env.AOA_WORKSPACE_ID).toBe("ws_abc");
    expect(env.AOA_WORKSPACE_REPO_URL).toBe("https://github.com/example/repo.git");
    expect(env.AOA_WORKSPACE_REPO_REF).toBe("main");
    expect(env.AOA_WORKSPACE_BRANCH).toBe("feat/x");
    expect(env.AOA_WORKSPACE_WORKTREE_PATH).toBe("/tmp/wt");
    expect(env.AGENT_HOME).toBe("/home/agent");
  });

  it("skips null/undefined/empty values", () => {
    const env: Record<string, string> = {};
    applyAoaWorkspaceEnv(env, {
      workspaceCwd: "/tmp/wt",
      workspaceSource: null,
      workspaceStrategy: "",
      workspaceId: undefined,
      agentHome: "/home/agent",
    });
    expect(env.AOA_WORKSPACE_CWD).toBe("/tmp/wt");
    expect(env.AGENT_HOME).toBe("/home/agent");
    expect(env.AOA_WORKSPACE_SOURCE).toBeUndefined();
    expect(env.AOA_WORKSPACE_STRATEGY).toBeUndefined();
    expect(env.AOA_WORKSPACE_ID).toBeUndefined();
  });
});
