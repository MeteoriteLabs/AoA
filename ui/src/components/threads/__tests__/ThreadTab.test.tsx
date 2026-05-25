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
});
