import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CockpitData } from "@armyofagents/shared";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Phase 3d: useCockpitPin calls useToast — mock it so tests don't need ToastProvider.
vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

// Phase 3d: pinsApi — mock so useCockpitPin mutations don't make real network calls.
vi.mock("../../../api/pins", () => ({
  pinsApi: {
    pin: vi.fn().mockResolvedValue(undefined),
    unpin: vi.fn().mockResolvedValue(undefined),
  },
}));

// Phase 3b/3c: mock the cockpit API (replaced the 3a per-card /live-runs query)
vi.mock("../../../api/cockpit", () => ({
  cockpitApi: {
    get: vi.fn().mockResolvedValue({
      running: [],
      review: [],
      myTasks: [],
      today: { reminders: [], dueTasks: [] },
      discussions: [],
      approvals: [],
      pinned: [],
      goalsAtRisk: [],
      budgetPulse: null,
      doneToday: [],
      proactiveFindings: [],
      teammatesActivity: [],
    } satisfies CockpitData),
  },
}));

// Mock queryKeys — only the cockpit key is needed in this test
vi.mock("../../../lib/queryKeys", () => ({
  queryKeys: {
    cockpit: (companyId: string) => ["cockpit", companyId],
  },
}));

import { cockpitApi } from "../../../api/cockpit";
import { CommanderCockpitPanel } from "./CommanderCockpitPanel";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeData(overrides?: Partial<CockpitData>): CockpitData {
  return {
    running: [],
    review: [],
    myTasks: [],
    today: { reminders: [], dueTasks: [] },
    discussions: [],
    // Phase 3c: required by CockpitData
    approvals: [],
    // Phase 3d: required by CockpitData
    pinned: [],
    // Opt-in cards
    goalsAtRisk: [],
    budgetPulse: null,
    doneToday: [],
    proactiveFindings: [],
    teammatesActivity: [],
    ...overrides,
  };
}

function makeRunItem(overrides?: Partial<CockpitData["running"][0]>): CockpitData["running"][0] {
  return {
    id: "run-1",
    agentName: "Atlas",
    status: "running",
    startedAt: null,
    issueId: "issue-1",
    ...overrides,
  };
}

function renderPanel(onCollapse = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <CommanderCockpitPanel companyId="comp-1" onCollapse={onCollapse} />
    </QueryClientProvider>,
  );
  return { onCollapse, queryClient };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CommanderCockpitPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(cockpitApi.get).mockResolvedValue(makeData());
  });

  it("renders with data-testid='commander-cockpit-panel'", async () => {
    renderPanel();
    expect(screen.getByTestId("commander-cockpit-panel")).toBeInTheDocument();
  });

  it("with empty data → shows 'All clear' empty state (no cards rendered)", async () => {
    vi.mocked(cockpitApi.get).mockResolvedValue(makeData());
    renderPanel();
    // No cards visible when all slices are empty
    expect(screen.queryByTestId("cockpit-card-running")).not.toBeInTheDocument();
    // "All clear" renders immediately since active is derived from the shared data
    // (no async onActiveChange self-report — derived synchronously from query data).
    expect(await screen.findByText(/all clear/i)).toBeInTheDocument();
  });

  it("with running runs → the Running card renders with cockpit-card-running testid", async () => {
    const run = makeRunItem();
    const { queryClient } = renderPanel();
    // Pre-seed the cache so the component renders immediately without fetch
    queryClient.setQueryData(["cockpit", "comp-1"], makeData({ running: [run] }));
    // Re-render with seeded data
    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <CommanderCockpitPanel companyId="comp-1" onCollapse={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("cockpit-card-running")).toBeInTheDocument();
    expect(screen.getByText("Atlas")).toBeInTheDocument();
    unmount();
  });

  it("⚙ config popover can hide the running card", async () => {
    const run = makeRunItem();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["cockpit", "comp-1"], makeData({ running: [run] }));

    render(
      <QueryClientProvider client={queryClient}>
        <CommanderCockpitPanel companyId="comp-1" onCollapse={vi.fn()} />
      </QueryClientProvider>,
    );

    // Initially the card is present
    expect(screen.getByTestId("cockpit-card-running")).toBeInTheDocument();

    // Open config popover
    const configBtn = screen.getByRole("button", { name: /configure cockpit/i });
    fireEvent.click(configBtn);

    // Uncheck the "Running now" checkbox
    const checkbox = screen.getByRole("checkbox", { name: /running now/i });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);

    // After hiding, the Running card should not be rendered
    expect(screen.queryByTestId("cockpit-card-running")).not.toBeInTheDocument();
  });

  it("collapse button calls onCollapse", () => {
    const onCollapse = vi.fn();
    renderPanel(onCollapse);
    const collapseBtn = screen.getByRole("button", { name: /collapse cockpit/i });
    fireEvent.click(collapseBtn);
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
