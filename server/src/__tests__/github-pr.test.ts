import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Octokit mock ----
const mockOctokit = vi.hoisted(() => ({
  users: { getAuthenticated: vi.fn() },
  pulls: { create: vi.fn() },
}));
vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(() => mockOctokit),
}));

// ---- service/index mock (secretService + logActivity) ----
const mockSvc = vi.hoisted(() => ({
  getByName: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  resolveSecretValue: vi.fn(),
}));
const mockLogActivity = vi.hoisted(() => vi.fn());
vi.mock("../services/index.js", () => ({
  secretService: () => mockSvc,
  logActivity: mockLogActivity,
}));

// The PR service imports `secretService` directly from ./secrets.js, not via
// services/index.js — mock that path too.
vi.mock("../services/secrets.js", () => ({
  secretService: () => mockSvc,
}));

// ---- issueService mock ----
const mockIssueSvc = vi.hoisted(() => ({
  getById: vi.fn(),
  addComment: vi.fn(),
}));
vi.mock("../services/issues.js", () => ({
  issueService: () => mockIssueSvc,
}));

// ---- executionWorkspaceService mock ----
const mockWsSvc = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../services/execution-workspaces.js", () => ({
  executionWorkspaceService: () => mockWsSvc,
}));

const mockResolveGitRoot = vi.hoisted(() => vi.fn());
const mockRunGit = vi.hoisted(() => vi.fn());
const mockPush = vi.hoisted(() => vi.fn());
vi.mock("../services/git.js", () => ({
  resolveGitRoot: mockResolveGitRoot,
  runGit: mockRunGit,
  push: mockPush,
}));

import { errorHandler } from "../middleware/index.js";
import { GITHUB_PAT_ACTIVITY_KINDS, GITHUB_PAT_SECRET_NAME } from "@armyofagents/shared";
import { githubRoutes } from "../routes/github.js";
import {
  GitHubPrError,
  createPullRequest,
  parseGitHubRepoUrl,
} from "../services/github-pr.js";

function createApp(actor: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", githubRoutes({} as any));
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

// -----------------------------------------------------------------------------
// Unit tests: parseGitHubRepoUrl
// -----------------------------------------------------------------------------

describe("parseGitHubRepoUrl", () => {
  it("parses https without .git", () => {
    expect(parseGitHubRepoUrl("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses https with .git suffix", () => {
    expect(parseGitHubRepoUrl("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses https with trailing slash", () => {
    expect(parseGitHubRepoUrl("https://github.com/owner/repo/")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses ssh with .git suffix", () => {
    expect(parseGitHubRepoUrl("git@github.com:owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses ssh without .git", () => {
    expect(parseGitHubRepoUrl("git@github.com:owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("throws GitHubPrError on non-GitHub URL", () => {
    try {
      parseGitHubRepoUrl("https://gitlab.com/owner/repo");
      throw new Error("expected parseGitHubRepoUrl to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubPrError);
      expect((err as GitHubPrError).status).toBe(400);
    }
  });
});

// -----------------------------------------------------------------------------
// Unit tests: createPullRequest service
// -----------------------------------------------------------------------------

describe("createPullRequest service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveGitRoot.mockResolvedValue(null);
    mockRunGit.mockResolvedValue("");
    mockPush.mockResolvedValue({ pushed: true, remote: "origin", branch: "feature/x" });
  });

  const baseArgs = {
    companyId: "company-1",
    repoUrl: "https://github.com/owner/repo",
    base: "main",
    head: "feature/x",
    title: "Add feature",
    body: "Body",
    draft: false,
  };

  it("throws 412 when no PAT configured (with scopeHint)", async () => {
    mockSvc.getByName.mockResolvedValue(null);

    await expect(createPullRequest({} as any, baseArgs)).rejects.toMatchObject({
      status: 412,
      scopeHint: expect.stringContaining("Settings"),
    });
  });

  it("returns {url, number, state: 'open', draft} on success", async () => {
    mockSvc.getByName.mockResolvedValue({ id: "secret-1" });
    mockSvc.resolveSecretValue.mockResolvedValue("ghp_valid");
    mockOctokit.pulls.create.mockResolvedValue({
      data: {
        html_url: "https://github.com/owner/repo/pull/42",
        number: 42,
        state: "open",
        draft: false,
      },
    });

    const pr = await createPullRequest({} as any, baseArgs);

    expect(pr).toEqual({
      url: "https://github.com/owner/repo/pull/42",
      number: 42,
      state: "open",
      draft: false,
    });
    expect(mockOctokit.pulls.create).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      base: "main",
      head: "feature/x",
      title: "Add feature",
      body: "Body",
      draft: false,
    });
  });

  it("maps Octokit 401 to GitHubPrError 401 with hint", async () => {
    mockSvc.getByName.mockResolvedValue({ id: "secret-1" });
    mockSvc.resolveSecretValue.mockResolvedValue("ghp_invalid");
    mockOctokit.pulls.create.mockRejectedValue({ status: 401 });

    try {
      await createPullRequest({} as any, baseArgs);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubPrError);
      expect((err as GitHubPrError).status).toBe(401);
      expect((err as GitHubPrError).scopeHint?.toLowerCase()).toContain("reconnect");
    }
  });

  it("maps Octokit 403 to GitHubPrError 403 with scope hint", async () => {
    mockSvc.getByName.mockResolvedValue({ id: "secret-1" });
    mockSvc.resolveSecretValue.mockResolvedValue("ghp_limited");
    mockOctokit.pulls.create.mockRejectedValue({ status: 403 });

    try {
      await createPullRequest({} as any, baseArgs);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubPrError);
      expect((err as GitHubPrError).status).toBe(403);
      expect((err as GitHubPrError).scopeHint).toContain("pull_requests");
    }
  });

  it("maps Octokit 404 to 'Repository not found: owner/repo'", async () => {
    mockSvc.getByName.mockResolvedValue({ id: "secret-1" });
    mockSvc.resolveSecretValue.mockResolvedValue("ghp_valid");
    mockOctokit.pulls.create.mockRejectedValue({ status: 404 });

    await expect(createPullRequest({} as any, baseArgs)).rejects.toMatchObject({
      status: 404,
      message: "Repository not found: owner/repo",
    });
  });

  it("maps Octokit 422 to message from response.data.message", async () => {
    mockSvc.getByName.mockResolvedValue({ id: "secret-1" });
    mockSvc.resolveSecretValue.mockResolvedValue("ghp_valid");
    mockOctokit.pulls.create.mockRejectedValue({
      status: 422,
      response: { data: { message: "No commits between main and feature/x" } },
    });

    await expect(createPullRequest({} as any, baseArgs)).rejects.toMatchObject({
      status: 422,
      message: "No commits between main and feature/x",
    });
  });
});

// -----------------------------------------------------------------------------
// Route tests: POST /issues/:issueId/github-pr
// -----------------------------------------------------------------------------

describe("POST /issues/:issueId/github-pr", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveGitRoot.mockResolvedValue(null);
    mockRunGit.mockResolvedValue("");
    mockPush.mockResolvedValue({ pushed: true, remote: "origin", branch: "feature/x" });
  });

  const happyIssue = {
    id: "issue-1",
    companyId: "company-1",
    title: "Add feature",
    description: "Issue description",
  };
  const happyWs = {
    id: "ws-1",
    companyId: "company-1",
    repoUrl: "https://github.com/acme/repo",
    branchName: "feature/x",
    metadata: null,
  };
  const validBody = {
    workspaceId: "11111111-1111-1111-1111-111111111111",
    title: "Add feature",
    body: "Body",
    base: "main",
    draft: false,
  };

  function mockHappyPath() {
    mockIssueSvc.getById.mockResolvedValue(happyIssue);
    mockWsSvc.getById.mockResolvedValue(happyWs);
    mockSvc.getByName.mockResolvedValue({ id: "secret-1" });
    mockSvc.resolveSecretValue.mockResolvedValue("ghp_valid");
    mockOctokit.pulls.create.mockResolvedValue({
      data: {
        html_url: "https://github.com/acme/repo/pull/42",
        number: 42,
        state: "open",
        draft: false,
      },
    });
    mockWsSvc.update.mockResolvedValue(happyWs);
    mockIssueSvc.addComment.mockResolvedValue({ id: "comment-1" });
  }

  it("happy path: 200 + persists workspace.metadata.pr + comments + logs activity", async () => {
    mockHappyPath();

    const app = createApp(boardActor);
    const res = await request(app)
      .post("/api/issues/issue-1/github-pr")
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      url: "https://github.com/acme/repo/pull/42",
      number: 42,
      state: "open",
      draft: false,
    });

    // metadata.pr persisted
    expect(mockWsSvc.update).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          pr: expect.objectContaining({
            url: "https://github.com/acme/repo/pull/42",
            number: 42,
            state: "open",
            draft: false,
            createdAt: expect.any(String),
          }),
        }),
      }),
    );

    // comment posted
    expect(mockIssueSvc.addComment).toHaveBeenCalledWith(
      "issue-1",
      "Pull request created: https://github.com/acme/repo/pull/42",
      expect.objectContaining({ userId: "board-user" }),
    );

    // activity log
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        companyId: "company-1",
        action: GITHUB_PAT_ACTIVITY_KINDS.PR_CREATED,
        entityType: "issue",
        entityId: "issue-1",
        details: expect.objectContaining({
          prUrl: "https://github.com/acme/repo/pull/42",
          prNumber: 42,
          workspaceId: "ws-1",
          draft: false,
        }),
      }),
    );
  });

  it("returns 404 when issue not found", async () => {
    mockIssueSvc.getById.mockResolvedValue(null);
    const app = createApp(boardActor);
    const res = await request(app)
      .post("/api/issues/issue-1/github-pr")
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Issue not found" });
  });

  it("returns 404 when workspace not found", async () => {
    mockIssueSvc.getById.mockResolvedValue(happyIssue);
    mockWsSvc.getById.mockResolvedValue(null);
    const app = createApp(boardActor);
    const res = await request(app)
      .post("/api/issues/issue-1/github-pr")
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Workspace not found" });
  });

  it("returns 403 when workspace belongs to a different company than the issue", async () => {
    mockIssueSvc.getById.mockResolvedValue(happyIssue);
    mockWsSvc.getById.mockResolvedValue({ ...happyWs, companyId: "other-company" });
    const app = createApp(boardActor);
    const res = await request(app)
      .post("/api/issues/issue-1/github-pr")
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 400 when workspace has no repoUrl", async () => {
    mockIssueSvc.getById.mockResolvedValue(happyIssue);
    mockWsSvc.getById.mockResolvedValue({ ...happyWs, repoUrl: null });
    const app = createApp(boardActor);
    const res = await request(app)
      .post("/api/issues/issue-1/github-pr")
      .send(validBody);
    expect(res.status).toBe(400);
  });

  it("returns 400 when workspace has no branchName and no head override", async () => {
    mockIssueSvc.getById.mockResolvedValue(happyIssue);
    mockWsSvc.getById.mockResolvedValue({ ...happyWs, branchName: null });
    const app = createApp(boardActor);
    const res = await request(app)
      .post("/api/issues/issue-1/github-pr")
      .send(validBody);
    expect(res.status).toBe(400);
  });

  it("uses head override when workspace.branchName is null", async () => {
    mockHappyPath();
    mockWsSvc.getById.mockResolvedValue({ ...happyWs, branchName: null });
    const app = createApp(boardActor);
    const res = await request(app)
      .post("/api/issues/issue-1/github-pr")
      .send({ ...validBody, head: "feature/from-client" });

    expect(res.status).toBe(200);
    // Verify Octokit was called with the client-provided head
    expect(mockOctokit.pulls.create).toHaveBeenCalledWith(
      expect.objectContaining({ head: "feature/from-client" }),
    );
  });

  it("adds origin from workspace repoUrl before auto-pushing when local worktree has no remote", async () => {
    mockHappyPath();
    mockWsSvc.getById.mockResolvedValue({
      ...happyWs,
      cwd: "C:\\repo",
    });
    mockResolveGitRoot.mockResolvedValue("C:\\repo");
    mockRunGit.mockImplementation(async (args: string[]) => {
      if (args[0] === "remote" && args[1] === "get-url") {
        throw new Error("No such remote 'origin'");
      }
      if (args[0] === "remote" && args[1] === "add") {
        return "";
      }
      if (args[0] === "rev-parse") {
        throw new Error("no upstream configured");
      }
      return "";
    });

    const app = createApp(boardActor);
    const res = await request(app)
      .post("/api/issues/issue-1/github-pr")
      .send(validBody);

    expect(res.status).toBe(200);
    expect(mockRunGit).toHaveBeenCalledWith(
      ["remote", "add", "origin", "https://github.com/acme/repo"],
      "C:\\repo",
      { timeout: 5_000 },
    );
    expect(mockPush).toHaveBeenCalledWith(
      "C:\\repo",
      "origin",
      "feature/x",
      { pat: "ghp_valid" },
    );
  });

  it("returns 400 when body is missing title (zod fail)", async () => {
    const app = createApp(boardActor);
    const res = await request(app)
      .post("/api/issues/issue-1/github-pr")
      .send({ ...validBody, title: "" });
    expect(res.status).toBe(400);
  });

  it("rejects non-board actor (assertBoard throws 403)", async () => {
    const app = createApp({
      type: "agent",
      agentId: "a1",
      companyId: "company-1",
    });
    const res = await request(app)
      .post("/api/issues/issue-1/github-pr")
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("rejects board actor from a different company (assertCompanyAccess throws 403)", async () => {
    mockIssueSvc.getById.mockResolvedValue(happyIssue);
    const app = createApp({
      type: "board",
      source: "session",
      userId: "user-x",
      companyIds: ["other-company"],
      isInstanceAdmin: false,
    });
    const res = await request(app)
      .post("/api/issues/issue-1/github-pr")
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("surfaces 412 when PAT not configured", async () => {
    mockIssueSvc.getById.mockResolvedValue(happyIssue);
    mockWsSvc.getById.mockResolvedValue(happyWs);
    mockSvc.getByName.mockResolvedValue(null);
    const app = createApp(boardActor);
    const res = await request(app)
      .post("/api/issues/issue-1/github-pr")
      .send(validBody);
    expect(res.status).toBe(412);
    expect(res.body.error).toContain("not configured");
    expect(res.body.hint).toContain("Settings");
  });
});

// -----------------------------------------------------------------------------
// Task 11 follow-up: DELETE route logs entityId as UUID, not the string
// name.
// -----------------------------------------------------------------------------

describe("Task 11 follow-up: DELETE /companies/:companyId/github/pat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs activity with entityId = secret row UUID (not the 'github_pat' literal)", async () => {
    mockSvc.getByName.mockResolvedValue({
      id: "uuid-row-123",
      externalRef: "octocat",
    });
    mockSvc.delete.mockResolvedValue(true);
    const app = createApp(boardActor);

    const res = await request(app).delete("/api/companies/company-1/github/pat");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false, removed: true });

    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: GITHUB_PAT_ACTIVITY_KINDS.DISCONNECTED,
        entityType: "secret",
        entityId: "uuid-row-123",
        details: expect.objectContaining({ githubUser: "octocat" }),
      }),
    );
    // Safety: entityId MUST NOT be the literal secret name
    const logCall = mockLogActivity.mock.calls[0]![1] as { entityId: string };
    expect(logCall.entityId).not.toBe(GITHUB_PAT_SECRET_NAME);
  });

  it("returns removed=false + does NOT log activity when no row existed", async () => {
    mockSvc.getByName.mockResolvedValue(null);
    const app = createApp(boardActor);

    const res = await request(app).delete("/api/companies/company-1/github/pat");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false, removed: false });
    expect(mockSvc.delete).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });
});
