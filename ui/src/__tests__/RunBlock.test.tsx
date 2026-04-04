import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { RunBlock } from "../components/workspace/RunBlock";
import type { RunForIssue } from "../api/activity";

// ─── Mock data ───────────────────────────────────────────────────────────────

const completedRun: RunForIssue = {
  runId: "run-001",
  status: "succeeded",
  agentId: "agent-1",
  startedAt: "2026-04-01T10:00:00Z",
  finishedAt: "2026-04-01T10:05:00Z",
  createdAt: "2026-04-01T10:00:00Z",
  invocationSource: "on_demand",
  usageJson: null,
  resultJson: null,
};

const runningRun: RunForIssue = {
  runId: "run-002",
  status: "running",
  agentId: "agent-1",
  startedAt: "2026-04-01T10:10:00Z",
  finishedAt: null,
  createdAt: "2026-04-01T10:10:00Z",
  invocationSource: "on_demand",
  usageJson: null,
  resultJson: null,
};

const failedRun: RunForIssue = {
  runId: "run-003",
  status: "failed",
  agentId: "agent-1",
  startedAt: "2026-04-01T10:15:00Z",
  finishedAt: "2026-04-01T10:16:00Z",
  createdAt: "2026-04-01T10:15:00Z",
  invocationSource: "on_demand",
  usageJson: null,
  resultJson: null,
};

// ─── API Mocks ───────────────────────────────────────────────────────────────

const heartbeatsApiMock = {
  log: vi.fn().mockResolvedValue({ runId: "run-001", store: "file", logRef: "", content: "Build succeeded\nAll tests passed" }),
};

vi.mock("../api/heartbeats", () => ({
  heartbeatsApi: new Proxy(
    {},
    { get: (_t, prop) => (heartbeatsApiMock as any)[prop] },
  ),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderRunBlock(run: RunForIssue, props: Partial<React.ComponentProps<typeof RunBlock>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RunBlock
          run={run}
          agentName="Alpha Agent"
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  heartbeatsApiMock.log.mockResolvedValue({
    runId: "run-001",
    store: "file",
    logRef: "",
    content: "Build succeeded\nAll tests passed",
  });
});

describe("RunBlock", () => {
  it("renders collapsed summary by default for non-latest runs", async () => {
    renderRunBlock(completedRun, { isLatest: false });

    expect(screen.getByTestId(`run-block-${completedRun.runId}`)).toBeInTheDocument();
    expect(screen.getByText("Alpha Agent")).toBeInTheDocument();
    // Output should not be visible when collapsed
    expect(screen.queryByTestId(`run-block-output-${completedRun.runId}`)).not.toBeInTheDocument();
  });

  it("expands to show output when clicked", async () => {
    renderRunBlock(completedRun, { isLatest: false });

    // Click to expand
    fireEvent.click(screen.getByTestId(`run-block-toggle-${completedRun.runId}`));

    await waitFor(() => {
      expect(screen.getByTestId(`run-block-output-${completedRun.runId}`)).toBeInTheDocument();
    });

    // Log content rendered in a <pre> — wait for async query to resolve
    await waitFor(() => {
      expect(screen.getByText(/Build succeeded/)).toBeInTheDocument();
    });
  });

  it("shows spinner icon for running status", () => {
    renderRunBlock(runningRun, { isLatest: true });

    // The running run should be auto-expanded (isLatest=true)
    expect(screen.getByTestId(`run-block-output-${runningRun.runId}`)).toBeInTheDocument();
  });

  it("auto-expands the latest run", async () => {
    renderRunBlock(completedRun, { isLatest: true });

    await waitFor(() => {
      expect(screen.getByTestId(`run-block-output-${completedRun.runId}`)).toBeInTheDocument();
    });
  });

  it("shows status badge with correct status", () => {
    renderRunBlock(failedRun, { isLatest: false });
    // The run ID truncated should be visible
    expect(screen.getByText(`Run ${failedRun.runId.slice(0, 6)}`)).toBeInTheDocument();
  });

  it("collapses when clicking expanded run", async () => {
    renderRunBlock(completedRun, { isLatest: true });

    await waitFor(() => {
      expect(screen.getByTestId(`run-block-output-${completedRun.runId}`)).toBeInTheDocument();
    });

    // Click to collapse
    fireEvent.click(screen.getByTestId(`run-block-toggle-${completedRun.runId}`));

    expect(screen.queryByTestId(`run-block-output-${completedRun.runId}`)).not.toBeInTheDocument();
  });
});
