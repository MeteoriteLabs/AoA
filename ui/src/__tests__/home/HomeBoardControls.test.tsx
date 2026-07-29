import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeBoardControls } from "../../components/home/HomeBoardControls";
import type { UseBoardEditResult } from "../../components/home/useBoardEdit";

/**
 * Focused unit tests for HomeBoardControls in isolation — a hand-built
 * UseBoardEditResult fixture, rather than the full HomeBoard harness (see
 * HomeBoard.test.tsx), since these assertions are only about the controls'
 * own rendering/gating, not the grid underneath.
 */
function makeBoardEdit(overrides: Partial<UseBoardEditResult> = {}): UseBoardEditResult {
  return {
    lg: [],
    editing: false,
    dirty: false,
    isSaving: false,
    isResetting: false,
    saveError: null,
    resetError: null,
    activeBreakpoint: "lg",
    announcement: "",
    startEdit: vi.fn(),
    exitEdit: vi.fn(),
    retrySave: vi.fn(),
    removeWidget: vi.fn(),
    addWidget: vi.fn(),
    resetBoard: vi.fn(),
    onLayoutChange: vi.fn(),
    onBreakpointChange: vi.fn(),
    onResizeStop: vi.fn(),
    moveWidget: vi.fn(),
    cycleWidgetSize: vi.fn(),
    ...overrides,
  };
}

describe("HomeBoardControls (Plan 6 Task 2: customize icon)", () => {
  it("renders an icon button labeled 'Customize board' when not editing (not the old 'Edit board' text)", () => {
    const boardEdit = makeBoardEdit();
    render(<HomeBoardControls boardEdit={boardEdit} />);

    expect(screen.getByRole("button", { name: "Customize board" })).toBeInTheDocument();
    expect(screen.queryByText("Edit board")).not.toBeInTheDocument();
  });

  it("stays disabled below the lg breakpoint, with the same tooltip as before", () => {
    const boardEdit = makeBoardEdit({ activeBreakpoint: "md" });
    render(<HomeBoardControls boardEdit={boardEdit} />);

    const button = screen.getByRole("button", { name: "Customize board" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Edit on a larger screen (1024px+)");
  });

  it("is enabled at the lg breakpoint and has no tooltip", () => {
    const boardEdit = makeBoardEdit({ activeBreakpoint: "lg" });
    render(<HomeBoardControls boardEdit={boardEdit} />);

    const button = screen.getByRole("button", { name: "Customize board" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("title");
  });

  it("clicking the icon button calls startEdit (and never exitEdit)", async () => {
    const user = userEvent.setup();
    const boardEdit = makeBoardEdit();
    render(<HomeBoardControls boardEdit={boardEdit} />);

    await user.click(screen.getByRole("button", { name: "Customize board" }));

    expect(boardEdit.startEdit).toHaveBeenCalledTimes(1);
    expect(boardEdit.exitEdit).not.toHaveBeenCalled();
  });

  it("switches to a 'Done' text button (calling exitEdit) while editing — edit-mode chrome unchanged", async () => {
    const user = userEvent.setup();
    const boardEdit = makeBoardEdit({ editing: true });
    render(<HomeBoardControls boardEdit={boardEdit} />);

    expect(screen.queryByRole("button", { name: "Customize board" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(boardEdit.exitEdit).toHaveBeenCalledTimes(1);
    expect(boardEdit.startEdit).not.toHaveBeenCalled();
  });

  it("disables Done while a save is in flight, even though editing is still true", () => {
    const boardEdit = makeBoardEdit({ editing: true, isSaving: true });
    render(<HomeBoardControls boardEdit={boardEdit} />);

    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
  });
});
