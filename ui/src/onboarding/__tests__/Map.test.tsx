import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Map } from "../Map";

describe("Map (WS9 — the flow diagram + door band)", () => {
  it("renders every flow node and edge", () => {
    render(<Map onPick={vi.fn()} />);

    for (const label of ["Commander", "Discussion", "Direct", "TASK", "Review"]) {
      expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
    }
    expect(screen.getByText(/Agent/)).toBeInTheDocument();
    expect(screen.getByText(/Human/)).toBeInTheDocument();
    expect(screen.getByText(/Memory/)).toBeInTheDocument();

    // Edges (DrawOnMap paths) — one per connection in the mockup S6 diagram.
    const { container } = render(<Map onPick={vi.fn()} />);
    expect(container.querySelectorAll("path").length).toBeGreaterThanOrEqual(7);
  });

  it("renders the door band with In-flight, Explorer, and a disabled Greenfield", () => {
    render(<Map onPick={vi.fn()} />);

    expect(screen.getByRole("button", { name: /In-flight/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Explorer/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Greenfield/ })).toBeDisabled();
  });

  it("picking In-flight calls onPick with 'in_flight'", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Map onPick={onPick} />);

    await user.click(screen.getByRole("button", { name: /In-flight/ }));
    expect(onPick).toHaveBeenCalledWith("in_flight");
  });

  it("picking Explorer calls onPick with 'explorer'", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Map onPick={onPick} />);

    await user.click(screen.getByRole("button", { name: /Explorer/ }));
    expect(onPick).toHaveBeenCalledWith("explorer");
  });

  it("clicking Greenfield (disabled) never calls onPick", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Map onPick={onPick} />);

    await user.click(screen.getByRole("button", { name: /Greenfield/ }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("shows an explicit 'Coming soon' marker on the disabled Greenfield door only", () => {
    render(<Map onPick={vi.fn()} />);

    const greenfield = screen.getByRole("button", { name: /Greenfield/ });
    expect(greenfield).toHaveAccessibleName(/coming soon/i);

    const inFlight = screen.getByRole("button", { name: /In-flight/ });
    const explorer = screen.getByRole("button", { name: /Explorer/ });
    expect(inFlight).not.toHaveAccessibleName(/coming soon/i);
    expect(explorer).not.toHaveAccessibleName(/coming soon/i);
  });
});
