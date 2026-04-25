// NOTE: under heavy parallel-suite CPU contention these ProjectDetail* test
// files occasionally flake at synchronous `expect(screen.getByText(...))`
// assertions placed after a single `waitFor`. The project query resolves
// before the executionWorkspaces query, so the tab shell renders but the
// row content is still loading when the sync assertion fires. Prefer
// `await screen.findByText(...)` for every row-level assertion here so
// the retry loop handles that gap. Each suite (Board, Discussions,
// Workspaces) needs the same treatment as rows are added.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

// These tests render a multi-query page; give enough headroom for slow CI runs.
vi.setConfig({ testTimeout: 15000 });
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  mockCompanyContext,
  mockBreadcrumbContext,
  mockDialogContext,
} from "./test-utils";
import { ProjectDetail } from "../pages/ProjectDetail";

// --- Mock data ---

const mockProject = {
  id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  name: "Engineering",
  type: "department",
  status: "active",
  color: "#6366f1",
  description: "Engineering department",
  targetDate: null,
  companyId: "comp-1",
  issuePrefix: "TC",
  simpleId: "ENG",
};

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    companyId: "comp-1",
    projectId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    projectWorkspaceId: null,
    sourceIssueId: "issue-99",
    mode: "isolated_workspace",
    strategyType: "git_worktree",
    name: "ENG-99-fix-auth",
    status: "active",
    cwd: "/tmp/workspaces/ENG-99",
    repoUrl: null,
    baseRef: "main",
    branchName: "ENG-99-fix-auth",
    providerType: "git_worktree",
    providerRef: null,
    derivedFromExecutionWorkspaceId: null,
    lastUsedAt: new Date("2026-04-01T10:00:00Z"),
    openedAt: new Date("2026-04-01T09:00:00Z"),
    closedAt: null,
    cleanupEligibleAt: null,
    cleanupReason: null,
    metadata: null,
    createdAt: new Date("2026-04-01T09:00:00Z"),
    updatedAt: new Date("2026-04-01T10:00:00Z"),
    ...overrides,
  };
}

const mockWorkspaces = [
  makeWorkspace(),
  makeWorkspace({
    id: "ws-2",
    name: "ENG-100-new-feature",
    branchName: "ENG-100-new-feature",
    sourceIssueId: "issue-100",
    status: "idle",
    mode: "shared_workspace",
    lastUsedAt: new Date("2026-03-30T15:00:00Z"),
  }),
];

// --- Mocks ---

const executionWorkspacesApiMock = {
  list: vi.fn().mockResolvedValue(mockWorkspaces),
  update: vi.fn().mockResolvedValue({}),
  getCloseReadiness: vi.fn().mockResolvedValue({
    workspaceId: "ws-1",
    state: "ready",
    blockingReasons: [],
    warnings: [],
    linkedIssues: [],
    plannedActions: [
      {
        kind: "archive_record",
        label: "Archive workspace record",
        description: "Keep the execution workspace history.",
        command: null,
      },
    ],
    isDestructiveCloseAllowed: true,
    isSharedWorkspace: false,
    isProjectPrimaryWorkspace: false,
    git: null,
    runtimeServices: [],
  }),
};

const projectsApiMock = {
  get: vi.fn().mockResolvedValue(mockProject),
  update: vi.fn().mockResolvedValue(mockProject),
  listAgents: vi.fn().mockResolvedValue([]),
  list: vi.fn().mockResolvedValue([mockProject]),
  budget: vi.fn().mockResolvedValue({ agents: [], totalSpendCents: 0 }),
  assignAgent: vi.fn(),
  unassignAgent: vi.fn(),
};

vi.mock("../components/TaskSlideOver", () => ({
  TaskSlideOver: () => null,
}));

vi.mock("../api/execution-workspaces", () => ({
  executionWorkspacesApi: new Proxy(
    {},
    { get: (_t, prop) => (executionWorkspacesApiMock as any)[prop] },
  ),
}));

vi.mock("../api/projects", () => ({
  projectsApi: new Proxy(
    {},
    { get: (_t, prop) => (projectsApiMock as any)[prop] },
  ),
}));

vi.mock("../api/issues", () => ({
  issuesApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/goals", () => ({
  goalsApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/agents", () => ({
  agentsApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: { liveRunsForCompany: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/assets", () => ({
  assetsApi: { uploadImage: vi.fn() },
}));

vi.mock("../api/discussions", () => ({
  discussionsApi: {
    list: vi.fn().mockResolvedValue({ discussions: [], total: 0, limit: 20, offset: 0 }),
  },
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    ...mockCompanyContext,
    selectedCompanyId: "comp-1",
    companies: [{ id: "comp-1", issuePrefix: "TC" }],
  }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => mockBreadcrumbContext,
}));

vi.mock("../context/DialogContext", () => ({
  useDialog: () => mockDialogContext,
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn(), toasts: [], dismissToast: vi.fn(), clearToasts: vi.fn() }),
}));

vi.mock("../lib/utils", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    projectRouteRef: (p: any) => p.simpleId ?? p.id,
  };
});

function renderProjectDetail(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="projects/:projectId/workspaces" element={<ProjectDetail />} />
          <Route path="projects/:projectId/discussions" element={<ProjectDetail />} />
          <Route path="projects/:projectId/issues" element={<ProjectDetail />} />
          <Route path="projects/:projectId/issues/:filter" element={<ProjectDetail />} />
          <Route path="projects/:projectId/overview" element={<ProjectDetail />} />
          <Route path="projects/:projectId/goals" element={<ProjectDetail />} />
          <Route path="projects/:projectId/team" element={<ProjectDetail />} />
          <Route path="projects/:projectId/budget" element={<ProjectDetail />} />
          <Route path="projects/:projectId" element={<ProjectDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  projectsApiMock.get.mockResolvedValue(mockProject);
  executionWorkspacesApiMock.list.mockResolvedValue(mockWorkspaces);
  // Archive now uses a Dialog instead of window.confirm
});

afterEach(() => {
  cleanup();
});

// --- Tests ---

describe("ProjectDetail — Workspaces tab", () => {
  it("renders a Workspaces tab button alongside other tabs", async () => {
    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await screen.findByText("ENG-99-fix-auth", {}, { timeout: 5000 });

    await screen.findByText("Overview");
    await screen.findByText("Board");
    await screen.findByText("Goals");
    await screen.findByText("Team");
    await screen.findByText("Budget");
    await screen.findByText("Discussions");
    await screen.findByText("Workspaces");
  });

  it("shows workspace list when workspaces tab is active", async () => {
    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await screen.findByText("ENG-99-fix-auth", {}, { timeout: 5000 });
    await screen.findByText("ENG-100-new-feature");
  });

  it("fetches workspaces filtered by project ID", async () => {
    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await waitFor(() => {
      expect(executionWorkspacesApiMock.list).toHaveBeenCalledWith(
        "comp-1",
        expect.objectContaining({ projectId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d" }),
      );
    }, { timeout: 5000 });
  });

  it("shows status badges for workspaces", async () => {
    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await screen.findByText("ENG-99-fix-auth", {}, { timeout: 5000 });
    await screen.findByText("active");
    await screen.findByText("idle");
  });

  it("shows mode badges for workspaces", async () => {
    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await screen.findByText("ENG-99-fix-auth", {}, { timeout: 5000 });
    await screen.findByText("Isolated");
    await screen.findByText("Shared");
  });

  it("shows empty state when no workspaces for this project", async () => {
    executionWorkspacesApiMock.list.mockResolvedValue([]);

    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await screen.findByText(/No workspaces yet/, {}, { timeout: 5000 });
  });

  it("shows Workspaces tab for departments without explicit policy", async () => {
    projectsApiMock.get.mockResolvedValue({ ...mockProject, executionWorkspacePolicy: null });
    executionWorkspacesApiMock.list.mockResolvedValue([]);

    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await screen.findByText(/No workspaces yet/, {}, { timeout: 5000 });
    await screen.findByText("Workspaces");
  });

  it("workspace row navigates to workspace view on click", async () => {
    function LocationDisplay() {
      const location = useLocation();
      return <div data-testid="location">{location.pathname}</div>;
    }

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces"]}>
          <Routes>
            <Route path="projects/:projectId/workspaces" element={<ProjectDetail />} />
            <Route path=":companyPrefix/workspaces/:workspaceId" element={<div data-testid="workspace-page" />} />
          </Routes>
          <LocationDisplay />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByText("ENG-99-fix-auth", {}, { timeout: 5000 });

    fireEvent.click(screen.getByTestId("workspace-row-ws-1"));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/TC/workspaces/ws-1");
    });
  });

  it("shows Archive button on active workspace rows", async () => {
    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await screen.findByText("ENG-99-fix-auth", {}, { timeout: 5000 });
    await screen.findByTestId("archive-workspace-ws-1");
    await screen.findByTestId("archive-workspace-ws-2");
  });

  it("calls update with archived status when Archive is confirmed via dialog", async () => {
    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    fireEvent.click(await screen.findByTestId("archive-workspace-ws-1", {}, { timeout: 5000 }));

    // Readiness loads via getCloseReadiness mock; wait for the action button
    // to be enabled before confirming. The AlertDialog action starts disabled
    // while readiness is loading.
    const confirmButton = await screen.findByTestId("confirm-archive-workspace");
    await waitFor(() => {
      expect(confirmButton).not.toBeDisabled();
    });

    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(executionWorkspacesApiMock.update).toHaveBeenCalledWith("ws-1", { status: "archived" });
    });
  });

  it("shows archived workspaces in a collapsed section", async () => {
    executionWorkspacesApiMock.list.mockResolvedValue([
      makeWorkspace({ id: "ws-active", status: "active" }),
      makeWorkspace({ id: "ws-archived-1", status: "archived", name: "old-branch", branchName: "old-branch" }),
      makeWorkspace({ id: "ws-archived-2", status: "archived", name: "older-branch", branchName: "older-branch" }),
    ]);

    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    // Wait for both the trigger AND its count label to render — under
    // parallel-suite CPU contention, React sometimes flushes the tab
    // shell before the executionWorkspaces query resolves. Use a generous
    // timeout to handle slow CI / parallel-suite runs.
    await screen.findByText("Archived (2)", {}, { timeout: 5000 });

    // Archived workspaces are NOT visible by default (collapsed)
    expect(screen.queryByTestId("archived-workspaces-list")).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByTestId("archived-workspaces-trigger"));

    expect(await screen.findByTestId("archived-workspaces-list")).toBeInTheDocument();
  });

  it("shows loading skeletons while fetching workspaces", async () => {
    executionWorkspacesApiMock.list.mockReturnValue(new Promise(() => {}));

    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    // Wait for project to load first (tab bar appears), then workspace loading shows
    await waitFor(() => {
      expect(screen.getByText("Workspaces")).toBeInTheDocument();
    }, { timeout: 5000 });

    await waitFor(() => {
      expect(screen.getByTestId("workspaces-loading")).toBeInTheDocument();
    }, { timeout: 5000 });

    const skeletons = screen.getByTestId("workspaces-loading").querySelectorAll("[data-slot='skeleton']");
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });
});
