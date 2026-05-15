/**
 * API route tests for workspace-git.ts endpoints.
 *
 * Uses vi.mock to stub services and git operations,
 * supertest for HTTP-level assertions.
 */

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mock git.ts service functions ----
const mockGetStatus = vi.hoisted(() => vi.fn());
const mockGetLog = vi.hoisted(() => vi.fn());
const mockCommit = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
const mockResolveGitRoot = vi.hoisted(() => vi.fn());
const mockGetCachedStatus = vi.hoisted(() => vi.fn());
const mockSetCachedStatus = vi.hoisted(() => vi.fn());
const mockInvalidateStatusCache = vi.hoisted(() => vi.fn());

vi.mock("../services/git.js", () => ({
  getStatus: mockGetStatus,
  getLog: mockGetLog,
  commit: mockCommit,
  push: mockPush,
  resolveGitRoot: mockResolveGitRoot,
  getCachedStatus: mockGetCachedStatus,
  setCachedStatus: mockSetCachedStatus,
  invalidateStatusCache: mockInvalidateStatusCache,
}));

// ---- Mock executionWorkspaceService ----
const mockWsSvc = vi.hoisted(() => ({
  getById: vi.fn(),
}));
vi.mock("../services/index.js", () => ({
  executionWorkspaceService: () => mockWsSvc,
  secretService: () => ({
    getByName: vi.fn().mockResolvedValue(null),
    resolveSecretValue: vi.fn(),
  }),
}));

// ---- Mock workspace-authz ----
vi.mock("../services/workspace-authz.js", () => ({
  assertCanControlWorkspace: vi.fn(),
}));

// ---- Mock authz (assertCompanyAccess) ----
vi.mock("../routes/authz.js", () => ({
  assertCompanyAccess: vi.fn(),
}));

import { errorHandler } from "../middleware/index.js";
import { workspaceGitRoutes } from "../routes/workspace-git.js";

// ---------------------------------------------------------------------------
// Test app factory
// ---------------------------------------------------------------------------

function createApp(actor: unknown = boardActor) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", workspaceGitRoutes({} as any));
  app.use(errorHandler);
  return app;
}

const boardActor = {
  type: "board",
  source: "local_implicit",
  userId: "board-user",
  companyIds: null,
  isInstanceAdmin: true,
};

const mockWorkspace = {
  id: "ws-1",
  companyId: "company-1",
  projectId: "project-1",
  cwd: "/tmp/test-workspace",
  branchName: "feature/test",
  providerType: "local_fs",
  repoUrl: null,
  baseRef: "main",
  status: "active",
  metadata: {},
};

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockWsSvc.getById.mockResolvedValue(mockWorkspace);
  mockResolveGitRoot.mockResolvedValue("/tmp/test-workspace");
  mockGetCachedStatus.mockReturnValue(null);
});

// ---------------------------------------------------------------------------
// GET /execution-workspaces/:id/git/status
// ---------------------------------------------------------------------------

describe("GET /execution-workspaces/:id/git/status", () => {
  it("returns live git status when no cache", async () => {
    const statusResult = {
      branch: "main",
      detachedHead: false,
      remote: null,
      ahead: null,
      behind: null,
      files: [],
      clean: true,
    };
    mockGetStatus.mockResolvedValue(statusResult);

    const app = createApp();
    const res = await request(app).get("/api/execution-workspaces/ws-1/git/status");

    expect(res.status).toBe(200);
    expect(res.body.gitAvailable).toBe(true);
    expect(res.body.branch).toBe("main");
    expect(res.body.clean).toBe(true);
    expect(mockSetCachedStatus).toHaveBeenCalledWith("ws-1", statusResult);
  });

  it("returns cached status when available", async () => {
    const cachedResult = {
      branch: "cached-branch",
      detachedHead: false,
      remote: null,
      ahead: null,
      behind: null,
      files: [],
      clean: true,
    };
    mockGetCachedStatus.mockReturnValue(cachedResult);

    const app = createApp();
    const res = await request(app).get("/api/execution-workspaces/ws-1/git/status");

    expect(res.status).toBe(200);
    expect(res.body.branch).toBe("cached-branch");
    // getStatus should not be called when cache hit
    expect(mockGetStatus).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown workspace", async () => {
    mockWsSvc.getById.mockResolvedValue(null);

    const app = createApp();
    const res = await request(app).get("/api/execution-workspaces/unknown/git/status");

    expect(res.status).toBe(404);
  });

  it("returns gitAvailable=false when no cwd", async () => {
    mockWsSvc.getById.mockResolvedValue({ ...mockWorkspace, cwd: null });

    const app = createApp();
    const res = await request(app).get("/api/execution-workspaces/ws-1/git/status");

    expect(res.status).toBe(200);
    expect(res.body.gitAvailable).toBe(false);
  });

  it("returns gitAvailable=false when not a git repo", async () => {
    mockResolveGitRoot.mockResolvedValue(null);

    const app = createApp();
    const res = await request(app).get("/api/execution-workspaces/ws-1/git/status");

    expect(res.status).toBe(200);
    expect(res.body.gitAvailable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /execution-workspaces/:id/git/log
// ---------------------------------------------------------------------------

describe("GET /execution-workspaces/:id/git/log", () => {
  it("returns log entries with default limit", async () => {
    const logEntries = [
      { hash: "abc", shortHash: "abc", message: "test", author: "A", timestamp: "2026-01-01" },
    ];
    mockGetLog.mockResolvedValue(logEntries);

    const app = createApp();
    const res = await request(app).get("/api/execution-workspaces/ws-1/git/log");

    expect(res.status).toBe(200);
    expect(res.body.gitAvailable).toBe(true);
    expect(res.body.entries).toHaveLength(1);
    expect(mockGetLog).toHaveBeenCalledWith("/tmp/test-workspace", 5);
  });

  it("respects limit query parameter", async () => {
    mockGetLog.mockResolvedValue([]);

    const app = createApp();
    const res = await request(app).get("/api/execution-workspaces/ws-1/git/log?limit=10");

    expect(res.status).toBe(200);
    expect(mockGetLog).toHaveBeenCalledWith("/tmp/test-workspace", 10);
  });

  it("clamps limit to 50", async () => {
    mockGetLog.mockResolvedValue([]);

    const app = createApp();
    await request(app).get("/api/execution-workspaces/ws-1/git/log?limit=100");

    expect(mockGetLog).toHaveBeenCalledWith("/tmp/test-workspace", 50);
  });
});

// ---------------------------------------------------------------------------
// POST /execution-workspaces/:id/git/commit
// ---------------------------------------------------------------------------

describe("POST /execution-workspaces/:id/git/commit", () => {
  it("commits with valid message and files", async () => {
    const commitResult = {
      hash: "abc123",
      message: "test commit",
      filesCommitted: ["file.txt"],
      skippedFiles: [],
    };
    mockCommit.mockResolvedValue(commitResult);

    const app = createApp();
    const res = await request(app)
      .post("/api/execution-workspaces/ws-1/git/commit")
      .send({ message: "test commit", files: ["file.txt"] });

    expect(res.status).toBe(200);
    expect(res.body.hash).toBe("abc123");
    expect(mockInvalidateStatusCache).toHaveBeenCalledWith("ws-1");
  });

  it("rejects missing message", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/execution-workspaces/ws-1/git/commit")
      .send({ files: ["file.txt"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/i);
  });

  it("rejects empty files array", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/execution-workspaces/ws-1/git/commit")
      .send({ message: "msg", files: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/files/i);
  });

  it("returns 400 for path traversal errors", async () => {
    mockCommit.mockRejectedValue(new Error('Invalid file path: "../etc/passwd" escapes the repository root'));

    const app = createApp();
    const res = await request(app)
      .post("/api/execution-workspaces/ws-1/git/commit")
      .send({ message: "hack", files: ["../etc/passwd"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/escapes/);
  });

  it("returns 400 for detached HEAD", async () => {
    mockCommit.mockRejectedValue(new Error("Cannot commit in detached HEAD state"));

    const app = createApp();
    const res = await request(app)
      .post("/api/execution-workspaces/ws-1/git/commit")
      .send({ message: "msg", files: ["file.txt"] });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /execution-workspaces/:id/git/push
// ---------------------------------------------------------------------------

describe("POST /execution-workspaces/:id/git/push", () => {
  it("pushes successfully", async () => {
    const pushResult = { pushed: true, remote: "origin", branch: "main" };
    mockPush.mockResolvedValue(pushResult);

    const app = createApp();
    const res = await request(app)
      .post("/api/execution-workspaces/ws-1/git/push")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.pushed).toBe(true);
    expect(mockInvalidateStatusCache).toHaveBeenCalledWith("ws-1");
  });

  it("returns 400 when no remote configured", async () => {
    mockPush.mockRejectedValue(new Error("No remote configured. Add a remote with `git remote add origin <url>`."));

    const app = createApp();
    const res = await request(app)
      .post("/api/execution-workspaces/ws-1/git/push")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No remote configured/);
  });

  it("returns 400 for detached HEAD", async () => {
    mockPush.mockRejectedValue(new Error("Cannot push in detached HEAD state"));

    const app = createApp();
    const res = await request(app)
      .post("/api/execution-workspaces/ws-1/git/push")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid push remote", async () => {
    mockPush.mockRejectedValue(new Error("Invalid remote: remote must be a configured remote name"));

    const app = createApp();
    const res = await request(app)
      .post("/api/execution-workspaces/ws-1/git/push")
      .send({ remote: "https://attacker.example/repo.git" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/remote/i);
  });

  it("returns 400 for invalid push branch", async () => {
    mockPush.mockRejectedValue(new Error("Invalid branch name: main;touch-owned"));

    const app = createApp();
    const res = await request(app)
      .post("/api/execution-workspaces/ws-1/git/push")
      .send({ branch: "main;touch-owned" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/branch/i);
  });
});
