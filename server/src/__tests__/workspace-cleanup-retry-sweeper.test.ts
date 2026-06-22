import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression test for the blocker: the cleanup-retry sweeper must NEVER rm -rf a
// path that is (or contains) a project workspace, nor a workspace the runtime did
// not create — mirroring the guards in cleanupExecutionWorkspaceArtifacts.

const rmMock = vi.fn().mockResolvedValue(undefined);
vi.mock("node:fs/promises", () => ({ rm: (...a: any[]) => rmMock(...a) }));

vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => ({ and: a }),
  eq: (a: any, b: any) => ({ eq: [a, b] }),
  lt: (a: any, b: any) => ({ lt: [a, b] }),
  sql: (s: any) => ({ sql: s }),
}));

vi.mock("@armyofagents/db", () => ({
  executionWorkspaces: {
    __table: "ew",
    id: "ew_id",
    cwd: "ew_cwd",
    providerRef: "ew_provider_ref",
    metadata: "ew_metadata",
    status: "ew_status",
    closedAt: "ew_closed_at",
  },
  projectWorkspaces: { __table: "pw", cwd: "pw_cwd" },
}));

vi.mock("../middleware/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { retryCleanupFailedWorkspaces } from "../services/workspace-cleanup-retry-sweeper.js";

function makeDb(opts: { failed: any[]; projectCwds: string[] }) {
  const archived: string[] = [];
  const db: any = {
    select: (_cols?: any) => ({
      from: (table: any) => {
        const rows =
          table.__table === "ew"
            ? opts.failed
            : opts.projectCwds.map((cwd) => ({ cwd }));
        const chain: any = {
          where: () => chain,
          then: (res: any) => Promise.resolve(res(rows)),
        };
        return chain;
      },
    }),
    update: (_table: any) => ({
      set: (_vals: any) => ({
        where: (cond: any) => {
          const id = cond?.eq?.[1];
          if (id) archived.push(id);
          return Promise.resolve(undefined);
        },
      }),
    }),
    __archived: archived,
  };
  return db;
}

describe("retryCleanupFailedWorkspaces — never rm -rf a preserved path", () => {
  beforeEach(() => rmMock.mockClear());

  it("does NOT remove a non-runtime-created workspace whose cwd is the project repo; archives it", async () => {
    const db = makeDb({
      failed: [{ id: "w1", cwd: "/home/user/repo", providerRef: null, providerType: "local_fs", metadata: { createdByRuntime: false } }],
      projectCwds: ["/home/user/repo"],
    });
    const res = await retryCleanupFailedWorkspaces(db);
    expect(rmMock).not.toHaveBeenCalled();
    expect(res.preserved).toBe(1);
    expect(db.__archived).toContain("w1");
  });

  it("does NOT remove a non-runtime local_fs dir even when isolated (local_fs requires createdByRuntime)", async () => {
    const db = makeDb({
      failed: [{ id: "w1b", cwd: "/srv/shared/external-skill-dir", providerRef: null, providerType: "local_fs", metadata: { createdByRuntime: false } }],
      projectCwds: ["/home/user/repo"],
    });
    const res = await retryCleanupFailedWorkspaces(db);
    expect(rmMock).not.toHaveBeenCalled();
    expect(res.preserved).toBe(1);
    expect(db.__archived).toContain("w1b");
  });

  it("does NOT remove a runtime workspace whose path equals/contains a project workspace", async () => {
    const db = makeDb({
      failed: [{ id: "w2", cwd: "/home/user/repo", providerRef: null, providerType: "local_fs", metadata: { createdByRuntime: true } }],
      projectCwds: ["/home/user/repo"],
    });
    const res = await retryCleanupFailedWorkspaces(db);
    expect(rmMock).not.toHaveBeenCalled();
    expect(res.preserved).toBe(1);
    expect(db.__archived).toContain("w2");
  });

  it("DOES remove an isolated runtime workspace not matching any project workspace", async () => {
    const db = makeDb({
      failed: [{ id: "w3", cwd: "/tmp/aoa-worktrees/abc", providerRef: null, providerType: "local_fs", metadata: { createdByRuntime: true } }],
      projectCwds: ["/home/user/repo"],
    });
    const res = await retryCleanupFailedWorkspaces(db);
    expect(rmMock).toHaveBeenCalledTimes(1);
    expect(rmMock).toHaveBeenCalledWith("/tmp/aoa-worktrees/abc", { recursive: true, force: true });
    expect(res.recovered).toBe(1);
    expect(res.preserved).toBe(0);
  });

  it("DOES remove an isolated git_worktree even when createdByRuntime is false (eager worktrees persist false)", async () => {
    const db = makeDb({
      failed: [{ id: "w5", cwd: null, providerRef: "/tmp/aoa-worktrees/wt-1", providerType: "git_worktree", metadata: { createdByRuntime: false } }],
      projectCwds: ["/home/user/repo"],
    });
    const res = await retryCleanupFailedWorkspaces(db);
    expect(rmMock).toHaveBeenCalledTimes(1);
    expect(rmMock).toHaveBeenCalledWith("/tmp/aoa-worktrees/wt-1", { recursive: true, force: true });
    expect(res.recovered).toBe(1);
    expect(res.preserved).toBe(0);
  });

  it("does NOT remove a git_worktree whose path equals/contains a project workspace", async () => {
    const db = makeDb({
      failed: [{ id: "w6", cwd: null, providerRef: "/home/user/repo", providerType: "git_worktree", metadata: { createdByRuntime: false } }],
      projectCwds: ["/home/user/repo"],
    });
    const res = await retryCleanupFailedWorkspaces(db);
    expect(rmMock).not.toHaveBeenCalled();
    expect(res.preserved).toBe(1);
    expect(db.__archived).toContain("w6");
  });

  it("archives a row with no path without calling rm", async () => {
    const db = makeDb({
      failed: [{ id: "w4", cwd: null, providerRef: null, metadata: null }],
      projectCwds: [],
    });
    const res = await retryCleanupFailedWorkspaces(db);
    expect(rmMock).not.toHaveBeenCalled();
    expect(res.recovered).toBe(1);
  });
});
