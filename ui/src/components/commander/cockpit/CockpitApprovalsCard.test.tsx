/**
 * CockpitApprovalsCard + useCockpitApprovalAction tests — Phase 3c.
 *
 * Verifies:
 *   - Card renders items for all 3 sources with correct source chip labels.
 *   - Approve on source="approval"        → approvalsApi.approve called (HC7).
 *   - Approve on source="memory"          → memoryApi.approve called (HC7).
 *   - Approve on source="discussion_item" → discussionsApi.approveItems with { items:[{itemId, action}] } (HC7).
 *   - Deny on source="approval"           → approvalsApi.reject called.
 *   - Deny on source="memory"             → memoryApi.reject called.
 *   - Deny on source="discussion_item"    → discussionsApi.rejectItems with [itemId] array (HC4).
 *   - Card returns null when items is [].
 *   - data-testid="cockpit-card-approvals" is present.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CockpitApprovalItem } from "@armyofagents/shared";

// ── Mock API clients (HC7) — vi.hoisted to avoid TDZ with vi.mock factories ──

const mockApprovalsApprove = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockApprovalsReject = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockMemoryApprove = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockMemoryReject = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockDiscussionsApproveItems = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockDiscussionsRejectItems = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock("../../../api/approvals", () => ({
  approvalsApi: {
    approve: mockApprovalsApprove,
    reject: mockApprovalsReject,
  },
}));

vi.mock("../../../api/memory", () => ({
  memoryApi: {
    approve: mockMemoryApprove,
    reject: mockMemoryReject,
  },
}));

vi.mock("../../../api/discussions", () => ({
  discussionsApi: {
    approveItems: mockDiscussionsApproveItems,
    rejectItems: mockDiscussionsRejectItems,
  },
}));

// Mock queryKeys — need cockpit + source-specific keys
vi.mock("../../../lib/queryKeys", () => ({
  queryKeys: {
    cockpit: (companyId: string) => ["cockpit", companyId],
    approvals: {
      list: (companyId: string) => ["approvals", companyId],
    },
    memory: {
      pending: (companyId: string) => ["memory", companyId, "pending"],
      list: (companyId: string) => ["memory", companyId],
    },
    discussions: {
      list: (companyId: string) => ["discussions", companyId],
      detail: (companyId: string, id: string) => ["discussions", companyId, id],
    },
  },
}));

// Mock ToastContext
vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

// ── Import component under test ───────────────────────────────────────────────

import { CockpitApprovalsCard } from "./CockpitApprovalsCard";

// ── Helpers ───────────────────────────────────────────────────────────────────

const COMPANY = "comp-test";

function makeApprovalItem(overrides?: Partial<CockpitApprovalItem>): CockpitApprovalItem {
  return {
    source: "approval",
    id: "appr-1",
    title: "Hire Scout",
    subtitle: "agent hire",
    ...overrides,
  };
}

function renderCard(items: CockpitApprovalItem[], onOpenFullPage = vi.fn(), onAsk = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CockpitApprovalsCard
        items={items}
        companyId={COMPANY}
        onOpenFullPage={onOpenFullPage}
        onAsk={onAsk}
      />
    </QueryClientProvider>,
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockApprovalsApprove.mockResolvedValue({});
  mockApprovalsReject.mockResolvedValue({});
  mockMemoryApprove.mockResolvedValue({});
  mockMemoryReject.mockResolvedValue({});
  mockDiscussionsApproveItems.mockResolvedValue({});
  mockDiscussionsRejectItems.mockResolvedValue({});
});

// ── Tests: card render ────────────────────────────────────────────────────────

describe("CockpitApprovalsCard — render", () => {
  it("renders null when items is empty", () => {
    const { container } = renderCard([]);
    expect(container.firstChild).toBeNull();
  });

  it("has data-testid='cockpit-card-approvals' when items present", () => {
    renderCard([makeApprovalItem()]);
    expect(screen.getByTestId("cockpit-card-approvals")).toBeInTheDocument();
  });

  it("renders an 'approval' source item with 'Approval' chip", () => {
    renderCard([makeApprovalItem({ source: "approval", title: "Hire Scout" })]);
    expect(screen.getByText("Hire Scout")).toBeInTheDocument();
    expect(screen.getByText("Approval")).toBeInTheDocument();
  });

  it("renders a 'memory' source item with 'Memory' chip", () => {
    renderCard([makeApprovalItem({ source: "memory", id: "mem-1", title: "Use TypeScript", subtitle: "domain" })]);
    expect(screen.getByText("Use TypeScript")).toBeInTheDocument();
    expect(screen.getByText("Memory")).toBeInTheDocument();
  });

  it("renders a 'discussion_item' source item with 'Discussion' chip", () => {
    renderCard([
      makeApprovalItem({
        source: "discussion_item",
        id: "item-1",
        discussionId: "disc-1",
        title: "CI task",
        subtitle: "task",
      }),
    ]);
    expect(screen.getByText("CI task")).toBeInTheDocument();
    expect(screen.getByText("Discussion")).toBeInTheDocument();
  });

  it("renders count in header", () => {
    renderCard([makeApprovalItem(), makeApprovalItem({ id: "appr-2", title: "Hire Atlas" })]);
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

// ── Tests: Approve dispatches correct API per source (HC7) ───────────────────

describe("CockpitApprovalsCard — Approve (HC7)", () => {
  it("source=approval → approvalsApi.approve(id)", async () => {
    renderCard([makeApprovalItem({ source: "approval", id: "appr-1" })]);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(mockApprovalsApprove).toHaveBeenCalledWith("appr-1"));
    expect(mockMemoryApprove).not.toHaveBeenCalled();
    expect(mockDiscussionsApproveItems).not.toHaveBeenCalled();
  });

  it("source=memory → memoryApi.approve(companyId, id)", async () => {
    renderCard([
      makeApprovalItem({ source: "memory", id: "mem-1", title: "Domain rule", subtitle: "domain" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(mockMemoryApprove).toHaveBeenCalledWith(COMPANY, "mem-1"));
    expect(mockApprovalsApprove).not.toHaveBeenCalled();
    expect(mockDiscussionsApproveItems).not.toHaveBeenCalled();
  });

  it("source=discussion_item → discussionsApi.approveItems with { items:[{itemId, action:'approved'}] } (HC7)", async () => {
    renderCard([
      makeApprovalItem({
        source: "discussion_item",
        id: "item-1",
        discussionId: "disc-1",
        title: "New task",
        subtitle: "task",
      }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() =>
      expect(mockDiscussionsApproveItems).toHaveBeenCalledWith(
        COMPANY,
        "disc-1",
        { items: [{ itemId: "item-1", action: "approved" }] },
      ),
    );
    expect(mockApprovalsApprove).not.toHaveBeenCalled();
    expect(mockMemoryApprove).not.toHaveBeenCalled();
  });
});

// ── Tests: Deny dispatches correct API per source (HC7/HC4) ──────────────────

describe("CockpitApprovalsCard — Deny (HC7/HC4)", () => {
  it("source=approval → approvalsApi.reject(id)", async () => {
    renderCard([makeApprovalItem({ source: "approval", id: "appr-1" })]);
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));
    await waitFor(() => expect(mockApprovalsReject).toHaveBeenCalledWith("appr-1"));
    expect(mockMemoryReject).not.toHaveBeenCalled();
    expect(mockDiscussionsRejectItems).not.toHaveBeenCalled();
  });

  it("source=memory → memoryApi.reject(companyId, id)", async () => {
    renderCard([
      makeApprovalItem({ source: "memory", id: "mem-1", title: "Domain rule", subtitle: "domain" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));
    await waitFor(() => expect(mockMemoryReject).toHaveBeenCalledWith(COMPANY, "mem-1"));
    expect(mockApprovalsReject).not.toHaveBeenCalled();
    expect(mockDiscussionsRejectItems).not.toHaveBeenCalled();
  });

  it("source=discussion_item → discussionsApi.rejectItems with [itemId] ARRAY (HC4)", async () => {
    renderCard([
      makeApprovalItem({
        source: "discussion_item",
        id: "item-1",
        discussionId: "disc-1",
        title: "New task",
        subtitle: "task",
      }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));
    await waitFor(() =>
      expect(mockDiscussionsRejectItems).toHaveBeenCalledWith(
        COMPANY,
        "disc-1",
        ["item-1"], // HC4: itemIds array, not an object
      ),
    );
    expect(mockApprovalsReject).not.toHaveBeenCalled();
    expect(mockMemoryReject).not.toHaveBeenCalled();
  });
});

// ── Tests: card inactive when empty ──────────────────────────────────────────

describe("CockpitApprovalsCard — empty state", () => {
  it("card absent (null) when approvals=[]", () => {
    const { container } = renderCard([]);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("cockpit-card-approvals")).not.toBeInTheDocument();
  });
});
