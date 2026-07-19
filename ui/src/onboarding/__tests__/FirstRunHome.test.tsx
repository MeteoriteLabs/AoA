import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FirstRunHome } from "../FirstRunHome";

const getFirstRunProgress = vi.hoisted(() =>
  vi.fn(async () => ({ firstRunPersona: null as string | null, firstRunCompleted: false })),
);
const setFirstRunPersona = vi.hoisted(() => vi.fn(async () => {}));
const setFirstRunCompleted = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../api/onboarding", () => ({
  getFirstRunProgress,
  setFirstRunPersona,
  setFirstRunCompleted,
}));

vi.mock("../inflight/InFlightFlow", () => ({
  InFlightFlow: ({ onDone }: { onDone: () => void }) => (
    <button onClick={onDone}>finish-in-flight</button>
  ),
}));

describe("FirstRunHome (WS9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFirstRunProgress.mockResolvedValue({ firstRunPersona: null, firstRunCompleted: false });
    setFirstRunPersona.mockResolvedValue(undefined);
    setFirstRunCompleted.mockResolvedValue(undefined);
  });

  it("shows the door band by default (no persisted persona)", async () => {
    render(<FirstRunHome companyId="co-1" />);
    expect(await screen.findByRole("button", { name: /In-flight/ })).toBeInTheDocument();
  });

  it("picking In-flight writes the persona, then routes into InFlightFlow", async () => {
    const user = userEvent.setup();
    render(<FirstRunHome companyId="co-1" />);

    await user.click(await screen.findByRole("button", { name: /In-flight/ }));

    await waitFor(() => expect(setFirstRunPersona).toHaveBeenCalledWith("co-1", "in_flight"));
    expect(await screen.findByText("finish-in-flight")).toBeInTheDocument();
    expect(setFirstRunCompleted).not.toHaveBeenCalled();
  });

  it("picking Explorer writes the persona AND completion, then calls onComplete", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<FirstRunHome companyId="co-1" onComplete={onComplete} />);

    await user.click(await screen.findByRole("button", { name: /Explorer/ }));

    await waitFor(() => expect(setFirstRunPersona).toHaveBeenCalledWith("co-1", "explorer"));
    await waitFor(() => expect(setFirstRunCompleted).toHaveBeenCalledWith("co-1"));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it("resumes straight into InFlightFlow when firstRunPersona is already in_flight", async () => {
    getFirstRunProgress.mockResolvedValue({ firstRunPersona: "in_flight", firstRunCompleted: false });
    render(<FirstRunHome companyId="co-1" />);

    expect(await screen.findByText("finish-in-flight")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /In-flight/ })).toBeNull();
  });

  it("InFlightFlow's completion calls onComplete", async () => {
    const user = userEvent.setup();
    getFirstRunProgress.mockResolvedValue({ firstRunPersona: "in_flight", firstRunCompleted: false });
    const onComplete = vi.fn();
    render(<FirstRunHome companyId="co-1" onComplete={onComplete} />);

    await user.click(await screen.findByText("finish-in-flight"));
    expect(onComplete).toHaveBeenCalled();
  });

  it("code-review fix: a failed progress read shows a retry state, NOT the door band", async () => {
    getFirstRunProgress.mockRejectedValue(new Error("network down"));
    render(<FirstRunHome companyId="co-1" />);

    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    // Must NOT fall back to the door band — that risks an Explorer pick
    // firing premature completion, or re-asking an in-progress founder.
    expect(screen.queryByRole("button", { name: /In-flight/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Explorer/ })).toBeNull();
    expect(setFirstRunCompleted).not.toHaveBeenCalled();
    expect(setFirstRunPersona).not.toHaveBeenCalled();
  });

  it("code-review fix: Retry re-attempts the read and recovers into the door band on success", async () => {
    const user = userEvent.setup();
    getFirstRunProgress
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ firstRunPersona: null, firstRunCompleted: false });
    render(<FirstRunHome companyId="co-1" />);

    await user.click(await screen.findByRole("button", { name: /retry/i }));

    expect(await screen.findByRole("button", { name: /In-flight/ })).toBeInTheDocument();
    expect(getFirstRunProgress).toHaveBeenCalledTimes(2);
  });
});
