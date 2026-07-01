import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HubPreferences, NotificationPreferences } from "@armyofagents/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { hubItemsApi } from "@/api/hub-items";
import { InboxHub } from "../pages/InboxHub";

const mockPushToast = vi.hoisted(() => vi.fn());
const liveHubItemCallbacks = vi.hoisted(() => new Set<(itemId: string) => void>());

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", name: "Test Co", issuePrefix: "P4" },
  }),
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("@/context/LiveUpdatesProvider", () => ({
  useLiveUpdates: () => ({
    onHubItemChanged: (cb: (itemId: string) => void) => {
      liveHubItemCallbacks.add(cb);
      return () => liveHubItemCallbacks.delete(cb);
    },
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    pushToast: mockPushToast,
  }),
}));

vi.mock("@/api/hub-items", () => ({
  hubItemsApi: {
    list: vi.fn().mockResolvedValue({ items: [], nextCursor: null, totalKnown: null }),
    getOne: vi.fn().mockResolvedValue({}),
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
    getPreferences: vi.fn().mockResolvedValue(defaultPreferences()),
    updatePreferences: vi.fn().mockResolvedValue(defaultPreferences()),
    notificationPreferences: {
      get: vi.fn().mockResolvedValue(defaultNotificationPreferences()),
      update: vi.fn().mockResolvedValue(defaultNotificationPreferences()),
      reset: vi.fn().mockResolvedValue(defaultNotificationPreferences()),
    },
    notificationDigest: {
      list: vi.fn().mockResolvedValue({ items: [] }),
      ack: vi.fn().mockResolvedValue({ acked: 0 }),
    },
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
          <Route path="/:companyPrefix/inbox" element={<><InboxHub /><LocationProbe /></>} />
          <Route path="/:companyPrefix/inbox/new" element={<><InboxHub /><LocationProbe /></>} />
          <Route path="/:companyPrefix/inbox/all" element={<><InboxHub /><LocationProbe /></>} />
          <Route path="/:companyPrefix/inbox/:lane" element={<><InboxHub /><LocationProbe /></>} />
          <Route path="/:companyPrefix/inbox/:lane/:itemId" element={<><InboxHub /><LocationProbe /></>} />
          <Route path="/:companyPrefix/inbox-hub" element={<InboxHub />} />
          <Route path="/:companyPrefix/inbox-hub/:lane" element={<><InboxHub /><LocationProbe /></>} />
          <Route path="/:companyPrefix/inbox-hub/:lane/:itemId" element={<><InboxHub /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  liveHubItemCallbacks.clear();
  vi.mocked(hubItemsApi.list).mockResolvedValue(hubList([]));
  vi.mocked(hubItemsApi.getOne).mockResolvedValue(hubItem());
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
  vi.mocked(hubItemsApi.getPreferences).mockResolvedValue(defaultPreferences());
  vi.mocked(hubItemsApi.updatePreferences).mockResolvedValue(defaultPreferences());
  vi.mocked(hubItemsApi.notificationPreferences.get).mockResolvedValue(
    defaultNotificationPreferences(),
  );
  vi.mocked(hubItemsApi.notificationPreferences.update).mockResolvedValue(
    defaultNotificationPreferences(),
  );
  vi.mocked(hubItemsApi.notificationPreferences.reset).mockResolvedValue(
    defaultNotificationPreferences(),
  );
  vi.mocked(hubItemsApi.notificationDigest.list).mockResolvedValue({ items: [] });
  vi.mocked(hubItemsApi.notificationDigest.ack).mockResolvedValue({ acked: 0 });
});

type HubListItem = Awaited<ReturnType<typeof hubItemsApi.list>>["items"][number];

function hubList(items: HubListItem[], nextCursor: string | null = null) {
  return { items, nextCursor, totalKnown: null };
}

function defaultPreferences(overrides: Partial<HubPreferences> = {}): HubPreferences {
  return {
    defaultLanding: "home",
    visibleLanes: ["waiting_on_you", "notifications", "suggestions"],
    groupMode: "auto",
    density: "comfortable",
    showAutopilotEntry: true,
    updatedAt: null,
    ...overrides,
  };
}

function defaultNotificationPreferences(
  overrides: Partial<NotificationPreferences> = {},
): NotificationPreferences {
  return {
    rules: [
      { semanticType: "approval_request", deliveryMode: "realtime", toastEnabled: true },
    ],
    quietHours: { enabled: false, start: "18:00", end: "09:00", timezone: "UTC" },
    digest: { enabled: true, cadence: "daily" },
    updatedAt: null,
    ...overrides,
  };
}

function hubItem(overrides: Partial<HubListItem> = {}) {
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
    groupKey: null,
    groupLabel: null,
    groupCount: null,
    scopeKey: null,
    slaAt: null,
    ...overrides,
  } as HubListItem;
}

describe("InboxHub page", () => {
  it("renders the hub at the canonical /inbox route", async () => {
    renderPage("/P4/inbox");

    expect(await screen.findByText(/Autopilot/i)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /hub lanes/i })).toBeInTheDocument();
  });

  it("maps legacy /inbox/new to the active waiting hub view", async () => {
    renderPage("/P4/inbox/new");

    await screen.findByRole("navigation", { name: /hub lanes/i });
    await waitFor(() => {
      expect(hubItemsApi.list).toHaveBeenLastCalledWith("company-1", {
        lane: "waiting_on_you",
        status: "open",
        groupMode: "auto",
        limit: 50,
      });
    });
  });

  it("maps legacy /inbox/all to a route-backed all/history view", async () => {
    renderPage("/P4/inbox/all");

    await screen.findByRole("navigation", { name: /hub lanes/i });
    await waitFor(() => {
      expect(hubItemsApi.list).toHaveBeenLastCalledWith("company-1", {
        lane: "waiting_on_you",
        status: "resolved",
        groupMode: "auto",
        limit: 50,
      });
    });
  });

  it("redirects old /inbox-hub deep links to canonical /inbox links and preserves search", async () => {
    renderPage("/P4/inbox-hub/waiting/hub-1?q=approval&status=archived");

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/P4/inbox/waiting/hub-1?q=approval&status=archived",
      );
    });
  });

  it("writes canonical /inbox paths when lanes and items are selected", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue(hubList([hubItem()]));

    renderPage("/P4/inbox");

    const laneNav = await screen.findByRole("navigation", { name: /hub lanes/i });
    fireEvent.click(within(laneNav).getByRole("button", { name: /waiting on you/i }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/P4/inbox/waiting");
    });

    fireEvent.click(await screen.findByRole("button", { name: /approve deployment/i }));
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/P4/inbox/waiting/hub-1");
    });
  });

  it("renders Home by default", async () => {
    renderPage("/P4/inbox-hub");

    expect(await screen.findByText(/Autopilot/i)).toBeInTheDocument();
  });

  it("bridges realtime hub item changes to hydrated toasts", async () => {
    vi.mocked(hubItemsApi.getOne).mockResolvedValue(
      hubItem({ title: "Authorized row title", version: 7 }),
    );
    renderPage("/P4/inbox");

    await screen.findByText(/Autopilot/i);
    await waitFor(() => expect(liveHubItemCallbacks.size).toBe(1));
    await act(async () => {
      for (const cb of liveHubItemCallbacks) cb("hub-1");
    });

    await waitFor(() => {
      expect(hubItemsApi.getOne).toHaveBeenCalledWith("company-1", "hub-1");
      expect(mockPushToast).toHaveBeenCalledWith(expect.objectContaining({
        dedupeKey: "hub:company-1:hub-1:7",
        title: "Authorized row title",
      }));
    });
  });

  it("does not bridge hub item changes to toasts before notification preferences load", async () => {
    let resolvePreferences: (preferences: NotificationPreferences) => void = () => {};
    vi.mocked(hubItemsApi.notificationPreferences.get).mockReturnValue(
      new Promise<NotificationPreferences>((resolve) => {
        resolvePreferences = resolve;
      }),
    );
    vi.mocked(hubItemsApi.getOne).mockResolvedValue(
      hubItem({ title: "Early event title", version: 3 }),
    );
    renderPage("/P4/inbox");

    await screen.findByText(/Autopilot/i);
    await waitFor(() => expect(liveHubItemCallbacks.size).toBe(1));
    await act(async () => {
      for (const cb of liveHubItemCallbacks) cb("hub-1");
    });

    expect(hubItemsApi.getOne).not.toHaveBeenCalledWith("company-1", "hub-1");
    expect(mockPushToast).not.toHaveBeenCalled();

    await act(async () => {
      resolvePreferences(defaultNotificationPreferences());
    });
  });

  it("does not toast digest-mode hub item changes", async () => {
    vi.mocked(hubItemsApi.notificationPreferences.get).mockResolvedValue(
      defaultNotificationPreferences({
        rules: [
          { semanticType: "approval_request", deliveryMode: "digest", toastEnabled: true },
        ],
      }),
    );
    renderPage("/P4/inbox");

    await screen.findByText(/Autopilot/i);
    await waitFor(() => expect(liveHubItemCallbacks.size).toBe(1));
    await act(async () => {
      for (const cb of liveHubItemCallbacks) cb("hub-1");
    });

    await waitFor(() => expect(hubItemsApi.getOne).toHaveBeenCalledWith("company-1", "hub-1"));
    expect(mockPushToast).not.toHaveBeenCalled();
  });

  it("updates notification preferences from hub settings", async () => {
    const user = userEvent.setup();
    renderPage("/P4/inbox/waiting");

    await user.click(await screen.findByRole("button", { name: /hub settings/i }));
    await user.click(screen.getByRole("button", { name: /notification preferences/i }));
    await user.selectOptions(screen.getByLabelText(/approval request delivery/i), "digest");

    await waitFor(() => {
      expect(hubItemsApi.notificationPreferences.update).toHaveBeenCalledWith(
        "company-1",
        expect.objectContaining({
          rules: expect.arrayContaining([
            expect.objectContaining({
              semanticType: "approval_request",
              deliveryMode: "digest",
            }),
          ]),
        }),
      );
    });
  });

  it("acknowledges pending digest items from hub settings", async () => {
    const user = userEvent.setup();
    vi.mocked(hubItemsApi.notificationDigest.list).mockResolvedValue({
      items: [hubItem({ id: "digest-1", title: "Digest reminder" })],
    });
    renderPage("/P4/inbox/waiting");

    await user.click(await screen.findByRole("button", { name: /hub settings/i }));
    await user.click(screen.getByRole("button", { name: /notification preferences/i }));
    await user.click(await screen.findByRole("button", { name: /acknowledge digest/i }));

    await waitFor(() => {
      expect(hubItemsApi.notificationDigest.ack).toHaveBeenCalledWith("company-1");
    });
  });

  it("maps the waiting slug to the waiting_on_you API lane with the preview limit", async () => {
    renderPage("/P4/inbox-hub/waiting");

    await screen.findByRole("navigation", { name: /hub lanes/i });
    await waitFor(() => {
      expect(vi.mocked(hubItemsApi.list)).toHaveBeenCalledWith("company-1", {
        lane: "waiting_on_you",
        status: "open",
        groupMode: "auto",
        limit: 50,
      });
    });
  });

  it("marks an unread row read only once even if it is clicked repeatedly", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue(hubList([hubItem()]));

    renderPage("/P4/inbox-hub/waiting");

    const row = await screen.findByRole("button", { name: /approve deployment/i });
    fireEvent.click(row);
    fireEvent.click(row);

    await waitFor(() => {
      expect(hubItemsApi.markRead).toHaveBeenCalledTimes(1);
    });
  });

  it("viewer can mark a selected read item unread", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue(hubList([
      hubItem({ readAt: "2026-06-29T10:01:00.000Z" }),
    ]));

    renderPage("/P4/inbox-hub/waiting/hub-1");

    fireEvent.click(await screen.findByRole("button", { name: /mark unread/i }));

    await waitFor(() => {
      expect(hubItemsApi.markUnread).toHaveBeenCalledWith("company-1", "hub-1");
    });
  });

  it("viewer can dismiss and snooze the selected item", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue(hubList([hubItem()]));

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
    vi.mocked(hubItemsApi.list).mockResolvedValue(hubList([hubItem()]));

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
    vi.mocked(hubItemsApi.list).mockResolvedValue(hubList([hubItem()]));

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

  it("keeps server undo reachable after the resolved item leaves the active list", async () => {
    vi.mocked(hubItemsApi.list)
      .mockResolvedValueOnce(hubList([hubItem()]))
      .mockResolvedValue(hubList([]));

    renderPage("/P4/inbox-hub/waiting/hub-1");

    fireEvent.click(await screen.findByRole("button", { name: /^resolve$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /undo resolve/i }));

    await waitFor(() => {
      expect(hubItemsApi.undo).toHaveBeenCalledWith("company-1", "hub-1", {
        auditId: "audit-1",
        expectedVersion: 2,
      });
    });
  });

  it("viewer shows claim and release actions for board-pool items", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue(hubList([
      hubItem({ semanticType: "stale_work", lane: "suggestions", ownerPool: "board" }),
    ]));

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
        groupMode: "auto",
        limit: 50,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /^archived$/i }));

    await waitFor(() => {
      expect(hubItemsApi.list).toHaveBeenLastCalledWith("company-1", {
        lane: "waiting_on_you",
        status: "archived",
        groupMode: "auto",
        limit: 50,
      });
    });
  });

  it("opens resolved and archived history items in the viewer", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue(hubList([
      hubItem({
        id: "history-1",
        status: "resolved",
        title: "Resolved approval",
        readAt: "2026-06-29T10:01:00.000Z",
      }),
    ]));

    renderPage("/P4/inbox-hub/waiting/history-1");
    fireEvent.click(await screen.findByRole("button", { name: /^resolved$/i }));

    expect(await screen.findByRole("heading", { name: /resolved approval/i })).toBeInTheDocument();
  });

  it("loads an audit timeline for the selected history item", async () => {
    vi.mocked(hubItemsApi.list).mockResolvedValue(hubList([
      hubItem({
        id: "history-1",
        status: "archived",
        title: "Archived notification",
        readAt: "2026-06-29T10:01:00.000Z",
      }),
    ]));
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
    vi.mocked(hubItemsApi.list).mockResolvedValue(hubList([
      hubItem({ id: "hub-1", title: "First approval", version: 1 }),
      hubItem({ id: "hub-2", title: "Second approval", version: 3 }),
    ]));

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
    vi.mocked(hubItemsApi.list).mockResolvedValue(hubList([
      hubItem({ id: "hub-1", title: "Dismiss one" }),
      hubItem({ id: "hub-2", title: "Dismiss two" }),
    ]));

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
    vi.mocked(hubItemsApi.list).mockResolvedValue(hubList([
      hubItem({ id: "hub-1", title: "Fresh item", version: 1 }),
      hubItem({ id: "hub-2", title: "Changed item", version: 1 }),
    ]));
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

  it("passes search text to the list query", async () => {
    renderPage("/P4/inbox-hub/waiting");

    fireEvent.change(await screen.findByRole("searchbox", { name: /search hub/i }), {
      target: { value: "deploy" },
    });

    await waitFor(() => {
      expect(hubItemsApi.list).toHaveBeenLastCalledWith("company-1", {
        lane: "waiting_on_you",
        status: "open",
        q: "deploy",
        groupMode: "auto",
        limit: 50,
      });
    });
  });

  it("optimistically applies hub preference lane visibility changes", async () => {
    let resolvePreferences: (value: HubPreferences) => void = () => {};
    vi.mocked(hubItemsApi.updatePreferences).mockReturnValueOnce(
      new Promise<HubPreferences>((resolve) => {
        resolvePreferences = resolve;
      }),
    );

    renderPage("/P4/inbox-hub/waiting");

    await screen.findByRole("navigation", { name: /hub lanes/i });
    fireEvent.click(screen.getByRole("button", { name: /hub settings/i }));
    const notificationsToggle = screen.getByRole("checkbox", { name: "Notifications" });
    expect(notificationsToggle).toBeChecked();

    fireEvent.click(notificationsToggle);

    expect(notificationsToggle).not.toBeChecked();
    expect(
      within(screen.getByRole("navigation", { name: /hub lanes/i })).queryByRole("button", {
        name: /notifications/i,
      }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(hubItemsApi.updatePreferences).toHaveBeenCalledWith("company-1", {
        visibleLanes: ["waiting_on_you", "suggestions"],
      });
    });

    resolvePreferences(
      defaultPreferences({ visibleLanes: ["waiting_on_you", "suggestions"] }),
    );
    await waitFor(() => {
      expect(notificationsToggle).not.toBeChecked();
    });
  });

  it("loads the next cursor page", async () => {
    vi.mocked(hubItemsApi.list)
      .mockResolvedValueOnce(hubList([hubItem({ id: "hub-1", title: "First approval" })], "cursor-2"))
      .mockResolvedValueOnce(hubList([hubItem({ id: "hub-2", title: "Second approval" })]));

    renderPage("/P4/inbox-hub/waiting");

    fireEvent.click(await screen.findByRole("button", { name: /load more/i }));

    await waitFor(() => {
      expect(hubItemsApi.list).toHaveBeenLastCalledWith("company-1", {
        lane: "waiting_on_you",
        status: "open",
        groupMode: "auto",
        cursor: "cursor-2",
        limit: 50,
      });
    });
    expect(await screen.findByText(/second approval/i)).toBeInTheDocument();
  });
});
