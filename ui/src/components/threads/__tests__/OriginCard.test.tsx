import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { OriginCard } from "../OriginCard";
import { threadsApi } from "../../../api/threads";
import type { ThreadDetail } from "../../../api/threads";

vi.mock("../../../api/threads", () => ({
  threadsApi: {
    advancePhase: vi.fn().mockResolvedValue({}),
    claim: vi.fn().mockResolvedValue({ ownerUserId: "user-1" }),
    transfer: vi.fn().mockResolvedValue({ ownerUserId: "user-2" }),
    setVisibility: vi.fn().mockResolvedValue({}),
    setAllowMemoryExtraction: vi.fn().mockResolvedValue({}),
    generateShareToken: vi.fn().mockResolvedValue({ token: "tok-fresh" }),
    revokeShareToken: vi.fn().mockResolvedValue({ ok: true }),
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
    visibility: "company",
    ownerUserId: null,
    originSource: "mcp",
    intent: ["improve ux", "reduce churn"],
    goalId: null,
    autonomyLevel: 1,
    summaryText: null,
    summaryNext: null,
    crewPaused: false,
    subtype: "normal",
    shareToken: null,
    participants: [],
    allowMemoryExtraction: true,
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
    const scopeBtn = screen.getByRole("button", { name: /^scope$/i });
    expect(scopeBtn).toHaveAttribute("aria-current", "true");
  });

  it("does NOT mark inactive phases with aria-current=true", () => {
    const thread = makeThread({ phase: "discuss" });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    const scopeBtn = screen.getByRole("button", { name: /^scope$/i });
    expect(scopeBtn).not.toHaveAttribute("aria-current", "true");
  });

  it("renders all 4 phase pills (discuss, scope, assign, done)", () => {
    const thread = makeThread();
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /^discuss$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^scope$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^assign$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^done$/i })).toBeInTheDocument();
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

  it("shows confirm dialog when a phase pill is clicked", async () => {
    const thread = makeThread({ phase: "discuss" });
    const user = userEvent.setup();
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /^scope$/i }));
    await waitFor(() => {
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });
  });

  // ── Claim button (carried over from prior task) ─────────────────────────

  it("shows Claim button when ownerUserId is null", () => {
    const thread = makeThread({ ownerUserId: null });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /claim/i })).toBeInTheDocument();
  });

  it("does NOT show Claim button when thread is already owned", () => {
    const thread = makeThread({ ownerUserId: "some-user" });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /claim/i })).not.toBeInTheDocument();
  });

  it("calls threadsApi.claim when Claim button is clicked", async () => {
    const thread = makeThread({ ownerUserId: null });
    const user = userEvent.setup();
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /claim/i }));
    await waitFor(() => {
      expect(threadsApi.claim).toHaveBeenCalledWith("comp-1", "thread-1");
    });
  });

  // ── Phase E batch 2 (T22): 3-option visibility selector ─────────────────

  it("renders visibility selector with the current value", () => {
    const thread = makeThread({ visibility: "department" });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    const selector = screen.getByTestId("visibility-selector");
    expect(selector).toBeInTheDocument();
    expect(selector).toHaveTextContent(/department/i);
  });

  it("calls threadsApi.setVisibility when a new option is chosen (legacy mode)", async () => {
    const thread = makeThread({ visibility: "company" });
    const user = userEvent.setup();
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    await user.click(screen.getByTestId("visibility-selector"));
    const option = await screen.findByTestId("visibility-option-private");
    await user.click(option);
    await waitFor(() => {
      expect(threadsApi.setVisibility).toHaveBeenCalledWith("comp-1", "thread-1", "private");
    });
  });

  it("calls onVisibilityChange when provided instead of mutating directly", async () => {
    const onVisibilityChange = vi.fn();
    const thread = makeThread({ visibility: "company" });
    const user = userEvent.setup();
    renderWithProviders(
      <OriginCard
        thread={thread}
        companyId="comp-1"
        onPhaseChanged={vi.fn()}
        onVisibilityChange={onVisibilityChange}
      />,
    );
    await user.click(screen.getByTestId("visibility-selector"));
    const option = await screen.findByTestId("visibility-option-department");
    await user.click(option);
    expect(onVisibilityChange).toHaveBeenCalledWith("department");
    expect(threadsApi.setVisibility).not.toHaveBeenCalled();
  });

  it("renders all three visibility options in the menu", async () => {
    const thread = makeThread();
    const user = userEvent.setup();
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    await user.click(screen.getByTestId("visibility-selector"));
    expect(await screen.findByTestId("visibility-option-private")).toBeInTheDocument();
    expect(screen.getByTestId("visibility-option-department")).toBeInTheDocument();
    expect(screen.getByTestId("visibility-option-company")).toBeInTheDocument();
  });

  // ── Phase E batch 2 (T22): share link toggle ────────────────────────────

  it("renders 'Generate share link' when shareToken is null", () => {
    const thread = makeThread({ shareToken: null });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(screen.getByTestId("generate-share-token")).toBeInTheDocument();
    expect(screen.queryByTestId("share-link-url")).not.toBeInTheDocument();
  });

  it("calls threadsApi.generateShareToken when 'Generate share link' is clicked", async () => {
    const thread = makeThread({ shareToken: null });
    const user = userEvent.setup();
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    await user.click(screen.getByTestId("generate-share-token"));
    await waitFor(() => {
      expect(threadsApi.generateShareToken).toHaveBeenCalledWith("comp-1", "thread-1");
    });
  });

  it("renders share URL, copy, and revoke when shareToken is set", () => {
    const thread = makeThread({ shareToken: "tok-abc" });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    const url = screen.getByTestId("share-link-url");
    expect(url).toBeInTheDocument();
    expect(url.textContent).toContain("/discussions/thread-1?token=tok-abc");
    expect(screen.getByTestId("copy-share-token")).toBeInTheDocument();
    expect(screen.getByTestId("revoke-share-token")).toBeInTheDocument();
  });

  it("calls threadsApi.revokeShareToken when 'Revoke' is clicked", async () => {
    const thread = makeThread({ shareToken: "tok-abc" });
    const user = userEvent.setup();
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    await user.click(screen.getByTestId("revoke-share-token"));
    await waitFor(() => {
      expect(threadsApi.revokeShareToken).toHaveBeenCalledWith("comp-1", "thread-1");
    });
  });

  it("prefers the onGenerateShareToken prop when provided", async () => {
    const onGenerate = vi.fn().mockResolvedValue({ token: "tok-via-prop" });
    const thread = makeThread({ shareToken: null });
    const user = userEvent.setup();
    renderWithProviders(
      <OriginCard
        thread={thread}
        companyId="comp-1"
        onPhaseChanged={vi.fn()}
        onGenerateShareToken={onGenerate}
      />,
    );
    await user.click(screen.getByTestId("generate-share-token"));
    await waitFor(() => {
      expect(onGenerate).toHaveBeenCalled();
    });
    expect(threadsApi.generateShareToken).not.toHaveBeenCalled();
  });

  // ── Phase E batch 2 (T22): roster wiring ────────────────────────────────

  it("renders ThreadRoster below PresencePanel when participants are present", () => {
    const thread = makeThread({
      participants: [
        {
          principalType: "user",
          principalId: "u-1",
          name: "Maria",
          role: "owner",
          addedAt: "2026-01-01T00:00:00Z",
        },
        {
          principalType: "agent",
          principalId: "agent-1",
          name: "Adjutant",
          role: "worker",
          addedAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    const roster = screen.getByTestId("thread-roster");
    expect(roster).toBeInTheDocument();
    expect(roster).toHaveTextContent("Maria");
    expect(roster).toHaveTextContent("Adjutant");
  });

  it("does NOT render ThreadRoster when participants is empty", () => {
    const thread = makeThread({ participants: [] });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(screen.queryByTestId("thread-roster")).not.toBeInTheDocument();
  });

  it("uses the participants prop when provided (overrides thread.participants)", () => {
    const thread = makeThread({
      participants: [
        {
          principalType: "user",
          principalId: "u-from-thread",
          name: "From Thread",
          role: "owner",
          addedAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    renderWithProviders(
      <OriginCard
        thread={thread}
        companyId="comp-1"
        onPhaseChanged={vi.fn()}
        participants={[
          {
            principalType: "user",
            principalId: "u-from-prop",
            name: "From Prop",
            role: "owner",
            addedAt: "2026-01-01T00:00:00Z",
          },
        ]}
      />,
    );
    expect(screen.getByText("From Prop")).toBeInTheDocument();
    expect(screen.queryByText("From Thread")).not.toBeInTheDocument();
  });

  // ── Phase E batch 2 (T22): live-thread visual treatment ─────────────────

  it("applies live-thread className when subtype === 'live'", () => {
    const thread = makeThread({ subtype: "live" });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    const card = screen.getByTestId("origin-card");
    expect(card).toHaveAttribute("data-subtype", "live");
    expect(card.className).toContain("origin-card--live");
  });

  it("hides phase advance buttons when subtype === 'live'", () => {
    const thread = makeThread({ subtype: "live" });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(screen.queryByTestId("phase-pills")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^scope$/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("phase-pills-live")).toBeInTheDocument();
    expect(screen.getByText(/live feed/i)).toBeInTheDocument();
  });

  it("renders phase advance buttons for normal threads", () => {
    const thread = makeThread({ subtype: "normal" });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(screen.getByTestId("phase-pills")).toBeInTheDocument();
    expect(screen.queryByTestId("phase-pills-live")).not.toBeInTheDocument();
  });

  // ── Phase G3 (T5, D6): allowMemoryExtraction toggle ─────────────────────

  it("renders Memory Keeper toggle inside Advanced settings disclosure", () => {
    const thread = makeThread();
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(screen.getByTestId("origin-card-advanced")).toBeInTheDocument();
    expect(screen.getByTestId("allow-memory-extraction-switch")).toBeInTheDocument();
    expect(
      screen.getByText(/memory keeper enabled for this thread/i),
    ).toBeInTheDocument();
  });

  it("renders Memory Keeper switch as checked when allowMemoryExtraction is true", () => {
    const thread = makeThread({ allowMemoryExtraction: true });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    const sw = screen.getByTestId("allow-memory-extraction-switch");
    // Radix Switch surfaces state via aria-checked.
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("renders Memory Keeper switch as unchecked when allowMemoryExtraction is false", () => {
    const thread = makeThread({ allowMemoryExtraction: false });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    const sw = screen.getByTestId("allow-memory-extraction-switch");
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("calls threadsApi.setAllowMemoryExtraction(false) when toggled off from true", async () => {
    const thread = makeThread({ allowMemoryExtraction: true });
    const user = userEvent.setup();
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    const sw = screen.getByTestId("allow-memory-extraction-switch");
    await user.click(sw);
    await waitFor(() => {
      expect(threadsApi.setAllowMemoryExtraction).toHaveBeenCalledWith(
        "comp-1",
        "thread-1",
        false,
      );
    });
  });

  it("calls threadsApi.setAllowMemoryExtraction(true) when toggled on from false", async () => {
    const thread = makeThread({ allowMemoryExtraction: false });
    const user = userEvent.setup();
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    const sw = screen.getByTestId("allow-memory-extraction-switch");
    await user.click(sw);
    await waitFor(() => {
      expect(threadsApi.setAllowMemoryExtraction).toHaveBeenCalledWith(
        "comp-1",
        "thread-1",
        true,
      );
    });
  });

  it("shows the privacy-hint copy when the thread is private", () => {
    const thread = makeThread({ visibility: "private" });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(
      screen.getByText(/will inherit its private scope/i),
    ).toBeInTheDocument();
  });

  it("shows the standard scan-hint copy when the thread is company-scoped", () => {
    const thread = makeThread({ visibility: "company" });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(
      screen.getByText(/scan this thread for decisions/i),
    ).toBeInTheDocument();
  });

  it("shows the standard scan-hint copy when the thread is department-scoped", () => {
    const thread = makeThread({ visibility: "department" });
    renderWithProviders(
      <OriginCard thread={thread} companyId="comp-1" onPhaseChanged={vi.fn()} />,
    );
    expect(
      screen.getByText(/scan this thread for decisions/i),
    ).toBeInTheDocument();
  });
});
