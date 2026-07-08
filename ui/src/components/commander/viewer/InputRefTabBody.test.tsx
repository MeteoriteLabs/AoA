import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HubItemListRow } from "@/api/hub-items";
import { TabBodySwitch } from "./CommanderViewerPanel";
import type { ViewerTab } from "./commanderViewerModel";

vi.mock("@/pages/ThreadDetail", () => ({
  ThreadDetail: ({
    discussionId,
    companyId,
    embedded,
  }: {
    discussionId?: string;
    companyId?: string;
    embedded?: boolean;
  }) => (
    <div
      data-testid="thread-detail-mock"
      data-discussion-id={discussionId}
      data-company-id={companyId}
      data-embedded={String(embedded)}
    />
  ),
}));

vi.mock("@/components/approval/ApprovalDetailCore", () => ({
  ApprovalDetailCore: ({
    approvalId,
    embedded,
  }: {
    approvalId: string;
    embedded?: boolean;
  }) => (
    <div
      data-testid="approval-detail-mock"
      data-approval-id={approvalId}
      data-embedded={String(embedded)}
    />
  ),
}));

vi.mock("@/api/hub-items", () => ({
  hubItemsApi: {
    getOne: vi.fn(async (): Promise<HubItemListRow> => ({
      id: "hub-1",
      companyId: "comp-1",
      semanticType: "run_complete",
      lane: "notifications",
      status: "open",
      priority: "normal",
      title: "Run complete",
      summary: "The run finished successfully.",
      sourceType: "heartbeat_run",
      sourceId: "run-1",
      ownerUserId: null,
      ownerPool: null,
      claimedByUserId: null,
      claimedAt: null,
      version: 1,
      createdAt: "2026-07-08T00:00:00.000Z",
      updatedAt: "2026-07-08T00:00:00.000Z",
      readAt: null,
      snoozedUntil: null,
      dismissedAt: null,
      groupKey: null,
      groupLabel: null,
      groupCount: null,
      scopeKey: null,
      slaAt: null,
    })),
  },
}));

function renderTab(activeTab: ViewerTab) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TabBodySwitch
        activeId={activeTab.id}
        activeTab={activeTab}
        companyId="comp-1"
        conversationRefs={[]}
        onOpen={vi.fn()}
        onCloseTab={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("Commander Viewer input-ref tab bodies", () => {
  it("renders discussion refs with embedded ThreadDetail", () => {
    renderTab({
      id: "discussion:disc-1",
      kind: "discussion",
      title: "Sprint planning",
      refId: "disc-1",
    });

    expect(screen.getByTestId("thread-detail-mock")).toHaveAttribute("data-discussion-id", "disc-1");
    expect(screen.getByTestId("thread-detail-mock")).toHaveAttribute("data-company-id", "comp-1");
    expect(screen.getByTestId("thread-detail-mock")).toHaveAttribute("data-embedded", "true");
  });

  it("renders approval refs with embedded ApprovalDetailCore", () => {
    renderTab({
      id: "approval:approval-1",
      kind: "approval",
      title: "Approve budget",
      refId: "approval-1",
    });

    expect(screen.getByTestId("approval-detail-mock")).toHaveAttribute("data-approval-id", "approval-1");
    expect(screen.getByTestId("approval-detail-mock")).toHaveAttribute("data-embedded", "true");
  });

  it("renders note refs as compact previews", () => {
    renderTab({
      id: "note:note-1",
      kind: "note",
      title: "Launch note",
      refId: "note-1",
      inputRef: {
        v: 1,
        kind: "note",
        id: "note-1",
        label: "Launch note",
        detail: "Remember to check QA.",
      },
    });

    expect(screen.getByText("Launch note")).toBeInTheDocument();
    expect(screen.getByText("Remember to check QA.")).toBeInTheDocument();
  });

  it("renders inbox refs from the hub item API", async () => {
    renderTab({
      id: "inbox:hub-1",
      kind: "inbox",
      title: "Run complete",
      refId: "hub-1",
      inputRef: {
        v: 1,
        kind: "inbox",
        id: "hub-1",
        label: "Run complete",
        detail: "Fallback detail",
      },
    });

    expect(await screen.findByText("Run complete")).toBeInTheDocument();
    expect(screen.getByText("The run finished successfully.")).toBeInTheDocument();
  });
});
