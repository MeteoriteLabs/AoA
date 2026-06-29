import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { hubItemsApi } from "@/api/hub-items";
import { InboxHub } from "../pages/InboxHub";

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", name: "Test Co", issuePrefix: "P4" },
  }),
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("@/api/hub-items", () => ({
  hubItemsApi: {
    list: vi.fn().mockResolvedValue([]),
    counts: vi.fn().mockResolvedValue({ open: 0, unread: 0 }),
    markRead: vi.fn().mockResolvedValue({}),
    markUnread: vi.fn().mockResolvedValue({}),
    snooze: vi.fn().mockResolvedValue({}),
    unsnooze: vi.fn().mockResolvedValue({}),
    dismiss: vi.fn().mockResolvedValue({}),
    undismiss: vi.fn().mockResolvedValue({}),
    act: vi.fn().mockResolvedValue({
      item: { id: "hub-1", status: "resolved", version: 2 },
      auditId: "audit-1",
      undoDeadline: "2026-06-29T00:00:08.000Z",
    }),
    undo: vi.fn().mockResolvedValue({
      item: { id: "hub-1", status: "open", version: 1 },
      auditId: "undo-audit-1",
    }),
    bulkAction: vi.fn().mockResolvedValue({
      bulkId: "bulk-1",
      summary: { succeeded: 2, failed: 0, skipped: 0 },
      results: [],
    }),
    audit: vi.fn().mockResolvedValue([]),
  },
}));

function renderPage(initialEntry: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/:companyPrefix/inbox-hub" element={<InboxHub />} />
          <Route path="/:companyPrefix/inbox-hub/:lane" element={<InboxHub />} />
          <Route path="/:companyPrefix/inbox-hub/:lane/:itemId" element={<InboxHub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hubItemsApi.list).mockResolvedValue([]);
  vi.mocked(hubItemsApi.counts).mockResolvedValue({ open: 0, unread: 0 });
  vi.mocked(hubItemsApi.markRead).mockResolvedValue({});
  vi.mocked(hubItemsApi.markUnread).mockResolvedValue({});
  vi.mocked(hubItemsApi.snooze).mockResolvedValue({});
  vi.mocked(hubItemsApi.unsnooze).mockResolvedValue({});
  vi.mocked(hubItemsApi.dismiss).mockResolvedValue({});
  vi.mocked(hubItemsApi.undismiss).mockResolvedValue({});
  vi.mocked(hubItemsApi.act).mockResolvedValue({
    item: { id: "hub-1", status: "resolved", version: 2 },
    auditId: "audit-1",
    undoDeadline: "2026-06-29T00:00:08.000Z",
  } as never);
  vi.mocked(hubItemsApi.undo).mockResolvedValue({
    item: { id: "hub-1", status: "open", version: 1 },
    auditId: "undo-audit-1",
  } as never);
  vi.mocked(hubItemsApi.bulkAction).mockResolvedValue({
    bulkId: "bulk-1",
    summary: { succeeded: 2, failed: 0, skipped: 0 },
    results: [],
  });
  vi.mocked(hubItemsApi.audit).mockResolvedValue([]);
});

function hubItem(overrides: Partial<Awaited<ReturnType<typeof hubItemsApi.list>>[number]> = {}) {
  return {
    id: "hub-1",
    companyId: "company-1",
    semanticType: "approval_request",
    lane: "waiting_on_you",
    status: "open",
    priority: "normal",
    title: "Approve deployment",
    summary: "Needs your decision",
    sourceType: "approval",
    sourceId: "approval-1",
    ownerUserId: null,
    ownerPool: null,
    claimedByUserId: null,
    claimedAt: null,
    version: 1,
    createdAt: "2026-06-29T10:00:00.000Z",
    updatedAt: "2026-06-29T10:00:00.000Z",
    readAt: null,
    snoozedUntil: null,
    dismissedAt: null,
    ...overrides,
  } as Awaited<ReturnType<typeof hubItemsApi.list>>[number];
}

describe("InboxHub page", () => {
  it("renders Home by default", async () => {
    renderPage("/P4/inbox-hub");

    expect(await screen.findByText(/Autopilot/i)).toBeInTheDocument();
  });

  it("maps the waiting slug to the waiting_on_you API lane with the preview limit", async () => {
    renderPage("/P4/inbox-hub/waiting");

    await screen.findByRole("navigation", { name: /hub lanes/i });
    await waitFor(() => {
      expect(vi.mocked(hubItemsApi.list)).toHaveBeenCalledWith("company-1", {
        lane: "waiting_on_you",
        status: "open",
        limit: 50,
      });
    });
  });

  it("marks an unread row read only once even if it is clicked repeatedly", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue([hubItem()]);

    renderPage("/P4/inbox-hub/waiting");

    const row = await screen.findByRole("button", { name: /approve deployment/i });
    fireEvent.click(row);
    fireEvent.click(row);

    await waitFor(() => {
      expect(hubItemsApi.markRead).toHaveBeenCalledTimes(1);
    });
  });

  it("viewer can mark a selected read item unread", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue([
      hubItem({ readAt: "2026-06-29T10:01:00.000Z" }),
    ]);

    renderPage("/P4/inbox-hub/waiting/hub-1");

    fireEvent.click(await screen.findByRole("button", { name: /mark unread/i }));

    await waitFor(() => {
      expect(hubItemsApi.markUnread).toHaveBeenCalledWith("company-1", "hub-1");
    });
  });

  it("viewer can dismiss and snooze the selected item", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue([hubItem()]);

    renderPage("/P4/inbox-hub/waiting/hub-1");

    fireEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
    fireEvent.click(await screen.findByRole("button", { name: /snooze/i }));

    await waitFor(() => {
      expect(hubItemsApi.dismiss).toHaveBeenCalledWith("company-1", "hub-1");
      expect(hubItemsApi.snooze).toHaveBeenCalledWith(
        "company-1",
        "hub-1",
        expect.stringMatching(/T/),
      );
    });
  });

  it("viewer can undo personal dismiss and snooze actions", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue([hubItem()]);

    renderPage("/P4/inbox-hub/waiting/hub-1");

    fireEvent.click(await screen.findByRole("button", { name: /dismiss/i }));
    fireEvent.click(await screen.findByRole("button", { name: /undo dismiss/i }));
    fireEvent.click(await screen.findByRole("button", { name: /snooze/i }));
    fireEvent.click(await screen.findByRole("button", { name: /undo snooze/i }));

    await waitFor(() => {
      expect(hubItemsApi.undismiss).toHaveBeenCalledWith("company-1", "hub-1");
      expect(hubItemsApi.unsnooze).toHaveBeenCalledWith("company-1", "hub-1");
    });
  });

  it("viewer resolves an item and can undo the server-backed action", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue([hubItem()]);

    renderPage("/P4/inbox-hub/waiting/hub-1");

    fireEvent.click(await screen.findByRole("button", { name: /^resolve$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /undo resolve/i }));

    await waitFor(() => {
      expect(hubItemsApi.act).toHaveBeenCalledWith("company-1", "hub-1", {
        action: "resolve",
        expectedVersion: 1,
      });
      expect(hubItemsApi.undo).toHaveBeenCalledWith("company-1", "hub-1", {
        auditId: "audit-1",
        expectedVersion: 2,
      });
    });
  });

  it("viewer shows claim and release actions for board-pool items", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue([
      hubItem({ semanticType: "stale_work", lane: "suggestions", ownerPool: "board" }),
    ]);

    renderPage("/P4/inbox-hub/suggestions/hub-1");

    fireEvent.click(await screen.findByRole("button", { name: /^claim$/i }));

    await waitFor(() => {
      expect(hubItemsApi.act).toHaveBeenCalledWith("company-1", "hub-1", {
        action: "claim",
        expectedVersion: 1,
      });
    });
  });

  it("history controls request resolved and archived items inside the active lane", async () => {
    renderPage("/P4/inbox-hub/waiting");

    fireEvent.click(await screen.findByRole("button", { name: /^resolved$/i }));

    await waitFor(() => {
      expect(hubItemsApi.list).toHaveBeenLastCalledWith("company-1", {
        lane: "waiting_on_you",
        status: "resolved",
        limit: 50,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /^archived$/i }));

    await waitFor(() => {
      expect(hubItemsApi.list).toHaveBeenLastCalledWith("company-1", {
        lane: "waiting_on_you",
        status: "archived",
        limit: 50,
      });
    });
  });

  it("opens resolved and archived history items in the viewer", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue([
      hubItem({
        id: "history-1",
        status: "resolved",
        title: "Resolved approval",
        readAt: "2026-06-29T10:01:00.000Z",
      }),
    ]);

    renderPage("/P4/inbox-hub/waiting/history-1");
    fireEvent.click(await screen.findByRole("button", { name: /^resolved$/i }));

    expect(await screen.findByRole("heading", { name: /resolved approval/i })).toBeInTheDocument();
  });

  it("loads an audit timeline for the selected history item", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue([
      hubItem({
        id: "history-1",
        status: "archived",
        title: "Archived notification",
        readAt: "2026-06-29T10:01:00.000Z",
      }),
    ]);
    vi.mocked(hubItemsApi.audit).mockResolvedValue([
      {
        id: "audit-1",
        companyId: "company-1",
        hubItemId: "history-1",
        actorType: "user",
        actorId: "user-1",
        action: "archive",
        authorityBasis: "founder",
        reason: "No longer needed",
        undoDeadline: null,
        createdAt: "2026-06-29T10:03:00.000Z",
      },
    ]);

    renderPage("/P4/inbox-hub/waiting/history-1");
    fireEvent.click(await screen.findByRole("button", { name: /^archived$/i }));

    await waitFor(() => {
      expect(hubItemsApi.audit).toHaveBeenCalledWith("company-1", "history-1");
    });
    const auditTimeline = await screen.findByRole("region", { name: /audit timeline/i });
    expect(within(auditTimeline).getByText(/^archive$/i)).toBeInTheDocument();
    expect(within(auditTimeline).getByText(/No longer needed/i)).toBeInTheDocument();
    expect(within(auditTimeline).getByText(/user-1/i)).toBeInTheDocument();
  });

  it("bulk archives selected open items with optimistic versions", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue([
      hubItem({ id: "hub-1", title: "First approval", version: 1 }),
      hubItem({ id: "hub-2", title: "Second approval", version: 3 }),
    ]);

    renderPage("/P4/inbox-hub/waiting");

    fireEvent.click(await screen.findByRole("checkbox", { name: /select first approval/i }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /select second approval/i }));
    fireEvent.click(await screen.findByRole("button", { name: /archive selected/i }));

    await waitFor(() => {
      expect(hubItemsApi.bulkAction).toHaveBeenCalledWith("company-1", {
        items: [
          { id: "hub-1", action: "archive", expectedVersion: 1 },
          { id: "hub-2", action: "archive", expectedVersion: 3 },
        ],
      });
    });
  });

  it("bulk dismisses selected open items as personal state", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue([
      hubItem({ id: "hub-1", title: "Dismiss one" }),
      hubItem({ id: "hub-2", title: "Dismiss two" }),
    ]);

    renderPage("/P4/inbox-hub/waiting");

    fireEvent.click(await screen.findByRole("checkbox", { name: /select dismiss one/i }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /select dismiss two/i }));
    fireEvent.click(await screen.findByRole("button", { name: /dismiss selected/i }));

    await waitFor(() => {
      expect(hubItemsApi.bulkAction).toHaveBeenCalledWith("company-1", {
        items: [
          { id: "hub-1", action: "dismiss" },
          { id: "hub-2", action: "dismiss" },
        ],
      });
    });
  });

  it("shows a compact bulk result summary when one selected item fails", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue([
      hubItem({ id: "hub-1", title: "Fresh item", version: 1 }),
      hubItem({ id: "hub-2", title: "Changed item", version: 1 }),
    ]);
    vi.mocked(hubItemsApi.bulkAction).mockResolvedValue({
      bulkId: "bulk-partial",
      summary: { succeeded: 1, failed: 1, skipped: 0 },
      results: [
        { id: "hub-1", status: "success" },
        { id: "hub-2", status: "failed", error: { status: 409, message: "Changed elsewhere" } },
      ],
    });

    renderPage("/P4/inbox-hub/waiting");

    fireEvent.click(await screen.findByRole("checkbox", { name: /select fresh item/i }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /select changed item/i }));
    fireEvent.click(await screen.findByRole("button", { name: /archive selected/i }));

    expect(await screen.findByText(/1 succeeded, 1 failed/i)).toBeInTheDocument();
  });
});
