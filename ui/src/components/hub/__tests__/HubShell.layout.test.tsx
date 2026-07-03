import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HubItemListRow } from "@/api/hub-items";

// --- Mock the breakpoint hook so we can drive the desktop/mobile branch ---
const breakpointState = { isMobile: false };
vi.mock("@/lib/useBreakpoint", () => ({
  useBreakpoint: () => ({
    tier: breakpointState.isMobile ? "mobile" : "desktop",
    isMobile: breakpointState.isMobile,
    isTablet: false,
    isDesktopUp: !breakpointState.isMobile,
    isWide: false,
    useDrawerSessions: breakpointState.isMobile,
  }),
}));

// --- Mock react-resizable-panels to assert structure without real layout math ---
vi.mock("react-resizable-panels", () => ({
  Group: ({ children, ...props }: any) => (
    <div data-testid={props["data-testid"]} role="group">
      {children}
    </div>
  ),
  Panel: ({ children, ...props }: any) => (
    <div data-testid={props["data-testid"]} data-panel-id={props.id}>
      {children}
    </div>
  ),
  Separator: ({ ...props }: any) => <div data-testid={props["data-testid"]} />,
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: vi.fn() }),
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: { id: "company-1", name: "Test Co", issuePrefix: "TC" },
  }),
}));

import { HubShell } from "../HubShell";

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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
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
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HubShell layout", () => {
  beforeEach(() => {
    breakpointState.isMobile = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("mounts a resizable group with list + viewer panels and a separator on desktop", () => {
    renderShell();

    const group = screen.getByTestId("hub-panel-group");
    expect(group).toBeInTheDocument();

    const listPanel = screen.getByTestId("hub-list-panel");
    const viewerPanel = screen.getByTestId("hub-viewer-panel");
    expect(listPanel).toHaveAttribute("data-panel-id", "hub-list");
    expect(viewerPanel).toHaveAttribute("data-panel-id", "hub-viewer");
    expect(screen.getByTestId("hub-panel-separator")).toBeInTheDocument();

    // The existing list + viewer content still renders inside the panels.
    expect(listPanel).toContainElement(screen.getByText("Review hire approval"));
    expect(viewerPanel).toContainElement(
      screen.getByRole("complementary", { name: /hub viewer/i }),
    );
  });

  it("does not mount the resizable group on mobile and keeps the stacked layout", () => {
    breakpointState.isMobile = true;
    renderShell();

    expect(screen.queryByTestId("hub-panel-group")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hub-list-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hub-viewer-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hub-panel-separator")).not.toBeInTheDocument();

    // Stacked list + viewer content is still present.
    expect(screen.getByText("Review hire approval")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: /hub viewer/i })).toBeInTheDocument();
  });

  it("renders the mobile lane dialog without the resizable group when the rail is opened", async () => {
    breakpointState.isMobile = true;
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", { name: /open hub lanes/i }));

    expect(screen.getByRole("dialog", { name: /hub lanes/i })).toBeInTheDocument();
    expect(screen.queryByTestId("hub-panel-group")).not.toBeInTheDocument();
  });
});
