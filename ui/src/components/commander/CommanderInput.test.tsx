import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  COMMANDER_INPUT_REF_DRAG_MIME,
  encodeCommanderInputRefDragPayload,
  type CommanderInputRef,
} from "@armyofagents/shared";
import { CommanderInput } from "./CommanderInput";

const taskRef: CommanderInputRef = {
  v: 1,
  kind: "task",
  id: "task-1",
  label: "Fix login",
  route: "/issues/task-1",
};

describe("CommanderInput", () => {
  it("accepts dropped Commander reference payloads", () => {
    const onReferenceDrop = vi.fn();
    render(
      <CommanderInput
        placeholder="Ask Commander"
        onSubmit={vi.fn()}
        onEmptyChange={vi.fn()}
        onSlashChange={vi.fn()}
        onReferenceDrop={onReferenceDrop}
      />,
    );

    fireEvent.drop(screen.getByRole("textbox"), {
      dataTransfer: {
        getData: (type: string) =>
          type === COMMANDER_INPUT_REF_DRAG_MIME
            ? encodeCommanderInputRefDragPayload(taskRef, "Show this task")
            : "",
      },
    });

    expect(onReferenceDrop).toHaveBeenCalledWith({
      ref: taskRef,
      prompt: "Show this task",
    });
  });
});
