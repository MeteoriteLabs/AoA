import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
});

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
    vi.mocked(hubItemsApi.list).mockResolvedValue([
      {
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
        version: 1,
        createdAt: "2026-06-29T10:00:00.000Z",
        updatedAt: "2026-06-29T10:00:00.000Z",
        readAt: null,
        snoozedUntil: null,
        dismissedAt: null,
      },
    ]);

    renderPage("/P4/inbox-hub/waiting");

    const row = await screen.findByRole("button", { name: /approve deployment/i });
    fireEvent.click(row);
    fireEvent.click(row);

    await waitFor(() => {
      expect(hubItemsApi.markRead).toHaveBeenCalledTimes(1);
    });
  });
});
