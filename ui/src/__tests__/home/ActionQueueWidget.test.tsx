import { screen } from "@testing-library/react";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { ActionQueueWidget } from "../../components/home/widgets/ActionQueueWidget";

vi.mock("../../context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }));
vi.mock("../../hooks/useHomeSummary", () => ({
  useHomeSummary: () => ({ data: {
    tasksInReview: 2, blockedTasks: 1, discussionsPendingReview: 0,
    myTasksDueToday: [{ id: "t1", title: "Ship it", status: "in_progress", priority: "high", dueDate: null, assigneeAgentId: null, assigneeUserId: "u1" }],
  }, isLoading: false }),
}));

describe("ActionQueueWidget", () => {
  it("renders the Needs Review, Blocked, and Due Today groups (collapsible)", () => {
    renderWithProviders(<ActionQueueWidget companyId="co-1" role="founder" />);
    expect(screen.getByText("Needs Review")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("Due Today")).toBeInTheDocument();
    expect(screen.getByText("Ship it")).toBeInTheDocument();
  });
});
