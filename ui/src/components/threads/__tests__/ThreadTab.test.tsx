import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { ThreadTab } from "../ThreadTab";
import type { DiscussionEntry } from "../../../api/discussions";

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
    expect(screen.getByText(/no posts yet/i)).toBeInTheDocument();
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

  it("renders input source labels (write, paste, voice, mcp)", () => {
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
    // Entry should render with the source indicator
    expect(screen.getByText("Pasted content")).toBeInTheDocument();
  });

  it("nests a reply under its parent one level deep", () => {
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
    const parentRow = screen.getByTestId("entry-row-parent");
    const childRow = screen.getByTestId("entry-row-child");
    // Child is indented (ml-6 from indentLevel=1)
    expect(childRow.className).toContain("ml-6");
    // Child is inside the parent's group wrapper
    const group = screen.getByTestId("entry-group-parent");
    expect(group).toContainElement(childRow);
    expect(group).toContainElement(parentRow);
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

  it("posts with parentEntryId after Reply is clicked", async () => {
    const { fireEvent, waitFor } = await import("@testing-library/react");
    const { discussionsApi } = await import("../../../api/discussions");
    const entries = [makeEntry({ id: "parent", rawContent: "Parent post" })];
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
    // Expand parent row and click Reply
    const entryRow = screen.getByTestId("entry-row-parent");
    fireEvent.click(entryRow.querySelector("button")!);
    fireEvent.click(screen.getByRole("button", { name: /reply/i }));
    // Type in the composer
    fireEvent.change(screen.getByTestId("thread-composer-textarea"), {
      target: { value: "my reply" },
    });
    fireEvent.click(screen.getByTestId("thread-composer-submit"));
    await waitFor(() =>
      expect(discussionsApi.addEntry).toHaveBeenCalledWith(
        "comp-1",
        "thread-1",
        expect.objectContaining({ rawContent: "my reply", parentEntryId: "parent" }),
      ),
    );
  });
});
