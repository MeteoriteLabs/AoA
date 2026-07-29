import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewMenu } from "../../components/home/NewMenu";

const openNewIssue = vi.fn();
const openDiscussionCapture = vi.fn();
const openNewGoal = vi.fn();

vi.mock("@/context/DialogContext", () => ({
  useDialog: () => ({
    openNewIssue,
    openDiscussionCapture,
    openNewGoal,
  }),
}));

describe("NewMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the New trigger button, labeled 'Create' for assistive tech", () => {
    render(<NewMenu />);
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
    // Visible label is "New" (plus the plus/chevron glyphs) — asserted via the
    // accessible name above through aria-label, not by text content.
    expect(screen.getByRole("button", { name: "Create" })).toHaveTextContent("New");
  });

  it("opening the menu shows all three creators as menu items", async () => {
    const user = userEvent.setup();
    render(<NewMenu />);

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("menuitem", { name: "New task" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Discussion" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "New goal" })).toBeInTheDocument();
  });

  it("'New task' calls openNewIssue", async () => {
    const user = userEvent.setup();
    render(<NewMenu />);

    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.click(await screen.findByRole("menuitem", { name: "New task" }));

    expect(openNewIssue).toHaveBeenCalledTimes(1);
    expect(openDiscussionCapture).not.toHaveBeenCalled();
    expect(openNewGoal).not.toHaveBeenCalled();
  });

  it("'Discussion' calls openDiscussionCapture", async () => {
    const user = userEvent.setup();
    render(<NewMenu />);

    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.click(await screen.findByRole("menuitem", { name: "Discussion" }));

    expect(openDiscussionCapture).toHaveBeenCalledTimes(1);
    expect(openNewIssue).not.toHaveBeenCalled();
    expect(openNewGoal).not.toHaveBeenCalled();
  });

  it("'New goal' calls openNewGoal", async () => {
    const user = userEvent.setup();
    render(<NewMenu />);

    await user.click(screen.getByRole("button", { name: "Create" }));
    await user.click(await screen.findByRole("menuitem", { name: "New goal" }));

    expect(openNewGoal).toHaveBeenCalledTimes(1);
    expect(openNewIssue).not.toHaveBeenCalled();
    expect(openDiscussionCapture).not.toHaveBeenCalled();
  });
});
