import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SpineCompleteStep } from "../SpineCompleteStep";
import { validateRegistry, type StepContext } from "../../registry";
import { ONBOARDING_STEPS } from "../index";

vi.mock("../../../api/onboarding", () => ({
  advanceOnboarding: vi.fn(async () => ({ completedStates: [] })),
  setFirstRunCompleted: vi.fn(async () => undefined),
}));

import { advanceOnboarding, setFirstRunCompleted } from "../../../api/onboarding";

const ctx: StepContext = {
  userId: "u1",
  companyId: "c1",
  journey: "founder",
  completedStates: [
    "AUTHENTICATED",
    "PROFILE_SET",
    "ORGANIZATION_CREATED",
    "ENVIRONMENT_READY",
    "COMMANDER_SELECTED",
    "COMMANDER_VERIFIED",
  ],
};

describe("SpineCompleteStep (WS0c terminal wizard step)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("advances SETUP_COMPLETE on mount (no button click required) and completes", async () => {
    const onComplete = vi.fn();
    render(<SpineCompleteStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(advanceOnboarding).toHaveBeenCalledWith({
      companyId: "c1",
      journey: "founder",
      requestedState: "SETUP_COMPLETE",
    });
  });

  it("does NOT write firstRunCompleted — that write moves to Home/WS9", async () => {
    const onComplete = vi.fn();
    render(<SpineCompleteStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(setFirstRunCompleted).not.toHaveBeenCalled();
  });

  it("shows an error and a Retry button when the advance fails, and does not call onComplete", async () => {
    (advanceOnboarding as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("advance blew up"),
    );
    const onComplete = vi.fn();
    render(<SpineCompleteStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    expect(await screen.findByText("advance blew up")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    const retry = screen.getByText("Retry").closest("button") as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
  });

  it("is genuinely retryable — clicking Retry after a failure re-fires the advance and can succeed", async () => {
    (advanceOnboarding as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("advance blew up"),
    );
    const onComplete = vi.fn();
    render(<SpineCompleteStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    await screen.findByText("Retry");

    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(advanceOnboarding).toHaveBeenCalledTimes(2);
  });
});

describe("assembled registry includes the terminal step", () => {
  it("passes the guard and registers SETUP_COMPLETE as the last founder step, gated on COMMANDER_VERIFIED", () => {
    expect(validateRegistry(ONBOARDING_STEPS)).toEqual([]);
    const founderSteps = ONBOARDING_STEPS.filter((s) => s.journeys.includes("founder"));
    expect(founderSteps).toHaveLength(6);
    const terminal = founderSteps[founderSteps.length - 1];
    expect(terminal.state).toBe("SETUP_COMPLETE");
    expect(terminal.dependsOn).toEqual(["COMMANDER_VERIFIED"]);
  });
});
