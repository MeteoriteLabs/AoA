import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HubTabBody } from "../HubTabBody";
import { HUB_TABPANEL_ID } from "../HubTabStrip";
import {
  HOME_TAB,
  approvalTab,
  browserTab,
  budgetTab,
  notificationTab,
  taskTab,
  type HubTab,
} from "../hubViewerModel";

// ── Mock the heavy viewers as simple divs. Each records the props it received
//    on a module-level spy so tests can assert what was threaded through. ──

const taskDetailSpy = vi.fn();
vi.mock("@/components/TaskDetail", () => ({
  TaskDetail: (props: Record<string, unknown>) => {
    taskDetailSpy(props);
    return (
      <div data-testid="mock-task-detail" data-issue-id={String(props.issueId)}>
        TaskDetail
      </div>
    );
  },
}));

const browserSpy = vi.fn();
vi.mock("@/components/viewers/BrowserViewer", () => ({
  BrowserViewer: (props: Record<string, unknown>) => {
    browserSpy(props);
    return (
      <div data-testid="mock-browser" data-url={String(props.initialUrl)}>
        BrowserViewer
      </div>
    );
  },
}));

vi.mock("@/components/settings/sections/BudgetCapsSection", () => ({
  BudgetCapsSection: () => <div data-testid="mock-budget">BudgetCapsSection</div>,
}));

vi.mock("../TaskOutputViewer", () => ({
  TaskOutputViewer: (props: Record<string, unknown>) => (
    <div data-testid="mock-task-output" data-issue-id={String(props.issueId)}>
      TaskOutputViewer
    </div>
  ),
}));

function renderBody(tab: HubTab, onOpenTab = vi.fn()) {
  const utils = render(
    <HubTabBody tab={tab} companyId="company-1" onOpenTab={onOpenTab} />,
  );
  return { ...utils, onOpenTab };
}

describe("HubTabBody", () => {
  it("roots the body at the tabpanel id with role=tabpanel", () => {
    const { container } = renderBody(HOME_TAB);
    const root = container.querySelector(`#${HUB_TABPANEL_ID}`);
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute("role", "tabpanel");
  });

  it("fills the panel (fluid w-full h-full, not a fixed width)", () => {
    const { container } = renderBody(HOME_TAB);
    const root = container.querySelector(`#${HUB_TABPANEL_ID}`);
    expect(root?.className).toContain("w-full");
    expect(root?.className).toContain("h-full");
    expect(root?.className).not.toContain("w-[360px]");
  });

  it("renders the home placeholder for the home tab", () => {
    renderBody(HOME_TAB);
    expect(screen.getByText(/inbox home/i)).toBeInTheDocument();
  });

  it("renders TaskDetail with the right issueId for a task tab", () => {
    renderBody(taskTab("issue-42", "Ship it"));
    const el = screen.getByTestId("mock-task-detail");
    expect(el).toHaveAttribute("data-issue-id", "issue-42");
  });

  it("threads onOpenTab into TaskDetail's handoff callback", () => {
    const onOpenTab = vi.fn();
    renderBody(taskTab("issue-42", "Ship it"), onOpenTab);
    const props = taskDetailSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    // TaskDetail must receive active + a handoff callback wired to onOpenTab.
    expect(props.active).toBe(true);
    const handoff = props.onOpenScopeHandoffItem as (item: unknown) => void;
    expect(typeof handoff).toBe("function");

    // A url handoff item should re-emit a browser tab through onOpenTab.
    handoff({
      id: "ctx-1",
      itemType: "url",
      label: "Docs",
      sourceId: null,
      metadata: { url: "https://example.com" },
    });
    expect(onOpenTab).toHaveBeenCalledTimes(1);
    const emitted = onOpenTab.mock.calls[0][0] as HubTab;
    expect(emitted.kind).toBe("browser");
  });

  it("renders BrowserViewer with the url for a browser tab", () => {
    renderBody(browserTab("https://example.com/path"));
    const el = screen.getByTestId("mock-browser");
    expect(el.getAttribute("data-url")).toContain("example.com");
  });

  it("renders BudgetCapsSection for a budget tab", () => {
    renderBody(budgetTab());
    expect(screen.getByTestId("mock-budget")).toBeInTheDocument();
  });

  it("renders a placeholder (not null) for an unwired kind like approval", () => {
    const { container } = renderBody(approvalTab("approval-1", "Review hire"));
    const root = container.querySelector(`#${HUB_TABPANEL_ID}`);
    expect(root).not.toBeNull();
    // The tab chrome + panel still render with a preparing-viewer placeholder.
    expect(screen.getByText(/preparing viewer/i)).toBeInTheDocument();
  });

  it("renders a minimal generic body for a notification tab", () => {
    renderBody(notificationTab("hub-item-1", "Budget nearing cap"));
    expect(screen.getByText("Budget nearing cap")).toBeInTheDocument();
    expect(screen.getByText(/no dedicated viewer/i)).toBeInTheDocument();
  });
});
