import { screen } from "@testing-library/react";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { BudgetWidget } from "../../components/home/widgets/BudgetWidget";

const { dashboardApiMock } = vi.hoisted(() => ({ dashboardApiMock: { summary: vi.fn() } }));
vi.mock("../../context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }));
vi.mock("../../api/dashboard", () => ({ dashboardApi: dashboardApiMock, homeApi: { summary: vi.fn() } }));

describe("BudgetWidget", () => {
  beforeEach(() => {
    dashboardApiMock.summary.mockResolvedValue({ costs: { monthSpendCents: 41200, monthBudgetCents: 200000, monthUtilizationPercent: 21 }, pendingApprovals: 0 });
  });
  it("renders month spend vs budget", async () => {
    renderWithProviders(<BudgetWidget companyId="co-1" role="founder" />);
    expect(await screen.findByText(/\$412/)).toBeInTheDocument();
    expect(screen.getByText(/of \$2,000/)).toBeInTheDocument();
  });

  it("renders nothing while budget data is missing (still loading)", () => {
    dashboardApiMock.summary.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderWithProviders(<BudgetWidget companyId="co-1" role="founder" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders $0 of $0 (not null) when budget data resolves to all-zero costs", async () => {
    dashboardApiMock.summary.mockResolvedValue({ costs: { monthSpendCents: 0, monthBudgetCents: 0, monthUtilizationPercent: 0 }, pendingApprovals: 0 });
    renderWithProviders(<BudgetWidget companyId="co-1" role="founder" />);
    expect(await screen.findByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.getByText(/of \$0 this month/)).toBeInTheDocument();
  });
});
