import { beforeEach, describe, it, expect, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import type { UserRole } from "@armyofagents/shared";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { listWidgets } from "../../components/home/widgets/registry";
import { WidgetErrorBoundary } from "../../components/home/WidgetErrorBoundary";

/**
 * Task 3 Step 2 (Plan 4): a completeness SAFETY NET across every registered
 * widget at once, generically mocked toward "empty" data — on top of (not a
 * replacement for) each widget's own bespoke loading/empty/error tests. Each
 * widget is rendered exactly as HomeBoard itself renders it — wrapped in the
 * same WidgetErrorBoundary — so a widget that throws during render surfaces
 * as the boundary's "This widget couldn't load" fallback instead of an
 * uncaught exception, giving a single, uniform assertion this loop can check
 * for every widget without needing widget-specific markup knowledge.
 */
const genericApiSpies = vi.hoisted(() => ({
  dashboardSummary: vi.fn(),
  homeApiSummary: vi.fn(),
  workQuestionsList: vi.fn(),
  issuesList: vi.fn(),
  suggestionsPending: vi.fn(),
  suggestionsDetect: vi.fn(),
  goalsList: vi.fn(),
  memoryCreate: vi.fn(),
}));

vi.mock("../../context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }));
vi.mock("../../context/DialogContext", () => ({ useDialog: () => ({ openNewIssue: vi.fn() }) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ pushToast: vi.fn() }) }));
vi.mock("../../lib/timeAgo", () => ({ timeAgo: () => "2m ago" }));

// Action queue / Objectives / Today's activity: no data yet — each widget's
// own `!data` guard collapses this to a safe empty render.
vi.mock("../../hooks/useHomeSummary", () => ({
  useHomeSummary: () => ({ data: undefined, isLoading: false, error: null }),
}));
// Agents working now: the hook itself always returns a safe number.
vi.mock("../../hooks/useLiveAgentCount", () => ({ useLiveAgentCount: () => 0 }));

vi.mock("../../api/dashboard", () => ({
  dashboardApi: { summary: genericApiSpies.dashboardSummary },
  homeApi: { summary: genericApiSpies.homeApiSummary },
}));
vi.mock("../../api/work-questions", () => ({
  workQuestionsApi: { list: genericApiSpies.workQuestionsList },
}));
vi.mock("../../api/issues", () => ({
  issuesApi: { list: genericApiSpies.issuesList },
}));
vi.mock("../../api/suggestions", () => ({
  suggestionsApi: {
    pending: genericApiSpies.suggestionsPending,
    detect: genericApiSpies.suggestionsDetect,
    accept: vi.fn(),
    dismiss: vi.fn(),
  },
}));
// Only reachable via SuggestionsWidget's nested (closed-by-default) suggested-
// memory dialog — its queries are `enabled: false` while closed, so these
// exist purely as defensive stubs (matches Dashboard.test.tsx's own pattern).
vi.mock("../../api/goals", () => ({ goalsApi: { list: genericApiSpies.goalsList } }));
vi.mock("../../api/memory", () => ({ memoryApi: { create: genericApiSpies.memoryCreate } }));

const ROLE: UserRole = "founder";

describe("widget completeness: every registered widget survives empty data", () => {
  beforeEach(() => {
    mockCompanyContext.selectedCompanyId = "co-1";
    genericApiSpies.dashboardSummary.mockResolvedValue({
      costs: { monthSpendCents: 0, monthBudgetCents: 0, monthUtilizationPercent: 0 },
      pendingApprovals: 0,
    });
    genericApiSpies.homeApiSummary.mockResolvedValue(undefined);
    genericApiSpies.workQuestionsList.mockResolvedValue([]);
    genericApiSpies.issuesList.mockResolvedValue([]);
    genericApiSpies.suggestionsPending.mockResolvedValue([]);
    genericApiSpies.suggestionsDetect.mockResolvedValue({ ok: true });
    genericApiSpies.goalsList.mockResolvedValue([]);
    genericApiSpies.memoryCreate.mockResolvedValue({});
  });

  for (const def of listWidgets()) {
    it(`${def.key} (${def.title}) renders without throwing on empty data`, async () => {
      const Widget = def.Component;
      renderWithProviders(
        <WidgetErrorBoundary>
          <Widget companyId="co-1" role={ROLE} size={def.defaultSize} />
        </WidgetErrorBoundary>,
      );

      // Flush the mocked (already-resolved) query promises through a real
      // macrotask tick so any post-settle re-render has happened before the
      // assertion below runs.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // Never the boundary's fallback (which only renders after a caught
      // throw) — every widget must produce either null or a safe shell.
      // Regex (not an exact string) so this can't silently stop matching on
      // a punctuation/whitespace tweak to WidgetErrorBoundary's copy.
      expect(screen.queryByText(/This widget couldn't load/)).not.toBeInTheDocument();
    });
  }

  it("covers all 8 registered widgets (guards against a silently-shrunk registry)", () => {
    expect(listWidgets().map((def) => def.key).sort()).toEqual([
      "action-queue",
      "activity-feed",
      "agents-now",
      "approvals",
      "budget",
      "my-tasks",
      "objectives",
      "suggestions",
    ]);
  });
});
