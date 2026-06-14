import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../TaskDetail", () => ({
  TaskDetail: ({ issueId, active }: { issueId: string | null; active: boolean }) => (
    <div data-testid="task-detail-mock" data-issue={issueId} data-active={String(active)} />
  ),
}));

import { TabBodySwitch } from "./CommanderViewerPanel";
import type { ViewerTab } from "./commanderViewerModel";

const taskTab: ViewerTab = {
  id: "task:issue-1",
  kind: "task",
  title: "Fix login",
  refId: "issue-1",
};

it("renders TaskDetail for a task tab with active=true and the issueId", () => {
  render(
    <TabBodySwitch
      activeId="task:issue-1"
      activeTab={taskTab}
      companyId="comp-1"
      conversationRefs={[]}
      onOpen={vi.fn()}
      onCloseTab={vi.fn()}
    />,
  );
  const el = screen.getByTestId("task-detail-mock");
  expect(el).toHaveAttribute("data-issue", "issue-1");
  expect(el).toHaveAttribute("data-active", "true");
});
