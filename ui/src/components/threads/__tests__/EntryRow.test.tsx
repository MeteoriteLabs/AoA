import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { EntryRow } from "../EntryRow";
import type { DiscussionEntry } from "../../../api/discussions";

function makeEntry(overrides: Partial<DiscussionEntry> = {}): DiscussionEntry {
  return {
    id: "e1",
    inputType: "write",
    rawContent: "We should ship Threads.",
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

describe("EntryRow — agent authorship", () => {
  it("renders the agent name and an Agent badge for an agent entry", () => {
    renderWithProviders(
      <EntryRow
        entry={makeEntry({
          inputType: "agent",
          authorAgentId: "agent-7",
          authorAgentName: "Scribe",
          authorAgentAvatar: null,
        })}
        onReprocess={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Scribe").length).toBeGreaterThan(0); // name + role badge
    expect(screen.getByTestId("entry-author-badge-agent")).toBeInTheDocument();
  });

  it("renders the human author (no Agent badge) for a human entry", () => {
    renderWithProviders(
      <EntryRow
        entry={makeEntry({ createdBy: "jane-doe" })}
        onReprocess={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("entry-author-badge-agent")).not.toBeInTheDocument();
  });

  it("right-aligns the bubble when currentUserId matches entry.createdBy", () => {
    renderWithProviders(
      <EntryRow
        entry={makeEntry({ id: "e-42", createdBy: "user-1" })}
        currentUserId="user-1"
        onReprocess={vi.fn()}
      />,
    );
    const row = screen.getByTestId("entry-row-e-42");
    expect(row.getAttribute("data-entry-type")).toBe("me");
  });

  it("left-aligns the bubble when currentUserId does not match", () => {
    renderWithProviders(
      <EntryRow
        entry={makeEntry({ id: "e-43", createdBy: "user-1" })}
        currentUserId="user-99"
        onReprocess={vi.fn()}
      />,
    );
    const row = screen.getByTestId("entry-row-e-43");
    expect(row.getAttribute("data-entry-type")).toBe("human");
  });

  it("does not render a Reply button", () => {
    renderWithProviders(
      <EntryRow entry={makeEntry()} onReprocess={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /reply/i })).not.toBeInTheDocument();
  });

  it("does not render an Annotate button", () => {
    renderWithProviders(
      <EntryRow entry={makeEntry()} onReprocess={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /annotate/i })).not.toBeInTheDocument();
  });
});

describe("EntryRow — system notices", () => {
  function makeSystemNoticeEntry(overrides: Partial<DiscussionEntry> = {}): DiscussionEntry {
    return makeEntry({
      sourceInfo: { systemNotice: true },
      rawContent: "This is a system notice message.",
      ...overrides,
    });
  }

  it("renders with data-testid entry-system-notice when sourceInfo.systemNotice is true", () => {
    renderWithProviders(
      <EntryRow
        entry={makeSystemNoticeEntry()}
        onReprocess={vi.fn()}
      />,
    );
    expect(screen.getByTestId("entry-system-notice")).toBeInTheDocument();
  });

  it("does not render a Reply button for system notices", () => {
    renderWithProviders(
      <EntryRow
        entry={makeSystemNoticeEntry()}
        onReprocess={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /reply/i })).not.toBeInTheDocument();
  });

  it("renders the content without a collapse toggle for system notices", () => {
    renderWithProviders(
      <EntryRow
        entry={makeSystemNoticeEntry({ rawContent: "System-level event occurred." })}
        onReprocess={vi.fn()}
      />,
    );
    // Content is always visible — no toggle button needed
    expect(screen.getByText("System-level event occurred.")).toBeInTheDocument();
    // No aria-expanded toggle button should be present
    expect(screen.queryByRole("button", { expanded: false })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { expanded: true })).not.toBeInTheDocument();
  });

  it("renders a System notice label", () => {
    renderWithProviders(
      <EntryRow
        entry={makeSystemNoticeEntry()}
        onReprocess={vi.fn()}
      />,
    );
    expect(screen.getByText("System notice")).toBeInTheDocument();
  });
});
