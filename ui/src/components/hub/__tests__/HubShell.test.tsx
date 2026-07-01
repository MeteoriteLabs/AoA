import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { HubShell } from "../HubShell";
import type { HubItemListRow } from "@/api/hub-items";
import type { HubAutopilotActionsResponse, HubAutopilotPolicy, NotificationPreferences } from "@armyofagents/shared";

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: { id: "company-1", name: "Test Co", issuePrefix: "TC" },
  }),
}));

const items: HubItemListRow[] = [
  {
    id: "hub-1",
    companyId: "company-1",
    semanticType: "approval_request",
    lane: "waiting_on_you",
    status: "open",
    priority: "normal",
    title: "Review hire approval",
    summary: "Scout",
    sourceType: "approval",
    sourceId: "approval-1",
    ownerUserId: "user-1",
    ownerPool: "board",
    version: 0,
    createdAt: "2026-06-29T00:00:00Z",
    updatedAt: "2026-06-29T00:00:00Z",
    readAt: null,
    snoozedUntil: null,
    dismissedAt: null,
    groupKey: "source:approval",
    groupLabel: "approval",
    groupCount: null,
    scopeKey: null,
    slaAt: null,
  },
];

function renderShell(overrides: Partial<React.ComponentProps<typeof HubShell>> = {}) {
  return render(
    <MemoryRouter>
      <HubShell
        activeLane="waiting_on_you"
        items={items}
        counts={{ open: 1, unread: 1 }}
        isLoading={false}
        error={null}
        selectedItemId={null}
        onLaneChange={vi.fn()}
        onSelectItem={vi.fn()}
        onMarkRead={vi.fn()}
        preferences={{
          defaultLanding: "waiting_on_you",
          visibleLanes: ["waiting_on_you", "suggestions"],
          groupMode: "auto",
          density: "comfortable",
          showAutopilotEntry: true,
          updatedAt: null,
        }}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

function notificationPreferences(
  overrides: Partial<NotificationPreferences> = {},
): NotificationPreferences {
  return {
    rules: [
      { semanticType: "approval_request", deliveryMode: "realtime", toastEnabled: true },
      { semanticType: "reminder", deliveryMode: "realtime", toastEnabled: true },
    ],
    quietHours: { enabled: false, start: "18:00", end: "09:00", timezone: "UTC" },
    digest: { enabled: true, cadence: "daily" },
    updatedAt: null,
    ...overrides,
  };
}

function autopilotPolicy(overrides: Partial<HubAutopilotPolicy> = {}): HubAutopilotPolicy {
  return {
    mode: "off",
    handledToday: 0,
    lastHandledAt: null,
    rules: [
      { semanticType: "approval_request", action: "none", minTrustScore: 100, enabled: false },
      { semanticType: "run_complete", action: "none", minTrustScore: 100, enabled: false },
    ],
    updatedAt: null,
    ...overrides,
  };
}

function autopilotActions(
  overrides: Partial<HubAutopilotActionsResponse> = {},
): HubAutopilotActionsResponse {
  return {
    items: [],
    ...overrides,
  };
}

describe("HubShell", () => {
  it("renders rail, lane list, and empty viewer state", () => {
    renderShell();

    expect(screen.getByRole("navigation", { name: /hub lanes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /waiting on you/i })).toBeInTheDocument();
    expect(screen.getByText("Review hire approval")).toBeInTheDocument();
    expect(screen.getByText("normal")).toBeInTheDocument();
    expect(screen.getByText(/select an item/i)).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: /hub viewer/i })).toBeInTheDocument();
  });

  it("opens a viewer tab when an item is selected", async () => {
    const user = userEvent.setup();
    const onSelectItem = vi.fn();
    renderShell({ onSelectItem });

    await user.click(screen.getByRole("button", { name: /review hire approval/i }));

    expect(onSelectItem).toHaveBeenCalledWith("hub-1");
  });

  it("renders the selected item viewer with a full-page link", () => {
    renderShell({ selectedItemId: "hub-1" });

    expect(screen.getByRole("complementary", { name: /hub viewer/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /approval/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open full/i })).toHaveAttribute(
      "href",
      "/TC/approvals/approval-1",
    );
  });

  it("closes the viewer with a nullable selection", async () => {
    const user = userEvent.setup();
    const onSelectItem = vi.fn();
    renderShell({ selectedItemId: "hub-1", onSelectItem });

    await user.click(screen.getByRole("button", { name: /close viewer/i }));

    expect(onSelectItem).toHaveBeenCalledWith(null);
  });

  it("hides lanes excluded by preferences", () => {
    renderShell();

    expect(screen.getByRole("button", { name: /waiting on you/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /notifications/i })).not.toBeInTheDocument();
  });

  it("renders grouped rows with explicit expansion state", () => {
    renderShell({
      items: Array.from({ length: 3 }, (_, index) => ({
        ...items[0],
        id: `hub-${index + 1}`,
        title: `Approval ${index + 1}`,
      })),
    });

    expect(screen.getByRole("button", { name: /3 approval/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("renders curated group summaries in grouped rows", () => {
    renderShell({
      items: Array.from({ length: 3 }, (_, index) => ({
        ...items[0],
        id: `hub-curated-${index + 1}`,
        title: `Approval ${index + 1}`,
        curationGroupSummary: "Three related approvals are waiting for founder review.",
      }) as HubItemListRow),
    });

    expect(screen.getByText("Three related approvals are waiting for founder review.")).toBeInTheDocument();
  });

  it("shows curation reasons in the viewer only when metadata exists", () => {
    const curated = renderShell({
      selectedItemId: "hub-1",
      items: [
        {
          ...items[0],
          curationReason: "SLA is due in 20 minutes.",
          curationPriorityReason: "Urgent priority is set on this hub item.",
        } as HubItemListRow,
      ],
    });

    expect(screen.getByText("Why you are seeing this")).toBeInTheDocument();
    expect(screen.getByText("SLA is due in 20 minutes.")).toBeInTheDocument();
    expect(screen.getByText("Urgent priority is set on this hub item.")).toBeInTheDocument();

    curated.unmount();
    renderShell({ selectedItemId: "hub-1" });
    expect(screen.queryByText("Why you are seeing this")).not.toBeInTheDocument();
  });

  it("uses curation reason on Hub Home needs-you-most", () => {
    renderShell({
      activeLane: null,
      items: [
        {
          ...items[0],
          curationReason: "SLA is due in 20 minutes.",
        } as HubItemListRow,
      ],
    });

    expect(screen.getByText("Review hire approval")).toBeInTheDocument();
    expect(screen.getByText("SLA is due in 20 minutes.")).toBeInTheDocument();
  });

  it("renders preference controls", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: /hub settings/i }));

    expect(screen.getByRole("combobox", { name: /default landing/i })).toHaveValue(
      "waiting_on_you",
    );
    expect(screen.getByRole("combobox", { name: /density/i })).toHaveValue("comfortable");
    expect(screen.getByRole("checkbox", { name: /autopilot entry/i })).toBeChecked();
    expect(
      screen.getByRole("button", { name: /notification preferences/i }),
    ).toBeEnabled();
  });

  it("renders live Autopilot status on Hub Home with recent undoable actions", async () => {
    const user = userEvent.setup();
    const onUndoAutopilotAction = vi.fn();
    renderShell({
      activeLane: null,
      autopilotPolicy: autopilotPolicy({ mode: "drive", handledToday: 1 }),
      autopilotActions: autopilotActions({
        items: [
          {
            auditId: "audit-1",
            hubItemId: "hub-1",
            title: "Finished run",
            semanticType: "run_complete",
            action: "resolve",
            autonomyLevel: "drive",
            reason: "Trusted completion",
            decisionContext: {},
            undoDeadline: "2099-01-01T00:00:00.000Z",
            itemStatus: "resolved",
            itemVersion: 3,
            createdAt: "2026-07-01T12:00:00.000Z",
          },
        ],
      }),
      onUndoAutopilotAction,
    });

    expect(screen.getByText("Drive")).toBeInTheDocument();
    expect(screen.getByText(/handled today/i)).toHaveTextContent("1 handled today");
    expect(screen.getByText("Finished run")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /undo autopilot action finished run/i }));
    expect(onUndoAutopilotAction).toHaveBeenCalledWith(expect.objectContaining({ auditId: "audit-1" }));
  });

  it("updates and resets Autopilot mode from hub settings", async () => {
    const user = userEvent.setup();
    const onUpdateAutopilotPolicy = vi.fn();
    const onResetAutopilotPolicy = vi.fn();
    renderShell({
      autopilotPolicy: autopilotPolicy({ mode: "off" }),
      onUpdateAutopilotPolicy,
      onResetAutopilotPolicy,
    });

    await user.click(screen.getByRole("button", { name: /hub settings/i }));
    await user.selectOptions(screen.getByRole("combobox", { name: /autopilot mode/i }), "drive");
    expect(onUpdateAutopilotPolicy).toHaveBeenCalledWith({ mode: "drive" });

    await user.click(screen.getByRole("button", { name: /reset autopilot/i }));
    expect(onResetAutopilotPolicy).toHaveBeenCalled();
  });

  it("prevents founder-gated categories from being configured for auto-handle", async () => {
    const user = userEvent.setup();
    renderShell({
      autopilotPolicy: autopilotPolicy(),
    });

    await user.click(screen.getByRole("button", { name: /hub settings/i }));

    expect(screen.getByText("Approval Request")).toBeInTheDocument();
    expect(screen.getByText(/founder-gated/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /approval request autopilot action/i })).not.toBeInTheDocument();
  });

  it("opens notification preferences from hub settings and shows digest summary", async () => {
    const user = userEvent.setup();
    const onAckDigest = vi.fn();
    const onResetNotificationPreferences = vi.fn();
    renderShell({
      notificationPreferences: notificationPreferences(),
      digestItems: [
        { ...items[0], id: "digest-1", semanticType: "reminder", lane: "notifications", title: "Digest reminder" },
      ],
      onAckDigest,
      onResetNotificationPreferences,
    } as Partial<React.ComponentProps<typeof HubShell>>);

    await user.click(screen.getByRole("button", { name: /hub settings/i }));
    await user.click(screen.getByRole("button", { name: /notification preferences/i }));

    expect(screen.getByRole("heading", { name: /notification preferences/i })).toBeInTheDocument();
    expect(screen.getByText("Digest reminder")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /acknowledge digest/i }));
    expect(onAckDigest).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /reset notification preferences/i }));
    expect(onResetNotificationPreferences).toHaveBeenCalled();
  });

  it("changes notification delivery, toast, and quiet-hours preferences", async () => {
    const user = userEvent.setup();
    const onUpdateNotificationPreferences = vi.fn();
    renderShell({
      notificationPreferences: notificationPreferences(),
      onUpdateNotificationPreferences,
    } as Partial<React.ComponentProps<typeof HubShell>>);

    await user.click(screen.getByRole("button", { name: /hub settings/i }));
    await user.click(screen.getByRole("button", { name: /notification preferences/i }));

    await user.selectOptions(screen.getByLabelText(/reminder delivery/i), "digest");
    expect(onUpdateNotificationPreferences).toHaveBeenCalledWith({
      rules: expect.arrayContaining([
        expect.objectContaining({ semanticType: "reminder", deliveryMode: "digest" }),
      ]),
    });

    await user.click(screen.getByRole("checkbox", { name: /reminder toast/i }));
    expect(onUpdateNotificationPreferences).toHaveBeenCalledWith({
      rules: expect.arrayContaining([
        expect.objectContaining({ semanticType: "reminder", toastEnabled: false }),
      ]),
    });

    await user.click(screen.getByRole("checkbox", { name: /quiet hours/i }));
    expect(onUpdateNotificationPreferences).toHaveBeenCalledWith({
      quietHours: { enabled: true, start: "18:00", end: "09:00", timezone: "UTC" },
    });
  });

  it("focuses search when slash is pressed outside an editable field", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.keyboard("/");

    expect(screen.getByRole("searchbox", { name: /search hub/i })).toHaveFocus();
  });

  it("does not steal slash key presses from editable fields", async () => {
    const user = userEvent.setup();
    const onSearchTextChange = vi.fn();
    renderShell({ onSearchTextChange });
    const search = screen.getByRole("searchbox", { name: /search hub/i });

    await user.click(search);
    await user.keyboard("/");

    expect(onSearchTextChange).toHaveBeenCalledWith("/");
  });

  it("moves selection with j and k", async () => {
    const user = userEvent.setup();
    const onSelectItem = vi.fn();
    renderShell({
      onSelectItem,
      items: [
        { ...items[0], id: "hub-1", title: "First approval" },
        { ...items[0], id: "hub-2", title: "Second approval" },
      ],
    });

    await user.keyboard("j");
    await user.keyboard("j");
    await user.keyboard("k");

    expect(onSelectItem).toHaveBeenNthCalledWith(1, "hub-1");
    expect(onSelectItem).toHaveBeenNthCalledWith(2, "hub-2");
    expect(onSelectItem).toHaveBeenNthCalledWith(3, "hub-1");
  });

  it("renders and closes the mobile lane drawer", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: /open hub lanes/i }));

    expect(screen.getByRole("dialog", { name: /hub lanes/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close hub lanes/i }));

    expect(screen.queryByRole("dialog", { name: /hub lanes/i })).not.toBeInTheDocument();
  });

  it("focuses the viewer heading and restores focus to the selected row on close", async () => {
    const user = userEvent.setup();
    const onSelectItem = vi.fn();
    renderShell({ selectedItemId: "hub-1", onSelectItem });

    expect(screen.getByRole("heading", { name: /review hire approval/i })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: /close viewer/i }));

    expect(onSelectItem).toHaveBeenCalledWith(null);
    expect(screen.getByRole("button", { name: /review hire approval/i })).toHaveFocus();
  });
});
