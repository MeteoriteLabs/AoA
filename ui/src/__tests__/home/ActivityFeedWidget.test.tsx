import { screen } from "@testing-library/react";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { ActivityFeedWidget } from "../../components/home/widgets/ActivityFeedWidget";

vi.mock("../../context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }));
vi.mock("../../lib/timeAgo", () => ({ timeAgo: () => "2m ago" }));
vi.mock("../../hooks/useHomeSummary", () => ({
  useHomeSummary: () => ({ data: { recentActivity: [
    { id: "a1", action: "issue.completed", entityType: "issue", entityId: "i1", details: { title: "Draft spec" }, createdAt: "x", actorType: "agent", actorId: "z" },
  ] }, isLoading: false }),
}));

describe("ActivityFeedWidget", () => {
  it("renders activity rows with the issue→task word substitution", () => {
    renderWithProviders(<ActivityFeedWidget companyId="co-1" role="founder" size={{ w: 2, h: 2 }} />);
    expect(screen.getByText(/task completed/i)).toBeInTheDocument();
    expect(screen.getByText("Draft spec")).toBeInTheDocument();
  });
});
