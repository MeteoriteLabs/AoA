import { describe, expect, it } from "vitest";
import {
  appendCommanderInputRefsToMessage,
  commanderInputRefKey,
  formatCommanderInputRefsBlock,
  type CommanderInputRef,
} from "../commander-input-refs.js";

const taskRef: CommanderInputRef = {
  v: 1,
  kind: "task",
  id: "task-1",
  label: "AOA-1 Fix cockpit",
  route: "/issues/task-1",
  detail: "status=in_review",
};

describe("commander input refs", () => {
  it("builds stable keys", () => {
    expect(commanderInputRefKey(taskRef)).toBe("task:task-1");
  });

  it("formats references as a compact text block", () => {
    expect(formatCommanderInputRefsBlock([taskRef])).toContain(
      "Task: AOA-1 Fix cockpit | id=task-1 | route=/issues/task-1 | detail=status=in_review",
    );
  });

  it("appends refs to an existing message", () => {
    expect(appendCommanderInputRefsToMessage("What changed?", [taskRef])).toContain(
      "What changed?\n\nReferenced context:",
    );
  });
});
