import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OrgStep } from "../OrgStep";
import { validateRegistry, type StepContext } from "../../registry";
import { ONBOARDING_STEPS } from "../index";

const createCompany = vi.fn(async (_data: { name: string }) => ({ id: "c1", name: "Acme" }));
vi.mock("../../../context/CompanyContext", () => ({
  useCompany: () => ({ createCompany }),
}));
vi.mock("../../../api/onboarding", () => ({
  advanceOnboarding: vi.fn(async () => ({
    completedStates: ["AUTHENTICATED", "PROFILE_SET", "ORGANIZATION_CREATED"],
  })),
}));

import { advanceOnboarding } from "../../../api/onboarding";

const ctx: StepContext = {
  userId: "u1",
  companyId: null,
  journey: "founder",
  completedStates: ["AUTHENTICATED", "PROFILE_SET"],
};

describe("OrgStep (Stage C / order 2)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an organization name", async () => {
    const onComplete = vi.fn();
    render(<OrgStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Continue"));
    expect(await screen.findByText(/enter a name/i)).toBeTruthy();
    expect(createCompany).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("creates the org, advances ORGANIZATION_CREATED on the NEW company, then completes", async () => {
    const onComplete = vi.fn();
    render(<OrgStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(createCompany).toHaveBeenCalledWith({ name: "Acme" });
    expect(advanceOnboarding).toHaveBeenCalledWith({
      companyId: "c1",
      journey: "founder",
      requestedState: "ORGANIZATION_CREATED",
    });
  });

  it("does NOT create a second company when the advance fails and the user retries", async () => {
    // First advance throws (e.g. transient network) — the company is already
    // created + selected; a retry must reuse it, not mint a duplicate.
    (advanceOnboarding as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({
        completedStates: ["AUTHENTICATED", "PROFILE_SET", "ORGANIZATION_CREATED"],
      });
    const onComplete = vi.fn();
    render(<OrgStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Acme" } });

    fireEvent.click(screen.getByText("Continue"));
    expect(await screen.findByText("network")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();

    // Retry — button re-enabled after the failure.
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());

    expect(createCompany).toHaveBeenCalledTimes(1);
    expect(advanceOnboarding).toHaveBeenCalledTimes(2);
  });
});

describe("assembled registry includes the org step", () => {
  it("ONBOARDING_STEPS still passes the registry guard", () => {
    expect(validateRegistry(ONBOARDING_STEPS)).toEqual([]);
  });
  it("registers the org step at order 2 for the founder journey", () => {
    const org = ONBOARDING_STEPS.find((s) => s.state === "ORGANIZATION_CREATED");
    expect(org).toBeTruthy();
    expect(org?.order).toBe(2);
    expect(org?.journeys).toEqual(["founder"]);
    expect(org?.dependsOn).toEqual(["PROFILE_SET"]);
  });
});
