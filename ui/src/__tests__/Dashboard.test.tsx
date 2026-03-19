import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockCompanyContext, mockDialogContext, mockBreadcrumbContext, makeCompany } from "./test-utils";
import { Dashboard } from "../pages/Dashboard";

// --- Mocks ---

const mockNavigate = vi.fn();

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    Link: actual.Link,
    NavLink: actual.NavLink,
  };
});

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

vi.mock("../context/DialogContext", () => ({
  useDialog: () => mockDialogContext,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => mockBreadcrumbContext,
}));

const mockHomeSummary = {
  briefsAwaitingReview: 0,
  tasksInReview: 0,
  blockedTasks: 0,
  myTasksDueToday: [],
  pendingMemoryItems: 0,
  nudges: [],
  recentActivity: [],
  setupStatus: {
    hasVisionMission: true,
    hasDepartment: true,
    hasAgent: true,
    hasGoal: true,
  },
  goalProgress: [],
};

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn(({ queryKey }: any) => {
      if (queryKey?.[0] === "auth" || queryKey === "auth.session") {
        return { data: { user: { name: "John Doe" } }, isLoading: false };
      }
      // home summary
      return { data: mockHomeSummary, isLoading: false, error: null };
    }),
  };
});

vi.mock("../hooks/useLiveAgentCount", () => ({
  useLiveAgentCount: () => 2,
}));

vi.mock("../api/dashboard", () => ({
  homeApi: { summary: vi.fn().mockResolvedValue({}) },
}));

vi.mock("../api/auth", () => ({
  authApi: { getSession: vi.fn().mockResolvedValue({ user: { name: "John" } }) },
}));

vi.mock("../lib/queryKeys", () => ({
  queryKeys: {
    auth: { session: "auth.session" },
    home: (id: string) => ["home", id],
  },
}));

vi.mock("../lib/timeAgo", () => ({
  timeAgo: () => "2m ago",
}));

vi.mock("../components/EmptyState", () => ({
  EmptyState: ({ message, onAction }: any) => (
    <div data-testid="empty-state">
      {message}
      {onAction && <button onClick={onAction}>Action</button>}
    </div>
  ),
}));

vi.mock("../components/PageSkeleton", () => ({
  PageSkeleton: () => <div data-testid="skeleton">Loading...</div>,
}));

// --- Tests ---

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.selectedCompanyId = "comp-1";
    mockCompanyContext.companies = [makeCompany()];
  });

  it("renders greeting", () => {
    renderWithProviders(<Dashboard />);

    // Greeting should contain "Good morning/afternoon/evening"
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toMatch(/Good (morning|afternoon|evening)/);
  });

  it("renders 3 quick action cards", () => {
    renderWithProviders(<Dashboard />);

    expect(screen.getByText("+ New Task")).toBeInTheDocument();
    expect(screen.getByText("+ Debrief")).toBeInTheDocument();
    expect(screen.getByText("+ New Goal")).toBeInTheDocument();
  });

  it("New Task action card calls openNewIssue", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Dashboard />);

    await user.click(screen.getByText("+ New Task"));
    expect(mockDialogContext.openNewIssue).toHaveBeenCalled();
  });

  it("Debrief action card calls openDebrief", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Dashboard />);

    await user.click(screen.getByText("+ Debrief"));
    expect(mockDialogContext.openDebrief).toHaveBeenCalled();
  });

  it("New Goal action card calls openNewGoal", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Dashboard />);

    await user.click(screen.getByText("+ New Goal"));
    expect(mockDialogContext.openNewGoal).toHaveBeenCalled();
  });
});
