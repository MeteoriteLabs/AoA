import { describe, expect, it, vi } from "vitest";
import { shouldDispatchIssueWakeup } from "../routes/issues-planning-mode-dispatch.js";
import { queueIssueAssignmentWakeup } from "../services/issue-assignment-wakeup.js";

describe("planning-mode dispatch gate — integration", () => {
  it("does not fire wakeup for planning-mode issue with active status", () => {
    const wakeup = vi.fn();

    const issue = {
      assigneeAgentId: "agent-123",
      status: "todo",
      workMode: "planning",
    };

    if (
      issue.assigneeAgentId &&
      issue.status !== "backlog" &&
      shouldDispatchIssueWakeup(issue)
    ) {
      wakeup(issue.assigneeAgentId);
    }

    expect(wakeup).not.toHaveBeenCalled();
  });

  it("fires wakeup for standard-mode issue with active status", () => {
    const wakeup = vi.fn();

    const issue = {
      assigneeAgentId: "agent-123",
      status: "todo",
      workMode: "standard",
    };

    if (
      issue.assigneeAgentId &&
      issue.status !== "backlog" &&
      shouldDispatchIssueWakeup(issue)
    ) {
      wakeup(issue.assigneeAgentId);
    }

    expect(wakeup).toHaveBeenCalledWith("agent-123");
  });

  it("does not fire wakeup for backlog planning-mode issue (double-gated)", () => {
    const wakeup = vi.fn();

    const issue = {
      assigneeAgentId: "agent-123",
      status: "backlog",
      workMode: "planning",
    };

    if (
      issue.assigneeAgentId &&
      issue.status !== "backlog" &&
      shouldDispatchIssueWakeup(issue)
    ) {
      wakeup(issue.assigneeAgentId);
    }

    expect(wakeup).not.toHaveBeenCalled();
  });
});

describe("automated-dispatch gates", () => {
  it("queueIssueAssignmentWakeup skips planning-mode issues", async () => {
    const wakeup = vi.fn().mockResolvedValue(null);
    const heartbeat = { wakeup };

    await queueIssueAssignmentWakeup({
      heartbeat,
      issue: { id: "i1", assigneeAgentId: "agent-1", status: "todo", workMode: "planning" },
      reason: "routine assignment",
      mutation: "create",
      contextSource: "routine",
    });

    expect(wakeup).not.toHaveBeenCalled();
  });

  it("queueIssueAssignmentWakeup fires for standard-mode issues", async () => {
    const wakeup = vi.fn().mockResolvedValue(null);
    const heartbeat = { wakeup };

    await queueIssueAssignmentWakeup({
      heartbeat,
      issue: { id: "i2", assigneeAgentId: "agent-1", status: "todo", workMode: "standard" },
      reason: "routine assignment",
      mutation: "create",
      contextSource: "routine",
    });

    expect(wakeup).toHaveBeenCalledOnce();
  });
});
