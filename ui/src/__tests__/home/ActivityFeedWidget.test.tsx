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
      isError: false,
      error: null,
    });
  });

  it("renders activity rows with the issue→task word substitution", () => {
    renderWithProviders(<ActivityFeedWidget companyId="co-1" role="founder" size={{ w: 2, h: 2 }} />);
    expect(screen.getByText(/task completed/i)).toBeInTheDocument();
    expect(screen.getByText("Draft spec")).toBeInTheDocument();
  });

  it("shows the shell + loading placeholder while the summary query is in flight", () => {
    useHomeSummaryMock.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null });
    renderWithProviders(<ActivityFeedWidget companyId="co-1" role="founder" size={{ w: 2, h: 2 }} />);

    expect(screen.getByText("Today's activity")).toBeInTheDocument();
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it("shows the empty state (no CTA) when there is no recent activity", () => {
    useHomeSummaryMock.mockReturnValue({ data: { recentActivity: [] }, isLoading: false, isError: false, error: null });
    renderWithProviders(<ActivityFeedWidget companyId="co-1" role="founder" size={{ w: 2, h: 2 }} />);

    expect(screen.getByText("Agent activity will show up here as your crew starts working.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows an error empty state (no throw) when the summary query errors", () => {
    useHomeSummaryMock.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error("network error") });
    renderWithProviders(<ActivityFeedWidget companyId="co-1" role="founder" size={{ w: 2, h: 2 }} />);

    expect(screen.getByText("Couldn't load activity")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the activity row as a deep link to its entity when not editing", () => {
    renderWithProviders(<ActivityFeedWidget companyId="co-1" role="founder" size={{ w: 2, h: 2 }} />);
    const link = screen.getByRole("link", { name: /Draft spec/i });
    expect(link).toHaveAttribute("href", "/issues/i1");
  });

  it("does not render the activity row as a link while editing", () => {
    renderWithProviders(<ActivityFeedWidget companyId="co-1" role="founder" size={{ w: 2, h: 2 }} editing />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Draft spec")).toBeInTheDocument();
  });

  it("renders a plain (non-navigating) row when the activity's entity type has no deep link", () => {
    useHomeSummaryMock.mockReturnValue({
      data: {
        recentActivity: [
          { id: "a2", action: "cost.recorded", entityType: "cost", entityId: "c1", details: null, createdAt: "x", actorType: "agent", actorId: "z" },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<ActivityFeedWidget companyId="co-1" role="founder" size={{ w: 2, h: 2 }} />);
    // The widget's own header link ("Open Today's activity" -> /activity) still
    // renders — only the row itself must stay a non-navigating element.
    expect(screen.queryByRole("link", { name: /cost recorded/i })).not.toBeInTheDocument();
    expect(screen.getByText(/cost recorded/i)).toBeInTheDocument();
  });
});
