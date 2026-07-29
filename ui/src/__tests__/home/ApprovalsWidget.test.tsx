import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { ApprovalsWidget } from "../../components/home/widgets/ApprovalsWidget";

const { dashboardApiMock, wqApiMock } = vi.hoisted(() => ({ dashboardApiMock: { summary: vi.fn() }, wqApiMock: { list: vi.fn() } }));
vi.mock("../../context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }));
vi.mock("../../api/dashboard", () => ({ dashboardApi: dashboardApiMock, homeApi: { summary: vi.fn() } }));
vi.mock("../../api/work-questions", () => ({ workQuestionsApi: wqApiMock }));

describe("ApprovalsWidget", () => {
  beforeEach(() => {
    dashboardApiMock.summary.mockResolvedValue({ pendingApprovals: 1, costs: { monthSpendCents: 0, monthBudgetCents: 0, monthUtilizationPercent: 0 } });
    wqApiMock.list.mockResolvedValue([{ id: "q1" }, { id: "q2" }]);
  });
  it("sums approvals + questions waiting", async () => {
    renderWithProviders(<ApprovalsWidget companyId="co-1" role="founder" />);
    expect(await screen.findByText("3")).toBeInTheDocument(); // 1 approval + 2 questions
    expect(screen.getByText(/waiting on you/i)).toBeInTheDocument();
  });

  it("renders nothing (no misleading partial total) when questions fails but dash resolves", async () => {
    wqApiMock.list.mockReset().mockRejectedValue(new Error("network error"));
    const { container } = renderWithProviders(<ApprovalsWidget companyId="co-1" role="founder" />);
    await waitFor(() => expect(wqApiMock.list).toHaveBeenCalled());
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(screen.queryByText(/waiting on you/i)).not.toBeInTheDocument();
  });
});
