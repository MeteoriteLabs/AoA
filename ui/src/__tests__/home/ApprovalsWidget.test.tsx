import { screen } from "@testing-library/react";
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
    renderWithProviders(<ApprovalsWidget companyId="co-1" role="founder" size={{ w: 1, h: 1 }} />);
    expect(await screen.findByText("3")).toBeInTheDocument(); // 1 approval + 2 questions
    expect(screen.getByText(/waiting on you/i)).toBeInTheDocument();
  });

  it("shows the shell + loading placeholder while either query is in flight", () => {
    wqApiMock.list.mockReturnValue(new Promise(() => {})); // never resolves
    renderWithProviders(<ApprovalsWidget companyId="co-1" role="founder" size={{ w: 1, h: 1 }} />);
    expect(screen.getByText("Approvals & questions")).toBeInTheDocument();
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it("shows an error empty state (no misleading partial total) when questions fails but dash resolves", async () => {
    wqApiMock.list.mockReset().mockRejectedValue(new Error("network error"));
    renderWithProviders(<ApprovalsWidget companyId="co-1" role="founder" size={{ w: 1, h: 1 }} />);

    expect(await screen.findByText("Couldn't load")).toBeInTheDocument();
    expect(screen.queryByText(/waiting on you/i)).not.toBeInTheDocument();
  });
});
