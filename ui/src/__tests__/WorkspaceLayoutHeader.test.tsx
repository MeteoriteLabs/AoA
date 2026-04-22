import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// --- Mock sidebar context (desktop mode for header visibility) ---
const mockSidebarValue = {
  sidebarOpen: true,
  setSidebarOpen: vi.fn(),
  toggleSidebar: vi.fn(),
  isMobile: false,
  collapsed: false,
  setCollapsed: vi.fn(),
  toggleCollapse: vi.fn(),
};

vi.mock("../context/SidebarContext", () => ({
  useSidebar: () => mockSidebarValue,
}));

// --- Mock heavy child components so we only exercise the header ---
vi.mock("../components/workspace/WorkspaceTaskNav", () => ({
  WorkspaceTaskNav: () => <div data-testid="mock-task-nav">TaskNav</div>,
}));

vi.mock("../components/workspace/WorkspaceTimeline", () => ({
  WorkspaceTimeline: () => <div data-testid="mock-timeline">Timeline</div>,
}));

vi.mock("../components/workspace/WorkspacePreviewPanel", () => ({
  WorkspacePreviewPanel: () => <div data-testid="mock-preview">Preview</div>,
  PreviewModeToolbar: () => null,
}));

vi.mock("../components/workspace/WorkspaceRightPanel", () => ({
  WorkspaceRightPanel: () => <div data-testid="mock-right-panel">RightPanel</div>,
}));

vi.mock("../components/workspace/DependencyChain", () => ({
  DependencyChain: () => null,
}));

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: any) => <div data-testid="resizable-group">{children}</div>,
  Panel: ({ children, ...props }: any) => <div data-testid={props["data-testid"]}>{children}</div>,
  Separator: () => <div />,
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: vi.fn() }),
}));

import { WorkspaceLayout } from "../components/workspace/WorkspaceLayout";

const mockWorkspace = {
  id: "ws-1",
  companyId: "comp-1",
  projectId: "proj-1",
  projectWorkspaceId: null,
  sourceIssueId: "issue-1",
  mode: "isolated_workspace",
  strategyType: "git_worktree",
  name: "feature-login",
  status: "active",
  cwd: "/repo/.paperclip/worktrees/feature-login",
  repoUrl: null,
  baseRef: "main",
  branchName: "feature-login",
  providerType: "git_worktree",
  providerRef: null,
  derivedFromExecutionWorkspaceId: null,
  lastUsedAt: new Date(),
  openedAt: new Date(),
  closedAt: null,
  cleanupEligibleAt: null,
  cleanupReason: null,
  metadata: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function renderLayout() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkspaceLayout
          workspace={mockWorkspace as any}
          project={null}
          selectedIssueId={"issue-1"}
          onSelectIssue={vi.fn()}
          companyId="comp-1"
          companyPrefix="tc"
          onBack={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WorkspaceLayout header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSidebarValue.isMobile = false;
  });

  it("renders workspace name and branch", () => {
    renderLayout();
    expect(screen.getByTestId("workspace-header-name")).toHaveTextContent("feature-login");
    expect(screen.getByTestId("workspace-header-branch")).toHaveTextContent("on feature-login");
  });

  it("renders kebab menu with Settings (disabled, Task 10) + Archive (enabled)", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByTestId("workspace-header-menu-trigger"));

    const settingsItem = await screen.findByRole("menuitem", { name: /settings/i });
    const archiveItem = await screen.findByRole("menuitem", { name: /archive/i });

    expect(settingsItem).toHaveAttribute("aria-disabled", "true");
    // Archive is now wired (Task 5). Only disabled when workspace is already archived.
    expect(archiveItem).not.toHaveAttribute("aria-disabled", "true");
  });

  it("disables Archive kebab item when workspace is already archived", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <WorkspaceLayout
            workspace={{ ...mockWorkspace, status: "archived" } as any}
            project={null}
            selectedIssueId={"issue-1"}
            onSelectIssue={vi.fn()}
            companyId="comp-1"
            companyPrefix="tc"
            onBack={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(screen.getByTestId("workspace-header-menu-trigger"));

    const archiveItem = await screen.findByRole("menuitem", { name: /archive/i });
    expect(archiveItem).toHaveAttribute("aria-disabled", "true");
  });
});
