import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { ScopeTab } from "../ScopeTab";
import type { ScopeItem } from "../scopeGrouping";

// Task 7 mock: threadsApi used for spinOff + routing calls
vi.mock("../../../api/threads", () => ({
  threadsApi: {
    spinOff: vi.fn().mockResolvedValue({ id: "new-thread" }),
    routeItem: vi.fn().mockResolvedValue({ itemId: "item-1" }),
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
  it("renders summary text when provided", () => {
    renderWithProviders(
      <ScopeTab
        summaryText="This thread is about improving onboarding."
        summaryNext={null}
        items={[]}
        planSteps={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        onItemClick={vi.fn()}
      />,
    );
    expect(screen.getByText("This thread is about improving onboarding.")).toBeInTheDocument();
  });

  it("shows summary empty state when no summaryText", () => {
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
    expect(screen.getByText(/scribe will summarize/i)).toBeInTheDocument();
  });

  it("shows plan empty state when planSteps is empty", () => {
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
    expect(screen.getByText(/no plan yet/i)).toBeInTheDocument();
  });

  it("renders plan steps in an ordered list", () => {
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

  it("shows items empty state when no items", () => {
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
    expect(screen.getByText(/nothing to scope yet/i)).toBeInTheDocument();
  });

  it("renders pending items in the Needs Input group", () => {
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
    expect(screen.getByText("Pending task A")).toBeInTheDocument();
    expect(screen.getByText(/needs input/i)).toBeInTheDocument();
  });

  it("renders approved tasks in Confirmed group", () => {
    const items: ScopeItem[] = [
      makeItem({ id: "a1", status: "approved", title: "Confirmed task B" }),
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
    expect(screen.getByText("Confirmed task B")).toBeInTheDocument();
    // Multiple elements may match "confirmed" (section header + type badge) — just check presence
    expect(screen.getAllByText(/confirmed/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders approved reference in References group", () => {
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
    expect(screen.getByText("Ref doc")).toBeInTheDocument();
    expect(screen.getByText(/references/i)).toBeInTheDocument();
  });

  it("renders approved artifact in Artifacts group", () => {
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
    expect(screen.getByText("My artifact")).toBeInTheDocument();
    expect(screen.getByText(/artifacts/i)).toBeInTheDocument();
  });

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

  it("shows conflict badge on items with conflictsWith", () => {
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
    // Conflict badge appears (there may be multiple conflict-related elements)
    expect(screen.getAllByText(/conflict/i).length).toBeGreaterThanOrEqual(1);
  });

  // ── Task 7: conflict card amber styling ───────────────────────────────────

  it("conflict card has amber styling for conflicted items in Needs Input", () => {
    const items: ScopeItem[] = [
      makeItem({
        id: "c1",
        status: "pending",
        title: "Conflicted item",
        conflictsWith: "other-item",
        dependsOn: [],
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
        isFounder={false}
      />,
    );
    // The conflicted item row should have an amber conflict class
    const itemEl = screen.getByTestId("scope-item-c1");
    expect(itemEl.className).toMatch(/amber/);
  });

  it("renders 'Spin off' button for each scope item", () => {
    const items: ScopeItem[] = [
      makeItem({ id: "s1", status: "pending", title: "Spinnable Task", dependsOn: [] }),
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
        isFounder={false}
      />,
    );
    // Each item should have a spin-off button
    expect(screen.getByTestId("spin-off-s1")).toBeInTheDocument();
  });

  it("shows dependency badge when item has dependsOn", () => {
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
        isFounder={false}
      />,
    );
    expect(screen.getByTestId("dep-badge-d1")).toBeInTheDocument();
  });

  it("shows routing UI (department selector) only for founders", () => {
    const items: ScopeItem[] = [
      makeItem({ id: "r1", status: "pending", title: "Routable Task", type: "task", dependsOn: [] }),
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
    // Routing selector should appear for founders
    expect(screen.getByTestId("routing-dept-r1")).toBeInTheDocument();
  });

  it("does NOT show routing UI for non-founders", () => {
    const items: ScopeItem[] = [
      makeItem({ id: "r2", status: "pending", title: "Task", type: "task", dependsOn: [] }),
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
        isFounder={false}
      />,
    );
    expect(screen.queryByTestId("routing-dept-r2")).not.toBeInTheDocument();
  });
});
