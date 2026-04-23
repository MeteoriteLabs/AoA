import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

import { ApiError } from "../api/client";

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

import { CreatePrDialog } from "../components/workspace/CreatePrDialog";

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    companyId: "co-1",
    projectId: "proj-1",
    projectWorkspaceId: null,
    sourceIssueId: "issue-1",
    mode: "isolated_workspace",
    strategyType: "git_worktree",
    name: "ENG-99",
    status: "active",
    cwd: "/tmp/ws/ENG-99",
    repoUrl: "https://github.com/acme/repo",
    baseRef: "main",
    branchName: "feature/x",
    providerType: "git_worktree",
    providerRef: null,
    derivedFromExecutionWorkspaceId: null,
    lastUsedAt: new Date(),
    openedAt: new Date(),
    closedAt: null,
    cleanupEligibleAt: null,
    cleanupReason: null,
    config: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

function renderDialog(props: Partial<React.ComponentProps<typeof CreatePrDialog>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const onOpenChange = vi.fn();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  }
  const result = render(
    <CreatePrDialog
      issueId="issue-1"
      workspace={makeWorkspace()}
      open={true}
      onOpenChange={onOpenChange}
      {...props}
    />,
    { wrapper: Wrapper },
  );
  return { ...result, onOpenChange, queryClient };
}

describe("CreatePrDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefills title/body from the linked task + base from workspace.baseRef", async () => {
    mockGetIssue.mockResolvedValue({
      id: "issue-1",
      title: "Fix auth bug",
      description: "Users cannot log in.",
    });

    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId("pr-title-input")).toHaveValue("Fix auth bug"),
    );
    expect(screen.getByTestId("pr-body-input")).toHaveValue("Users cannot log in.");
    expect(screen.getByTestId("pr-base-input")).toHaveValue("main");
  });

  it("renders head branch as read-only from workspace.branchName", async () => {
    mockGetIssue.mockResolvedValue({
      id: "issue-1",
      title: "Title",
      description: "",
    });

    renderDialog();

    const head = await screen.findByTestId("pr-head-readonly");
    expect(head).toHaveTextContent("feature/x");
  });

  it("draft checkbox toggles", async () => {
    mockGetIssue.mockResolvedValue({ id: "issue-1", title: "T", description: "" });

    const user = userEvent.setup();
    renderDialog();

    const checkbox = await screen.findByTestId("pr-draft-checkbox");
    expect(checkbox).toHaveAttribute("data-state", "unchecked");
    await user.click(checkbox);
    expect(checkbox).toHaveAttribute("data-state", "checked");
  });

  it("submit calls createPR with correct payload, shows toast, closes dialog on success", async () => {
    mockGetIssue.mockResolvedValue({
      id: "issue-1",
      title: "T",
      description: "B",
    });
    mockCreatePR.mockResolvedValue({
      url: "https://github.com/acme/repo/pull/42",
      number: 42,
      state: "open",
      draft: false,
    });
    const onCreated = vi.fn();

    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({ onCreated });

    await waitFor(() =>
      expect(screen.getByTestId("pr-title-input")).toHaveValue("T"),
    );
    await user.click(screen.getByTestId("pr-submit"));

    await waitFor(() => {
      expect(mockCreatePR).toHaveBeenCalledWith("issue-1", {
        workspaceId: "ws-1",
        title: "T",
        body: "B",
        base: "main",
        draft: false,
      });
    });
    await waitFor(() => {
      expect(mockPushToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining("#42"),
          tone: "success",
        }),
      );
    });
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ number: 42 }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders 'GitHub not connected' banner + Settings link on 412 error", async () => {
    mockGetIssue.mockResolvedValue({ id: "issue-1", title: "T", description: "" });
    mockCreatePR.mockRejectedValue(
      new ApiError("GitHub PAT not configured", 412, {
        error: "GitHub PAT not configured",
        hint: "Go to Settings → Integrations",
      }),
    );

    const user = userEvent.setup();
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId("pr-title-input")).toHaveValue("T"),
    );
    await user.click(screen.getByTestId("pr-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("pr-error-412")).toBeInTheDocument(),
    );
    expect(screen.getByText(/GitHub not connected/i)).toBeInTheDocument();
    const link = screen.getByRole("link", {
      name: /open settings → integrations/i,
    });
    expect(link).toHaveAttribute("href", "/settings?tab=integrations");
  });

  it("renders scope hint banner on 403 error", async () => {
    mockGetIssue.mockResolvedValue({ id: "issue-1", title: "T", description: "" });
    mockCreatePR.mockRejectedValue(
      new ApiError("PAT lacks required permissions", 403, {
        error: "PAT lacks required permissions",
        hint: "Reconnect with pull_requests:write scope",
      }),
    );

    const user = userEvent.setup();
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId("pr-title-input")).toHaveValue("T"),
    );
    await user.click(screen.getByTestId("pr-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("pr-error-scope")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/reconnect with pull_requests:write scope/i),
    ).toBeInTheDocument();
  });

  it("does NOT render DialogContent when open=false (conditional mount)", () => {
    mockGetIssue.mockResolvedValue({ id: "issue-1", title: "T", description: "" });
    renderDialog({ open: false });
    expect(screen.queryByTestId("create-pr-dialog")).not.toBeInTheDocument();
  });

  it("shows 'PR already created' banner + link when workspace.metadata.pr exists, hides form", async () => {
    mockGetIssue.mockResolvedValue({ id: "issue-1", title: "T", description: "" });
    const workspaceWithPr = makeWorkspace({
      metadata: {
        pr: {
          url: "https://github.com/acme/repo/pull/42",
          number: 42,
          state: "open",
        },
      },
    });

    renderDialog({ workspace: workspaceWithPr });

    const banner = await screen.findByTestId("pr-already-exists");
    expect(banner).toBeInTheDocument();
    const link = screen.getByTestId("pr-already-exists-link");
    expect(link).toHaveAttribute("href", "https://github.com/acme/repo/pull/42");
    expect(link).toHaveTextContent(/View PR #42/i);
    // Form is not rendered
    expect(screen.queryByTestId("pr-title-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pr-submit")).not.toBeInTheDocument();
  });

  it("shows the create form (no banner) when workspace has no existing PR", async () => {
    mockGetIssue.mockResolvedValue({ id: "issue-1", title: "T", description: "" });

    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId("pr-title-input")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("pr-already-exists")).not.toBeInTheDocument();
  });

  it("invalidates both executionWorkspaces.detail and .list query keys on PR create success", async () => {
    mockGetIssue.mockResolvedValue({ id: "issue-1", title: "T", description: "B" });
    mockCreatePR.mockResolvedValue({
      url: "https://github.com/acme/repo/pull/42",
      number: 42,
      state: "open",
      draft: false,
    });

    const user = userEvent.setup();
    const { queryClient } = renderDialog();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await waitFor(() =>
      expect(screen.getByTestId("pr-title-input")).toHaveValue("T"),
    );
    await user.click(screen.getByTestId("pr-submit"));

    await waitFor(() => expect(mockCreatePR).toHaveBeenCalled());

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => (call[0] as { queryKey: readonly unknown[] }).queryKey,
    );
    // Workspace detail (existing behavior)
    expect(invalidatedKeys).toContainEqual(["executionWorkspaces", "detail", "ws-1"]);
    // Workspace list for the company (new in Task 15 — prevents stale /workspaces page)
    expect(invalidatedKeys).toContainEqual(["executionWorkspaces", "co-1"]);
  });
});
