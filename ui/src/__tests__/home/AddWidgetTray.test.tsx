import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddWidgetTray } from "../../components/home/AddWidgetTray";

describe("AddWidgetTray", () => {
  it("lists every registered widget when the board is empty", () => {
    render(<AddWidgetTray boardKeys={[]} onAdd={vi.fn()} onReset={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Action queue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suggestions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Objectives" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Today's activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agents working now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Budget" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Waiting on you" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "My tasks" })).toBeInTheDocument();
  });

  it("excludes widgets already on the board (draft keys)", () => {
    render(
      <AddWidgetTray boardKeys={["budget", "agents-now"]} onAdd={vi.fn()} onReset={vi.fn()} />,
    );

    expect(screen.queryByRole("button", { name: "Budget" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agents working now" })).not.toBeInTheDocument();
    // The other six are still offered.
    expect(screen.getByRole("button", { name: "Objectives" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "My tasks" })).toBeInTheDocument();
  });

  it("clicking a row calls onAdd with that widget's key", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddWidgetTray boardKeys={[]} onAdd={onAdd} onReset={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Objectives" }));

    expect(onAdd).toHaveBeenCalledWith("objectives");
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("shows an empty message when every widget is already on the board", () => {
    const allKeys = [
      "action-queue",
      "suggestions",
      "objectives",
      "activity-feed",
      "agents-now",
      "budget",
      "approvals",
      "my-tasks",
    ] as const;
    render(<AddWidgetTray boardKeys={allKeys} onAdd={vi.fn()} onReset={vi.fn()} />);

    expect(screen.getByText(/already on your board/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Budget" })).not.toBeInTheDocument();
  });

  it("reset button calls onReset", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    render(<AddWidgetTray boardKeys={[]} onAdd={vi.fn()} onReset={onReset} />);

    await user.click(screen.getByRole("button", { name: /reset/i }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("disables the reset button while a reset is in flight", () => {
    render(<AddWidgetTray boardKeys={[]} onAdd={vi.fn()} onReset={vi.fn()} resetting />);

    expect(screen.getByRole("button", { name: /reset/i })).toBeDisabled();
  });
});
