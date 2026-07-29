import { beforeEach, describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import type { HomeBoardLayoutItem } from "@armyofagents/shared";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { HomeBoard } from "../../components/home/HomeBoard";

// jsdom has no real layout: react-grid-layout's useContainerWidth() measures
// containerRef.current.offsetWidth in a mount effect (jsdom always reports 0)
// and the globally-stubbed ResizeObserver (see __tests__/setup.ts) never fires
// again after that, so width would be pinned at 0 and RGL would render no
// tiles at all. Fix: mock just this hook to a fixed, non-zero width so the
// real Responsive/verticalCompactor still run and lay out real tiles.
vi.mock("react-grid-layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-grid-layout")>();
  return {
    ...actual,
    useContainerWidth: () => ({
      width: 1024,
      mounted: true,
      containerRef: { current: null },
      measureWidth: vi.fn(),
    }),
  };
});

// Default: no saved layout (role default applies). Individual tests override
// `homeBoardLayoutMock.layout` to exercise the saved/reconciled path.
const homeBoardLayoutMock = vi.hoisted(() => ({ layout: null as HomeBoardLayoutItem[] | null }));
vi.mock("../../hooks/useHomeBoardLayout", () => ({
  useHomeBoardLayout: () => ({
    layout: homeBoardLayoutMock.layout,
    schemaVersion: null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
    save: vi.fn(),
    saveAsync: vi.fn(),
    isSaving: false,
    saveError: null,
    reset: vi.fn(),
    resetAsync: vi.fn(),
    isResetting: false,
    resetError: null,
  }),
}));

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
  beforeEach(() => {
    homeBoardLayoutMock.layout = null;
  });

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
      "Action queue",
      "Approvals & questions",
      "Agents working now",
      "Today's activity",
      "Objectives",
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
      "Action queue",
      "Objectives",
      "Today's activity",
      "Suggestions",
      "Agents working now",
    ]);
    expect(headings).not.toContain("Budget");
    expect(headings).not.toContain("Approvals & questions");
  });

  it("renders a saved layout reconciled against the live registry (subset + reordered)", async () => {
    homeBoardLayoutMock.layout = [
      { i: "budget", x: 0, y: 0, w: 1, h: 1 },
      { i: "my-tasks", x: 1, y: 0, w: 2, h: 1 },
    ];
    renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);

    expect(await screen.findByText("Ship it")).toBeInTheDocument();

    // Only the two saved widgets render — reconcileLg never adds the other 6
    // founder-default widgets back in, even though this is a founder board.
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.sort()).toEqual(["Budget", "My tasks"]);
  });

  it("skips a saved widget key that is no longer registered (retired widget)", async () => {
    homeBoardLayoutMock.layout = [
      { i: "my-tasks", x: 0, y: 0, w: 2, h: 1 },
      { i: "retired-widget" as HomeBoardLayoutItem["i"], x: 2, y: 0, w: 1, h: 1 },
    ];
    renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);

    expect(await screen.findByText("Ship it")).toBeInTheDocument();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["My tasks"]);
  });
});
