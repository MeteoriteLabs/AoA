import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { OriginCard } from "../OriginCard";
import type { ThreadDetail } from "../../../api/threads";

vi.mock("../../../api/threads", () => ({
  threadsApi: {
    advancePhase: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../../../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

function makeThread(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: "thread-1",
    title: "Improve onboarding flow",
    status: "active",
    scopeType: null,
    scopeId: null,
    scopeName: null,
    tags: [],
    entryCount: 2,
    pendingItemCount: 1,
    createdBy: "user-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    entries: [],
    phase: "discuss",
    visibility: "open",
    ownerUserId: null,
    originSource: "mcp",
    intent: ["improve ux", "reduce churn"],
    goalId: null,
    autonomyLevel: 1,
    summaryText: null,
    summaryNext: null,
    ...overrides,
  };
}

describe("OriginCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the thread title", () => {
    const thread = makeThread();
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(screen.getByText("Improve onboarding flow")).toBeInTheDocument();
  });

  it("renders 'Unclaimed' when ownerUserId is null", () => {
    const thread = makeThread({ ownerUserId: null });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(screen.getByText(/unclaimed/i)).toBeInTheDocument();
  });

  it("marks the active phase pill with aria-current=true", () => {
    const thread = makeThread({ phase: "scope" });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    const scopeBtn = screen.getByRole("button", { name: /scope/i });
    expect(scopeBtn).toHaveAttribute("aria-current", "true");
  });

  it("does NOT mark inactive phases with aria-current=true", () => {
    const thread = makeThread({ phase: "discuss" });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    const scopeBtn = screen.getByRole("button", { name: /scope/i });
    expect(scopeBtn).not.toHaveAttribute("aria-current", "true");
  });

  it("renders all 4 phase pills (discuss, scope, assign, done)", () => {
    const thread = makeThread();
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /discuss/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scope/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /assign/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
  });

  it("renders intent chips when intent is provided", () => {
    const thread = makeThread({ intent: ["improve ux", "reduce churn"] });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(screen.getByText("improve ux")).toBeInTheDocument();
    expect(screen.getByText("reduce churn")).toBeInTheDocument();
  });

  it("renders autonomy level as a chip (L0/L1/L2)", () => {
    const thread = makeThread({ autonomyLevel: 2 });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(screen.getByText(/L2/i)).toBeInTheDocument();
  });

  it("renders visibility badge", () => {
    const thread = makeThread({ visibility: "open" });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(screen.getByText(/open/i)).toBeInTheDocument();
  });

  it("shows confirm dialog when a phase pill is clicked", async () => {
    const thread = makeThread({ phase: "discuss" });
    const user = userEvent.setup();
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /scope/i }));
    // Confirm dialog should appear
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
  });
});
