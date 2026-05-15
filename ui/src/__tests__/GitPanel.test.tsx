import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { GitPanel } from "../components/workspace/tools/GitPanel";

const mockGetIssue = vi.fn();
const mockCreatePR = vi.fn();
const mockPushToast = vi.fn();
const mockGetGitStatus = vi.fn();
const mockSafety = vi.fn();
const mockGitCommit = vi.fn();
const mockGitPush = vi.fn();

vi.mock("../api/issues", () => ({
  issuesApi: { get: (...args: unknown[]) => mockGetIssue(...args) },
}));

vi.mock("../api/github-integration", () => ({
  githubIntegrationApi: {
    createPR: (...args: unknown[]) => mockCreatePR(...args),
  },
}));

vi.mock("../api/execution-workspaces", () => ({
  executionWorkspacesApi: {
    getGitStatus: (...args: unknown[]) => mockGetGitStatus(...args),
    getGitLog: vi.fn().mockResolvedValue({ gitAvailable: true, entries: [] }),
    safety: (...args: unknown[]) => mockSafety(...args),
    gitCommit: (...args: unknown[]) => mockGitCommit(...args),
    gitPush: (...args: unknown[]) => mockGitPush(...args),
  },
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({
    toasts: [],
    pushToast: (...args: unknown[]) => mockPushToast(...args),
    dismissToast: vi.fn(),
    clearToasts: vi.fn(),
  }),
}));

// Mock clipboard API
const writeText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText } });

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    companyId: "comp-1",
    projectId: "proj-1",
    projectWorkspaceId: null,
    sourceIssueId: "issue-1",
    mode: "isolated_workspace" as const,
    strategyType: "git_worktree" as const,
    name: "ENG-99-fix-auth",
    status: "active" as const,
    cwd: "/tmp/ws/ENG-99",
    repoUrl: "https://github.com/acme/repo",
    baseRef: "main",
    branchName: "ENG-99-fix-auth",
    providerType: "git_worktree" as const,
    providerRef: null,
    derivedFromExecutionWorkspaceId: null,
    lastUsedAt: new Date(),
    openedAt: new Date(),
    closedAt: null,
    cleanupEligibleAt: null,
    cleanupReason: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function renderPanel(
  props: Partial<React.ComponentProps<typeof GitPanel>> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  }
  // Distinguish explicit null/undefined in `issueId` from "not passed":
  const issueIdProp: string | null | undefined =
    "issueId" in props ? props.issueId : "issue-1";
  return render(
    <GitPanel
      workspace={(props.workspace ?? makeWorkspace()) as any}
      issueId={issueIdProp}
    />,
    { wrapper: Wrapper },
  );
}

describe("GitPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default git status: git available, clean tree, branch matches workspace.branchName
    mockGetGitStatus.mockResolvedValue({
      gitAvailable: true,
      branch: "ENG-99-fix-auth",
      detachedHead: false,
      remote: null,
      ahead: null,
      behind: null,
      files: [],
      clean: true,
    });
    mockSafety.mockResolvedValue({
      task: null,
      activeRun: null,
      requiresConfirmation: { commit: false, push: false, createPr: false },
      warnings: [],
    });
    mockGitCommit.mockResolvedValue({ hash: "abc", message: "", filesCommitted: [], skippedFiles: [] });
    mockGitPush.mockResolvedValue({ pushed: true, remote: "origin", branch: "main" });
  });

  it("renders branch name, base ref, and repo URL", async () => {
    renderPanel();

    expect(await screen.findByText("ENG-99-fix-auth")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /github\.com/i })).toHaveAttribute(
      "href",
      "https://github.com/acme/repo",
    );
  });

  it("copy button copies branch name to clipboard", async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    renderPanel();

    const copyBtn = await screen.findByTestId("copy-branch-btn");
    await user.click(copyBtn);

    expect(spy).toHaveBeenCalledWith("ENG-99-fix-auth");
    spy.mockRestore();
  });

  it("shows 'No PR created' when metadata.pr is absent", async () => {
    renderPanel();
    expect(await screen.findByText("No PR created")).toBeInTheDocument();
  });

  it("renders PR badge and link when metadata.pr has new {url, number, state} shape", async () => {
    const ws = makeWorkspace({
      metadata: {
        pr: {
          url: "https://github.com/acme/repo/pull/42",
          number: 42,
          state: "open",
          createdAt: "2026-04-22T12:00:00Z",
          draft: false,
        },
      },
    });
    renderPanel({ workspace: ws as any });

    expect(await screen.findByText("#42")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    // External "View PR #42" link is rendered in place of the Create PR button.
    const viewPrLink = screen.getByTestId("pr-link");
    expect(viewPrLink).toHaveAttribute(
      "href",
      "https://github.com/acme/repo/pull/42",
    );
    expect(viewPrLink).toHaveTextContent("View PR #42");
  });

  it("hides repo URL row when repoUrl is null", async () => {
    renderPanel({ workspace: makeWorkspace({ repoUrl: null }) as any });
    // Wait for status to load, then confirm repo-url-row is absent
    await screen.findByText("No PR created");
    expect(screen.queryByTestId("repo-url-row")).not.toBeInTheDocument();
  });

  it("hides branch row when branchName is null", async () => {
    // Override status to return no branch (workspace has no branch provisioned yet)
    mockGetGitStatus.mockResolvedValue({
      gitAvailable: true,
      branch: null,
      detachedHead: false,
      remote: null,
      ahead: null,
      behind: null,
      files: [],
      clean: true,
    });
    renderPanel({ workspace: makeWorkspace({ branchName: null }) as any });
    // Wait for status to load, then confirm branch-row is absent
    await screen.findByText("No PR created");
    expect(screen.queryByTestId("branch-row")).not.toBeInTheDocument();
  });

  it("Create PR button enabled when issueId provided and no PR exists", async () => {
    renderPanel();

    const btn = await screen.findByTestId("create-pr-btn");
    expect(btn).toBeEnabled();
    expect(btn).toHaveTextContent(/create pr/i);
  });

  it("Create PR button disabled with helper tooltip when issueId is null", async () => {
    renderPanel({ issueId: null });

    const btn = await screen.findByTestId("create-pr-btn");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute(
      "title",
      "Link a task to this workspace to create a PR",
    );
  });

  it("clicking Create PR opens the dialog", async () => {
    mockGetIssue.mockResolvedValue({
      id: "issue-1",
      title: "Task title",
      description: "",
    });
    const user = userEvent.setup();
    renderPanel();

    // Wait for the git status to load so the Create PR button is rendered
    const createPrBtn = await screen.findByTestId("create-pr-btn");
    expect(screen.queryByTestId("create-pr-dialog")).not.toBeInTheDocument();

    await user.click(createPrBtn);

    await waitFor(() =>
      expect(screen.getByTestId("create-pr-dialog")).toBeInTheDocument(),
    );
  });

  it("asks for confirmation before committing when a run is active", async () => {
    mockGetGitStatus.mockResolvedValue({
      gitAvailable: true,
      branch: "ENG-99-fix-auth",
      detachedHead: false,
      remote: { name: "origin", fetchUrl: "git@example.com:acme/repo.git", pushUrl: "git@example.com:acme/repo.git" },
      ahead: 0,
      behind: 0,
      files: [{ path: "src/auth.ts", status: "modified", staged: false }],
      clean: false,
    });
    mockSafety.mockResolvedValue({
      task: { id: "issue-1", title: "Fix auth bug", status: "in_progress", identifier: "ENG-99" },
      activeRun: { id: "run-1", status: "running", startedAt: "2026-05-15T10:00:00Z" },
      requiresConfirmation: { commit: true, push: true, createPr: true },
      warnings: ["An agent run is currently active."],
    });

    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByText("Commit..."));
    await user.type(screen.getByTestId("commit-message-input"), "Fix auth");
    expect(screen.getByTestId("commit-btn")).toHaveTextContent("Commit 1 file");

    await user.click(screen.getByTestId("commit-btn"));

    expect(mockSafety).toHaveBeenCalledWith("ws-1");
    expect(mockGitCommit).not.toHaveBeenCalled();
    expect(await screen.findByText(/workspace safety check/i)).toBeInTheDocument();
    expect(screen.getByText(/Fix auth bug/i)).toBeInTheDocument();
    expect(screen.getByText(/running/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /continue anyway/i }));

    await waitFor(() => expect(mockGitCommit).toHaveBeenCalledWith("ws-1", {
      message: "Fix auth",
      files: ["src/auth.ts"],
    }));
  });

  it("asks for confirmation before pushing when a run is active, cancel prevents push, and continue performs it", async () => {
    mockGetGitStatus.mockResolvedValue({
      gitAvailable: true,
      branch: "ENG-99-fix-auth",
      detachedHead: false,
      remote: { name: "origin", fetchUrl: "git@example.com:acme/repo.git", pushUrl: "git@example.com:acme/repo.git" },
      ahead: 2,
      behind: 0,
      files: [],
      clean: true,
    });
    mockSafety.mockResolvedValue({
      task: { id: "issue-1", title: "Fix auth bug", status: "in_progress", identifier: "ENG-99" },
      activeRun: { id: "run-1", status: "running", startedAt: "2026-05-15T10:00:00Z", agentName: "Builder" },
      requiresConfirmation: { commit: true, push: true, createPr: true },
      warnings: ["An agent run is currently active."],
    });

    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByTestId("push-btn"));

    expect(mockSafety).toHaveBeenCalledWith("ws-1");
    expect(mockGitPush).not.toHaveBeenCalled();
    expect(await screen.findByTestId("workspace-safety-dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByTestId("workspace-safety-dialog")).not.toBeInTheDocument());
    expect(mockGitPush).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("push-btn"));
    await user.click(await screen.findByRole("button", { name: /continue anyway/i }));

    await waitFor(() => expect(mockGitPush).toHaveBeenCalledWith("ws-1"));
  });

  it("labels push with the number of commits ahead", async () => {
    mockGetGitStatus.mockResolvedValue({
      gitAvailable: true,
      branch: "ENG-99-fix-auth",
      detachedHead: false,
      remote: { name: "origin", fetchUrl: "git@example.com:acme/repo.git", pushUrl: "git@example.com:acme/repo.git" },
      ahead: 2,
      behind: 0,
      files: [],
      clean: true,
    });

    renderPanel();

    expect(await screen.findByTestId("push-btn")).toHaveTextContent("Push 2 commits");
  });

  it("does not show pushed when remote exists but upstream tracking is unknown", async () => {
    mockGetGitStatus.mockResolvedValue({
      gitAvailable: true,
      branch: "ENG-99-fix-auth",
      detachedHead: false,
      remote: { name: "origin", fetchUrl: "git@example.com:acme/repo.git", pushUrl: "git@example.com:acme/repo.git" },
      ahead: null,
      behind: null,
      files: [],
      clean: true,
    });

    renderPanel();

    expect(await screen.findByTestId("push-btn")).toHaveTextContent("Push branch");
    expect(screen.queryByText("Pushed")).not.toBeInTheDocument();
  });

  it("shows pushed state when the remote is up to date", async () => {
    mockGetGitStatus.mockResolvedValue({
      gitAvailable: true,
      branch: "ENG-99-fix-auth",
      detachedHead: false,
      remote: { name: "origin", fetchUrl: "git@example.com:acme/repo.git", pushUrl: "git@example.com:acme/repo.git" },
      ahead: 0,
      behind: 0,
      files: [],
      clean: true,
    });

    renderPanel();

    expect(await screen.findByText("Pushed")).toBeInTheDocument();
    expect(screen.queryByTestId("push-btn")).not.toBeInTheDocument();
  });
});
