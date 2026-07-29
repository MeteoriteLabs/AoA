import { beforeEach, describe, it, expect, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { HomeBoardLayoutItem, UserRole } from "@armyofagents/shared";
import { renderWithProviders, mockCompanyContext } from "../test-utils";
import { HomeBoard } from "../../components/home/HomeBoard";
import { HomeBoardControls } from "../../components/home/HomeBoardControls";
import { useBoardEdit } from "../../components/home/useBoardEdit";

// jsdom has no real layout: react-grid-layout's useContainerWidth() measures
// containerRef.current.offsetWidth in a mount effect (jsdom always reports 0)
// and the globally-stubbed ResizeObserver (see __tests__/setup.ts) never fires
// again after that, so width would be pinned at 0 and RGL would render no
// tiles at all. Fix: mock just this hook to a fixed, non-zero width so the
// real Responsive/verticalCompactor still run and lay out real tiles.
// `containerWidthMock.width` is mutable (reset to 1024 in beforeEach) so a
// single test (Task D1/D2 breakpoint gating) can shrink it and force RGL's
// own real width->breakpoint detection to fire onBreakpointChange, without
// every other test needing to know or care.
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
  resetError: null as unknown,
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
    resetError: homeBoardLayoutMock.resetError,
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

/**
 * Task D3: HomeBoard no longer owns useBoardEdit itself — Dashboard does,
 * sharing ONE bundle with both HomeBoardControls (the pinned header, in
 * Dashboard) and HomeBoard (the grid) as a prop, so there's exactly one edit
 * session/draft. This harness reproduces that exact composition so the
 * pre-existing test bodies below (which exercise the Edit board/Done/Add
 * widget/Reset controls formerly rendered inline by HomeBoard) keep working
 * with only the render call itself changed, from <HomeBoard> alone to this.
 */
function HomeBoardHarness({ companyId, role }: { companyId: string; role: UserRole | null }) {
  const boardEdit = useBoardEdit(companyId, role);
  return (
    <>
      <HomeBoardControls boardEdit={boardEdit} />
      <HomeBoard companyId={companyId} role={role} boardEdit={boardEdit} />
    </>
  );
}

describe("HomeBoard", () => {
  beforeEach(() => {
    homeBoardLayoutMock.layout = null;
    homeBoardLayoutMock.isSaving = false;
    homeBoardLayoutMock.isResetting = false;
    homeBoardLayoutMock.saveAsync.mockReset().mockResolvedValue({ layout: [], schemaVersion: 1 });
    homeBoardLayoutMock.reset.mockReset();
    homeBoardLayoutMock.resetError = null;
    containerWidthMock.width = 1024;
  });

  it('renders the founder board: all 8 widgets, each in its own error boundary, in getDefaultLayout("founder") order', async () => {
    renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);

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
    renderWithProviders(<HomeBoardHarness companyId="co-1" role="team_member" />);

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

  it("founder vs member default divergence: founder gets all 8, member gets the execution subset led by My tasks with no Budget/Approvals (Plan 4 Task 6)", async () => {
    // The two tests above each prove one side independently; this one holds
    // both roles side by side in a single assertion so a future change that
    // drifts one default without the other fails here explicitly.
    const { rerender } = renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
    expect(await screen.findByText("Ship it")).toBeInTheDocument();
    const founderHeadings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

    rerender(<HomeBoardHarness companyId="co-1" role="team_member" />);
    expect(await screen.findByText("Ship it")).toBeInTheDocument();
    const memberHeadings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

    expect(founderHeadings).toHaveLength(8);
    expect(memberHeadings).toHaveLength(6);
    expect(memberHeadings.length).toBeLessThan(founderHeadings.length);
    expect(memberHeadings[0]).toBe("My tasks");
    expect(memberHeadings).not.toContain("Budget");
    expect(memberHeadings).not.toContain("Approvals & questions");
    // Every member widget is also on the founder board (execution subset,
    // not a disjoint set).
    for (const title of memberHeadings) {
      expect(founderHeadings).toContain(title);
    }
  });

  it("renders a saved layout reconciled against the live registry (subset + reordered)", async () => {
    homeBoardLayoutMock.layout = [
      { i: "budget", x: 0, y: 0, w: 1, h: 1 },
      { i: "my-tasks", x: 1, y: 0, w: 2, h: 1 },
    ];
    renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);

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
    renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);

    expect(await screen.findByText("Ship it")).toBeInTheDocument();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["My tasks"]);
  });

  describe("edit mode (Task C1)", () => {
    it("entering edit mode shows a remove button per tile, suppresses header navigation, and enables drag/resize", async () => {
      renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      // Not editing: header links exist, no remove buttons, resize hidden.
      expect(screen.getAllByRole("link", { name: /^Open / }).length).toBe(8);
      expect(screen.queryAllByLabelText(/^Remove /)).toHaveLength(0);
      // Task 5: `data-home-board-editing` scopes the resize-handle-visibility
      // CSS (index.css) — absent while read-only.
      expect(document.querySelector("[data-home-board-editing]")).toBeNull();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));

      // Editing: WidgetShell headers stop being links...
      expect(screen.queryAllByRole("link", { name: /^Open / })).toHaveLength(0);
      // ...and every tile grows a remove button.
      expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(8);
      // Task 5: present while editing so the resize-handle CSS applies.
      expect(document.querySelector('[data-home-board-editing="true"]')).not.toBeNull();

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
      renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(8);

      await user.click(screen.getByLabelText("Remove Budget"));

      expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(7);
      expect(screen.queryByRole("heading", { level: 2, name: "Budget" })).not.toBeInTheDocument();
    });

    it("removing every widget shows a centered empty-board state, and the pinned header controls remain (Plan 4 Task 6)", async () => {
      homeBoardLayoutMock.layout = [{ i: "budget", x: 0, y: 0, w: 1, h: 1 }];
      renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
      expect(await screen.findByRole("heading", { level: 2, name: "Budget" })).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      await user.click(screen.getByLabelText("Remove Budget"));

      expect(await screen.findByText("Your board is empty")).toBeInTheDocument();
      expect(screen.getByText(/Use Add widget above/i)).toBeInTheDocument();
      // The pinned header controls (from HomeBoardControls, a sibling of
      // this empty grid) remain reachable — the empty state never takes the
      // header with it.
      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add widget" })).toBeInTheDocument();

      // Re-adding a widget from the tray replaces the empty state with the grid again.
      await user.click(screen.getByRole("button", { name: "Add widget" }));
      const tray = screen.getByRole("menu", { name: "Add widget" });
      await user.click(within(tray).getByRole("button", { name: "Budget" }));
      expect(await screen.findByRole("heading", { level: 2, name: "Budget" })).toBeInTheDocument();
      expect(screen.queryByText("Your board is empty")).not.toBeInTheDocument();
    });

    it("exiting edit mode after a change calls save with the updated (dirty) draft", async () => {
      renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
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
      renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      await user.click(screen.getByRole("button", { name: "Done" }));

      await waitFor(() => expect(screen.getByRole("button", { name: "Edit board" })).toBeInTheDocument());
      expect(homeBoardLayoutMock.saveAsync).not.toHaveBeenCalled();
    });

    it("a failed save keeps the board in edit mode and dirty, and a retry can succeed", async () => {
      homeBoardLayoutMock.saveAsync.mockRejectedValueOnce(new Error("network down"));
      renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
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

    // [P2] Edits during an in-flight save were silently discarded: editableNow
    // only gated on editing+lg, so drag/resize/remove/add-widget stayed live
    // during "Saving…"; attemptSave's `.then` does `setDraft(null)` on
    // success, dropping anything changed in that window. Fixed by also
    // requiring !isSaving.
    it("disables drag/resize/remove/add-widget while a save is in flight, even though editing is still true (P2: no silent mid-save discard)", async () => {
      const { rerender } = renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(8);
      expect(screen.getByRole("button", { name: "Add widget" })).toBeInTheDocument();

      // Simulate the window between clicking Done and the save settling:
      // `editing` is still true (attemptSave hasn't resolved yet) but the
      // underlying mutation is now pending.
      homeBoardLayoutMock.isSaving = true;
      rerender(<HomeBoardHarness companyId="co-1" role="founder" />);

      expect(screen.getByText("Saving…")).toBeInTheDocument();
      // Every mutating affordance is gone, even though editing is still true.
      expect(screen.queryAllByLabelText(/^Remove /)).toHaveLength(0);
      expect(screen.queryByRole("button", { name: "Add widget" })).not.toBeInTheDocument();
      const gridItems = document.querySelectorAll(".react-grid-item");
      expect(gridItems.length).toBeGreaterThan(0);
      gridItems.forEach((el) => {
        expect(el.classList.contains("react-draggable")).toBe(false);
      });
      // Done itself stays visible (disabled — pre-existing behavior) so the
      // user can see something is happening.
      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    });

    it("switching companyId mid-edit discards the draft without saving", async () => {
      const { rerender } = renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      await user.click(screen.getByLabelText("Remove Budget"));
      expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(7);

      rerender(<HomeBoardHarness companyId="co-2" role="founder" />);

      // Back to read-only chrome for the new company — the dirty draft
      // (Budget removed) from co-1 is discarded, not carried over or saved.
      await waitFor(() => expect(screen.getByRole("button", { name: "Edit board" })).toBeInTheDocument());
      expect(screen.queryAllByLabelText(/^Remove /)).toHaveLength(0);
      expect(homeBoardLayoutMock.saveAsync).not.toHaveBeenCalled();
    });
  });

  describe("keyboard a11y (Task D2)", () => {
    it("tiles are not focusable/operable outside edit mode", async () => {
      renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      expect(screen.queryByRole("group", { name: /^Budget/ })).not.toBeInTheDocument();
    });

    it("arrow keys nudge the focused tile in the draft, blocked at bounds, with focus retained", async () => {
      renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));

      // Budget sits at the founder default's x:0 (leftmost column, see
      // gridLayout.ts packing) — column 1 of 4.
      const budgetTile = screen.getByRole("group", { name: /^Budget tile, column 1,/ });
      budgetTile.focus();
      expect(budgetTile).toHaveFocus();

      // Blocked: already at the left edge — no-op, same tile, same column.
      await user.keyboard("{ArrowLeft}");
      expect(screen.getByRole("group", { name: /^Budget tile, column 1,/ })).toBe(budgetTile);
      expect(budgetTile).toHaveFocus();

      // Moves right one cell.
      await user.keyboard("{ArrowRight}");
      expect(screen.getByRole("group", { name: /^Budget tile, column 2,/ })).toBe(budgetTile);
      expect(budgetTile).toHaveFocus();
    });

    it("shift+arrow cycles the focused tile's allowed size", async () => {
      renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));

      const budgetTile = screen.getByRole("group", { name: /^Budget tile,.*size 1 by 1/ });
      budgetTile.focus();

      await user.keyboard("{Shift>}{ArrowRight}{/Shift}");

      expect(screen.getByRole("group", { name: /^Budget tile,.*size 2 by 1/ })).toBe(budgetTile);
      expect(budgetTile).toHaveFocus();
    });

    it("announces each keyboard move/resize via the aria-live region", async () => {
      renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));

      const liveRegion = screen.getByRole("status");
      expect(liveRegion).toHaveTextContent("");

      const budgetTile = screen.getByRole("group", { name: /^Budget/ });
      budgetTile.focus();
      await user.keyboard("{ArrowRight}");

      // Budget is last in the founder default order, at y:6 (row 7) — the
      // five list widgets ahead of it now default to 2×2 (Task 4 sizing
      // recalibration), so the board packs one row taller than before.
      expect(liveRegion).toHaveTextContent(/Budget moved to column 2, row 7/);

      await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
      expect(liveRegion).toHaveTextContent(/Budget resized to 2 by 1/);
    });

    it("hides tile focusability once the real viewport drops below the lg breakpoint mid-edit (Task D1)", async () => {
      const { rerender } = renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      expect(screen.getByRole("group", { name: /^Budget/ })).toBeInTheDocument();

      // Shrink below the 1024px lg breakpoint and re-render so the REAL
      // Responsive component recomputes the breakpoint from the new width
      // (not a simulated onBreakpointChange call) — this is the one place
      // that exercises RGL's actual width->breakpoint detection end to end;
      // the gating logic itself is unit-tested directly in
      // useBoardEdit.test.ts's "activeBreakpoint" and lg-only-gating cases.
      containerWidthMock.width = 500;
      rerender(<HomeBoardHarness companyId="co-1" role="founder" />);

      await waitFor(() => {
        expect(screen.queryByRole("group", { name: /^Budget/ })).not.toBeInTheDocument();
      });
      // Editing is still on (Done/exit stays reachable) — just every
      // mutating affordance (remove, add, keyboard) is gone below lg.
      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
      expect(screen.queryAllByLabelText(/^Remove /)).toHaveLength(0);
    });

    // [P2] Below-lg edit left tiles inert: HomeBoard passed the raw `editing`
    // flag to each Widget/WidgetShell, which suppresses header navigation
    // whenever `editing` is truthy — regardless of activeBreakpoint. Below
    // lg, editableNow is false (drag/remove/keyboard are already disabled,
    // per the test above), so a tile was neither navigable (nav suppressed)
    // nor editable: a dead end. Fixed by passing `editableNow` instead.
    it("stays navigable (header links) below the lg breakpoint mid-edit, even though drag/remove/keyboard are disabled (P2: was inert)", async () => {
      const { rerender } = renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      // While editing at lg, header nav is suppressed in favor of drag/select.
      expect(screen.queryAllByRole("link", { name: /^Open / })).toHaveLength(0);

      containerWidthMock.width = 500;
      rerender(<HomeBoardHarness companyId="co-1" role="founder" />);

      await waitFor(() => {
        expect(screen.queryByRole("group", { name: /^Budget/ })).not.toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
      // Every tile is navigable again now that editableNow is false — nav
      // suppression is keyed on editableNow, not the raw `editing` flag.
      expect(screen.getAllByRole("link", { name: /^Open / }).length).toBe(8);
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
      renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
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
      renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
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

    // [P2] Reset failure was silent: only saveError was ever rendered, so a
    // failed Reset (the DELETE mutation) left the founder with no feedback
    // at all and no way to retry from the UI.
    it("surfaces a reset failure with a Retry affordance (P2: resetError was previously never rendered)", async () => {
      renderWithProviders(<HomeBoardHarness companyId="co-1" role="founder" />);
      expect(await screen.findByText("Ship it")).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: "Edit board" }));
      await user.click(screen.getByRole("button", { name: "Add widget" }));

      homeBoardLayoutMock.resetError = new Error("delete failed");
      await user.click(screen.getByRole("button", { name: /^reset/i }));

      expect(await screen.findByText(/Couldn't reset/i)).toBeInTheDocument();
      expect(homeBoardLayoutMock.reset).toHaveBeenCalledTimes(1);

      // Retry re-invokes resetBoard (a second reset attempt).
      await user.click(screen.getByRole("button", { name: "Retry" }));
      expect(homeBoardLayoutMock.reset).toHaveBeenCalledTimes(2);
    });
  });
});
