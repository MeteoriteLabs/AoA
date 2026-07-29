import { screen } from "@testing-library/react";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { ActionQueueWidget } from "../../components/home/widgets/ActionQueueWidget";

// A vi.fn() (not a fixed object) so individual tests below can override the
// hook's return value per-case (loading/empty/error), matching the pattern
// used by AgentsNowWidget.test.tsx's useLiveAgentCountMock.
const { useHomeSummaryMock } = vi.hoisted(() => ({ useHomeSummaryMock: vi.fn() }));
vi.mock("../../context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }));
vi.mock("../../hooks/useHomeSummary", () => ({ useHomeSummary: useHomeSummaryMock }));

describe("ActionQueueWidget", () => {
  beforeEach(() => {
    useHomeSummaryMock.mockReturnValue({
      data: {
        tasksInReview: 2, blockedTasks: 1, discussionsPendingReview: 0,
        myTasksDueToday: [{ id: "t1", title: "Ship it", status: "in_progress", priority: "high", dueDate: null, assigneeAgentId: null, assigneeUserId: "u1" }],
      },
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  it("renders the Needs Review, Blocked, and Due Today groups (collapsible)", () => {
    renderWithProviders(<ActionQueueWidget companyId="co-1" role="founder" size={{ w: 2, h: 1 }} />);
    expect(screen.getByText("Needs Review")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Due Today")).toBeInTheDocument();
    expect(screen.getByText("Ship it")).toBeInTheDocument();
  });

  it("shows the shell + loading placeholder while the summary query is in flight", () => {
    useHomeSummaryMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null });
    renderWithProviders(<ActionQueueWidget companyId="co-1" role="founder" size={{ w: 2, h: 1 }} />);

    expect(screen.getByText("Action queue")).toBeInTheDocument();
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it("shows the empty state (no CTA) when the summary has zero actionable items", () => {
    useHomeSummaryMock.mockReturnValue({
      data: { tasksInReview: 0, blockedTasks: 0, discussionsPendingReview: 0, myTasksDueToday: [] },
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<ActionQueueWidget companyId="co-1" role="founder" size={{ w: 2, h: 1 }} />);

    expect(screen.getByText("Nothing needs review — all clear")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows an error empty state (no throw) when the summary query errors", () => {
    useHomeSummaryMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("network error") });
    renderWithProviders(<ActionQueueWidget companyId="co-1" role="founder" size={{ w: 2, h: 1 }} />);

    expect(screen.getByText("Couldn't load")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
