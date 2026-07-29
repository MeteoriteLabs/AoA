import { beforeEach, describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { UserRole } from "@armyofagents/shared";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { HomeBoard } from "../../components/home/HomeBoard";
import { HomeBoardControls } from "../../components/home/HomeBoardControls";
import { useBoardEdit } from "../../components/home/useBoardEdit";

// Same jsdom-width workaround as HomeBoard.test.tsx (see its comment for why).
const containerWidthMock = vi.hoisted(() => ({ width: 1024 }));
vi.mock("react-grid-layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-grid-layout")>();
  return {
    ...actual,
    useContainerWidth: () => ({
      width: containerWidthMock.width,
      mounted: true,
      containerRef: { current: null },
      measureWidth: vi.fn(),
    }),
  };
});

// Deliberately mocks the API modules (not the hooks) so the REAL
// useHomeSummary/useLiveAgentCount/useHomeBoardLayout hooks + react-query run
// end to end — this is the only way to prove the board doesn't over-fetch,
// since a hook-layer mock (as in HomeBoard.test.tsx) always returns static
// data regardless of how many widgets/observers subscribe to it.
const apiSpies = vi.hoisted(() => ({
  homeSummary: vi.fn(),
  dashboardSummary: vi.fn(),
  approvalsList: vi.fn(),
  workQuestionsList: vi.fn(),
  issuesList: vi.fn(),
  suggestionsPending: vi.fn(),
  suggestionsDetect: vi.fn(),
  liveRunsForCompany: vi.fn(),
  layoutGet: vi.fn(),
  layoutSave: vi.fn(),
  layoutReset: vi.fn(),
}));

vi.mock("../../context/CompanyContext", () => ({ useCompany: () => mockCompanyContext }));
vi.mock("../../context/DialogContext", () => ({ useDialog: () => ({}) }));
vi.mock("../../context/ToastContext", () => ({ useToast: () => ({ pushToast: vi.fn() }) }));
vi.mock("../../lib/timeAgo", () => ({ timeAgo: () => "2m ago" }));

vi.mock("../../api/dashboard", () => ({
  homeApi: { summary: apiSpies.homeSummary },
  dashboardApi: { summary: apiSpies.dashboardSummary },
}));
vi.mock("../../api/approvals", () => ({
  approvalsApi: { list: apiSpies.approvalsList },
}));
vi.mock("../../api/work-questions", () => ({
  workQuestionsApi: { list: apiSpies.workQuestionsList },
}));
vi.mock("../../api/issues", () => ({
  issuesApi: { list: apiSpies.issuesList },
}));
vi.mock("../../api/suggestions", () => ({
  suggestionsApi: {
    pending: apiSpies.suggestionsPending,
    detect: apiSpies.suggestionsDetect,
    accept: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock("../../api/heartbeats", () => ({
  heartbeatsApi: { liveRunsForCompany: apiSpies.liveRunsForCompany },
}));
vi.mock("../../api/home-board-layout", () => ({
  homeBoardLayoutApi: {
    get: apiSpies.layoutGet,
    save: apiSpies.layoutSave,
    reset: apiSpies.layoutReset,
  },
}));

/** Mirrors HomeBoard.test.tsx's harness (Task D3): Dashboard owns ONE
 * useBoardEdit, shared by the pinned header (HomeBoardControls) and the grid
 * (HomeBoard). */
function HomeBoardHarness({ companyId, role }: { companyId: string; role: UserRole | null }) {
  const boardEdit = useBoardEdit(companyId, role);
  return (
    <>
      <HomeBoardControls boardEdit={boardEdit} />
      <HomeBoard companyId={companyId} role={role} boardEdit={boardEdit} />
    </>
  );
}

describe("HomeBoard query-count (no over-fetch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    containerWidthMock.width = 1024;
    mockCompanyContext.selectedCompanyId = "co-1";

    apiSpies.homeSummary.mockResolvedValue({
      companyId: "co-1",
      setupStatus: { hasVisionMission: true, hasDepartment: true, hasAgent: true, hasGoal: true },
      firstRunCompleted: true,
      discussionsPendingReview: 0,
      // Non-zero/non-empty so Action queue/Objectives/Today's activity (all
      // three consumers of this one shared query) render actual content
      // rather than self-hiding — proves the board composed real data, not
      // just that a shared empty fetch happened once.
      tasksInReview: 1,
      myTasksDueToday: [],
      blockedTasks: 0,
      pendingMemoryItems: 0,
      recentActivity: [
        { id: "a1", action: "issue.completed", entityType: "issue", entityId: "i1", details: { title: "Spec" }, createdAt: new Date().toISOString(), actorType: "agent", actorId: "z" },
      ],
      goalProgress: [
        { id: "g1", title: "Launch", status: "active", totalTasks: 2, doneTasks: 1, inProgressTasks: 1, blockedTasks: 0, progressPercent: 50 },
      ],
      nudges: [],
    });
    apiSpies.dashboardSummary.mockResolvedValue({
      costs: { monthSpendCents: 41200, monthBudgetCents: 200000, monthUtilizationPercent: 21 },
      pendingApprovals: 1,
    });
    apiSpies.approvalsList.mockResolvedValue([
      { id: "appr-1", companyId: "co-1", type: "hire_agent", status: "pending", payload: {}, createdAt: new Date().toISOString() },
    ]);
    apiSpies.workQuestionsList.mockResolvedValue([
      { id: "q1", title: "Need input", question: "", issueId: "iss-1", issueIdentifierSnapshot: null },
    ]);
    apiSpies.issuesList.mockResolvedValue([{ id: "t1", title: "Ship it", status: "in_progress", priority: "high" }]);
    apiSpies.suggestionsPending.mockResolvedValue([]);
    apiSpies.suggestionsDetect.mockResolvedValue({ ok: true });
    apiSpies.liveRunsForCompany.mockResolvedValue([{ id: "run-1" }]);
    apiSpies.layoutGet.mockResolvedValue(null); // no saved layout -> founder role default (8 widgets)
    apiSpies.layoutSave.mockResolvedValue({ layout: [], schemaVersion: 1 });
    apiSpies.layoutReset.mockResolvedValue({ ok: true });
  });

  it("fetches every widget api exactly once for the founder (all-8) board — no N+1, dashboard dedup confirmed", async () => {
    renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);

    // Settle: wait for the slowest widget (My tasks) plus the full 8-widget
    // composition before reading final call counts.
    expect(await screen.findByText("Ship it")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(8));
    // Also wait for the Waiting-on-you widget's merged list content to
    // settle, since it depends on BOTH approvalsApi.list AND
    // workQuestionsApi.list resolving (Plan 6 Task 4: no longer a single
    // dashboard-summary-derived count).
    expect(await screen.findByText("Need input")).toBeInTheDocument();

    // homeApi.summary: shared by Action queue, Objectives, and Today's
    // activity via the SAME queryKeys.home(companyId) cache entry — expected
    // count is 1, not 3, proving react-query's dedup (not each widget
    // independently fetching).
    expect(apiSpies.homeSummary).toHaveBeenCalledTimes(1);
    // dashboardApi.summary: only Budget calls this now (Waiting-on-you moved
    // to approvalsApi.list in Plan 6 Task 4). Expected count is 1.
    expect(apiSpies.dashboardSummary).toHaveBeenCalledTimes(1);
    // approvalsApi.list: only Waiting-on-you calls this. Expected count is 1.
    expect(apiSpies.approvalsList).toHaveBeenCalledTimes(1);
    // workQuestionsApi.list: only Waiting-on-you calls this. Expected count is 1.
    expect(apiSpies.workQuestionsList).toHaveBeenCalledTimes(1);
    // issuesApi.list: only My tasks calls this (with assigneeUserId: "me").
    // Expected count is 1.
    expect(apiSpies.issuesList).toHaveBeenCalledTimes(1);
    // suggestionsApi.pending: only Suggestions calls this DIRECTLY, but the
    // founder-only "detect" mutation's onSuccess unconditionally invalidates
    // this same query key, so a founder board always does 1 initial fetch +
    // 1 detect-triggered refetch. Expected count is 2 — NOT 1 — a documented
    // deviation from a naive "every api exactly once" reading; see
    // HomeBoard.strictmode.test.tsx for the same finding reproduced with and
    // without StrictMode (identical either way, so this isn't react-query
    // over-fetching — it's SuggestionsWidget's own intentional
    // detect-then-refresh design).
    expect(apiSpies.suggestionsPending).toHaveBeenCalledTimes(2);
    expect(apiSpies.suggestionsDetect).toHaveBeenCalledTimes(1);
    // heartbeatsApi.liveRunsForCompany: only Agents working now (via
    // useLiveAgentCount) calls this. Expected count is 1.
    expect(apiSpies.liveRunsForCompany).toHaveBeenCalledTimes(1);
    // homeBoardLayoutApi.get: the board's own persisted-layout query
    // (useHomeBoardLayout, underneath useBoardEdit) — exactly one caller.
    // Expected count is 1.
    expect(apiSpies.layoutGet).toHaveBeenCalledTimes(1);
    // Never triggered by a plain mount/read.
    expect(apiSpies.layoutSave).not.toHaveBeenCalled();
    expect(apiSpies.layoutReset).not.toHaveBeenCalled();
  });

  it("fetches every widget api exactly once for the member (execution-subset) board too", async () => {
    renderWithProviders(<HomeBoardHarness companyId="co-1" role="team_member" />);

    expect(await screen.findByText("Ship it")).toBeInTheDocument();
    // Member default is a 6-widget subset led by My tasks, no Budget/Approvals.
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(6));

    expect(apiSpies.homeSummary).toHaveBeenCalledTimes(1);
    expect(apiSpies.issuesList).toHaveBeenCalledTimes(1);
    expect(apiSpies.liveRunsForCompany).toHaveBeenCalledTimes(1);
    // Budget/Waiting-on-you aren't on the member board — their apis never fire.
    expect(apiSpies.dashboardSummary).not.toHaveBeenCalled();
    expect(apiSpies.approvalsList).not.toHaveBeenCalled();
    expect(apiSpies.workQuestionsList).not.toHaveBeenCalled();
    // team_member is not founder -> canAct is false -> the auto-detect effect
    // never fires, so suggestionsApi.pending is a plain single fetch here
    // (no detect-triggered refetch) — confirms the "2" above is specifically
    // a founder-role characteristic, not a universal Suggestions behavior.
    expect(apiSpies.suggestionsDetect).not.toHaveBeenCalled();
    expect(apiSpies.suggestionsPending).toHaveBeenCalledTimes(1);
    expect(apiSpies.layoutGet).toHaveBeenCalledTimes(1);
  });
});
