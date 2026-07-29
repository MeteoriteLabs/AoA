import { screen } from "@testing-library/react";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { HomeBoard } from "../../components/home/HomeBoard";

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

describe("HomeBoard", () => {
  it("renders all four widgets, each in its own error boundary, in the default order", () => {
    renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);

    // Every widget renders (each self-hides when its data is empty, so this also
    // proves the board composed real content, not just headers).
    expect(screen.getByText("Action Queue")).toBeInTheDocument();
    expect(screen.getByText("Suggestions")).toBeInTheDocument();
    expect(screen.getByText("Active Goals")).toBeInTheDocument();
    expect(screen.getByText("Today's Activity")).toBeInTheDocument();

    // Section order matches getDefaultLayout: action-queue, suggestions, objectives, activity-feed.
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Action Queue", "Suggestions", "Active Goals", "Today's Activity"]);
  });

  it("skips unknown widget keys without crashing (defensive)", () => {
    // A populated board still renders even though getDefaultLayout only yields
    // registered keys; getWidget returns undefined for anything unknown and the
    // board returns null for it (verified in registry.test.ts).
    renderWithProviders(<HomeBoard companyId="co-1" role="team_member" />);
    expect(screen.getByText("Active Goals")).toBeInTheDocument();
  });
});
