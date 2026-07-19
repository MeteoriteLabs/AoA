import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { FirstJobStep } from "../FirstJobStep";

const issuesCreate = vi.hoisted(() =>
  vi.fn(async (_companyId: string, data: Record<string, unknown>) => ({
    id: "issue-1",
    title: data.title,
  })),
);
vi.mock("../../../api/issues", () => ({
  issuesApi: { create: issuesCreate },
}));

const discussionsCreate = vi.hoisted(() =>
  vi.fn(async (_companyId: string, data: Record<string, unknown>) => ({
    id: "disc-1",
    title: data.title,
  })),
);
vi.mock("../../../api/discussions", () => ({
  discussionsApi: { create: discussionsCreate },
}));

const agentsList = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
vi.mock("../../../api/agents", () => ({
  agentsApi: { list: agentsList },
}));

// This surface is domain-only — like DefineDepartments/CreateAgents — and
// must never call advanceOnboarding. Mocked as a regression guard.
const advanceOnboarding = vi.hoisted(() => vi.fn());
vi.mock("../../../api/onboarding", () => ({ advanceOnboarding }));

describe("FirstJobStep (WS8 — In-flight standalone surface)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentsList.mockResolvedValue([]);
  });

  it("renders both cards (create task / start discussion) plus Skip", async () => {
    render(<FirstJobStep companyId="c1" onDone={vi.fn()} />);
    expect(screen.getByText("Create a task")).toBeTruthy();
    expect(screen.getByText("Start a discussion")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip to Home" })).toBeTruthy();
    expect(advanceOnboarding).not.toHaveBeenCalled();
    // Flush the agentsApi.list effect (wrapped in act via waitFor) so the
    // pending-state update doesn't leak into a later test.
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
  });

  it("assignee picker is populated from agentsApi.list, preferring org agents over hidden aoa crew", async () => {
    agentsList.mockResolvedValue([
      { id: "agent-1", kind: "org", name: "Scout" },
      { id: "agent-2", kind: "aoa", name: "Adjutant" },
    ]);
    render(<FirstJobStep companyId="c1" onDone={vi.fn()} />);

    const select = (await screen.findByLabelText("Assignee")) as HTMLSelectElement;
    await waitFor(() => expect(screen.getByRole("option", { name: "Scout" })).toBeTruthy());
    expect(within(select).queryByText("Adjutant")).toBeNull();
    expect(screen.getByRole("option", { name: "Unassigned" })).toBeTruthy();
  });

  it("create-task path: creates a task with the chosen title + assignee, then calls onDone once", async () => {
    agentsList.mockResolvedValue([{ id: "agent-1", kind: "org", name: "Scout" }]);
    const onDone = vi.fn();
    render(<FirstJobStep companyId="c1" onDone={onDone} />);

    const select = (await screen.findByLabelText("Assignee")) as HTMLSelectElement;
    await waitFor(() => expect(screen.getByRole("option", { name: "Scout" })).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Write the launch memo" } });
    fireEvent.change(select, { target: { value: "agent-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(issuesCreate).toHaveBeenCalledTimes(1));
    expect(issuesCreate).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({
        title: "Write the launch memo",
        status: "todo",
        assigneeAgentId: "agent-1",
      }),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(discussionsCreate).not.toHaveBeenCalled();
    expect(advanceOnboarding).not.toHaveBeenCalled();
  });

  it("start-discussion path: creates a discussion via the API, then calls onDone once", async () => {
    const onDone = vi.fn();
    render(<FirstJobStep companyId="c1" onDone={onDone} />);

    fireEvent.change(screen.getByLabelText("Discussion topic"), {
      target: { value: "How should we price v1?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start discussion" }));

    await waitFor(() => expect(discussionsCreate).toHaveBeenCalledTimes(1));
    expect(discussionsCreate).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ title: "How should we price v1?" }),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(issuesCreate).not.toHaveBeenCalled();
  });

  it("Skip to Home calls onDone once and creates nothing", async () => {
    const onDone = vi.fn();
    render(<FirstJobStep companyId="c1" onDone={onDone} />);
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Skip to Home" }));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(issuesCreate).not.toHaveBeenCalled();
    expect(discussionsCreate).not.toHaveBeenCalled();
  });

  it("onDone fires exactly once even on a rapid double-submit across both cards", async () => {
    let resolveIssue: (v: unknown) => void = () => {};
    issuesCreate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveIssue = resolve;
        }),
    );
    let resolveDiscussion: (v: unknown) => void = () => {};
    discussionsCreate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDiscussion = resolve;
        }),
    );

    const onDone = vi.fn();
    render(<FirstJobStep companyId="c1" onDone={onDone} />);

    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Task A" } });
    fireEvent.change(screen.getByLabelText("Discussion topic"), { target: { value: "Topic A" } });

    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    fireEvent.click(screen.getByRole("button", { name: "Start discussion" }));

    resolveIssue({ id: "issue-1", title: "Task A" });
    resolveDiscussion({ id: "disc-1", title: "Topic A" });

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    // Give any trailing microtasks a chance to run before asserting the count stays 1.
    await new Promise((r) => setTimeout(r, 0));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("shows a per-card error and does not call onDone when the task create fails", async () => {
    issuesCreate.mockRejectedValueOnce(new Error("boom"));
    const onDone = vi.fn();
    render(<FirstJobStep companyId="c1" onDone={onDone} />);

    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Task A" } });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    expect(await screen.findByText("boom")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    // The other card is unaffected and still submittable.
    expect(screen.getByRole("button", { name: "Start discussion" })).toBeTruthy();
  });
});
