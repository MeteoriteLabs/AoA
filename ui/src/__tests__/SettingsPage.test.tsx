import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockCompanyContext, mockBreadcrumbContext, makeCompany } from "./test-utils";
import { SettingsPage } from "../pages/SettingsPage";

// --- Mocks ---

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => mockBreadcrumbContext,
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: vi.fn().mockReturnValue({ data: undefined, isLoading: false }),
    useMutation: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false }),
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

vi.mock("../lib/queryKeys", () => ({
    queryKeys: {
    companies: { all: ["companies"], detail: () => ["company-detail"] },
    costs: () => ["costs"],
    activity: () => ["activity"],
    agents: { list: () => ["agents"] },
    issues: { list: () => ["issues"] },
    projects: { list: () => ["projects"] },
    goals: { list: () => ["goals"] },
    sidebarBadges: () => ["badges"],
    mcp: {
      status: () => ["mcp-status"],
      keys: () => ["mcp-keys"],
      clients: () => ["mcp-clients"],
    },
    agentConfig: () => ["agent-config"],
  },
}));

vi.mock("../api/companies", () => ({
  companiesApi: { update: vi.fn(), archive: vi.fn() },
}));

vi.mock("../api/access", () => ({
  accessApi: { createCompanyInvite: vi.fn(), getInviteOnboarding: vi.fn() },
}));

vi.mock("../api/costs", () => ({
  costsApi: { summary: vi.fn(), byAgent: vi.fn(), byProject: vi.fn() },
}));

vi.mock("../api/activity", () => ({
  activityApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/agents", () => ({
  agentsApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/issues", () => ({
  issuesApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/projects", () => ({
  projectsApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/goals", () => ({
  goalsApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../api/mcp", () => ({
  mcpApi: {
    status: vi.fn().mockResolvedValue({
      companyId: "comp-1",
      enabled: false,
      endpointPath: "/api/companies/comp-1/mcp",
      keyCount: 0,
      connectedClients: 0,
    }),
    updateSettings: vi.fn(),
    listKeys: vi.fn().mockResolvedValue([]),
    createKey: vi.fn(),
    revokeKey: vi.fn(),
    listClients: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../api/internal-agent", () => ({
  internalAgentApi: {
    getConfig: vi.fn().mockResolvedValue({
      id: "ia-cfg-1",
      executionMode: "api",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      budgetMonthlyCents: 5000,
      spentMonthlyCents: 1234,
    }),
  },
}));

vi.mock("../lib/utils", () => ({
  formatCents: (v: number) => `$${(v / 100).toFixed(2)}`,
  formatTokens: (v: number) => `${v}`,
  budgetProgressColor: (u: number) =>
    u >= 90 ? "bg-red-500" : u >= 70 ? "bg-amber-500" : "bg-emerald-500",
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}));

vi.mock("../components/LLMProvidersSection", () => ({
  LLMProvidersSection: () => <div data-testid="llm-providers">LLM Providers Content</div>,
}));

vi.mock("../components/PageTabBar", () => ({
  PageTabBar: ({ items, value, onValueChange }: any) => (
    <div data-testid="page-tab-bar">
      {items.map((item: any) => (
        <button
          key={item.value}
          data-testid={`tab-${item.value}`}
          aria-selected={value === item.value}
          onClick={() => onValueChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../components/EmptyState", () => ({
  EmptyState: ({ message }: any) => <div>{message}</div>,
}));

vi.mock("../components/PageSkeleton", () => ({
  PageSkeleton: () => <div data-testid="skeleton">Loading...</div>,
}));

vi.mock("../components/CompanyPatternIcon", () => ({
  CompanyPatternIcon: () => <div data-testid="company-icon" />,
}));

vi.mock("../components/agent-config-primitives", () => ({
  Field: ({ label, children }: any) => <div><label>{label}</label>{children}</div>,
  ToggleField: ({ label }: any) => <div data-testid="toggle-field">{label}</div>,
  HintIcon: () => <span>?</span>,
}));

vi.mock("../components/Identity", () => ({
  Identity: ({ name }: any) => <span>{name}</span>,
}));

vi.mock("../components/StatusBadge", () => ({
  StatusBadge: ({ status }: any) => <span>{status}</span>,
}));

vi.mock("../components/ActivityRow", () => ({
  ActivityRow: () => <div data-testid="activity-row" />,
}));

// --- Tests ---

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.selectedCompanyId = "comp-1";
    mockCompanyContext.selectedCompany = makeCompany();
    mockCompanyContext.companies = [makeCompany()];
  });

  it("renders Settings title and icon", () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("renders commander link", () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByText("Commander")).toBeInTheDocument();
  });

  it("renders tab bar with all tabs", () => {
    renderWithProviders(<SettingsPage />);
    expect(screen.getByTestId("page-tab-bar")).toBeInTheDocument();
    expect(screen.getByTestId("tab-general")).toBeInTheDocument();
    expect(screen.getByTestId("tab-llm")).toBeInTheDocument();
    expect(screen.getByTestId("tab-budget")).toBeInTheDocument();
    expect(screen.getByTestId("tab-activity")).toBeInTheDocument();
    expect(screen.getByTestId("tab-integrations")).toBeInTheDocument();
  });

  it("General tab is selected by default", () => {
    renderWithProviders(<SettingsPage />);
    // General content should be visible (inner subsection heading)
    expect(screen.getAllByText("General").length).toBeGreaterThanOrEqual(1);
  });

  it("switching tabs shows correct content", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    // Click LLM Providers tab
    await user.click(screen.getByTestId("tab-llm"));
    expect(screen.getByTestId("llm-providers")).toBeInTheDocument();
  });
});
