import { describe, expect, it, vi } from "vitest";
import type { CommanderInputRef } from "@armyofagents/shared";
import {
  buildCommanderInputRefState,
  openCommanderInputRef,
  type CommanderInputRefOpenDeps,
} from "./InternalAgentPanel";

const taskRef: CommanderInputRef = {
  v: 1,
  kind: "task",
  id: "task-1",
  label: "Fix login",
  route: "/issues/task-1",
};

const inboxRef: CommanderInputRef = {
  v: 1,
  kind: "inbox",
  id: "hub-1",
  label: "Approve budget",
  route: "/inbox/waiting/hub-1",
};

describe("Commander input refs", () => {
  it("adds a new ref once and reports duplicate refs for emphasis", () => {
    const first = buildCommanderInputRefState([], taskRef);
    expect(first).toEqual({
      refs: [taskRef],
      duplicateKey: null,
    });

    const second = buildCommanderInputRefState(first.refs, taskRef);
    expect(second).toEqual({
      refs: [taskRef],
      duplicateKey: "task:task-1",
    });
  });

  it("opens supported refs in the Commander viewer instead of navigating away", () => {
    const deps: CommanderInputRefOpenDeps = {
      openPreview: vi.fn(),
      openTask: vi.fn(),
      openArtifact: vi.fn(),
      openInputRef: vi.fn(),
      navigate: vi.fn(),
    };

    openCommanderInputRef(taskRef, deps);
    expect(deps.openPreview).toHaveBeenCalledWith("right-panel");
    expect(deps.openInputRef).toHaveBeenCalledWith(taskRef);
    expect(deps.navigate).not.toHaveBeenCalled();

    openCommanderInputRef(inboxRef, deps);
    expect(deps.openPreview).toHaveBeenCalledWith("right-panel");
    expect(deps.openInputRef).toHaveBeenCalledWith(inboxRef);
    expect(deps.navigate).not.toHaveBeenCalled();
  });
});
