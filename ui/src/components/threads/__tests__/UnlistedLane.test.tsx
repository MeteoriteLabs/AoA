import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { UnlistedLane } from "../UnlistedLane";
import React from "react";
import { api } from "../../../api/client";

// Mock fetch / api client
vi.mock("../../../api/client", () => ({
  api: {
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

vi.mock("../../../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "comp-1",
    selectedCompany: { id: "comp-1", name: "Test Corp", issuePrefix: "TC" },
  }),
}));

const makeItem = (overrides = {}) => ({
  id: "item-1",
  rawContent: "Meeting notes from product sync",
  originSource: "mcp" as const,
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("UnlistedLane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.post).mockResolvedValue({ ok: true });
  });

  it("renders inbox items with triage buttons", () => {
    const items = [makeItem({ id: "item-1", rawContent: "User feedback about onboarding" })];

    renderWithProviders(
      <UnlistedLane inboxItems={items} onTriaged={vi.fn()} />,
      { initialEntries: ["/TC/discussions"] },
    );

    expect(screen.getByText("User feedback about onboarding")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /make thread/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("calls triage endpoint with 'dismiss' when Dismiss button is clicked", async () => {
    const user = userEvent.setup();
    const onTriaged = vi.fn();
    const items = [makeItem({ id: "item-99" })];

    renderWithProviders(
      <UnlistedLane inboxItems={items} onTriaged={onTriaged} />,
      { initialEntries: ["/TC/discussions"] },
    );

    const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
    await user.click(dismissBtn);

    await waitFor(() => {
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        expect.stringContaining("item-99/triage"),
        expect.objectContaining({ action: "dismiss" }),
      );
    });
  });

  it("calls triage endpoint with 'make_thread' when Make thread button is clicked", async () => {
    const user = userEvent.setup();
    const items = [makeItem({ id: "item-42" })];

    renderWithProviders(
      <UnlistedLane inboxItems={items} onTriaged={vi.fn()} />,
      { initialEntries: ["/TC/discussions"] },
    );

    const makeThreadBtn = screen.getByRole("button", { name: /make thread/i });
    await user.click(makeThreadBtn);

    await waitFor(() => {
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        expect.stringContaining("item-42/triage"),
        expect.objectContaining({ action: "make_thread" }),
      );
    });
  });

  it("shows empty state when no inbox items", () => {
    renderWithProviders(
      <UnlistedLane inboxItems={[]} onTriaged={vi.fn()} />,
      { initialEntries: ["/TC/discussions"] },
    );

    expect(screen.getByText(/nothing to triage/i)).toBeInTheDocument();
  });
});
