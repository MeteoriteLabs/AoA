import { beforeEach, describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HomeBoardLayoutItem } from "@armyofagents/shared";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { HomeBoard } from "../../components/home/HomeBoard";

// jsdom has no real layout: react-grid-layout's useContainerWidth() measures
// containerRef.current.offsetWidth in a mount effect (jsdom always reports 0)
// and the globally-stubbed ResizeObserver (see __tests__/setup.ts) never fires
// again after that, so width would be pinned at 0 and RGL would render no
// tiles at all. Fix: mock just this hook to a fixed, non-zero width so the
// real Responsive/verticalCompactor still run and lay out real tiles.
vi.mock("react-grid-layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-grid-layout")>();
  return {
    ...actual,
    useContainerWidth: () => ({
      width: 1024,
      mounted: true,
      containerRef: { current: null },
      measureWidth: vi.fn(),
    }),
  };
});

// Default: no saved layout (role default applies). Individual tests override
// `homeBoardLayoutMock.layout` to exercise the saved/reconciled path.
// saveAsync/reset are STABLE fn references (never reassigned) so a
// useCallback closing over them never goes stale across renders — tests
// reconfigure behavior via mockResolvedValue/mockRejectedValueOnce on the
// same instance instead of swapping the reference.
const homeBoardLayoutMock = vi.hoisted(() => ({
  layout: null as HomeBoardLayoutItem[] | null,
  isSaving: false,
  isResetting: false,
  saveAsync: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("../../hooks/useHomeBoardLayout", () => ({
  useHomeBoardLayout: () => ({
    layout: homeBoardLayoutMock.layout,
    schemaVersion: null,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
    save: vi.fn(),
    saveAsync: homeBoardLayoutMock.saveAsync,
    isSaving: homeBoardLayoutMock.isSaving,
    saveError: null,
    reset: homeBoardLayoutMock.reset,
    resetAsync: vi.fn(),
    isResetting: homeBoardLayoutMock.isResetting,
    resetError: null,
  }),
}));

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

// Plan 2: data deps for the 4 new-data widgets (Budget + Approvals share the
// dashboard summary query; My tasks needs at least one non-terminal issue so
// it doesn't self-hide; Agents working now needs the live-count hook).
vi.mock("../../api/dashboard", () => ({
  dashboardApi: {
    summary: vi.fn().mockResolvedValue({
      costs: { monthSpendCents: 41200, monthBudgetCents: 200000, monthUtilizationPercent: 21 },
      pendingApprovals: 1,
    }),
  },
  homeApi: { summary: vi.fn() },
}));
vi.mock("../../api/work-questions", () => ({
  workQuestionsApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../api/issues", () => ({
  issuesApi: {
    list: vi.fn().mockResolvedValue([{ id: "t1", title: "Ship it", status: "in_progress", priority: "high" }]),
  },
}));
vi.mock("../../hooks/useLiveAgentCount", () => ({ useLiveAgentCount: () => 2 }));

describe("HomeBoard", () => {
  beforeEach(() => {
    homeBoardLayoutMock.layout = null;
    homeBoardLayoutMock.isSaving = false;
    homeBoardLayoutMock.isResetting = false;
    homeBoardLayoutMock.saveAsync.mockReset().mockResolvedValue({ layout: [], schemaVersion: 1 });
    homeBoardLayoutMock.reset.mockReset();
  });

  it('renders the founder board: all 8 widgets, each in its own error boundary, in getDefaultLayout("founder") order', async () => {
    renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);

    // The query-backed widgets (My tasks, Budget, Approvals) render only after
    // their mocked API calls resolve, so wait for the slowest one before
    // asserting the full composition.
    expect(await screen.findByText("Ship it")).toBeInTheDocument();

    // Every widget renders (each self-hides when its data is empty, so this also
    // proves the board composed real content, not just headers).
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "Action queue",
      "Approvals & questions",
      "Agents working now",
      "Today's activity",
      "Objectives",
      "Suggestions",
      "My tasks",
      "Budget",
    ]);
  });

  it("renders the member board: execution subset led by My tasks, no Budget/Approvals", async () => {
    renderWithProviders(<HomeBoard companyId="co-1" role="team_member" />);

    expect(await screen.findByText("Ship it")).toBeInTheDocument();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "My tasks",
      "Action queue",
      "Objectives",
      "Today's activity",
      "Suggestions",
      "Agents working now",
    ]);
    expect(headings).not.toContain("Budget");
    expect(headings).not.toContain("Approvals & questions");
  });

  it("renders a saved layout reconciled against the live registry (subset + reordered)", async () => {
    homeBoardLayoutMock.layout = [
      { i: "budget", x: 0, y: 0, w: 1, h: 1 },
      { i: "my-tasks", x: 1, y: 0, w: 2, h: 1 },
    ];
    renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);

    expect(await screen.findByText("Ship it")).toBeInTheDocument();

    // Only the two saved widgets render — reconcileLg never adds the other 6
    // founder-default widgets back in, even though this is a founder board.
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.sort()).toEqual(["Budget", "My tasks"]);
  });

  it("skips a saved widget key that is no longer registered (retired widget)", async () => {
    homeBoardLayoutMock.layout = [
      { i: "my-tasks", x: 0, y: 0, w: 2, h: 1 },
      { i: "retired-widget" as HomeBoardLayoutItem["i"], x: 2, y: 0, w: 1, h: 1 },
    ];
    renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);

    expect(await screen.findByText("Ship it")).toBeInTheDocument();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["My tasks"]);
  });

  describe("edit mode (Task C1)", () => {
    it("entering edit mode shows a remove button per tile, suppresses header navigation, and enables drag/resize", async () => {
      renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      // Not editing: header links exist, no remove buttons, resize hidden.
      expect(screen.getAllByRole("link", { name: /^Open / }).length).toBe(8);
      expect(screen.queryAllByLabelText(/^Remove /)).toHaveLength(0);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));

      // Editing: WidgetShell headers stop being links...
      expect(screen.queryAllByRole("link", { name: /^Open / })).toHaveLength(0);
      // ...and every tile grows a remove button.
      expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(8);

      // Drag/resize are wired to `editing`: RGL marks each grid item
      // draggable and un-hides its resize handle only while editing.
      const gridItems = document.querySelectorAll(".react-grid-item");
      expect(gridItems.length).toBe(8);
      gridItems.forEach((el) => {
        expect(el.classList.contains("react-draggable")).toBe(true);
        expect(el.classList.contains("react-resizable-hide")).toBe(false);
      });

      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    });

    it("removing a tile via its x button drops it from the board immediately", async () => {
      renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(8);

      await user.click(screen.getByLabelText("Remove Budget"));

      expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(7);
      expect(screen.queryByRole("heading", { level: 2, name: "Budget" })).not.toBeInTheDocument();
    });

    it("exiting edit mode after a change calls save with the updated (dirty) draft", async () => {
      renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      await user.click(screen.getByLabelText("Remove Budget"));
      await user.click(screen.getByRole("button", { name: "Done" }));

      await waitFor(() => expect(homeBoardLayoutMock.saveAsync).toHaveBeenCalledTimes(1));
      const [savedLayout] = homeBoardLayoutMock.saveAsync.mock.calls[0] as [HomeBoardLayoutItem[]];
      expect(savedLayout.some((item) => item.i === "budget")).toBe(false);

      // Back to read-only chrome once the save resolves.
      await waitFor(() => expect(screen.getByRole("button", { name: "Edit board" })).toBeInTheDocument());
      expect(screen.queryAllByLabelText(/^Remove /)).toHaveLength(0);
    });

    it("exiting edit mode with no changes does not call save", async () => {
      renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      await user.click(screen.getByRole("button", { name: "Done" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Edit board" })).toBeInTheDocument());
      expect(homeBoardLayoutMock.saveAsync).not.toHaveBeenCalled();
    });

    it("a failed save keeps the board in edit mode and dirty, and a retry can succeed", async () => {
      homeBoardLayoutMock.saveAsync.mockRejectedValueOnce(new Error("network down"));
      renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      await user.click(screen.getByLabelText("Remove Budget"));
      await user.click(screen.getByRole("button", { name: "Done" }));

      expect(await screen.findByText(/Couldn't save/)).toBeInTheDocument();
      // Still editing — the Done toggle and the (now 7) remove buttons remain.
      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
      expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(7);

      await user.click(screen.getByRole("button", { name: "Retry" }));

      await waitFor(() => expect(homeBoardLayoutMock.saveAsync).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.getByRole("button", { name: "Edit board" })).toBeInTheDocument());
    });

    it("switching companyId mid-edit discards the draft without saving", async () => {
      const { rerender } = renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      await user.click(screen.getByLabelText("Remove Budget"));
      expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(7);

      rerender(<HomeBoard companyId="co-2" role="founder" />);

      // Back to read-only chrome for the new company — the dirty draft
      // (Budget removed) from co-1 is discarded, not carried over or saved.
      await waitFor(() => expect(screen.getByRole("button", { name: "Edit board" })).toBeInTheDocument());
      expect(screen.queryAllByLabelText(/^Remove /)).toHaveLength(0);
      expect(homeBoardLayoutMock.saveAsync).not.toHaveBeenCalled();
    });
  });

  describe("add-widget tray (Task C2)", () => {
    beforeEach(() => {
      // A custom, smaller saved layout so there's room to add widgets.
      homeBoardLayoutMock.layout = [
        { i: "budget", x: 0, y: 0, w: 1, h: 1 },
        { i: "my-tasks", x: 1, y: 0, w: 2, h: 1 },
      ];
    });

    it("the tray lists only widgets not on the board, and adding one adds it to the board", async () => {
      renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(2);

      await user.click(screen.getByRole("button", { name: "Add widget" }));
      const tray = screen.getByRole("menu", { name: "Add widget" });

      // On-board widgets (Budget, My tasks) are excluded from the tray...
      expect(within(tray).queryByRole("button", { name: "Budget" })).not.toBeInTheDocument();
      expect(within(tray).queryByRole("button", { name: "My tasks" })).not.toBeInTheDocument();
      // ...the other six are offered.
      expect(within(tray).getByRole("button", { name: "Objectives" })).toBeInTheDocument();

      await user.click(within(tray).getByRole("button", { name: "Objectives" }));

      // Added to the board (draft): a new tile + remove button appear...
      expect(await screen.findByRole("heading", { level: 2, name: "Objectives" })).toBeInTheDocument();
      expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(3);
      // ...and the tray immediately reflects it's no longer available to add.
      expect(within(tray).queryByRole("button", { name: "Objectives" })).not.toBeInTheDocument();
    });

    it("reset restores the role-default board and marks the draft clean (a later exit does not re-save)", async () => {
      renderWithProviders(<HomeBoard companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(2);

      await user.click(screen.getByRole("button", { name: "Add widget" }));
      await user.click(screen.getByRole("button", { name: /^reset/i }));

      expect(homeBoardLayoutMock.reset).toHaveBeenCalledTimes(1);
      // Founder's role default includes all 8 registered widgets.
      await waitFor(() => expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(8));
      expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Done" }));

      // No delete-then-upsert race: exiting right after a reset must not re-save.
      await waitFor(() => expect(screen.getByRole("button", { name: "Edit board" })).toBeInTheDocument());
      expect(homeBoardLayoutMock.saveAsync).not.toHaveBeenCalled();
    });
  });
});
