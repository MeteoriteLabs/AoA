import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { GitPanel } from "../components/workspace/tools/GitPanel";

const mockGetIssue = vi.fn();
const mockCreatePR = vi.fn();
const mockPushToast = vi.fn();

vi.mock("../api/issues", () => ({
  issuesApi: { get: (...args: unknown[]) => mockGetIssue(...args) },
}));

vi.mock("../api/github-integration", () => ({
  githubIntegrationApi: {
    createPR: (...args: unknown[]) => mockCreatePR(...args),
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
  });

  it("renders branch name, base ref, and repo URL", () => {
    renderPanel();

    expect(screen.getByText("ENG-99-fix-auth")).toBeInTheDocument();
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

    const copyBtn = screen.getByTestId("copy-branch-btn");
    await user.click(copyBtn);

    expect(spy).toHaveBeenCalledWith("ENG-99-fix-auth");
    spy.mockRestore();
  });

  it("shows 'No PR created' when metadata.pr is absent", () => {
    renderPanel();
    expect(screen.getByText("No PR created")).toBeInTheDocument();
  });

  it("renders PR badge and link when metadata.pr has new {url, number, state} shape", () => {
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

    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    // External "View PR #42" link is rendered in place of the Create PR button.
    const viewPrLink = screen.getByTestId("pr-link");
    expect(viewPrLink).toHaveAttribute(
      "href",
      "https://github.com/acme/repo/pull/42",
    );
    expect(viewPrLink).toHaveTextContent("View PR #42");
  });

  it("hides repo URL row when repoUrl is null", () => {
    renderPanel({ workspace: makeWorkspace({ repoUrl: null }) as any });
    expect(screen.queryByTestId("repo-url-row")).not.toBeInTheDocument();
  });

  it("hides branch row when branchName is null", () => {
    renderPanel({ workspace: makeWorkspace({ branchName: null }) as any });
    expect(screen.queryByTestId("branch-row")).not.toBeInTheDocument();
  });

  it("Create PR button enabled when issueId provided and no PR exists", () => {
    renderPanel();

    const btn = screen.getByTestId("create-pr-btn");
    expect(btn).toBeEnabled();
    expect(btn).toHaveTextContent(/create pr/i);
  });

  it("Create PR button disabled with helper tooltip when issueId is null", () => {
    renderPanel({ issueId: null });

    const btn = screen.getByTestId("create-pr-btn");
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

    expect(screen.queryByTestId("create-pr-dialog")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("create-pr-btn"));

    expect(screen.getByTestId("create-pr-dialog")).toBeInTheDocument();
  });
});
