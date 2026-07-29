import { screen } from "@testing-library/react";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { ObjectivesWidget } from "../../components/home/widgets/ObjectivesWidget";

const { useHomeSummaryMock } = vi.hoisted(() => ({ useHomeSummaryMock: vi.fn() }));
vi.mock("../../context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }));
vi.mock("../../hooks/useHomeSummary", () => ({ useHomeSummary: useHomeSummaryMock }));

describe("ObjectivesWidget", () => {
  beforeEach(() => {
    useHomeSummaryMock.mockReturnValue({
      data: {
        goalProgress: [
          { id: "g1", title: "Launch v1.1", status: "at_risk", totalTasks: 10, doneTasks: 7, inProgressTasks: 2, blockedTasks: 1, progressPercent: 70 },
          { id: "g2", title: "No tasks goal", status: "active", totalTasks: 0, doneTasks: 0, inProgressTasks: 0, blockedTasks: 0, progressPercent: 0 },
        ],
      },
      isLoading: false,
      error: null,
    });
  });

  it("renders goals with the At Risk pill and task counts", () => {
    renderWithProviders(<ObjectivesWidget companyId="co-1" role="founder" size={{ w: 2, h: 1 }} />);
    expect(screen.getByText("Launch v1.1")).toBeInTheDocument();
    expect(screen.getByText("At Risk")).toBeInTheDocument();
    expect(screen.getByText("7/10 tasks")).toBeInTheDocument();
  });
  it("shows 'no tasks yet' instead of a 0% bar for a zero-task goal", () => {
    renderWithProviders(<ObjectivesWidget companyId="co-1" role="founder" size={{ w: 2, h: 1 }} />);
    expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument();
  });

  it("renders nothing while loading (no data yet)", () => {
    useHomeSummaryMock.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { container } = renderWithProviders(
      <ObjectivesWidget companyId="co-1" role="founder" size={{ w: 2, h: 1 }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there are zero goals (empty)", () => {
    useHomeSummaryMock.mockReturnValue({ data: { goalProgress: [] }, isLoading: false, error: null });
    const { container } = renderWithProviders(
      <ObjectivesWidget companyId="co-1" role="founder" size={{ w: 2, h: 1 }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing (no throw) when the summary query errors", () => {
    useHomeSummaryMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error("network error") });
    const { container } = renderWithProviders(
      <ObjectivesWidget companyId="co-1" role="founder" size={{ w: 2, h: 1 }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
