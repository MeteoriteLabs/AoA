import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithProviders, mockCompanyContext, makeCompany } from "./test-utils";
import type {
  BudgetPolicySummary,
  BudgetIncident,
  BudgetOverview,
} from "@paperclipai/shared";
import { BudgetPolicyCard } from "../components/finance/BudgetPolicyCard";
import { BudgetIncidentCard } from "../components/finance/BudgetIncidentCard";
import { BudgetSidebarMarker } from "../components/finance/BudgetSidebarMarker";
import { QuotaBar } from "../components/finance/QuotaBar";
import { ProviderQuotaCard } from "../components/finance/ProviderQuotaCard";
import type { ProviderQuotaWindow } from "../api/quotas";

const budgetsOverviewMock = vi.fn();
const resolveIncidentMock = vi.fn();

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

vi.mock("../api/budgets", () => ({
  budgetsApi: {
    overview: (...args: unknown[]) => budgetsOverviewMock(...args),
    upsertPolicy: vi.fn(),
    resolveIncident: (...args: unknown[]) => resolveIncidentMock(...args),
  },
}));

function makePolicy(overrides: Partial<BudgetPolicySummary> = {}): BudgetPolicySummary {
  return {
    id: "pol-1",
    companyId: "comp-1",
    scopeType: "company",
    scopeId: "comp-1",
    scopeName: "Acme Inc",
    metric: "cost_usd",
    windowKind: "month_utc",
    amountCents: 10_000,
    warnPercent: 80,
    hardStopEnabled: true,
    isActive: true,
    observedCents: 2_500,
    utilizationPercent: 25,
    status: "ok",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeIncident(overrides: Partial<BudgetIncident> = {}): BudgetIncident {
  return {
    id: "inc-1",
    companyId: "comp-1",
    policyId: "pol-1",
    scopeType: "company",
    scopeId: "comp-1",
    scopeName: "Acme Inc",
    windowStart: new Date("2026-04-01T00:00:00Z"),
    windowEnd: new Date("2026-05-01T00:00:00Z"),
    thresholdType: "hard_stop",
    amountLimitCents: 10_000,
    amountObservedCents: 11_000,
    status: "open",
    approvalId: null,
    resolvedAt: null,
    createdAt: new Date("2026-04-15T12:00:00Z"),
    ...overrides,
  };
}

function makeOverview(overrides: Partial<BudgetOverview> = {}): BudgetOverview {
  return {
    policies: [],
    openIncidents: [],
    ...overrides,
  };
}

describe("BudgetPolicyCard", () => {
  it("renders scope name, amount, and utilization bar", () => {
    const policy = makePolicy({ amountCents: 10_000, observedCents: 2_500, utilizationPercent: 25 });
    renderWithProviders(<BudgetPolicyCard policy={policy} />);
    expect(screen.getByText("Acme Inc")).toBeInTheDocument();
    expect(screen.getByText(/\$100\.00/)).toBeInTheDocument();
    expect(screen.getByText(/25%/)).toBeInTheDocument();
    const bar = screen.getByTestId("budget-policy-utilization-bar");
    expect(bar).toHaveStyle({ width: "25%" });
  });

  it("shows warning status when observed >= warn threshold", () => {
    const policy = makePolicy({ status: "warning", utilizationPercent: 85 });
    renderWithProviders(<BudgetPolicyCard policy={policy} />);
    expect(screen.getByText(/warning/i)).toBeInTheDocument();
  });

  it("shows hard-stop status when observed >= 100%", () => {
    const policy = makePolicy({
      status: "hard_stop",
      utilizationPercent: 110,
      observedCents: 11_000,
    });
    renderWithProviders(<BudgetPolicyCard policy={policy} />);
    expect(screen.getByText(/hard stop/i)).toBeInTheDocument();
  });

  it("fires onEdit when edit button clicked", () => {
    const onEdit = vi.fn();
    const policy = makePolicy();
    renderWithProviders(<BudgetPolicyCard policy={policy} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledWith(policy);
  });

  it("visually deemphasizes inactive policies", () => {
    const policy = makePolicy({ isActive: false });
    const { container } = renderWithProviders(<BudgetPolicyCard policy={policy} />);
    const root = container.querySelector("[data-testid=budget-policy-card]");
    expect(root?.className).toMatch(/opacity/);
  });
});

describe("BudgetIncidentCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.selectedCompanyId = "comp-1";
    mockCompanyContext.selectedCompany = makeCompany();
  });

  it("renders incident scope name, observed vs limit, and window start", () => {
    const incident = makeIncident();
    renderWithProviders(<BudgetIncidentCard incident={incident} />);
    expect(screen.getByText("Acme Inc")).toBeInTheDocument();
    expect(screen.getByText(/\$110\.00/)).toBeInTheDocument();
    expect(screen.getByText(/\$100\.00/)).toBeInTheDocument();
  });

  it("fires raise-and-resume with the new amount", async () => {
    resolveIncidentMock.mockResolvedValue({ ok: true });
    const incident = makeIncident();
    renderWithProviders(<BudgetIncidentCard incident={incident} />);
    const input = screen.getByLabelText(/new budget/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "150.00" } });
    fireEvent.click(screen.getByRole("button", { name: /raise.*resume/i }));
    await waitFor(() => {
      expect(resolveIncidentMock).toHaveBeenCalledWith("comp-1", "inc-1", {
        action: "raise_and_resume",
        newAmountCents: 15_000,
      });
    });
  });

  it("fires dismiss action", async () => {
    resolveIncidentMock.mockResolvedValue({ ok: true });
    const incident = makeIncident();
    renderWithProviders(<BudgetIncidentCard incident={incident} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await waitFor(() => {
      expect(resolveIncidentMock).toHaveBeenCalledWith("comp-1", "inc-1", { action: "dismiss" });
    });
  });
});

describe("BudgetSidebarMarker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.selectedCompanyId = "comp-1";
    mockCompanyContext.selectedCompany = makeCompany();
  });

  it("renders nothing when no policies are in warn/hard state", async () => {
    budgetsOverviewMock.mockResolvedValue(
      makeOverview({
        policies: [makePolicy({ status: "ok", utilizationPercent: 25 })],
      }),
    );
    const { container } = renderWithProviders(<BudgetSidebarMarker />);
    await waitFor(() => {
      expect(budgetsOverviewMock).toHaveBeenCalled();
    });
    expect(container.querySelector("[data-testid=budget-sidebar-marker]")).toBeNull();
  });

  it("renders warning chip when at least one policy is in warning state", async () => {
    budgetsOverviewMock.mockResolvedValue(
      makeOverview({
        policies: [
          makePolicy({ status: "ok", utilizationPercent: 25 }),
          makePolicy({ id: "pol-2", status: "warning", utilizationPercent: 85 }),
        ],
      }),
    );
    renderWithProviders(<BudgetSidebarMarker />);
    const marker = await screen.findByTestId("budget-sidebar-marker");
    expect(marker).toHaveAttribute("data-tone", "warning");
    expect(marker.textContent).toMatch(/85/);
  });

  it("renders hard-stop chip when at least one policy is in hard_stop state", async () => {
    budgetsOverviewMock.mockResolvedValue(
      makeOverview({
        policies: [
          makePolicy({ status: "warning", utilizationPercent: 85 }),
          makePolicy({ id: "pol-2", status: "hard_stop", utilizationPercent: 110 }),
        ],
      }),
    );
    renderWithProviders(<BudgetSidebarMarker />);
    const marker = await screen.findByTestId("budget-sidebar-marker");
    expect(marker).toHaveAttribute("data-tone", "hard");
  });
});

describe("QuotaBar", () => {
  it("renders label, valueLabel, and percentage", () => {
    renderWithProviders(
      <QuotaBar label="5h window" used={50} limit={100} valueLabel="50 / 100 msgs" />,
    );
    expect(screen.getByText("5h window")).toBeInTheDocument();
    expect(screen.getByText("50 / 100 msgs")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("derives default value label from used/limit when not provided", () => {
    renderWithProviders(<QuotaBar label="24h" used={3} limit={10} />);
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
  });

  it("uses healthy tone when percent < 70", () => {
    renderWithProviders(<QuotaBar label="5h" used={50} limit={100} />);
    const fill = screen.getByTestId("quota-bar-fill");
    expect(fill).toHaveAttribute("data-tone", "healthy");
    expect(fill.className).toMatch(/green/);
    expect(fill).toHaveStyle({ width: "50%" });
  });

  it("uses warn tone when percent >= 70 and < 90", () => {
    renderWithProviders(<QuotaBar label="5h" used={80} limit={100} />);
    const fill = screen.getByTestId("quota-bar-fill");
    expect(fill).toHaveAttribute("data-tone", "warn");
    expect(fill.className).toMatch(/amber|yellow/);
  });

  it("uses hard tone when percent >= 90", () => {
    renderWithProviders(<QuotaBar label="5h" used={95} limit={100} />);
    const fill = screen.getByTestId("quota-bar-fill");
    expect(fill).toHaveAttribute("data-tone", "hard");
    expect(fill.className).toMatch(/red/);
  });

  it("visually clamps fill width to 100% when over-limit", () => {
    renderWithProviders(<QuotaBar label="5h" used={150} limit={100} />);
    const fill = screen.getByTestId("quota-bar-fill");
    expect(fill).toHaveStyle({ width: "100%" });
    expect(fill).toHaveAttribute("data-tone", "hard");
    expect(screen.getByText("150%")).toBeInTheDocument();
  });

  it("shows 0% without crashing when limit is 0", () => {
    renderWithProviders(<QuotaBar label="5h" used={0} limit={0} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
    const fill = screen.getByTestId("quota-bar-fill");
    expect(fill).toHaveStyle({ width: "0%" });
  });
});

describe("ProviderQuotaCard", () => {
  function makeWindow(overrides: Partial<ProviderQuotaWindow> = {}): ProviderQuotaWindow {
    return {
      id: "qw-1",
      companyId: "comp-1",
      provider: "anthropic",
      model: null,
      windowKind: "5h",
      label: "5h",
      limitValue: 100,
      usedValue: 30,
      usedPercent: 30,
      valueLabel: "30 / 100 msgs",
      resetAt: null,
      lastUpdatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("renders provider name capitalized and one bar per window", () => {
    renderWithProviders(
      <ProviderQuotaCard
        provider="anthropic"
        windows={[
          makeWindow({ windowKind: "5h", label: "5h" }),
          makeWindow({ id: "qw-2", windowKind: "24h", label: "24h", usedPercent: 85 }),
          makeWindow({ id: "qw-3", windowKind: "7d", label: "7d", usedPercent: 12 }),
        ]}
        lastUpdatedAt={new Date().toISOString()}
      />,
    );
    expect(screen.getByText(/anthropic/i)).toBeInTheDocument();
    expect(screen.getAllByTestId("quota-bar-fill")).toHaveLength(3);
  });

  it("shows relative last-updated time", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    renderWithProviders(
      <ProviderQuotaCard
        provider="anthropic"
        windows={[makeWindow()]}
        lastUpdatedAt={fiveMinAgo}
      />,
    );
    expect(screen.getByText(/5m ago/i)).toBeInTheDocument();
  });

  it("marks data as stale when older than 10 minutes", () => {
    const stale = new Date(Date.now() - 15 * 60_000).toISOString();
    renderWithProviders(
      <ProviderQuotaCard
        provider="anthropic"
        windows={[makeWindow()]}
        lastUpdatedAt={stale}
      />,
    );
    const freshness = screen.getByTestId("quota-freshness");
    expect(freshness).toHaveAttribute("data-stale", "true");
  });

  it("fires onRefresh when Refresh button clicked", () => {
    const onRefresh = vi.fn();
    renderWithProviders(
      <ProviderQuotaCard
        provider="anthropic"
        windows={[makeWindow()]}
        lastUpdatedAt={new Date().toISOString()}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables Refresh button while isRefreshing", () => {
    renderWithProviders(
      <ProviderQuotaCard
        provider="anthropic"
        windows={[makeWindow()]}
        lastUpdatedAt={new Date().toISOString()}
        onRefresh={() => {}}
        isRefreshing
      />,
    );
    expect(screen.getByRole("button", { name: /refresh/i })).toBeDisabled();
  });

  it("renders empty state when no windows and never refreshed", () => {
    renderWithProviders(
      <ProviderQuotaCard provider="anthropic" windows={[]} lastUpdatedAt={null} />,
    );
    expect(screen.getByText(/no quota data/i)).toBeInTheDocument();
  });
});
