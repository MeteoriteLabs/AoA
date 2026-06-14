import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LiveRunForIssue } from "../../../api/heartbeats";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Mock heartbeats API so no real fetch occurs
vi.mock("../../../api/heartbeats", () => ({
  heartbeatsApi: {
    liveRunsForCompany: vi.fn().mockResolvedValue([]),
  },
}));

// Mock queryKeys so the import chain doesn't need the full app context
vi.mock("../../../lib/queryKeys", () => ({
  queryKeys: {
    liveRuns: (companyId: string) => ["live-runs", companyId],
  },
}));

import { heartbeatsApi } from "../../../api/heartbeats";
import { CommanderCockpitPanel } from "./CommanderCockpitPanel";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRun(overrides?: Partial<LiveRunForIssue>): LiveRunForIssue {
  return {
    id: "run-1",
    status: "running",
    startedAt: null,
    finishedAt: null,
    createdAt: new Date().toISOString(),
    agentId: "agent-1",
    agentName: "Atlas",
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
    vi.mocked(heartbeatsApi.liveRunsForCompany).mockResolvedValue([]);
  });

  it("renders with data-testid='commander-cockpit-panel'", async () => {
    renderPanel();
    expect(screen.getByTestId("commander-cockpit-panel")).toBeInTheDocument();
  });

  it("with no runs → shows 'All clear' empty state (no cockpit-card-running)", async () => {
    vi.mocked(heartbeatsApi.liveRunsForCompany).mockResolvedValue([]);
    renderPanel();
    // The Running card returns null when empty — should not be present
    expect(screen.queryByTestId("cockpit-card-running")).not.toBeInTheDocument();
    // The "All clear" empty state renders once the card self-reports inactive (effect settles).
    expect(await screen.findByText(/all clear/i)).toBeInTheDocument();
  });

  it("with running runs → the Running card renders with cockpit-card-running testid", async () => {
    const run = makeRun({ status: "running", agentName: "Atlas" });
    vi.mocked(heartbeatsApi.liveRunsForCompany).mockResolvedValue([run]);

    const { queryClient } = renderPanel();
    // Pre-seed the cache so the component renders immediately without fetch
    queryClient.setQueryData(["live-runs", "comp-1"], [run]);
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
    const run = makeRun({ status: "running", agentName: "Atlas" });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(["live-runs", "comp-1"], [run]);

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
