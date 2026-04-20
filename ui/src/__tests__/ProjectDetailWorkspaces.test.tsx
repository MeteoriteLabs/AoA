import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
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

// --- Tests ---

describe("ProjectDetail — Workspaces tab", () => {
  it("renders a Workspaces tab button alongside other tabs", async () => {
    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await waitFor(() => {
      expect(screen.getByText("ENG-99-fix-auth")).toBeInTheDocument();
    });

    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Board")).toBeInTheDocument();
    expect(screen.getByText("Goals")).toBeInTheDocument();
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("Discussions")).toBeInTheDocument();
    expect(screen.getByText("Workspaces")).toBeInTheDocument();
  });

  it("shows workspace list when workspaces tab is active", async () => {
    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await waitFor(() => {
      expect(screen.getByText("ENG-99-fix-auth")).toBeInTheDocument();
    });

    expect(screen.getByText("ENG-100-new-feature")).toBeInTheDocument();
  });

  it("fetches workspaces filtered by project ID", async () => {
    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await waitFor(() => {
      expect(executionWorkspacesApiMock.list).toHaveBeenCalledWith(
        "comp-1",
        expect.objectContaining({ projectId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d" }),
      );
    });
  });

  it("shows status badges for workspaces", async () => {
    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await waitFor(() => {
      expect(screen.getByText("ENG-99-fix-auth")).toBeInTheDocument();
    });

    // Both status values should appear
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  it("shows mode badges for workspaces", async () => {
    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await waitFor(() => {
      expect(screen.getByText("ENG-99-fix-auth")).toBeInTheDocument();
    });

    expect(screen.getByText("Isolated")).toBeInTheDocument();
    expect(screen.getByText("Shared")).toBeInTheDocument();
  });

  it("shows empty state when no workspaces for this project", async () => {
    executionWorkspacesApiMock.list.mockResolvedValue([]);

    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await waitFor(() => {
      expect(
        screen.getByText(/No workspaces yet/),
      ).toBeInTheDocument();
    });
  });

  it("shows Workspaces tab for departments without explicit policy", async () => {
    projectsApiMock.get.mockResolvedValue({ ...mockProject, executionWorkspacePolicy: null });
    executionWorkspacesApiMock.list.mockResolvedValue([]);

    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await waitFor(() => {
      expect(screen.getByText(/No workspaces yet/)).toBeInTheDocument();
    });

    expect(screen.getByText("Workspaces")).toBeInTheDocument();
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

    await waitFor(() => {
      expect(screen.getByText("ENG-99-fix-auth")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("workspace-row-ws-1"));

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/TC/workspaces/ws-1");
    });
  });

  it("shows Archive button on active workspace rows", async () => {
    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await waitFor(() => {
      expect(screen.getByText("ENG-99-fix-auth")).toBeInTheDocument();
    });

    expect(screen.getByTestId("archive-workspace-ws-1")).toBeInTheDocument();
    expect(screen.getByTestId("archive-workspace-ws-2")).toBeInTheDocument();
  });

  it("calls update with archived status when Archive is confirmed via dialog", async () => {
    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    await waitFor(() => {
      expect(screen.getByText("ENG-99-fix-auth")).toBeInTheDocument();
    });

    // Clicking Archive opens confirmation dialog
    fireEvent.click(screen.getByTestId("archive-workspace-ws-1"));

    // Confirm via the dialog button
    await waitFor(() => {
      expect(screen.getByTestId("confirm-archive-workspace")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId("confirm-archive-workspace"));

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

    await waitFor(() => {
      expect(screen.getByTestId("archived-workspaces-trigger")).toBeInTheDocument();
    });

    // The trigger shows count
    expect(screen.getByText("Archived (2)")).toBeInTheDocument();

    // Archived workspaces are NOT visible by default (collapsed)
    expect(screen.queryByTestId("archived-workspaces-list")).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(screen.getByTestId("archived-workspaces-trigger"));

    await waitFor(() => {
      expect(screen.getByTestId("archived-workspaces-list")).toBeInTheDocument();
    });
  });

  it("shows loading skeletons while fetching workspaces", async () => {
    executionWorkspacesApiMock.list.mockReturnValue(new Promise(() => {}));

    renderProjectDetail("/projects/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/workspaces");

    // Wait for project to load first (tab bar appears), then workspace loading shows
    await waitFor(() => {
      expect(screen.getByText("Workspaces")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByTestId("workspaces-loading")).toBeInTheDocument();
    });

    const skeletons = screen.getByTestId("workspaces-loading").querySelectorAll("[data-slot='skeleton']");
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });
});
