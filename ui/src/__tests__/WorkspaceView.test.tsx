import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, Outlet, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect as reactUseEffect } from "react";
import {
  mockCompanyContext,
  mockBreadcrumbContext,
} from "./test-utils";
import { WorkspaceView } from "../pages/WorkspaceView";
import { useSidebar } from "../context/SidebarContext";

// ─── Mock data ────────────────────────────────────────────────────────────────

const mockWorkspace = {
  id: "ws-abc",
  companyId: "comp-1",
  projectId: "proj-1",
  projectWorkspaceId: null,
  sourceIssueId: "issue-1",
  mode: "isolated_workspace",
  strategyType: "git_worktree",
  name: "ENG-42-fix-auth",
  status: "active",
  cwd: "/tmp/workspaces/ENG-42",
  repoUrl: null,
  baseRef: "main",
  branchName: "ENG-42-fix-auth",
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
};

const mockProject = {
  id: "proj-1",
  name: "Engineering",
  type: "department",
  status: "active",
  color: "#6366f1",
  description: "Engineering department",
  companyId: "comp-1",
  simpleId: "ENG",
  issuePrefix: "TC",
};

const mockIssue = {
  id: "issue-1",
  companyId: "comp-1",
  projectId: "proj-1",
  goalId: null,
  parentId: null,
  title: "Fix auth bug",
  description: null,
  status: "in_progress",
  priority: "high",
  assigneeAgentId: null,
  assigneeUserId: null,
  checkoutRunId: null,
  executionRunId: null,
  executionAgentNameKey: null,
  executionLockedAt: null,
  executionWorkspaceId: "ws-abc",
  executionWorkspacePreference: null,
  executionWorkspaceSettings: null,
  createdByAgentId: null,
  createdByUserId: null,
  issueNumber: 42,
  identifier: "ENG-42",
  requestDepth: 0,
  billingCode: null,
  assigneeAdapterOverrides: null,
  source: null,
  reviewerUserId: null,
  dueDate: null,
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  hiddenAt: null,
  artifactId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockIssues = [
  mockIssue,
  {
    ...mockIssue,
    id: "issue-2",
    title: "Add new feature",
    identifier: "ENG-43",
    status: "todo",
    executionWorkspaceId: "ws-def",
  },
  {
    ...mockIssue,
    id: "issue-3",
    title: "No workspace task",
    identifier: "ENG-44",
    status: "backlog",
    executionWorkspaceId: null,
  },
  {
    ...mockIssue,
    id: "issue-4",
    title: "Done task with workspace",
    identifier: "ENG-45",
    status: "done",
    executionWorkspaceId: "ws-ghi",
  },
];

// ─── API Mocks ────────────────────────────────────────────────────────────────

const executionWorkspacesApiMock = {
  get: vi.fn().mockResolvedValue(mockWorkspace),
  list: vi.fn().mockResolvedValue([mockWorkspace]),
};

const issuesApiMock = {
  get: vi.fn().mockResolvedValue(mockIssue),
  list: vi.fn().mockResolvedValue(mockIssues),
  listComments: vi.fn().mockResolvedValue([]),
  addComment: vi.fn().mockResolvedValue({ id: "c-1" }),
};

const projectsApiMock = {
  get: vi.fn().mockResolvedValue(mockProject),
};

const dependenciesApiMock = {
  list: vi.fn().mockResolvedValue({ upstream: [], downstream: [] }),
};

const activityApiMock = {
  runsForIssue: vi.fn().mockResolvedValue([]),
};

const heartbeatsApiMock = {
  liveRunsForIssue: vi.fn().mockResolvedValue([]),
  activeRunForIssue: vi.fn().mockResolvedValue(null),
  log: vi.fn().mockResolvedValue({ runId: "", store: "file", logRef: "", content: "" }),
};

const agentsApiMock = {
  list: vi.fn().mockResolvedValue([]),
  wakeup: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../api/dependencies", () => ({
  dependenciesApi: new Proxy(
    {},
    { get: (_t, prop) => (dependenciesApiMock as any)[prop] },
  ),
}));

vi.mock("../api/activity", () => ({
  activityApi: new Proxy(
    {},
    { get: (_t, prop) => (activityApiMock as any)[prop] },
  ),
}));

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: new Proxy(
    {},
    { get: (_t, prop) => (heartbeatsApiMock as any)[prop] },
  ),
}));

vi.mock("../api/agents", () => ({
  agentsApi: new Proxy(
    {},
    { get: (_t, prop) => (agentsApiMock as any)[prop] },
  ),
}));

// Mock LiveRunWidget to avoid WebSocket dependencies
vi.mock("../components/LiveRunWidget", () => ({
  LiveRunWidget: ({ issueId }: { issueId: string }) => (
    <div data-testid="live-run-widget">Live runs for {issueId}</div>
  ),
}));

vi.mock("../api/execution-workspaces", () => ({
  executionWorkspacesApi: new Proxy(
    {},
    { get: (_t, prop) => (executionWorkspacesApiMock as any)[prop] },
  ),
}));

vi.mock("../api/issues", () => ({
  issuesApi: new Proxy(
    {},
    { get: (_t, prop) => (issuesApiMock as any)[prop] },
  ),
}));

vi.mock("../api/projects", () => ({
  projectsApi: new Proxy(
    {},
    { get: (_t, prop) => (projectsApiMock as any)[prop] },
  ),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    ...mockCompanyContext,
    selectedCompanyId: "comp-1",
    selectedCompany: { id: "comp-1", issuePrefix: "TC", name: "Test Corp" },
    companies: [{ id: "comp-1", issuePrefix: "TC" }],
  }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => mockBreadcrumbContext,
}));

// Mock react-resizable-panels with simple divs
vi.mock("react-resizable-panels", () => ({
  Group: ({ children, ...props }: any) => (
    <div data-testid={props["data-testid"] ?? "panel-group"} {...props}>
      {children}
    </div>
  ),
  Panel: ({ children, id, ...props }: any) => (
    <div data-testid={props["data-testid"] ?? `panel-${id}`} id={id} {...props}>
      {children}
    </div>
  ),
  Separator: ({ id, ...props }: any) => (
    <div
      data-testid={props["data-testid"] ?? `separator-${id}`}
      id={id}
      role="separator"
      {...props}
    />
  ),
  useDefaultLayout: () => ({
    defaultLayout: undefined,
    onLayoutChanged: vi.fn(),
    onLayoutChange: vi.fn(),
  }),
}));

// ─── Sidebar context mock ─────────────────────────────────────────────────────

const setCollapsedMock = vi.fn();

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => ({
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
    toggleSidebar: vi.fn(),
    isMobile: false,
    collapsed: false,
    setCollapsed: setCollapsedMock,
    toggleCollapse: vi.fn(),
  }),
}));

// ─── Layout stub with auto-collapse detection ─────────────────────────────────

function LayoutStub() {
  const location = useLocation();
  const { setCollapsed } = useSidebar();

  // Mirrors Layout.tsx behaviour
  reactUseEffect(() => {
    if (location.pathname.includes("/workspaces/")) {
      setCollapsed(true);
    }
  }, [location.pathname, setCollapsed]);

  return (
    <div data-testid="layout">
      <Outlet />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderWorkspaceView(workspaceId = "ws-abc") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/TC/workspaces/${workspaceId}`]}>
        <Routes>
          <Route path=":companyPrefix" element={<LayoutStub />}>
            <Route path="workspaces/:workspaceId" element={<WorkspaceView />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  executionWorkspacesApiMock.get.mockResolvedValue(mockWorkspace);
  issuesApiMock.get.mockResolvedValue(mockIssue);
  issuesApiMock.list.mockResolvedValue(mockIssues);
  projectsApiMock.get.mockResolvedValue(mockProject);
});

describe("WorkspaceView — route and page renders", () => {
  it("renders the workspace layout when data loads", async () => {
    renderWorkspaceView();

    await waitFor(() => {
      expect(screen.getByTestId("workspace-layout")).toBeInTheDocument();
    });
  });

  it("fetches workspace by ID from route param", async () => {
    renderWorkspaceView("ws-abc");

    await waitFor(() => {
      expect(executionWorkspacesApiMock.get).toHaveBeenCalledWith("ws-abc");
    });
  });
});

describe("WorkspaceView — sidebar auto-collapse", () => {
  it("calls setCollapsed(true) when on workspace route", async () => {
    renderWorkspaceView();

    await waitFor(() => {
      expect(setCollapsedMock).toHaveBeenCalledWith(true);
    });
  });
});

describe("WorkspaceView — three-panel layout", () => {
  it("renders three panels: left nav, center, and right context", async () => {
    renderWorkspaceView();

    await waitFor(() => {
      expect(screen.getByTestId("workspace-layout")).toBeInTheDocument();
    });

    expect(screen.getByTestId("workspace-left-panel")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-center-group")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-right-panel")).toBeInTheDocument();
  });

  it("renders a resizable handle between center panels", async () => {
    renderWorkspaceView();

    await waitFor(() => {
      expect(screen.getByTestId("workspace-resizable-handle")).toBeInTheDocument();
    });
  });

  it("renders timeline in center panel and placeholder for right panel", async () => {
    renderWorkspaceView();

    await waitFor(() => {
      expect(screen.getByTestId("workspace-timeline")).toBeInTheDocument();
    });

    expect(screen.getByText(/Context sections coming soon/)).toBeInTheDocument();
  });
});

describe("WorkspaceView — left panel task navigator", () => {
  it("renders the task navigator", async () => {
    renderWorkspaceView();

    await waitFor(() => {
      expect(screen.getByTestId("workspace-task-nav")).toBeInTheDocument();
    });
  });

  it("shows tasks grouped by status (only tasks with workspaces)", async () => {
    renderWorkspaceView();

    await waitFor(() => {
      // ENG-42 is in_progress (Running group)
      expect(screen.getByText("Fix auth bug")).toBeInTheDocument();
      // ENG-43 is todo (Idle group)
      expect(screen.getByText("Add new feature")).toBeInTheDocument();
    });

    // ENG-44 has no workspace → should NOT appear
    expect(screen.queryByText("No workspace task")).not.toBeInTheDocument();
  });

  it("shows group labels for non-empty groups", async () => {
    renderWorkspaceView();

    await waitFor(() => {
      expect(screen.getByText("Running")).toBeInTheDocument();
      expect(screen.getByText("Idle")).toBeInTheDocument();
    });
  });

  it("shows Completed group collapsed by default (with a done workspace task)", async () => {
    renderWorkspaceView();

    await waitFor(() => {
      // Completed group header should be present but tasks collapsed
      expect(screen.getByTestId("workspace-group-completed")).toBeInTheDocument();
    });

    // The done task's title should not be visible (group is collapsed)
    expect(screen.queryByText("Done task with workspace")).not.toBeInTheDocument();
  });

  it("highlights the selected task", async () => {
    renderWorkspaceView();

    await waitFor(() => {
      expect(screen.getByTestId(`workspace-task-row-issue-1`)).toBeInTheDocument();
    });

    const row = screen.getByTestId("workspace-task-row-issue-1");
    // The selected task (sourceIssueId = issue-1) should have accent styling
    expect(row.className).toMatch(/bg-accent/);
  });

  it("clicking a task updates selected task", async () => {
    renderWorkspaceView();

    await waitFor(() => {
      expect(screen.getByTestId("workspace-task-row-issue-2")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("workspace-task-row-issue-2"));

    await waitFor(() => {
      const row2 = screen.getByTestId("workspace-task-row-issue-2");
      expect(row2.className).toMatch(/bg-accent/);
    });
  });

  it("filters tasks by search input", async () => {
    renderWorkspaceView();

    await waitFor(() => {
      expect(screen.getByTestId("workspace-task-search")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("workspace-task-search"), {
      target: { value: "auth" },
    });

    await waitFor(() => {
      expect(screen.getByText("Fix auth bug")).toBeInTheDocument();
      expect(screen.queryByText("Add new feature")).not.toBeInTheDocument();
    });
  });
});
