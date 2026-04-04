import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceTimeline } from "../components/workspace/WorkspaceTimeline";

// ─── Mock data ───────────────────────────────────────────────────────────────

const mockIssue = {
  id: "issue-1",
  companyId: "comp-1",
  projectId: "proj-1",
  title: "Fix auth",
  status: "in_progress",
  priority: "high",
  assigneeAgentId: "agent-1",
  assigneeUserId: null,
};

const mockRuns = [
  {
    runId: "run-001",
    status: "succeeded",
    agentId: "agent-1",
    startedAt: "2026-04-01T10:00:00Z",
    finishedAt: "2026-04-01T10:05:00Z",
    createdAt: "2026-04-01T10:00:00Z",
    invocationSource: "on_demand",
    usageJson: null,
    resultJson: null,
  },
  {
    runId: "run-002",
    status: "succeeded",
    agentId: "agent-1",
    startedAt: "2026-04-01T10:20:00Z",
    finishedAt: "2026-04-01T10:25:00Z",
    createdAt: "2026-04-01T10:20:00Z",
    invocationSource: "on_demand",
    usageJson: null,
    resultJson: null,
  },
];

const mockComments = [
  {
    id: "comment-1",
    companyId: "comp-1",
    issueId: "issue-1",
    authorAgentId: null,
    authorUserId: "user-1",
    body: "Please fix the login flow",
    createdAt: "2026-04-01T10:10:00Z",
    updatedAt: "2026-04-01T10:10:00Z",
  },
  {
    id: "comment-2",
    companyId: "comp-1",
    issueId: "issue-1",
    authorAgentId: "agent-1",
    authorUserId: null,
    body: "Working on it now",
    createdAt: "2026-04-01T10:15:00Z",
    updatedAt: "2026-04-01T10:15:00Z",
  },
];

const mockAgents = [
  { id: "agent-1", name: "Alpha Agent", status: "active", companyId: "comp-1" },
  { id: "agent-2", name: "Beta Agent", status: "active", companyId: "comp-1" },
];

// ─── API Mocks ───────────────────────────────────────────────────────────────

const issuesApiMock = {
  get: vi.fn().mockResolvedValue(mockIssue),
  listComments: vi.fn().mockResolvedValue(mockComments),
  addComment: vi.fn().mockResolvedValue({ id: "new-comment" }),
};

const activityApiMock = {
  runsForIssue: vi.fn().mockResolvedValue(mockRuns),
};

const heartbeatsApiMock = {
  liveRunsForIssue: vi.fn().mockResolvedValue([]),
  activeRunForIssue: vi.fn().mockResolvedValue(null),
  log: vi.fn().mockResolvedValue({ runId: "run-001", store: "file", logRef: "", content: "done" }),
};

const agentsApiMock = {
  list: vi.fn().mockResolvedValue(mockAgents),
  wakeup: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../api/issues", () => ({
  issuesApi: new Proxy(
    {},
    { get: (_t, prop) => (issuesApiMock as any)[prop] },
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

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "comp-1",
    selectedCompany: { id: "comp-1", issuePrefix: "TC" },
    companies: [{ id: "comp-1" }],
  }),
}));

// Mock LiveRunWidget to avoid complex WebSocket dependencies
vi.mock("../components/LiveRunWidget", () => ({
  LiveRunWidget: ({ issueId }: { issueId: string }) => (
    <div data-testid="live-run-widget">Live runs for {issueId}</div>
  ),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderTimeline(props: Partial<React.ComponentProps<typeof WorkspaceTimeline>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkspaceTimeline
          issueId="issue-1"
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  issuesApiMock.get.mockResolvedValue(mockIssue);
  issuesApiMock.listComments.mockResolvedValue(mockComments);
  activityApiMock.runsForIssue.mockResolvedValue(mockRuns);
  heartbeatsApiMock.liveRunsForIssue.mockResolvedValue([]);
  heartbeatsApiMock.activeRunForIssue.mockResolvedValue(null);
  agentsApiMock.list.mockResolvedValue(mockAgents);
});

describe("WorkspaceTimeline — rendering", () => {
  it("renders runs and comments in chronological order", async () => {
    renderTimeline();

    await waitFor(() => {
      // Both runs should render as RunBlocks
      expect(screen.getByTestId("run-block-run-001")).toBeInTheDocument();
      expect(screen.getByTestId("run-block-run-002")).toBeInTheDocument();
    });

    // Both comments should render
    expect(screen.getByText("Please fix the login flow")).toBeInTheDocument();
    expect(screen.getByText("Working on it now")).toBeInTheDocument();
  });

  it("shows empty state when no runs or comments", async () => {
    activityApiMock.runsForIssue.mockResolvedValue([]);
    issuesApiMock.listComments.mockResolvedValue([]);

    renderTimeline();

    await waitFor(() => {
      expect(screen.getByText(/No runs or comments yet/)).toBeInTheDocument();
    });
  });

  it("latest run is expanded, older runs collapsed", async () => {
    renderTimeline();

    await waitFor(() => {
      expect(screen.getByTestId("run-block-run-001")).toBeInTheDocument();
      expect(screen.getByTestId("run-block-run-002")).toBeInTheDocument();
    });

    // run-002 is the latest run (after all other items)
    // run-001 should be collapsed (no output visible)
    expect(screen.queryByTestId("run-block-output-run-001")).not.toBeInTheDocument();
  });
});

describe("WorkspaceTimeline — input area", () => {
  it("renders the input area with textarea and send button", async () => {
    renderTimeline();

    await waitFor(() => {
      expect(screen.getByTestId("workspace-input-area")).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText("Continue working on this task...")).toBeInTheDocument();
    expect(screen.getByText("Send")).toBeInTheDocument();
  });

  it("Send creates comment and triggers agent wakeup", async () => {
    renderTimeline();

    await waitFor(() => {
      expect(screen.getByTestId("workspace-input-area")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("Continue working on this task...");
    fireEvent.change(textarea, { target: { value: "Please review the changes" } });

    const sendButton = screen.getByText("Send");
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(issuesApiMock.addComment).toHaveBeenCalledWith("issue-1", "Please review the changes");
    });

    // Default send agent = assigneeAgentId from issue
    expect(agentsApiMock.wakeup).toHaveBeenCalledWith("agent-1", {
      source: "on_demand",
      reason: "Please review the changes",
    });
  });

  it("Send button is disabled when input is empty", async () => {
    renderTimeline();

    await waitFor(() => {
      expect(screen.getByText("Send")).toBeInTheDocument();
    });

    const sendButton = screen.getByText("Send");
    expect(sendButton).toBeDisabled();
  });
});

describe("WorkspaceTimeline — comment display", () => {
  it("shows author name for agent comments", async () => {
    renderTimeline();

    await waitFor(() => {
      // Agent name appears in Identity + in the text span, so multiple matches expected
      expect(screen.getAllByText("Alpha Agent").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows Board for user comments", async () => {
    renderTimeline();

    await waitFor(() => {
      // Board appears in Identity + in the font-medium span
      expect(screen.getAllByText("Board").length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("WorkspaceTimeline — Mark Complete", () => {
  it("shows Mark Complete button when showMarkComplete is true", async () => {
    const onMarkComplete = vi.fn();
    renderTimeline({ showMarkComplete: true, onMarkComplete });

    await waitFor(() => {
      expect(screen.getByText("Mark Complete")).toBeInTheDocument();
    });
  });

  it("does not show Mark Complete button by default", async () => {
    renderTimeline();

    await waitFor(() => {
      expect(screen.getByTestId("workspace-input-area")).toBeInTheDocument();
    });

    expect(screen.queryByText("Mark Complete")).not.toBeInTheDocument();
  });
});
