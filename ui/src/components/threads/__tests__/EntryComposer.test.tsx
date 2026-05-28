/**
 * EntryComposer.test.tsx — Phase E1 composer tests.
 */
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { EntryComposer, type AgentRef, type UserRef } from "../EntryComposer";

const agents: AgentRef[] = [
  { id: "agent-scout", name: "Scout", role: "scout" },
  { id: "agent-engineer", name: "Engineer", role: "engineer" },
];

const users: UserRef[] = [
  { id: "user-1", name: "Alice", email: "alice@example.com" },
  { id: "user-2", name: "Bob", email: "bob@example.com" },
];

describe("EntryComposer — autocomplete", () => {
  it("opens the autocomplete dropdown when the user types '@'", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <EntryComposer
        threadId="thread-1"
        agents={agents}
        users={users}
        onSubmit={vi.fn()}
      />,
    );
    const ta = screen.getByTestId("entry-composer-textarea");
    await user.click(ta);
    await user.type(ta, "@");
    expect(screen.getByTestId("entry-autocomplete")).toBeInTheDocument();
    // Both agents and both users (capped at 8) are shown
    expect(screen.getByTestId("entry-autocomplete-option-Scout")).toBeInTheDocument();
    expect(screen.getByTestId("entry-autocomplete-option-Alice")).toBeInTheDocument();
  });

  it("filters suggestions when typing '@Sco' — Scout matches, Engineer does not", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <EntryComposer
        threadId="thread-1"
        agents={agents}
        users={users}
        onSubmit={vi.fn()}
      />,
    );
    const ta = screen.getByTestId("entry-composer-textarea");
    await user.click(ta);
    await user.type(ta, "@Sco");
    expect(screen.getByTestId("entry-autocomplete-option-Scout")).toBeInTheDocument();
    expect(screen.queryByTestId("entry-autocomplete-option-Engineer")).not.toBeInTheDocument();
  });

  it("inserts a mention chip when Enter is pressed on the active suggestion", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <EntryComposer
        threadId="thread-1"
        agents={agents}
        users={users}
        onSubmit={vi.fn()}
      />,
    );
    const ta = screen.getByTestId("entry-composer-textarea");
    await user.click(ta);
    await user.type(ta, "@Sco");
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("mention-chip-Scout")).toBeInTheDocument();
    // Textarea now contains the expanded @Name and a trailing space
    expect((ta as HTMLTextAreaElement).value).toMatch(/^@Scout /);
  });
});

describe("EntryComposer — submit", () => {
  it("submits the entry with text + mentions + attachments + parentEntryId on Ctrl+Enter", async () => {
    const user = userEvent.setup();
    const upload = vi.fn().mockResolvedValue({
      id: "asset-1",
      name: "test.png",
      mimeType: "image/png",
    });
    const onSubmit = vi.fn();
    renderWithProviders(
      <EntryComposer
        threadId="thread-1"
        parentEntryId="parent-42"
        agents={agents}
        users={users}
        onUpload={upload}
        onSubmit={onSubmit}
      />,
    );
    const ta = screen.getByTestId("entry-composer-textarea");
    await user.click(ta);
    await user.type(ta, "@Sco");
    await user.keyboard("{Enter}");
    await user.type(ta, "ping the build");

    // Attach a file via the hidden file input
    const fileInput = screen.getByTestId("entry-composer-file-input") as HTMLInputElement;
    const file = new File(["pixels"], "test.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    await waitFor(() =>
      expect(screen.getByTestId("entry-composer-attachment-test.png")).toBeInTheDocument(),
    );

    // Ctrl+Enter submits
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.text).toContain("@Scout");
    expect(payload.text).toContain("ping the build");
    expect(payload.mentions).toEqual(["agent-scout"]);
    expect(payload.parentEntryId).toBe("parent-42");
    expect(payload.attachments).toEqual([
      { id: "asset-1", name: "test.png", mimeType: "image/png" },
    ]);
  });
});

describe("EntryComposer — attachments", () => {
  it("renders an attachment preview after the file is uploaded", async () => {
    const upload = vi.fn().mockResolvedValue({
      id: "asset-1",
      name: "test.png",
      mimeType: "image/png",
    });
    renderWithProviders(
      <EntryComposer
        threadId="thread-1"
        agents={agents}
        users={users}
        onUpload={upload}
        onSubmit={vi.fn()}
      />,
    );
    // The attach button exists, and clicking it would open the OS file picker.
    // We assert on the underlying hidden input instead.
    expect(screen.getByTestId("entry-composer-attach-button")).toBeInTheDocument();
    const input = screen.getByTestId("entry-composer-file-input") as HTMLInputElement;
    const file = new File(["x"], "test.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(screen.getByTestId("entry-composer-attachment-test.png")).toBeInTheDocument(),
    );
    expect(upload).toHaveBeenCalledWith(file);
  });
});

describe("EntryComposer — reply mode", () => {
  it("renders reply-mode UI when parentEntryId is set", () => {
    renderWithProviders(
      <EntryComposer
        threadId="thread-1"
        parentEntryId="parent-42"
        agents={agents}
        users={users}
        onSubmit={vi.fn()}
      />,
    );
    const composer = screen.getByTestId("entry-composer");
    expect(composer.getAttribute("data-reply")).toBe("true");
    expect(composer.getAttribute("data-parent-entry-id")).toBe("parent-42");
  });
});
