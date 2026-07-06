import { describe, it, expect, vi, beforeAll } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { ThreadTab } from "../ThreadTab";
import type { DiscussionEntry } from "../../../api/discussions";

// jsdom does not implement scrollIntoView
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

vi.mock("../../../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "comp-1",
    selectedCompany: { id: "comp-1", name: "Test Corp", issuePrefix: "TC" },
  }),
}));

vi.mock("../../../context/DialogContext", () => ({
  useDialog: () => ({
    openDiscussionCapture: vi.fn(),
  }),
}));

vi.mock("../../../api/discussions", () => ({
  discussionsApi: {
    addEntry: vi.fn().mockResolvedValue({ id: "entry-new" }),
    reprocessEntry: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../../api/agents", () => ({
  agentsApi: {
    listAoa: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../../api/team", () => ({
  teamApi: {
    // Real TeamSummary always carries currentUser (non-optional) — useTeamAccess
    // (now consumed by ThreadTab for the founder-gated artifact actions) reads
    // currentUser.role/permissions, so the mock must include it.
    get: vi.fn().mockResolvedValue({
      currentUser: {
        userId: "user-1",
        role: "team_member",
        permissions: {
          canAssignTasks: false,
          canInviteUsers: false,
          canManageRoles: false,
          canEditIdentityMemory: false,
        },
      },
      members: [],
      pendingInvites: [],
    }),
  },
}));

vi.mock("../../../api/assets", () => ({
  assetsApi: {
    uploadFile: vi.fn().mockResolvedValue({
      assetId: "asset-1",
      originalFilename: "f.txt",
      contentType: "text/plain",
    }),
  },
}));

vi.mock("../../../api/auth", () => ({
  authApi: {
    getSession: vi.fn().mockResolvedValue({ userId: "user-1" }),
  },
}));

vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

function makeEntry(overrides: Partial<DiscussionEntry> = {}): DiscussionEntry {
  return {
    id: "entry-1",
    inputType: "write",
    rawContent: "We need to redesign the onboarding flow.",
    title: null,
    sourceInfo: null,
    departmentId: null,
    projectId: null,
    goalId: null,
    parentEntryId: null,
    authorAgentId: null,
    authorAgentName: null,
    authorAgentAvatar: null,
    extractionStatus: "completed",
    createdBy: "user-1",
    createdAt: "2026-01-01T09:00:00Z",
    extractedItems: [],
    annotations: [],
    ...overrides,
  };
}

describe("ThreadTab", () => {
  it("renders entries with their raw content", () => {
    const entries = [
      makeEntry({ id: "e1", rawContent: "First post content" }),
      makeEntry({ id: "e2", rawContent: "Second post content" }),
    ];
    renderWithProviders(
      <ThreadTab
        threadId="thread-1"
        companyId="comp-1"
        entries={entries}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("First post content")).toBeInTheDocument();
    expect(screen.getByText("Second post content")).toBeInTheDocument();
  });

  it("shows empty state message when there are no entries", () => {
    renderWithProviders(
      <ThreadTab
        threadId="thread-1"
        companyId="comp-1"
        entries={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });

  it("shows loading skeleton when isLoading is true", () => {
    renderWithProviders(
      <ThreadTab
        threadId="thread-1"
        companyId="comp-1"
        entries={[]}
        isLoading={true}
        isError={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId("thread-tab-skeleton")).toBeInTheDocument();
  });

  it("shows error state when isError is true", () => {
    renderWithProviders(
      <ThreadTab
        threadId="thread-1"
        companyId="comp-1"
        entries={[]}
        isLoading={false}
        isError={true}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId("thread-tab-error")).toBeInTheDocument();
  });

  it("renders entry content regardless of inputType", () => {
    const entries = [
      makeEntry({ id: "e1", inputType: "paste", rawContent: "Pasted content" }),
    ];
    renderWithProviders(
      <ThreadTab
        threadId="thread-1"
        companyId="comp-1"
        entries={entries}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("Pasted content")).toBeInTheDocument();
  });

  it("nests a reply under its parent with pl-10 indentation", () => {
    const entries = [
      makeEntry({ id: "parent", rawContent: "Parent post" }),
      makeEntry({ id: "child", rawContent: "Child reply", parentEntryId: "parent" }),
    ];
    renderWithProviders(
      <ThreadTab
        threadId="thread-1"
        companyId="comp-1"
        entries={entries}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );
    const childRow = screen.getByTestId("entry-row-child");
    // Child is wrapped in a pl-10 indent div
    expect(childRow.closest(".pl-10")).not.toBeNull();
    // Child is inside the parent's group wrapper
    const group = screen.getByTestId("entry-group-parent");
    expect(group).toContainElement(childRow);
  });

  it("does not render a reply as its own top-level row", () => {
    const entries = [
      makeEntry({ id: "parent", rawContent: "Parent post" }),
      makeEntry({ id: "child", rawContent: "Child reply", parentEntryId: "parent" }),
    ];
    renderWithProviders(
      <ThreadTab
        threadId="thread-1"
        companyId="comp-1"
        entries={entries}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );
    // Exactly one top-level group (the parent); the child is nested inside it
    expect(screen.getAllByTestId(/^entry-group-/)).toHaveLength(1);
  });

  it("sends a top-level message via the composer", async () => {
    const { fireEvent, waitFor } = await import("@testing-library/react");
    const { discussionsApi } = await import("../../../api/discussions");
    renderWithProviders(
      <ThreadTab
        threadId="thread-1"
        companyId="comp-1"
        entries={[]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
      />,
    );
    // Phase E1: composer test-ids moved to entry-composer-*
    fireEvent.change(screen.getByTestId("entry-composer-textarea"), {
      target: { value: "hello world" },
    });
    fireEvent.click(screen.getByTestId("entry-composer-submit"));
    await waitFor(() =>
      expect(discussionsApi.addEntry).toHaveBeenCalledWith(
        "comp-1",
        "thread-1",
        expect.objectContaining({ rawContent: "hello world", parentEntryId: null }),
      ),
    );
  });
});
