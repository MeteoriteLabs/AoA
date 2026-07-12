import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VerifyStep } from "../VerifyStep";
import { validateRegistry, type StepContext } from "../../registry";
import { ONBOARDING_STEPS } from "../index";
import { ApiError } from "../../../api/client";

const post = vi.hoisted(() => vi.fn());
vi.mock("../../../api/client", async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>;
  return { ...actual, api: { ...(actual.api as object), post } };
});
vi.mock("../../../api/onboarding", () => ({
  advanceOnboarding: vi.fn(async () => ({ completedStates: [] })),
}));

import { advanceOnboarding } from "../../../api/onboarding";

const ctx: StepContext = {
  userId: "u1",
  companyId: "c1",
  journey: "founder",
  completedStates: ["AUTHENTICATED", "PROFILE_SET", "ORGANIZATION_CREATED", "ENVIRONMENT_READY", "COMMANDER_SELECTED"],
};

describe("VerifyStep (Stage C / order 5, blocking)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("advances COMMANDER_VERIFIED and completes when verified", async () => {
    post.mockResolvedValueOnce({ outcome: "verified", result: { status: "pass" } });
    const onComplete = vi.fn();
    render(<VerifyStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Verify"));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith("/companies/c1/internal-agent/verify", {});
    expect(advanceOnboarding).toHaveBeenCalledWith({
      companyId: "c1",
      journey: "founder",
      requestedState: "COMMANDER_VERIFIED",
    });
  });

  it("BLOCKS on needs_auth (422) — shows sign-in guidance + Check again, no advance/complete", async () => {
    post.mockRejectedValueOnce(
      new ApiError("Request failed: 422", 422, {
        outcome: "needs_auth",
        result: { status: "fail", checks: [{ code: "claude_hello_probe_auth_required", message: "sign in" }] },
      }),
    );
    const onComplete = vi.fn();
    render(<VerifyStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Verify"));
    expect(await screen.findByText(/sign in/i)).toBeTruthy();
    expect(screen.getByText("Check again")).toBeTruthy();
    expect(advanceOnboarding).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("BLOCKS on not_installed (422) — shows an install hint", async () => {
    post.mockRejectedValueOnce(
      new ApiError("Request failed: 422", 422, {
        outcome: "not_installed",
        result: { status: "fail", checks: [{ code: "claude_command_unresolvable", message: "not found" }] },
      }),
    );
    const onComplete = vi.fn();
    render(<VerifyStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Verify"));
    expect(await screen.findByText(/install/i)).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("assembled registry includes the verify step", () => {
  it("passes the guard and registers at order 5, non-skippable", () => {
    expect(validateRegistry(ONBOARDING_STEPS)).toEqual([]);
    const v = ONBOARDING_STEPS.find((s) => s.state === "COMMANDER_VERIFIED");
    expect(v?.order).toBe(5);
    expect(v?.dependsOn).toEqual(["COMMANDER_SELECTED"]);
    expect(v?.canSkip).toBe(false);
  });
});
