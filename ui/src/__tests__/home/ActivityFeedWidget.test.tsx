import { screen } from "@testing-library/react";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { ActivityFeedWidget } from "../../components/home/widgets/ActivityFeedWidget";

const { useHomeSummaryMock } = vi.hoisted(() => ({ useHomeSummaryMock: vi.fn() }));
vi.mock("../../context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }));
vi.mock("../../lib/timeAgo", () => ({ timeAgo: () => "2m ago" }));
vi.mock("../../hooks/useHomeSummary", () => ({ useHomeSummary: useHomeSummaryMock }));

describe("ActivityFeedWidget", () => {
  beforeEach(() => {
    useHomeSummaryMock.mockReturnValue({
      data: {
        recentActivity: [
          { id: "a1", action: "issue.completed", entityType: "issue", entityId: "i1", details: { title: "Draft spec" }, createdAt: "x", actorType: "agent", actorId: "z" },
        ],
      },
      isLoading: false,
      error: null,
    });
  });

  it("renders activity rows with the issue→task word substitution", () => {
    renderWithProviders(<ActivityFeedWidget companyId="co-1" role="founder" size={{ w: 2, h: 2 }} />);
    expect(screen.getByText(/task completed/i)).toBeInTheDocument();
    expect(screen.getByText("Draft spec")).toBeInTheDocument();
  });

  it("renders nothing while loading (no data yet)", () => {
    useHomeSummaryMock.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { container } = renderWithProviders(
      <ActivityFeedWidget companyId="co-1" role="founder" size={{ w: 2, h: 2 }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there is no recent activity (empty)", () => {
    useHomeSummaryMock.mockReturnValue({ data: { recentActivity: [] }, isLoading: false, error: null });
    const { container } = renderWithProviders(
      <ActivityFeedWidget companyId="co-1" role="founder" size={{ w: 2, h: 2 }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing (no throw) when the summary query errors", () => {
    useHomeSummaryMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error("network error") });
    const { container } = renderWithProviders(
      <ActivityFeedWidget companyId="co-1" role="founder" size={{ w: 2, h: 2 }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
