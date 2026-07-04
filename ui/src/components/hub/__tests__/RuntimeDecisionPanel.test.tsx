import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RuntimeDecisionDetail } from "@armyofagents/shared";
import { RuntimeDecisionPanel } from "../RuntimeDecisionPanel";
import type { HubItemListRow } from "@/api/hub-items";

// Mock the runtime-decisions api so the panel's detail query resolves to a
// deterministic permission decision without hitting the network.
const detailSpy = vi.fn();
const answerSpy = vi.fn();
vi.mock("@/api/agent-runtime-decisions", () => ({
  agentRuntimeDecisionsApi: {
    detail: (...args: unknown[]) => detailSpy(...args),
    answer: (...args: unknown[]) => answerSpy(...args),
  },
}));

function permissionDetail(overrides: Partial<RuntimeDecisionDetail> = {}): RuntimeDecisionDetail {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    hubItemId: "00000000-0000-0000-0000-0000000000a1",
    companyId: "00000000-0000-0000-0000-0000000000c1",
    agentId: "00000000-0000-0000-0000-0000000000b1",
    runId: "00000000-0000-0000-0000-0000000000d1",
    adapterType: "claude_local",
    adapterSessionId: null,
    kind: "permission",
    status: "shown",
    sourceRevision: 3,
    nonce: "nonce-abc",
    title: "Allow command?",
    summary: "Run the test suite",
    promptText: "pnpm test:run",
    toolName: "shell",
    command: "pnpm test:run",
    cwd: "C:/repo",
    path: null,
    networkTarget: null,
    riskClass: "medium",
    options: null,
    timeoutPolicy: "deny",
    expiresAt: null,
    answeredAt: null,
    relayedAt: null,
    relayError: null,
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

function runtimeDecisionItem(overrides: Partial<HubItemListRow> = {}): HubItemListRow {
  return {
    id: "hub-runtime-1",
    companyId: "company-1",
    semanticType: "agent_runtime_decision",
    lane: "waiting_on_you",
    status: "open",
    priority: "normal",
    title: "Runtime decision",
    summary: null,
    sourceType: "agent_runtime_decision",
    sourceId: "decision-1",
    ownerUserId: null,
    ownerPool: "board",
    claimedByUserId: null,
    claimedAt: null,
    version: 0,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    readAt: null,
    snoozedUntil: null,
    dismissedAt: null,
    groupKey: null,
    groupLabel: null,
    groupCount: null,
    scopeKey: null,
    slaAt: null,
    ...overrides,
  };
}

function renderPanel(item: HubItemListRow) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RuntimeDecisionPanel item={item} />
    </QueryClientProvider>,
  );
}

describe("RuntimeDecisionPanel", () => {
  beforeEach(() => {
    detailSpy.mockReset();
    answerSpy.mockReset();
  });

  it("renders the allow/deny controls and decision facts for a permission decision", async () => {
    detailSpy.mockResolvedValueOnce(permissionDetail());
    renderPanel(runtimeDecisionItem());

    // Allow/deny permission controls render once the detail resolves.
    expect(await screen.findByRole("button", { name: /allow once/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /allow always/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^deny$/i })).toBeInTheDocument();

    // Facts render from the detail (tool + command + risk).
    expect(screen.getByText("Tool")).toBeInTheDocument();
    expect(screen.getByText("shell")).toBeInTheDocument();
    expect(screen.getByText("Command")).toBeInTheDocument();
    expect(screen.getByText("Risk")).toBeInTheDocument();
    expect(screen.getByText("medium")).toBeInTheDocument();

    // Status label humanizes underscores.
    expect(screen.getByText("shown")).toBeInTheDocument();
  });

  it("renders a work-question answer box for a work_question decision", async () => {
    detailSpy.mockResolvedValueOnce(permissionDetail({ kind: "work_question" }));
    renderPanel(runtimeDecisionItem());

    expect(await screen.findByLabelText(/work question answer/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send answer/i })).toBeInTheDocument();
  });

  it("renders option buttons and posts {answer:{value}} for a work_question with options", async () => {
    const { fireEvent } = await import("@testing-library/react");
    detailSpy.mockResolvedValueOnce(
      permissionDetail({
        kind: "work_question",
        options: [
          { label: "Approve", value: "approve" },
          { label: "Hold", value: "hold" },
        ] as any,
      }),
    );
    answerSpy.mockResolvedValueOnce(permissionDetail({ kind: "work_question" }));
    renderPanel(runtimeDecisionItem());

    const approve = await screen.findByRole("button", { name: /approve/i });
    expect(screen.getByRole("button", { name: /hold/i })).toBeInTheDocument();
    // No free-text box when options are present.
    expect(screen.queryByLabelText(/work question answer/i)).not.toBeInTheDocument();

    fireEvent.click(approve);
    await waitFor(() => expect(answerSpy).toHaveBeenCalledTimes(1));
    const payload = answerSpy.mock.calls[0][2];
    expect(payload).toMatchObject({ kind: "work_question", answer: { value: "approve" } });
  });

  it("still renders the free-text box when a work_question has no options", async () => {
    detailSpy.mockResolvedValueOnce(permissionDetail({ kind: "work_question", options: null }));
    renderPanel(runtimeDecisionItem());
    expect(await screen.findByLabelText(/work question answer/i)).toBeInTheDocument();
  });

  it("shows an unavailable message when the item has no source id", () => {
    renderPanel(runtimeDecisionItem({ sourceId: null }));
    expect(screen.getByText(/runtime decision source is unavailable/i)).toBeInTheDocument();
    // No detail fetch when there's no decision id.
    expect(detailSpy).not.toHaveBeenCalled();
  });

  it("surfaces a details-unavailable message when the detail query errors", async () => {
    detailSpy.mockRejectedValueOnce(new Error("boom"));
    renderPanel(runtimeDecisionItem());
    await waitFor(() =>
      expect(screen.getByText(/decision details unavailable/i)).toBeInTheDocument(),
    );
  });
});
