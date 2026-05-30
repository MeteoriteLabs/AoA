import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../__tests__/test-utils";

// Mock @/lib/router so the company-prefix-aware Link doesn't pull in
// CompanyProvider (we render outside a real CompanyContext here).
vi.mock("@/lib/router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

import { TasksTab } from "../TasksTab";

const mockIssuesList = vi.fn();
const mockIssuesUpdate = vi.fn();

vi.mock("../../../api/issues", () => ({
  issuesApi: {
    list: (...args: any[]) => mockIssuesList(...args),
    update: (...args: any[]) => mockIssuesUpdate(...args),
  },
}));

// KanbanBoard pulls in dnd-kit which is heavy in jsdom; stub it down to the
// surface this test cares about: each card shows the issue title, so we can
// assert grouping/filtering without exercising drag-and-drop.
vi.mock("../../KanbanBoard", () => ({
  KanbanBoard: ({ issues }: { issues: any[] }) => (
    <div data-testid="kanban-stub">
      {issues.map((i) => (
        <div key={i.id} data-testid={`kb-card-${i.id}`}>
          {i.title}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select
      data-testid="agent-filter-select"
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));

function makeIssue(overrides: Record<string, any> = {}) {
  return {
    id: "i-1",
    companyId: "comp-1",
    projectId: null,
    goalId: null,
    parentId: null,
    title: "Task title",
    description: null,
    status: "todo" as const,
    priority: "medium" as const,
    workMode: "standard" as const,
    assigneeAgentId: null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    executionWorkspaceId: null,
    executionEnvironmentId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: 1,
    identifier: "TC-1",
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    source: null,
    sourceDiscussionId: "thread-A",
    sourceThreadTitle: "Plan landing page redesign",
    reviewerUserId: null,
    dueDate: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    artifactId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("TasksTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading then groups tasks by source thread", async () => {
    mockIssuesList.mockResolvedValue([
      makeIssue({ id: "i-1", title: "Hero copy" }),
      makeIssue({ id: "i-2", title: "Pricing card" }),
      makeIssue({
        id: "i-3",
        title: "Backend API stub",
        sourceDiscussionId: "thread-B",
        sourceThreadTitle: "Design system upgrade",
      }),
    ]);

    renderWithProviders(<TasksTab companyId="comp-1" />);

    await waitFor(() =>
      expect(screen.getByTestId("crew-board")).toBeInTheDocument(),
    );

    // The query was issued with the crewBoard filter so the server knows to JOIN.
    expect(mockIssuesList).toHaveBeenCalledWith("comp-1", {
      crewBoard: true,
    });

    // Both group headings render.
    expect(screen.getByText("Plan landing page redesign")).toBeInTheDocument();
    expect(screen.getByText("Design system upgrade")).toBeInTheDocument();

    // Each group renders its own KanbanBoard with the right cards.
    expect(screen.getByTestId("kb-card-i-1")).toBeInTheDocument();
    expect(screen.getByTestId("kb-card-i-2")).toBeInTheDocument();
    expect(screen.getByTestId("kb-card-i-3")).toBeInTheDocument();

    // Group containers are present (one per source thread).
    expect(screen.getByTestId("crew-board-group-thread-A")).toBeInTheDocument();
    expect(screen.getByTestId("crew-board-group-thread-B")).toBeInTheDocument();
  });

  it("renders the empty state when no tasks come back from the server", async () => {
    mockIssuesList.mockResolvedValue([]);

    renderWithProviders(<TasksTab companyId="comp-1" />);

    await waitFor(() =>
      expect(screen.getByTestId("crew-board-empty")).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/No tasks yet. Crew-created tasks will appear here\./),
    ).toBeInTheDocument();
  });

  it("filters out tasks missing sourceDiscussionId defensively", async () => {
    mockIssuesList.mockResolvedValue([
      makeIssue({ id: "i-1", title: "Real task" }),
      // Defensive case: server should never return this when the filter is on,
      // but the component should not crash or create an "(unknown thread)"
      // group either.
      makeIssue({ id: "i-stray", title: "Stray", sourceDiscussionId: null }),
    ]);

    renderWithProviders(<TasksTab companyId="comp-1" />);

    await waitFor(() =>
      expect(screen.getByTestId("kb-card-i-1")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("kb-card-i-stray")).not.toBeInTheDocument();
  });

  it("narrows to a single crew agent via the dropdown", async () => {
    const user = userEvent.setup();
    mockIssuesList.mockResolvedValue([
      makeIssue({ id: "i-1", title: "Task by A", assigneeAgentId: "agent-1" }),
      makeIssue({ id: "i-2", title: "Task by B", assigneeAgentId: "agent-2" }),
    ]);

    renderWithProviders(
      <TasksTab
        companyId="comp-1"
        crewAgents={[
          { id: "agent-1", name: "Adjutant" },
          { id: "agent-2", name: "Planner" },
        ]}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("kb-card-i-1")).toBeInTheDocument(),
    );

    // Both visible by default.
    expect(screen.getByTestId("kb-card-i-1")).toBeInTheDocument();
    expect(screen.getByTestId("kb-card-i-2")).toBeInTheDocument();

    // Pick Adjutant from the dropdown.
    await user.selectOptions(
      screen.getByTestId("agent-filter-select"),
      "agent-1",
    );

    expect(screen.getByTestId("kb-card-i-1")).toBeInTheDocument();
    expect(screen.queryByTestId("kb-card-i-2")).not.toBeInTheDocument();
  });

  it("triggers a server re-query with assigneeAgentId when an agent is selected", async () => {
    const user = userEvent.setup();

    // Initial load: both agents' tasks returned (no agent filter).
    mockIssuesList.mockResolvedValueOnce([
      makeIssue({
        id: "i-1",
        title: "Task by A",
        assigneeAgentId: "agent-1",
        sourceDiscussionId: "thread-A",
        sourceThreadTitle: "Thread A",
      }),
      makeIssue({
        id: "i-2",
        title: "Task by B",
        assigneeAgentId: "agent-2",
        sourceDiscussionId: "thread-A",
        sourceThreadTitle: "Thread A",
      }),
    ]);

    // Second query (after filter): only agent-1's task.
    mockIssuesList.mockResolvedValueOnce([
      makeIssue({
        id: "i-1",
        title: "Task by A",
        assigneeAgentId: "agent-1",
        sourceDiscussionId: "thread-A",
        sourceThreadTitle: "Thread A",
      }),
    ]);

    renderWithProviders(
      <TasksTab
        companyId="comp-1"
        crewAgents={[
          { id: "agent-1", name: "Adjutant" },
          { id: "agent-2", name: "Planner" },
        ]}
      />,
    );

    // Wait for initial board to render.
    await waitFor(() =>
      expect(screen.getByTestId("crew-board")).toBeInTheDocument(),
    );

    // First call: no assigneeAgentId.
    expect(mockIssuesList).toHaveBeenCalledWith("comp-1", {
      crewBoard: true,
    });

    // Select agent-1.
    await user.selectOptions(
      screen.getByTestId("agent-filter-select"),
      "agent-1",
    );

    // The component should issue a second API call that includes assigneeAgentId.
    await waitFor(() =>
      expect(mockIssuesList).toHaveBeenCalledWith("comp-1", {
        crewBoard: true,
        assigneeAgentId: "agent-1",
      }),
    );

    // After the re-query only agent-1's task is visible.
    expect(screen.getByTestId("kb-card-i-1")).toBeInTheDocument();
    expect(screen.queryByTestId("kb-card-i-2")).not.toBeInTheDocument();
  });
});
