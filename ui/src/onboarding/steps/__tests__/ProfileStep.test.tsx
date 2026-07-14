import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProfileStep } from "../ProfileStep";
import { validateRegistry, type StepContext } from "../../registry";
import { ONBOARDING_STEPS } from "../index";

vi.mock("../../../api/userProfile", () => ({ saveUserProfile: vi.fn(async () => ({})) }));
vi.mock("../../../api/onboarding", () => ({
  advanceOnboarding: vi.fn(async () => ({ completedStates: ["AUTHENTICATED", "PROFILE_SET"] })),
}));

import { saveUserProfile } from "../../../api/userProfile";
import { advanceOnboarding } from "../../../api/onboarding";

const ctx: StepContext = {
  userId: "u1",
  companyId: null,
  journey: "founder",
  completedStates: ["AUTHENTICATED"],
};

describe("ProfileStep (Stage C / C3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a name", async () => {
    const onComplete = vi.fn();
    render(<ProfileStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Continue"));
    expect(await screen.findByText(/enter your name/i)).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("saves the profile, advances PROFILE_SET, then completes", async () => {
    const onComplete = vi.fn();
    render(<ProfileStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Ada" } });
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(saveUserProfile).toHaveBeenCalledWith({ displayName: "Ada" });
    expect(advanceOnboarding).toHaveBeenCalledWith({
      companyId: null,
      journey: "founder",
      requestedState: "PROFILE_SET",
    });
  });
});

describe("assembled registry (Stage C)", () => {
  it("ONBOARDING_STEPS passes the registry guard", () => {
    expect(validateRegistry(ONBOARDING_STEPS)).toEqual([]);
  });
});
