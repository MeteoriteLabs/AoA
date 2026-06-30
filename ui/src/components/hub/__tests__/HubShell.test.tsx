import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { HubShell } from "../HubShell";
import type { HubItemListRow } from "@/api/hub-items";

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
    ).toBeDisabled();
  });
});
