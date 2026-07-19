import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockBreadcrumbContext, mockCompanyContext, mockDialogContext, makeCompany } from "./test-utils";
import { Dashboard } from "../pages/Dashboard";

const mockNavigate = vi.fn();
const {
  pushToast,
  mockHomeSummary,
  suggestionFixtures,
  suggestionsApiMock,
  memoryApiMock,
} = vi.hoisted(() => ({
  pushToast: vi.fn(),
  mockHomeSummary: {
    companyId: "comp-1",
    discussionsPendingReview: 0,
    tasksInReview: 0,
    blockedTasks: 0,
    myTasksDueToday: [],
    pendingMemoryItems: 0,
    nudges: [],
    recentActivity: [],
    setupStatus: {
      hasVisionMission: true,
      hasDepartment: true,
      hasAgent: true,
      hasGoal: true,
    },
    firstRunCompleted: true,
    goalProgress: [],
  },
  suggestionFixtures: [
    {
      id: "s-create-task",
      companyId: "comp-1",
      category: "goal_gap",
      actionType: "create_task",
      actionPayload: {
        title: "Create launch checklist",
        description: "Break launch prep into a task.",
        projectId: "proj-1",
        priority: "high",
      },
      title: "Turn launch prep into a task",
      evidence: "The launch goal has no active execution task.",
      status: "pending",
      expiresAt: null,
      relatedMemoryItemId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "s-risk",
      companyId: "comp-1",
      category: "risk_flag",
      actionType: "flag_risk",
      actionPayload: {},
      title: "Flag launch risk",
      evidence: "A blocker has been open for 3 days.",
      status: "pending",
      expiresAt: null,
      relatedMemoryItemId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "s-memory",
      companyId: "comp-1",
      category: "pattern_detected",
      actionType: "suggest_memory",
      actionPayload: {
        title: "Always include rollout checklist",
        content: "Every production launch needs a rollout checklist.",
        layer: "domain",
        category: "reference",
      },
      title: "Capture rollout checklist guidance",
      evidence: "Founder added the same rollout note in 3 reviews.",
      status: "pending",
      expiresAt: null,
      relatedMemoryItemId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "s-agent",
      companyId: "comp-1",
      category: "agent_proposal",
      actionType: "create_task",
      actionPayload: {
        title: "Review competitor pricing",
        agentName: "Scout",
        agentAvatarUrl: "https://example.com/scout.png",
      },
      title: "Scout proposed competitor pricing research",
      evidence: "Scout found 4 pricing changes this week.",
      status: "pending",
      expiresAt: null,
      relatedMemoryItemId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  suggestionsApiMock: {
    pending: vi.fn(),
    detect: vi.fn(),
    accept: vi.fn(),
    dismiss: vi.fn(),
  },
  memoryApiMock: {
    create: vi.fn(),
  },
}));

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Link: actual.Link,
    NavLink: actual.NavLink,
  };
});

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

vi.mock("../context/DialogContext", () => ({
  useDialog: () => mockDialogContext,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => mockBreadcrumbContext,
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast }),
}));

vi.mock("../hooks/useLiveAgentCount", () => ({
  useLiveAgentCount: () => 2,
}));

// N2: the suggestions-detect trigger is founder-gated client-side. Default to
// founder so the pre-existing tests (which assert detect fires) keep passing.
const teamAccessMock = vi.hoisted(() => ({ role: "founder" as string | null }));
vi.mock("../hooks/useTeamAccess", () => ({
  useTeamAccess: () => ({ role: teamAccessMock.role }),
}));

vi.mock("../api/dashboard", () => ({
  homeApi: { summary: vi.fn().mockResolvedValue(mockHomeSummary) },
}));

vi.mock("../api/auth", () => ({
  authApi: { getSession: vi.fn().mockResolvedValue({ user: { name: "John Doe" } }) },
}));

vi.mock("../api/suggestions", () => ({
  suggestionsApi: suggestionsApiMock,
}));

vi.mock("../api/memory", () => ({
  memoryApi: memoryApiMock,
}));

vi.mock("../api/goals", () => ({
  goalsApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/issues", () => ({
  issuesApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../lib/timeAgo", () => ({
  timeAgo: () => "2m ago",
}));

// WS9: FirstRunHome (the Map + door band) has its own unit tests
// (`onboarding/__tests__/FirstRunHome.test.tsx`) — stub it here so Dashboard's
// tests only assert the branch (which component renders), not its internals.
const firstRunHomeProps = vi.hoisted(() => ({ companyId: null as string | null }));
vi.mock("../onboarding/FirstRunHome", () => ({
  FirstRunHome: ({ companyId }: { companyId: string }) => {
    firstRunHomeProps.companyId = companyId;
    return <div data-testid="first-run-home">first-run-home</div>;
  },
}));

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.selectedCompanyId = "comp-1";
    mockCompanyContext.companies = [makeCompany()];
    teamAccessMock.role = "founder";
    suggestionsApiMock.pending.mockResolvedValue(suggestionFixtures);
    suggestionsApiMock.detect.mockResolvedValue({ ok: true });
    suggestionsApiMock.accept.mockResolvedValue({});
    suggestionsApiMock.dismiss.mockResolvedValue({});
    memoryApiMock.create.mockResolvedValue({});
  });

  it("renders quick actions and suggestion cards from the API", async () => {
    renderWithProviders(<Dashboard />);

    expect(await screen.findByText("Turn launch prep into a task")).toBeInTheDocument();
    expect(screen.getByText("Flag launch risk")).toBeInTheDocument();
    expect(screen.getByText("+ New Task")).toBeInTheDocument();
    await waitFor(() => expect(suggestionsApiMock.detect).toHaveBeenCalledWith("comp-1"));
  });

  it("does not fire suggestions detect for non-founders (server founder-gates it)", async () => {
    teamAccessMock.role = "team_member";
    renderWithProviders(<Dashboard />);

    // Wait for the page to settle (suggestions listed) before asserting absence.
    expect(await screen.findByText("Turn launch prep into a task")).toBeInTheDocument();
    expect(suggestionsApiMock.detect).not.toHaveBeenCalled();
  });

  it("hides suggestion accept/dismiss actions for non-founders (server founder-gates them)", async () => {
    teamAccessMock.role = "team_member";
    renderWithProviders(<Dashboard />);

    // Cards still render (suggestions are visible to everyone)...
    expect(await screen.findByText("Turn launch prep into a task")).toBeInTheDocument();
    // ...but the founder-only actions are gone (clicking them would 403).
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("create_task accept opens the task dialog with suggestion defaults", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Dashboard />);

    const buttons = await screen.findAllByRole("button", { name: "Accept" });
    await user.click(buttons[0]!);

    expect(mockDialogContext.openNewIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Create launch checklist",
        description: "Break launch prep into a task.",
        projectId: "proj-1",
        priority: "high",
      }),
    );
  });

  it("flag_risk accept calls the accept API and shows a toast", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Dashboard />);

    const cards = await screen.findAllByRole("button", { name: "Accept" });
    await user.click(cards[1]!);

    await waitFor(() => expect(suggestionsApiMock.accept).toHaveBeenCalledWith("comp-1", "s-risk"));
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Suggestion accepted",
      body: "Risk flagged",
      tone: "success",
    }));
  });

  it("dismiss removes a suggestion card", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Dashboard />);

    const dismissButtons = await screen.findAllByRole("button", { name: "Dismiss" });
    await user.click(dismissButtons[1]!);

    await waitFor(() => expect(suggestionsApiMock.dismiss).toHaveBeenCalledWith("comp-1", "s-risk"));
    await waitFor(() => expect(screen.queryByText("Flag launch risk")).not.toBeInTheDocument());
  });

  it("shows the empty state when there are no suggestions", async () => {
    suggestionsApiMock.pending.mockResolvedValue([]);
    renderWithProviders(<Dashboard />);

    expect(await screen.findByText("All caught up")).toBeInTheDocument();
  });

  it("shows agent proposals with the agent badge", async () => {
    renderWithProviders(<Dashboard />);

    expect(await screen.findByText("Scout")).toBeInTheDocument();
    expect(screen.getByText("Scout proposed competitor pricing research")).toBeInTheDocument();
  });

  it("WS9: renders FirstRunHome (the Map + door band) when firstRunCompleted is false, even with a complete checklist", async () => {
    const { homeApi } = await import("../api/dashboard");
    vi.mocked(homeApi.summary).mockResolvedValue({
      ...mockHomeSummary,
      firstRunCompleted: false,
    });
    renderWithProviders(<Dashboard />);

    expect(await screen.findByTestId("first-run-home")).toBeInTheDocument();
    expect(firstRunHomeProps.companyId).toBe("comp-1");
    expect(screen.queryByText("+ New Task")).not.toBeInTheDocument();
  });

  it("WS0b: shows steady-state Home when firstRunCompleted is true, even with an incomplete checklist (no goal)", async () => {
    const { homeApi } = await import("../api/dashboard");
    vi.mocked(homeApi.summary).mockResolvedValue({
      ...mockHomeSummary,
      setupStatus: {
        hasVisionMission: false,
        hasDepartment: false,
        hasAgent: false,
        hasGoal: false,
      },
      firstRunCompleted: true,
    });
    renderWithProviders(<Dashboard />);

    expect(await screen.findByText("+ New Task")).toBeInTheDocument();
    expect(screen.queryByTestId("first-run-home")).not.toBeInTheDocument();
  });

  it("suggest_memory accept opens the suggested memory dialog", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Dashboard />);

    const buttons = await screen.findAllByRole("button", { name: "Accept" });
    await user.click(buttons[2]!);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Always include rollout checklist")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Every production launch needs a rollout checklist.")).toBeInTheDocument();
  });
});
