import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPaneCaption } from "@/components/commander/ChatPaneCaption";

describe("ChatPaneCaption", () => {
  it("renders the title", () => {
    render(
      <ChatPaneCaption
        title="Sprint planning chat"
        messageCount={5}
      />,
    );
    expect(screen.getByText("Sprint planning chat")).toBeInTheDocument();
  });

  it("renders N msgs", () => {
    render(
      <ChatPaneCaption
        title="My chat"
        messageCount={12}
      />,
    );
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("msgs")).toBeInTheDocument();
  });

  it("renders 0 msgs when messageCount is 0", () => {
    render(
      <ChatPaneCaption
        title="Empty chat"
        messageCount={0}
      />,
    );
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("renders relative time when updatedAt is provided", () => {
    const updatedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString(); // 2 minutes ago
    render(
      <ChatPaneCaption
        title="My chat"
        messageCount={3}
        updatedAt={updatedAt}
      />,
    );
    // timeAgo returns "2m ago" for ~2 minutes
    expect(screen.getByText(/ago/i)).toBeInTheDocument();
  });

  it("omits relative time when updatedAt is not provided", () => {
    render(
      <ChatPaneCaption
        title="New chat"
        messageCount={0}
      />,
    );
    expect(screen.queryByText(/ago/i)).not.toBeInTheDocument();
  });

  it("calls onOpenSessions when Sessions button is clicked", async () => {
    const user = userEvent.setup();
    const onOpenSessions = vi.fn();
    render(
      <ChatPaneCaption
        title="My chat"
        messageCount={2}
        onOpenSessions={onOpenSessions}
      />,
    );
    const btn = screen.getByRole("button", { name: /open sessions/i });
    await user.click(btn);
    expect(onOpenSessions).toHaveBeenCalledOnce();
  });
});
