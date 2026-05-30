import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CrewTaskAuditCard } from "../CrewTaskAuditCard";
import type { RunForIssue } from "../../../api/activity";

/* ── Mocks ── */

// activityApi must be mocked before imports are resolved. The mock factory
// captures the spy reference so each test can control the resolved value.
const runsForIssueSpy = vi.fn<[string], Promise<RunForIssue[]>>();

vi.mock("../../../api/activity", () => ({
  activityApi: {
    runsForIssue: (...args: [string]) => runsForIssueSpy(...args),
  },
}));

// Stub router Link used transitively by components inside the sheet
vi.mock("@/lib/router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));

/* ── Helpers ── */

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderWithQuery(ui: React.ReactElement) {
  const client = makeQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const MOCK_ISSUE = {
  id: "issue-abc",
  title: "Build recommendation engine",
  identifier: "CREW-42",
  status: "in_progress",
} as const;

const MOCK_RUN: RunForIssue = {
  runId: "run-001",
  status: "succeeded",
  agentId: "agent-x",
  startedAt: "2026-05-30T10:00:00Z",
  finishedAt: "2026-05-30T10:02:30Z",
  createdAt: "2026-05-30T10:00:00Z",
  invocationSource: "issue_assigned",
  usageJson: {
    rawInputTokens: 8200,
    rawOutputTokens: 1500,
    rawCachedInputTokens: 3000,
  },
  resultJson: {
    summary: "Implemented the recommendation engine with collaborative filtering.",
    toolsCalled: ["Read", "Write", "Bash"],
    cost_usd: 0.024,
  },
  detectedOutputs: null,
};

/* ── Tests ── */

describe("CrewTaskAuditCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all audit sections with correct testids from mocked run data", async () => {
    runsForIssueSpy.mockResolvedValue([MOCK_RUN]);

    renderWithQuery(
      <CrewTaskAuditCard issue={MOCK_ISSUE} open={true} onOpenChange={vi.fn()} />,
    );

    // Wait for card to render (query must resolve first)
    await screen.findByTestId("crew-audit-card");

    // After data loads the loading indicator disappears
    await waitFor(() => {
      expect(screen.queryByTestId("crew-audit-loading")).not.toBeInTheDocument();
    });

    // Prompt context section
    const promptSection = screen.getByTestId("crew-audit-prompt");
    expect(promptSection).toBeInTheDocument();
    expect(promptSection.textContent).toContain("issue_assigned");

    // Tools section
    const toolsSection = screen.getByTestId("crew-audit-tools");
    expect(toolsSection).toBeInTheDocument();
    expect(toolsSection.textContent).toContain("Read");
    expect(toolsSection.textContent).toContain("Write");
    expect(toolsSection.textContent).toContain("Bash");

    // Cost section
    const costSection = screen.getByTestId("crew-audit-cost");
    expect(costSection).toBeInTheDocument();
    expect(costSection.textContent).toContain("8.2k"); // formatTokens(8200)
    expect(costSection.textContent).toContain("1.5k"); // formatTokens(1500)
    expect(costSection.textContent).toContain("0.0240"); // $0.0240

    // Outcome section
    const outcomeSection = screen.getByTestId("crew-audit-outcome");
    expect(outcomeSection).toBeInTheDocument();
    expect(outcomeSection.textContent).toContain("succeeded");
  });

  it("renders reasoning section when resultJson.summary is present", async () => {
    runsForIssueSpy.mockResolvedValue([MOCK_RUN]);

    renderWithQuery(
      <CrewTaskAuditCard issue={MOCK_ISSUE} open={true} onOpenChange={vi.fn()} />,
    );

    const reasoning = await screen.findByTestId("crew-audit-reasoning");
    expect(reasoning).toBeInTheDocument();
    expect(reasoning.textContent).toContain(
      "Implemented the recommendation engine",
    );
  });

  it("shows empty state when no runs exist", async () => {
    runsForIssueSpy.mockResolvedValue([]);

    renderWithQuery(
      <CrewTaskAuditCard issue={MOCK_ISSUE} open={true} onOpenChange={vi.fn()} />,
    );

    const empty = await screen.findByTestId("crew-audit-empty");
    expect(empty).toBeInTheDocument();
  });

  it("shows 'No tool calls recorded' when toolsCalled is absent", async () => {
    const runWithoutTools: RunForIssue = {
      ...MOCK_RUN,
      runId: "run-002",
      resultJson: { summary: "Done" },
    };
    runsForIssueSpy.mockResolvedValue([runWithoutTools]);

    renderWithQuery(
      <CrewTaskAuditCard issue={MOCK_ISSUE} open={true} onOpenChange={vi.fn()} />,
    );

    const toolsSection = await screen.findByTestId("crew-audit-tools");
    await waitFor(() =>
      expect(toolsSection.textContent).toContain("No tool calls recorded"),
    );
  });

  it("shows 'No usage data recorded' when usageJson is null", async () => {
    const runWithoutUsage: RunForIssue = {
      ...MOCK_RUN,
      runId: "run-003",
      usageJson: null,
      resultJson: null,
    };
    runsForIssueSpy.mockResolvedValue([runWithoutUsage]);

    renderWithQuery(
      <CrewTaskAuditCard issue={MOCK_ISSUE} open={true} onOpenChange={vi.fn()} />,
    );

    const costSection = await screen.findByTestId("crew-audit-cost");
    await waitFor(() =>
      expect(costSection.textContent).toContain("No usage data recorded"),
    );
  });

  it("does not fetch when open=false", () => {
    // When open is false the query is disabled — runsForIssue should not be called.
    renderWithQuery(
      <CrewTaskAuditCard issue={MOCK_ISSUE} open={false} onOpenChange={vi.fn()} />,
    );
    // Sheet is closed — portal not rendered
    expect(screen.queryByTestId("crew-audit-card")).not.toBeInTheDocument();
    expect(runsForIssueSpy).not.toHaveBeenCalled();
  });

  it("renders issue title and identifier in the sheet header", async () => {
    runsForIssueSpy.mockResolvedValue([MOCK_RUN]);

    renderWithQuery(
      <CrewTaskAuditCard issue={MOCK_ISSUE} open={true} onOpenChange={vi.fn()} />,
    );

    await screen.findByTestId("crew-audit-card");
    // SheetDescription shows identifier + title
    expect(document.body.textContent ?? "").toContain("CREW-42");
    expect(document.body.textContent ?? "").toContain(
      "Build recommendation engine",
    );
  });

  it("renders promptSnapshot in the prompt context section when present", async () => {
    const runWithSnapshot: RunForIssue = {
      ...MOCK_RUN,
      runId: "run-snap",
      promptSnapshot: "You are the Engineer agent.\n\n## Task\nBuild the engine.\n\n[redacted]",
    };
    runsForIssueSpy.mockResolvedValue([runWithSnapshot]);

    renderWithQuery(
      <CrewTaskAuditCard issue={MOCK_ISSUE} open={true} onOpenChange={vi.fn()} />,
    );

    const promptSection = await screen.findByTestId("crew-audit-prompt");

    // The snapshot text should appear inside the prompt section
    await waitFor(() => {
      expect(promptSection.textContent).toContain("You are the Engineer agent.");
      expect(promptSection.textContent).toContain("[redacted]");
    });

    // The "System prompt (redacted)" header should be visible
    expect(promptSection.textContent).toContain("System prompt (redacted)");

    // The invocationSource meta sub-line should still be present
    expect(promptSection.textContent).toContain("issue_assigned");

    // The "not captured" fallback should NOT appear
    expect(promptSection.textContent).not.toContain("Full prompt not captured");
  });

  it("shows 'Full prompt not captured' fallback when promptSnapshot is null", async () => {
    const runWithoutSnapshot: RunForIssue = {
      ...MOCK_RUN,
      runId: "run-no-snap",
      promptSnapshot: null,
    };
    runsForIssueSpy.mockResolvedValue([runWithoutSnapshot]);

    renderWithQuery(
      <CrewTaskAuditCard issue={MOCK_ISSUE} open={true} onOpenChange={vi.fn()} />,
    );

    const promptSection = await screen.findByTestId("crew-audit-prompt");

    // Fallback text must appear
    await waitFor(() => {
      expect(promptSection.textContent).toContain("Full prompt not captured for this run.");
    });

    // The invocationSource proxy should still be visible
    expect(promptSection.textContent).toContain("issue_assigned");

    // No "System prompt (redacted)" header
    expect(promptSection.textContent).not.toContain("System prompt (redacted)");
  });

  it("renders cached token count when present", async () => {
    runsForIssueSpy.mockResolvedValue([MOCK_RUN]);

    renderWithQuery(
      <CrewTaskAuditCard issue={MOCK_ISSUE} open={true} onOpenChange={vi.fn()} />,
    );

    const costSection = await screen.findByTestId("crew-audit-cost");
    // cachedInputTokens = 3000 → "3.0k cached"
    await waitFor(() =>
      expect(costSection.textContent).toContain("cached"),
    );
  });
});
