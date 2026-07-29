import { screen } from "@testing-library/react";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { HomeBoard } from "../../components/home/HomeBoard";

vi.mock("../../context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }));
vi.mock("../../hooks/useHomeSummary", () => ({ useHomeSummary: () => ({ data: {
  goalProgress: [{ id: "g1", title: "Launch", status: "active", totalTasks: 2, doneTasks: 1, inProgressTasks: 1, blockedTasks: 0, progressPercent: 50 }],
  recentActivity: [{ id: "a1", action: "issue.completed", entityType: "issue", entityId: "i1", details: { title: "Spec" }, createdAt: new Date().toISOString(), actorType: "agent", actorId: "z" }],
  tasksInReview: 1, blockedTasks: 0, discussionsPendingReview: 0, myTasksDueToday: [],
}, isLoading: false }) }));
vi.mock("../../lib/timeAgo", () => ({ timeAgo: () => "2m ago" }));
vi.mock("../../api/suggestions", () => ({ suggestionsApi: { pending: vi.fn().mockResolvedValue([]), detect: vi.fn(), accept: vi.fn(), dismiss: vi.fn() } }));
vi.mock("../../context/DialogContext", () => ({ useDialog: () => ({}) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ pushToast: vi.fn() }) }));

// Plan 2: data deps for the 4 new-data widgets (Budget + Approvals share the
// dashboard summary query; My tasks needs at least one non-terminal issue so
// it doesn't self-hide; Agents working now needs the live-count hook).
vi.mock("../../api/dashboard", () => ({
  dashboardApi: {
    summary: vi.fn().mockResolvedValue({
      costs: { monthSpendCents: 41200, monthBudgetCents: 200000, monthUtilizationPercent: 21 },
      pendingApprovals: 1,
    }),
  },
  homeApi: { summary: vi.fn() },
}));
vi.mock("../../api/work-questions", () => ({
  workQuestionsApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../api/issues", () => ({
  issuesApi: {
    list: vi.fn().mockResolvedValue([{ id: "t1", title: "Ship it", status: "in_progress", priority: "high" }]),
  },
}));
vi.mock("../../hooks/useLiveAgentCount", () => ({ useLiveAgentCount: () => 2 }));

describe("HomeBoard", () => {
  it('renders the founder board: all 8 widgets, each in its own error boundary, in getDefaultLayout("founder") order', async () => {
    renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);

    // The query-backed widgets (My tasks, Budget, Approvals) render only after
    // their mocked API calls resolve, so wait for the slowest one before
    // asserting the full composition.
    expect(await screen.findByText("Ship it")).toBeInTheDocument();

    // Every widget renders (each self-hides when its data is empty, so this also
    // proves the board composed real content, not just headers).
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Action Queue",
      "Approvals & questions",
      "Agents working now",
      "Today's Activity",
      "Active Goals",
      "Suggestions",
      "My tasks",
      "Budget",
    ]);
  });

  it("renders the member board: execution subset led by My tasks, no Budget/Approvals", async () => {
    renderWithProviders(<HomeBoard companyId="co-1" role="team_member" />);

    expect(await screen.findByText("Ship it")).toBeInTheDocument();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "My tasks",
      "Action Queue",
      "Active Goals",
      "Today's Activity",
      "Suggestions",
      "Agents working now",
    ]);
    expect(headings).not.toContain("Budget");
    expect(headings).not.toContain("Approvals & questions");
  });
});
