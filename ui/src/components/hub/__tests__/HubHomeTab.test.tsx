import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { HubItemListRow } from "@/api/hub-items";
import { HubHomeTab } from "../HubHomeTab";

const item: HubItemListRow = {
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
};

function renderHome(overrides: Partial<React.ComponentProps<typeof HubHomeTab>> = {}) {
  return render(
    <MemoryRouter>
      <HubHomeTab
        selectedItem={null}
        auditRows={[]}
        auditLoading={false}
        onOpenFull={vi.fn()}
        onClose={vi.fn()}
        onMarkUnread={vi.fn()}
        onDismiss={vi.fn()}
        onSnooze={vi.fn()}
        onLifecycleAction={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("HubHomeTab", () => {
  it("shows an empty prompt when nothing is selected", () => {
    renderHome();
    expect(screen.getByText(/select an item to review details/i)).toBeInTheDocument();
  });

  it("previews the selected item and opens it full via the tab handoff", async () => {
    const user = userEvent.setup();
    const onOpenFull = vi.fn();
    renderHome({ selectedItem: item, onOpenFull });

    expect(screen.getByRole("heading", { name: /review hire approval/i })).toBeInTheDocument();

    // "Open full" is a tab-opening button (no route link) — it hands the item back.
    await user.click(screen.getByRole("button", { name: /open full/i }));
    expect(onOpenFull).toHaveBeenCalledWith(expect.objectContaining({ id: "hub-1" }));
    // The reading pane never route-navigates.
    expect(screen.queryByRole("link", { name: /open full/i })).not.toBeInTheDocument();
  });

  it("fires lifecycle actions from the reading pane", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const onLifecycleAction = vi.fn();
    renderHome({ selectedItem: item, onDismiss, onLifecycleAction });

    await user.click(screen.getByRole("button", { name: /^dismiss$/i }));
    expect(onDismiss).toHaveBeenCalledWith("hub-1");

    await user.click(screen.getByRole("button", { name: /^resolve$/i }));
    expect(onLifecycleAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "hub-1" }),
      "resolve",
    );
  });
});
