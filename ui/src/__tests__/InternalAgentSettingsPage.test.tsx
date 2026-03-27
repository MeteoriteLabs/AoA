import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  mockCompanyContext,
  mockBreadcrumbContext,
  makeCompany,
} from "./test-utils";
import { InternalAgentSettingsPage } from "../pages/InternalAgentSettingsPage";
import type { AgentConfig, AgentRunsResponse } from "../api/internal-agent";

// --- Factory ---
function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "ia-cfg-1",
    executionMode: "api",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    cliTool: null,
    autonomyLevel: 0,
    enabledCapabilities: [
      "discussion_processing",
      "proactive_suggestions",
      "organizational_queries",
      "system_actions",
      "context_briefing",
      "memory_management",
      "conflict_detection",
      "budget_awareness",
      "workflow_coaching",
      "workflow_discovery",
      "cross_department_coordination",
      "department_personas",
    ],
    notificationPreference: "realtime",
    contextTokenBudget: 8000,
    budgetMonthlyCents: 5000,
    spentMonthlyCents: 1234,
    proactiveIntervalMinutes: 240,
    lastProactiveRunAt: null,
    ...overrides,
  };
}

function makeRunsResponse(
  overrides: Partial<AgentRunsResponse> = {},
): AgentRunsResponse {
  return {
    runs: [],
    total: 0,
    limit: 20,
    offset: 0,
    aggregates: {
      totalCostCents: 0,
      totalRuns: 0,
      avgDurationMs: 0,
      failureRate: 0,
    },
    ...overrides,
  };
}

// --- API mock ---
const apiMock = {
  getConfig: vi.fn().mockResolvedValue(makeAgentConfig()),
  updateConfig: vi.fn().mockResolvedValue(makeAgentConfig()),
  getRuns: vi.fn().mockResolvedValue(makeRunsResponse()),
  testConnection: vi.fn().mockResolvedValue({ success: true }),
};

vi.mock("../api/internal-agent", () => ({
  internalAgentApi: new Proxy(
    {},
    { get: (_t, prop) => (apiMock as any)[prop] },
  ),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => mockBreadcrumbContext,
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

// --- Tests ---
describe("InternalAgentSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.selectedCompanyId = "comp-1";
    mockCompanyContext.selectedCompany = makeCompany();
    mockCompanyContext.companies = [makeCompany()];
    apiMock.getConfig.mockResolvedValue(makeAgentConfig());
    apiMock.getRuns.mockResolvedValue(makeRunsResponse());
  });

  it("renders tab bar with all tabs", async () => {
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("page-tab-bar")).toBeInTheDocument();
    });
    expect(screen.getByTestId("tab-execution")).toBeInTheDocument();
    expect(screen.getByTestId("tab-capabilities")).toBeInTheDocument();
    expect(screen.getByTestId("tab-budget")).toBeInTheDocument();
    expect(screen.getByTestId("tab-history")).toBeInTheDocument();
  });

  it("shows provider and model dropdowns in API mode", async () => {
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Provider")).toBeInTheDocument();
    });
    expect(screen.getByText("Model")).toBeInTheDocument();
  });

  it("shows CLI tool dropdown in CLI mode", async () => {
    apiMock.getConfig.mockResolvedValue(
      makeAgentConfig({ executionMode: "cli", cliTool: "claude_cli" }),
    );
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("CLI Tool")).toBeInTheDocument();
    });
  });

  it("hides provider/model when in CLI mode", async () => {
    apiMock.getConfig.mockResolvedValue(
      makeAgentConfig({ executionMode: "cli", cliTool: "claude_cli" }),
    );
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("CLI Tool")).toBeInTheDocument();
    });
    expect(screen.queryByText("Provider")).not.toBeInTheDocument();
    expect(screen.queryByText("Model")).not.toBeInTheDocument();
  });

  it("autonomy level is disabled", async () => {
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Autonomy Level")).toBeInTheDocument();
    });
    const autonomySelect = screen.getByText("Level 0 — Full Approval");
    expect(autonomySelect.closest("button")).toBeDisabled();
  });

  it("renders all 12 capability checkboxes on capabilities tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-capabilities")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-capabilities"));
    await waitFor(() => {
      expect(screen.getByText("Discussion Processing")).toBeInTheDocument();
    });
    expect(screen.getByText("Proactive Suggestions")).toBeInTheDocument();
    expect(screen.getByText("Budget Awareness")).toBeInTheDocument();
    expect(screen.getByText("Department Personas")).toBeInTheDocument();
  });

  it("select all toggles all capabilities on", async () => {
    apiMock.getConfig.mockResolvedValue(
      makeAgentConfig({ enabledCapabilities: [] }),
    );
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-capabilities")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-capabilities"));
    await waitFor(() => {
      expect(screen.getByText("Select All")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Select All"));
    const checkboxes = screen.getAllByRole("checkbox");
    const capCheckboxes = checkboxes.filter(
      (cb) => cb.getAttribute("data-capability") !== null,
    );
    capCheckboxes.forEach((cb) => {
      expect(cb).toBeChecked();
    });
  });

  it("renders notification preference options on capabilities tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-capabilities")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-capabilities"));
    await waitFor(() => {
      expect(screen.getByText("Silent")).toBeInTheDocument();
    });
    expect(screen.getByText("Digest")).toBeInTheDocument();
    expect(screen.getByText("Real-time")).toBeInTheDocument();
  });

  it("budget progress bar is green when under 70%", async () => {
    apiMock.getConfig.mockResolvedValue(
      makeAgentConfig({ spentMonthlyCents: 1000, budgetMonthlyCents: 5000 }),
    );
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-budget")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-budget"));
    await waitFor(() => {
      expect(screen.getByTestId("budget-progress")).toBeInTheDocument();
    });
    const bar = screen.getByTestId("budget-progress-bar");
    expect(bar.className).toContain("bg-emerald");
  });

  it("budget progress bar is yellow when 70-89%", async () => {
    apiMock.getConfig.mockResolvedValue(
      makeAgentConfig({ spentMonthlyCents: 4000, budgetMonthlyCents: 5000 }),
    );
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-budget")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-budget"));
    await waitFor(() => {
      expect(screen.getByTestId("budget-progress")).toBeInTheDocument();
    });
    const bar = screen.getByTestId("budget-progress-bar");
    expect(bar.className).toContain("bg-amber");
  });

  it("budget progress bar is red when >= 90%", async () => {
    apiMock.getConfig.mockResolvedValue(
      makeAgentConfig({ spentMonthlyCents: 4800, budgetMonthlyCents: 5000 }),
    );
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-budget")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-budget"));
    await waitFor(() => {
      expect(screen.getByTestId("budget-progress")).toBeInTheDocument();
    });
    const bar = screen.getByTestId("budget-progress-bar");
    expect(bar.className).toContain("bg-red");
  });

  it("shows agent paused indicator at 100%", async () => {
    apiMock.getConfig.mockResolvedValue(
      makeAgentConfig({ spentMonthlyCents: 5000, budgetMonthlyCents: 5000 }),
    );
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-budget")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-budget"));
    await waitFor(() => {
      expect(screen.getByText("Agent paused")).toBeInTheDocument();
    });
  });

  it("execution tab save calls updateConfig with execution fields", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Save")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(apiMock.updateConfig).toHaveBeenCalledWith("comp-1", {
        executionMode: "api",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        cliTool: undefined,
      });
    });
  });

  it("test connection shows green badge on success", async () => {
    apiMock.testConnection.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Test Connection")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Test Connection"));
    await waitFor(() => {
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
  });

  it("test connection shows red badge on failure", async () => {
    apiMock.testConnection.mockResolvedValue({
      success: false,
      error: "Invalid API key",
    });
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Test Connection")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Test Connection"));
    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeInTheDocument();
    });
  });

  it("run history tab renders empty state when no runs", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-history")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-history"));
    await waitFor(() => {
      expect(screen.getByText("No runs yet")).toBeInTheDocument();
    });
  });

  it("toggling individual checkbox updates state", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-capabilities")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-capabilities"));
    await waitFor(() => {
      expect(screen.getByText("Discussion Processing")).toBeInTheDocument();
    });
    const checkbox = screen.getByRole("checkbox", {
      name: /Discussion Processing/i,
    });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it("notification preference radio selection changes value", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-capabilities")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-capabilities"));
    await waitFor(() => {
      expect(screen.getByText("Silent")).toBeInTheDocument();
    });
    const silentRadio = screen.getByRole("radio", { name: /Silent/i });
    await user.click(silentRadio);
    expect(silentRadio).toBeChecked();
  });

  it("context token budget dropdown renders current value", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-capabilities")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-capabilities"));
    await waitFor(() => {
      expect(screen.getByText("Context Token Budget")).toBeInTheDocument();
    });
    expect(screen.getByText("Standard (8,000)")).toBeInTheDocument();
  });

  it("deselect all toggles all capabilities off", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-capabilities")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-capabilities"));
    await waitFor(() => {
      expect(screen.getByText("Deselect All")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Deselect All"));
    const checkboxes = screen.getAllByRole("checkbox");
    const capCheckboxes = checkboxes.filter(
      (cb) => cb.getAttribute("data-capability") !== null,
    );
    capCheckboxes.forEach((cb) => {
      expect(cb).not.toBeChecked();
    });
  });

  it("run history tab renders table with run data", async () => {
    apiMock.getRuns.mockResolvedValue(
      makeRunsResponse({
        runs: [
          {
            id: "run-1",
            triggerType: "conversation",
            triggerSource: "user_message",
            status: "completed",
            toolsCalled: [],
            tokenUsage: { inputTokens: 100, outputTokens: 50 },
            costCents: 2,
            durationMs: 1500,
            summary: "Answered question",
            departmentContext: null,
            userId: "user-1",
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-history")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-history"));
    await waitFor(() => {
      expect(screen.getByText("conversation")).toBeInTheDocument();
    });
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("load more button visible when more pages exist", async () => {
    apiMock.getRuns.mockResolvedValue(
      makeRunsResponse({
        runs: [
          {
            id: "run-1",
            triggerType: "conversation",
            triggerSource: "user_message",
            status: "completed",
            toolsCalled: [],
            tokenUsage: { inputTokens: 100, outputTokens: 50 },
            costCents: 2,
            durationMs: 1500,
            summary: null,
            departmentContext: null,
            userId: "user-1",
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        ],
        total: 25,
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-history")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-history"));
    await waitFor(() => {
      expect(screen.getByText("Load More")).toBeInTheDocument();
    });
  });

  it("load more button hidden when all runs loaded", async () => {
    apiMock.getRuns.mockResolvedValue(
      makeRunsResponse({
        runs: [
          {
            id: "run-1",
            triggerType: "conversation",
            triggerSource: "user_message",
            status: "completed",
            toolsCalled: [],
            tokenUsage: { inputTokens: 100, outputTokens: 50 },
            costCents: 2,
            durationMs: 1500,
            summary: null,
            departmentContext: null,
            userId: "user-1",
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          },
        ],
        total: 1,
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-history")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-history"));
    await waitFor(() => {
      expect(screen.getByText("conversation")).toBeInTheDocument();
    });
    expect(screen.queryByText("Load More")).not.toBeInTheDocument();
  });

  it("capabilities tab save calls updateConfig with capabilities fields", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-capabilities")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-capabilities"));
    await waitFor(() => {
      expect(screen.getByText("Save")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(apiMock.updateConfig).toHaveBeenCalledWith("comp-1", {
        enabledCapabilities: expect.any(Array),
        notificationPreference: "realtime",
        contextTokenBudget: 8000,
      });
    });
  });

  it("budget tab save calls updateConfig with budget fields", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InternalAgentSettingsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-budget")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-budget"));
    await waitFor(() => {
      expect(screen.getByText("Save")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(apiMock.updateConfig).toHaveBeenCalledWith("comp-1", {
        budgetMonthlyCents: 5000,
      });
    });
  });
});
