import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import type { Issue } from "@armyofagents/shared";
import { KanbanBoard } from "../components/KanbanBoard";

/**
 * Tests for the enriched shared KanbanCard meta row (unified-crew-board T1):
 * owner avatar (🤖 agent / 👤 human), clickable source badge (lineage), and
 * artifact chip. The card renders on BOTH the main Tasks board and the Crew
 * Board, so these assertions guard both surfaces at once.
 */

// The card's outer Link and the source-badge navigate both resolve the active
// company prefix via useCompany. Mock it with no selected company so paths stay
// un-prefixed and navigation assertions read cleanly.
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: null,
    selectedCompanyId: null,
    companies: [],
  }),
}));

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-1",
    companyId: "comp-1",
    projectId: null,
    goalId: null,
    parentId: null,
    title: "Build first-action prompt flow",
    description: null,
    status: "in_progress",
    priority: "high",
    workMode: "standard",
    assigneeAgentId: null,
    assigneeUserId: null,
    checkoutRunId: null,
    executionRunId: null,
    executionAgentNameKey: null,
    executionLockedAt: null,
    executionWorkspaceId: null,
    executionEnvironmentId: null,
    executionWorkspacePreference: null,
    executionWorkspaceSettings: null,
    createdByAgentId: null,
    createdByUserId: null,
    issueNumber: 13,
    identifier: "QAC-13",
    requestDepth: 0,
    billingCode: null,
    assigneeAdapterOverrides: null,
    source: null,
    sourceDiscussionId: null,
    sourceThreadTitle: null,
    reviewerUserId: null,
    dueDate: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    hiddenAt: null,
    artifactId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Issue;
}

/** Renders the board with a location probe so we can assert navigation. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname}</div>;
}

function renderBoard(
  issue: Issue,
  opts: {
    agents?: { id: string; name: string }[];
    onSelectIssue?: (id: string) => void;
  } = {},
) {
  return render(
    <MemoryRouter initialEntries={["/board"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <KanbanBoard
                issues={[issue]}
                agents={opts.agents}
                onUpdateIssue={vi.fn()}
                onSelectIssue={opts.onSelectIssue}
              />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("KanbanCard — owner", () => {
  it("renders the agent avatar + name for an agent-assigned task", () => {
    const issue = makeIssue({ assigneeAgentId: "agent-9" });
    renderBoard(issue, { agents: [{ id: "agent-9", name: "Engineer" }] });

    // Agent owner: shared AgentAvatar (robot) + the agent name.
    expect(screen.getAllByTestId("agent-avatar").length).toBeGreaterThan(0);
    expect(screen.getByText("Engineer")).toBeTruthy();
  });

  it("renders human initials (not the robot) for a human-assigned task", () => {
    const issue = makeIssue({ assigneeUserId: "Ada Lovelace" });
    renderBoard(issue);

    // Human owner uses Identity initials — no agent robot avatar present.
    expect(screen.queryByTestId("agent-avatar")).toBeNull();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
  });
});

describe("KanbanCard — source badge (lineage)", () => {
  it("shows the discussion thread title and links to the origin", async () => {
    const user = userEvent.setup();
    const onSelectIssue = vi.fn();
    const issue = makeIssue({
      sourceThreadTitle: "QA6-drive",
      sourceDiscussionId: "disc-77",
    });
    renderBoard(issue, { onSelectIssue });

    const badge = screen.getByTitle("From discussion: QA6-drive");
    expect(badge).toBeTruthy();
    // Truncated/exact thread title appears in the badge label.
    expect(within(badge).getByText("QA6-drive")).toBeTruthy();
    expect(badge.getAttribute("role")).toBe("link");

    // Clicking the badge navigates to the discussion and does NOT open the
    // card slide-over (stopPropagation/preventDefault on the outer Link).
    await user.click(badge);
    expect(screen.getByTestId("location").textContent).toContain("/discussions/disc-77");
    expect(onSelectIssue).not.toHaveBeenCalled();
  });

  it("links a goal-scoped task to its goal", () => {
    const issue = makeIssue({ goalId: "goal-3" });
    renderBoard(issue);

    const badge = screen.getByTitle("Serves a goal");
    expect(badge.getAttribute("role")).toBe("link");
    expect(within(badge).getByText("goal")).toBeTruthy();
  });

  it("renders a faint non-clickable 'direct' label for context-free tasks", () => {
    const issue = makeIssue();
    renderBoard(issue);

    const badge = screen.getByTitle("Created directly");
    // Not a link — direct tasks have no navigable origin.
    expect(badge.getAttribute("role")).not.toBe("link");
    expect(within(badge).getByText("direct")).toBeTruthy();
  });
});

describe("KanbanCard — artifact chip", () => {
  it("renders the artifact chip only when artifactId is present", () => {
    const withArtifact = makeIssue({ artifactId: "artifact-1" });
    const { unmount } = renderBoard(withArtifact);
    expect(screen.getByTestId("kanban-artifact-chip")).toBeTruthy();
    unmount();

    const withoutArtifact = makeIssue();
    renderBoard(withoutArtifact);
    expect(screen.queryByTestId("kanban-artifact-chip")).toBeNull();
  });
});
