/**
 * Phase 3b: Component tests for the 5 presentational cockpit cards.
 * All cards receive data directly (no query mocking needed — they are pure
 * presentational components).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CockpitData, CommanderOutputRef } from "@armyofagents/shared";

// Mock queryKeys and cockpitApi for the panel test (panel tests come later)
vi.mock("../../../api/cockpit", () => ({
  cockpitApi: { get: vi.fn().mockResolvedValue({ running: [], review: [], myTasks: [], today: { reminders: [], dueTasks: [] }, discussions: [], approvals: [], pinned: [], goalsAtRisk: [], budgetPulse: null, doneToday: [] } satisfies CockpitData) },
}));
vi.mock("../../../lib/queryKeys", () => ({
  queryKeys: { cockpit: (id: string) => ["cockpit", id] },
}));
// Phase 3d: useCockpitPin calls useToast — mock it so panel tests don't need ToastProvider.
vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));
// Phase 3d: pinsApi — mock so useCockpitPin mutations don't make real network calls.
vi.mock("../../../api/pins", () => ({
  pinsApi: {
    pin: vi.fn().mockResolvedValue(undefined),
    unpin: vi.fn().mockResolvedValue(undefined),
  },
}));

import { CommanderCockpitPanel } from "./CommanderCockpitPanel";
import { CockpitRunningCard } from "./CockpitRunningCard";
import { CockpitReviewCard } from "./CockpitReviewCard";
import { CockpitMyTasksCard } from "./CockpitMyTasksCard";
import { CockpitTodayCard } from "./CockpitTodayCard";
import { CockpitDiscussionsCard } from "./CockpitDiscussionsCard";

// ── Data factories ─────────────────────────────────────────────────────────

type RunItem = CockpitData["running"][0];
type TaskItem = CockpitData["review"][0];
type ReminderItem = CockpitData["today"]["reminders"][0];
type DiscussionItem = CockpitData["discussions"][0];

function makeRun(overrides?: Partial<RunItem>): RunItem {
  return { id: "run-1", agentName: "Atlas", status: "running", startedAt: null, issueId: "issue-1", ...overrides };
}

function makeTask(overrides?: Partial<TaskItem>): TaskItem {
  return {
    id: "task-1",
    identifier: "ACME-1",
    title: "Fix the login flow",
    status: "in_review",
    assigneeUserId: "u1",
    assigneeAgentId: null,
    dueDate: null,
    ...overrides,
  };
}

function makeReminder(overrides?: Partial<ReminderItem>): ReminderItem {
  return { id: "rem-1", content: "Review Q2 roadmap", triggerAt: new Date().toISOString(), ...overrides };
}

function makeDiscussion(overrides?: Partial<DiscussionItem>): DiscussionItem {
  return { id: "disc-1", title: "Sprint planning", pendingItemCount: 3, reason: "pending_items", ...overrides };
}

// ── Panel: card rendering from shared data ─────────────────────────────────

describe("CommanderCockpitPanel with shared data", () => {
  it("renders the Running card when data.running is non-empty", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["cockpit", "comp-1"], {
      running: [makeRun()],
      review: [],
      myTasks: [],
      today: { reminders: [], dueTasks: [] },
      discussions: [],
      approvals: [],
      pinned: [],
      goalsAtRisk: [],
      budgetPulse: null,
      doneToday: [],
    } satisfies CockpitData);

    render(
      <QueryClientProvider client={qc}>
        <CommanderCockpitPanel companyId="comp-1" onCollapse={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("cockpit-card-running")).toBeInTheDocument();
  });

  it("renders the Review card when data.review is non-empty", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["cockpit", "comp-1"], {
      running: [],
      review: [makeTask({ status: "in_review" })],
      myTasks: [],
      today: { reminders: [], dueTasks: [] },
      discussions: [],
      approvals: [],
      pinned: [],
      goalsAtRisk: [],
      budgetPulse: null,
      doneToday: [],
    } satisfies CockpitData);

    render(
      <QueryClientProvider client={qc}>
        <CommanderCockpitPanel companyId="comp-1" onCollapse={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("cockpit-card-review")).toBeInTheDocument();
  });

  it("renders 'All clear' when all slices are empty", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["cockpit", "comp-1"], {
      running: [],
      review: [],
      myTasks: [],
      today: { reminders: [], dueTasks: [] },
      discussions: [],
      approvals: [],
      pinned: [],
      goalsAtRisk: [],
      budgetPulse: null,
      doneToday: [],
    } satisfies CockpitData);

    render(
      <QueryClientProvider client={qc}>
        <CommanderCockpitPanel companyId="comp-1" onCollapse={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/all clear/i)).toBeInTheDocument();
  });
});

// ── CockpitRunningCard ─────────────────────────────────────────────────────

describe("CockpitRunningCard", () => {
  it("renders null when runs is empty", () => {
    const { container } = render(<CockpitRunningCard runs={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows agent name", () => {
    render(<CockpitRunningCard runs={[makeRun({ agentName: "Atlas" })]} />);
    expect(screen.getByText("Atlas")).toBeInTheDocument();
  });

  it("row click calls onOpenTask with issueId", () => {
    const onOpenTask = vi.fn();
    render(<CockpitRunningCard runs={[makeRun({ issueId: "issue-42", agentName: "Atlas" })]} onOpenTask={onOpenTask} />);
    fireEvent.click(screen.getByText("Atlas"));
    expect(onOpenTask).toHaveBeenCalledWith("issue-42", expect.any(String));
  });

  it("Ask↩ button calls onAsk with a scoped string", () => {
    const onAsk = vi.fn();
    render(<CockpitRunningCard runs={[makeRun({ agentName: "Atlas" })]} onAsk={onAsk} />);
    // The Ask button is hidden until hover — use fireEvent directly
    const askBtn = screen.getByRole("button", { name: /ask commander about this/i });
    fireEvent.click(askBtn);
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining("Atlas"));
  });
});

// ── CockpitReviewCard ──────────────────────────────────────────────────────

describe("CockpitReviewCard", () => {
  it("renders null when items is empty", () => {
    const { container } = render(<CockpitReviewCard items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows task title", () => {
    render(<CockpitReviewCard items={[makeTask({ title: "Fix the login flow" })]} />);
    expect(screen.getByText("Fix the login flow")).toBeInTheDocument();
  });

  it("row click calls onOpenTask(id, title)", () => {
    const onOpenTask = vi.fn();
    render(<CockpitReviewCard items={[makeTask({ id: "t-1", title: "Fix the login flow" })]} onOpenTask={onOpenTask} />);
    fireEvent.click(screen.getByText("Fix the login flow"));
    expect(onOpenTask).toHaveBeenCalledWith("t-1", "Fix the login flow");
  });

  it("Ask↩ button calls onAsk with scoped string including identifier", () => {
    const onAsk = vi.fn();
    render(<CockpitReviewCard items={[makeTask({ identifier: "ACME-1", title: "Fix the login flow" })]} onAsk={onAsk} />);
    const askBtn = screen.getByRole("button", { name: /ask commander about this/i });
    fireEvent.click(askBtn);
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining("ACME-1"));
  });
});

// ── CockpitMyTasksCard ─────────────────────────────────────────────────────

describe("CockpitMyTasksCard", () => {
  it("renders null when items is empty", () => {
    const { container } = render(<CockpitMyTasksCard items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows items grouped by status", () => {
    render(
      <CockpitMyTasksCard
        items={[
          makeTask({ id: "t1", status: "todo", title: "Write docs" }),
          makeTask({ id: "t2", status: "in_progress", title: "Build API" }),
        ]}
      />,
    );
    expect(screen.getByText("Write docs")).toBeInTheDocument();
    expect(screen.getByText("Build API")).toBeInTheDocument();
  });

  it("row click calls onOpenTask", () => {
    const onOpenTask = vi.fn();
    render(
      <CockpitMyTasksCard items={[makeTask({ id: "t-42", title: "Write docs" })]} onOpenTask={onOpenTask} />,
    );
    fireEvent.click(screen.getByText("Write docs"));
    expect(onOpenTask).toHaveBeenCalledWith("t-42", "Write docs");
  });
});

// ── CockpitTodayCard ───────────────────────────────────────────────────────

describe("CockpitTodayCard", () => {
  it("renders null when no reminders and no dueTasks", () => {
    const { container } = render(<CockpitTodayCard reminders={[]} dueTasks={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows reminder content", () => {
    render(<CockpitTodayCard reminders={[makeReminder({ content: "Review Q2 roadmap" })]} dueTasks={[]} />);
    expect(screen.getByText("Review Q2 roadmap")).toBeInTheDocument();
  });

  it("due task row click calls onOpenTask", () => {
    const onOpenTask = vi.fn();
    render(
      <CockpitTodayCard
        reminders={[]}
        dueTasks={[makeTask({ id: "due-1", title: "Ship v1" })]}
        onOpenTask={onOpenTask}
      />,
    );
    fireEvent.click(screen.getByText("Ship v1"));
    expect(onOpenTask).toHaveBeenCalledWith("due-1", "Ship v1");
  });
});

// ── CockpitReviewCard — Pin button (Phase 3d) ──────────────────────────────

describe("CockpitReviewCard — Pin button", () => {
  it("Pin button calls onPin('task', id)", () => {
    const onPin = vi.fn();
    render(
      <CockpitReviewCard
        items={[makeTask({ id: "t-pin-1", title: "Pinnable task" })]}
        onPin={onPin}
      />,
    );
    const pinBtn = screen.getByRole("button", { name: /^pin$/i });
    fireEvent.click(pinBtn);
    expect(onPin).toHaveBeenCalledWith("task", "t-pin-1");
  });

  it("Pin button is absent when onPin is not provided", () => {
    render(<CockpitReviewCard items={[makeTask({ title: "No pin card" })]} />);
    expect(screen.queryByRole("button", { name: /^pin$/i })).not.toBeInTheDocument();
  });
});

// ── CockpitDiscussionsCard ─────────────────────────────────────────────────

describe("CockpitDiscussionsCard", () => {
  it("renders null when items is empty", () => {
    const { container } = render(<CockpitDiscussionsCard items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows discussion title", () => {
    render(<CockpitDiscussionsCard items={[makeDiscussion({ title: "Sprint planning" })]} />);
    expect(screen.getByText("Sprint planning")).toBeInTheDocument();
  });

  it("row click calls onOpenFullPage with /discussions/:id", () => {
    const onOpenFullPage = vi.fn();
    render(
      <CockpitDiscussionsCard
        items={[makeDiscussion({ id: "disc-99", title: "Sprint planning" })]}
        onOpenFullPage={onOpenFullPage}
      />,
    );
    fireEvent.click(screen.getByText("Sprint planning"));
    expect(onOpenFullPage).toHaveBeenCalledWith("/discussions/disc-99");
  });

  it("Ask↩ button calls onAsk with discussion title", () => {
    const onAsk = vi.fn();
    render(
      <CockpitDiscussionsCard
        items={[makeDiscussion({ title: "Sprint planning" })]}
        onAsk={onAsk}
      />,
    );
    const askBtn = screen.getByRole("button", { name: /ask commander about this/i });
    fireEvent.click(askBtn);
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining("Sprint planning"));
  });
});

// ── CommanderCockpitPanel + CockpitConversationZone integration ───────────────

function makeConversationRef(overrides?: Partial<CommanderOutputRef>): CommanderOutputRef {
  return {
    v: 1,
    kind: "artifact",
    id: "artifact-zone-1",
    versionId: "ver-zone-1",
    title: "Zone Artifact",
    action: "created",
    ...overrides,
  };
}

function renderPanelWithRefs(conversationRefs: CommanderOutputRef[], data: CockpitData) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["cockpit", "comp-zone"], data);
  render(
    <QueryClientProvider client={qc}>
      <CommanderCockpitPanel
        companyId="comp-zone"
        onCollapse={vi.fn()}
        conversationRefs={conversationRefs}
      />
    </QueryClientProvider>,
  );
  return qc;
}

const EMPTY_COCKPIT: CockpitData = {
  running: [],
  review: [],
  myTasks: [],
  today: { reminders: [], dueTasks: [] },
  discussions: [],
  approvals: [],
  pinned: [],
  goalsAtRisk: [],
  budgetPulse: null,
  doneToday: [],
};

describe("CommanderCockpitPanel — CockpitConversationZone integration", () => {
  it("zone renders when conversationRefs is non-empty, even if all cards are empty", () => {
    renderPanelWithRefs([makeConversationRef()], EMPTY_COCKPIT);
    expect(screen.getByTestId("cockpit-zone-conversation")).toBeInTheDocument();
  });

  it("'All clear' does NOT appear when conversationRefs is non-empty (even if all cards empty)", async () => {
    renderPanelWithRefs([makeConversationRef()], EMPTY_COCKPIT);
    // Zone is showing — All clear must be suppressed
    expect(screen.queryByText(/all clear/i)).not.toBeInTheDocument();
  });

  it("'All clear' appears when BOTH conversationRefs is empty AND all cards are empty", async () => {
    renderPanelWithRefs([], EMPTY_COCKPIT);
    expect(await screen.findByText(/all clear/i)).toBeInTheDocument();
  });

  it("zone title is shown in the panel", () => {
    renderPanelWithRefs([makeConversationRef({ title: "Zone Artifact" })], EMPTY_COCKPIT);
    expect(screen.getByText("Zone Artifact")).toBeInTheDocument();
  });
});
