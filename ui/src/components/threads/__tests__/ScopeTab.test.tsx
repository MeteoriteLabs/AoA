import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { ScopeTab } from "../ScopeTab";
import type { ScopeItem } from "../scopeGrouping";
import { ALL_SCOPE_TYPES } from "../scopeGrouping";

vi.mock("../../../api/threads", () => ({
  threadsApi: {
    spinOff: vi.fn().mockResolvedValue({ id: "new-thread" }),
    routeItem: vi.fn().mockResolvedValue({ itemId: "item-1" }),
  },
}));

vi.mock("../../../api/discussions", () => ({
  discussionsApi: {
    approveItems: vi.fn().mockResolvedValue({}),
    rejectItems: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

function makeItem(overrides: Partial<ScopeItem> = {}): ScopeItem {
  return {
    id: "item-1",
    type: "task",
    title: "Default item",
    description: null,
    status: "pending",
    conflictsWith: null,
    suggestedPriority: null,
    suggestedAssigneeId: null,
    suggestedDepartmentId: null,
    suggestedLayer: null,
    layer: null,
    dedupAction: null,
    resultTaskId: null,
    resultMemoryId: null,
    createdAt: "2026-01-01T00:00:00Z",
    dependsOn: [],
    ...overrides,
  };
}

describe("ScopeTab", () => {
  it("shows loading skeleton when isLoading", () => {
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={[]}
        planSteps={[]}
        isLoading={true}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("scope-tab-skeleton")).toBeInTheDocument();
  });

  it("shows error state when isError", () => {
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={[]}
        planSteps={[]}
        isLoading={false}
        isError={true}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("scope-tab-error")).toBeInTheDocument();
  });

  it("shows empty state when no pending items", () => {
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={[]}
        planSteps={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
      />,
    );
    expect(screen.getByText(/nothing to decide yet/i)).toBeInTheDocument();
  });

  it("renders plan steps when planSteps is non-empty", () => {
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={[]}
        planSteps={["Step one", "Step two", "Step three"]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Step one")).toBeInTheDocument();
    expect(screen.getByText("Step two")).toBeInTheDocument();
    expect(screen.getByText("Step three")).toBeInTheDocument();
  });

  it("renders plan steps from the backend", () => {
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={[]}
        planSteps={["Spec the API", "Build it", "Test it"]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Spec the API")).toBeInTheDocument();
    expect(screen.getByText("Test it")).toBeInTheDocument();
  });

  it("shows Needs Decision section with pending items (collapsed by default)", () => {
    const items: ScopeItem[] = [
      makeItem({ id: "p1", status: "pending", title: "Pending task A" }),
    ];
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={items}
        planSteps={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("scope-needs-decision")).toBeInTheDocument();
    // Type accordion button exists but is collapsed
    const accordion = screen.getByRole("button", { name: /tasks/i });
    expect(accordion).toHaveAttribute("aria-expanded", "false");
  });

  it("expands type accordion to reveal pending items", async () => {
    const user = userEvent.setup();
    const items: ScopeItem[] = [
      makeItem({ id: "p1", status: "pending", title: "Pending task A" }),
    ];
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={items}
        planSteps={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /tasks/i }));
    expect(screen.getByText("Pending task A")).toBeInTheDocument();
  });

  it("shows Approved section when items are approved", async () => {
    const user = userEvent.setup();
    const items: ScopeItem[] = [
      makeItem({ id: "a1", status: "approved", title: "Approved task B" }),
    ];
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={items}
        planSteps={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
      />,
    );
    // Approved section header should be visible
    expect(screen.getByTestId("scope-approved")).toBeInTheDocument();
    // Expand it
    await user.click(screen.getByRole("button", { name: /approved/i }));
    expect(screen.getByText("Approved task B")).toBeInTheDocument();
  });

  it("shows approved references under type label in Approved section", async () => {
    const user = userEvent.setup();
    const items: ScopeItem[] = [
      makeItem({ id: "ref1", status: "approved", type: "reference", title: "Ref doc" }),
    ];
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={items}
        planSteps={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /approved/i }));
    expect(screen.getByText("Ref doc")).toBeInTheDocument();
    expect(screen.getByText("References")).toBeInTheDocument();
  });

  it("shows approved artifacts under type label in Approved section", async () => {
    const user = userEvent.setup();
    const items: ScopeItem[] = [
      makeItem({ id: "art1", status: "approved", type: "artifact", title: "My artifact" }),
    ];
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={items}
        planSteps={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /approved/i }));
    expect(screen.getByText("My artifact")).toBeInTheDocument();
    expect(screen.getByText("Artifacts")).toBeInTheDocument();
  });

  it("conflict card has amber styling for conflicted items", async () => {
    const user = userEvent.setup();
    const items: ScopeItem[] = [
      makeItem({
        id: "c1",
        status: "pending",
        title: "Conflicted item",
        conflictsWith: "other-item",
      }),
    ];
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={items}
        planSteps={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
        companyId="comp-1"
        discussionId="disc-1"
      />,
    );
    // Expand the Tasks accordion first so item card renders
    await user.click(screen.getByRole("button", { name: /tasks/i }));
    const itemEl = screen.getByTestId("scope-item-c1");
    // Amber conflict border is applied
    expect(itemEl.className).toMatch(/amber/);
  });

  it("shows conflict badge text on conflicted items", async () => {
    const user = userEvent.setup();
    const items: ScopeItem[] = [
      makeItem({
        id: "c1",
        status: "pending",
        title: "Conflicted item",
        conflictsWith: "other-item",
      }),
    ];
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={items}
        planSteps={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /tasks/i }));
    expect(screen.getAllByText(/conflict/i).length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'Spin off' button only for spin_off_thread type items", async () => {
    const user = userEvent.setup();
    const items: ScopeItem[] = [
      makeItem({ id: "s1", status: "pending", type: "spin_off_thread", title: "Branch Task", dependsOn: [] }),
    ];
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={items}
        planSteps={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
        companyId="comp-1"
        discussionId="disc-1"
      />,
    );
    await user.click(screen.getByRole("button", { name: /branches/i }));
    expect(screen.getByTestId("spin-off-s1")).toBeInTheDocument();
  });

  it("shows dependency badge when item has dependsOn", async () => {
    const user = userEvent.setup();
    const items: ScopeItem[] = [
      makeItem({ id: "d1", status: "pending", title: "Blocked Task", dependsOn: ["item-a", "item-b"] }),
    ];
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={items}
        planSteps={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
        companyId="comp-1"
        discussionId="disc-1"
      />,
    );
    await user.click(screen.getByRole("button", { name: /tasks/i }));
    expect(screen.getByTestId("dep-badge-d1")).toBeInTheDocument();
  });

  it("does not render routing UI (removed in v1.1 redesign)", () => {
    const items: ScopeItem[] = [
      makeItem({ id: "r1", status: "pending", title: "Task", type: "task", dependsOn: [] }),
    ];
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={items}
        planSteps={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
        companyId="comp-1"
        discussionId="disc-1"
        isFounder={true}
        departments={[{ id: "dept-1", name: "Engineering" }]}
      />,
    );
    expect(screen.queryByTestId("routing-dept-r1")).not.toBeInTheDocument();
  });

  it("renders items of all scope types in Approved section", async () => {
    const user = userEvent.setup();
    const items = ALL_SCOPE_TYPES.map((t, i) =>
      makeItem({ id: `t${i}`, type: t, status: "approved", title: `${t} item` }),
    );
    renderWithProviders(
      <ScopeTab
        summaryText={null}
        summaryNext={null}
        items={items}
        planSteps={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
        showAllTypes
      />,
    );
    await user.click(screen.getByRole("button", { name: /approved/i }));
    for (const t of ALL_SCOPE_TYPES) {
      expect(screen.getByText(`${t} item`)).toBeInTheDocument();
    }
  });
});
