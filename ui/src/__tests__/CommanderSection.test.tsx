import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  mockCompanyContext,
  makeCompany,
} from "./test-utils";
import { CommanderSection } from "@/components/settings/sections/CommanderSection";
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
    cheapModel: null,
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

vi.mock("@/api/internal-agent", () => ({
  internalAgentApi: new Proxy(
    {},
    { get: (_t, prop) => (apiMock as any)[prop] },
  ),
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => mockCompanyContext,
}));

// CommanderSubTabs is mocked to expose the legacy `data-testid="tab-<id>"`
// hooks so the existing test bodies can drive the component. Sub-tab state
// is owned here in the mock so user clicks switch the active tab.
vi.mock("@/components/settings/sections/CommanderSubTabs", async () => {
  const React = await import("react");
  const SUB_TABS = [
    { id: "execution", label: "Execution & Model" },
    { id: "capabilities", label: "Capabilities" },
    { id: "budget", label: "Budget & Spend" },
    { id: "history", label: "Run History" },
  ];

  function useCommanderSubTab() {
    const [active, setActive] = React.useState("execution");
    return { active, setActive };
  }

  function MockSubTabs({
    active,
    onSelect,
  }: {
    active: string;
    onSelect: (id: string) => void;
  }) {
    return (
      <div data-testid="page-tab-bar">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            aria-selected={active === t.id}
            onClick={() => onSelect(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    );
  }

  return {
    CommanderSubTabs: MockSubTabs,
    CommanderSubTabsMobile: () => null,
    useCommanderSubTab,
  };
});

// --- Tests ---
describe("CommanderSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCompanyContext.selectedCompanyId = "comp-1";
    mockCompanyContext.selectedCompany = makeCompany();
    mockCompanyContext.companies = [makeCompany()];
    apiMock.getConfig.mockResolvedValue(makeAgentConfig());
    apiMock.getRuns.mockResolvedValue(makeRunsResponse());
  });

  it("renders tab bar with all tabs", async () => {
    renderWithProviders(<CommanderSection />);
    await waitFor(() => {
      expect(screen.getByTestId("page-tab-bar")).toBeInTheDocument();
    });
    expect(screen.getByTestId("tab-execution")).toBeInTheDocument();
    expect(screen.getByTestId("tab-capabilities")).toBeInTheDocument();
    expect(screen.getByTestId("tab-budget")).toBeInTheDocument();
    expect(screen.getByTestId("tab-history")).toBeInTheDocument();
  });

  // Sprint 2A (Decision #91) — Commander is CLI-only. The page no longer
  // shows a mode toggle, provider picker, or model picker; just the CLI tool
  // picker.
  it("shows CLI tool dropdown (the only execution option)", async () => {
    renderWithProviders(<CommanderSection />);
    await waitFor(() => {
      expect(screen.getByText("CLI Tool")).toBeInTheDocument();
    });
  });

  it("does not show API-mode provider or model pickers", async () => {
    renderWithProviders(<CommanderSection />);
    await waitFor(() => {
      expect(screen.getByText("CLI Tool")).toBeInTheDocument();
    });
    expect(screen.queryByText("Provider")).not.toBeInTheDocument();
    expect(screen.queryByText("Model")).not.toBeInTheDocument();
    expect(screen.queryByText("Execution Mode")).not.toBeInTheDocument();
  });

  it("autonomy level is disabled", async () => {
    renderWithProviders(<CommanderSection />);
    await waitFor(() => {
      expect(screen.getByText("Autonomy Level")).toBeInTheDocument();
    });
    const autonomySelect = screen.getByText("Level 0 — Full Approval");
    expect(autonomySelect.closest("button")).toBeDisabled();
  });

  it("renders all 12 capability checkboxes on capabilities tab", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
    await waitFor(() => {
      expect(screen.getByTestId("tab-budget")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-budget"));
    await waitFor(() => {
      expect(screen.getByText("Agent paused")).toBeInTheDocument();
    });
  });

  it("execution tab save calls updateConfig with CLI-only fields (Sprint 2A)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommanderSection />);
    await waitFor(() => {
      expect(screen.getByText("Save")).toBeInTheDocument();
    });
    await user.click(screen.getByText("Save"));
    await waitFor(() => {
      expect(apiMock.updateConfig).toHaveBeenCalledWith("comp-1", {
        executionMode: "cli",
        cliTool: "claude_cli",
      });
    });
  });

  it("test connection shows green badge on success", async () => {
    apiMock.testConnection.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
    renderWithProviders(<CommanderSection />);
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
        proactiveIntervalMinutes: 240,
      });
    });
  });

  it("budget tab save calls updateConfig with budget fields", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommanderSection />);
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
        cheapModel: null,
      });
    });
  });

  describe("cost-saver cheap model field", () => {
    it("renders the cheap model input in the budget tab", async () => {
      apiMock.getConfig.mockResolvedValue(
        makeAgentConfig({ cheapModel: "claude-haiku-4-5" }),
      );
      const user = userEvent.setup();
      renderWithProviders(<CommanderSection />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-budget")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("tab-budget"));
      const input = await screen.findByTestId("cheap-model-input");
      expect(input).toBeInTheDocument();
      expect((input as HTMLInputElement).value).toBe("claude-haiku-4-5");
    });

    it("renders empty cheap model input when cheapModel is null", async () => {
      apiMock.getConfig.mockResolvedValue(
        makeAgentConfig({ cheapModel: null }),
      );
      const user = userEvent.setup();
      renderWithProviders(<CommanderSection />);
      await waitFor(() => {
        expect(screen.getByTestId("tab-budget")).toBeInTheDocument();
      });
      await user.click(screen.getByTestId("tab-budget"));
      const input = await screen.findByTestId("cheap-model-input");
      expect((input as HTMLInputElement).value).toBe("");
    });
  });
});
