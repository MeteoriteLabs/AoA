import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReviewStep } from "../ReviewStep";
import { validateRegistry, type StepContext } from "../../registry";
import { ONBOARDING_STEPS } from "../index";

const getCompany = vi.hoisted(() => vi.fn(async () => ({ id: "c1", name: "Acme" })));
const projectsList = vi.hoisted(() =>
  vi.fn(async () => [{ id: "d1", type: "department", name: "Engineering" }] as unknown[]),
);
const agentsList = vi.hoisted(() => vi.fn(async () => [{ id: "a1", kind: "org", name: "Director" }] as unknown[]));

vi.mock("../../../api/companies", () => ({ companiesApi: { get: getCompany } }));
vi.mock("../../../api/projects", () => ({ projectsApi: { list: projectsList } }));
vi.mock("../../../api/agents", () => ({ agentsApi: { list: agentsList } }));
vi.mock("../../../api/onboarding", () => ({
  advanceOnboarding: vi.fn(async () => ({ completedStates: [] })),
}));

import { advanceOnboarding } from "../../../api/onboarding";

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
    "DEPARTMENT_CREATED",
    "AGENT_ASSIGNED",
  ],
};

describe("ReviewStep (Stage C / order 8)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the setup summary", async () => {
    render(<ReviewStep ctx={ctx} onComplete={vi.fn()} onBack={() => {}} />);
    expect(await screen.findByText("Acme")).toBeTruthy();
    expect(screen.getByText("Engineering")).toBeTruthy();
    expect(screen.getByText(/Director/)).toBeTruthy();
  });

  it("finishing advances SETUP_COMPLETE and completes", async () => {
    const onComplete = vi.fn();
    render(<ReviewStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Finish setup"));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(advanceOnboarding).toHaveBeenCalledWith({
      companyId: "c1",
      journey: "founder",
      requestedState: "SETUP_COMPLETE",
    });
  });

  it("surfaces the error and re-enables the buttons when finishing fails", async () => {
    (advanceOnboarding as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("advance blew up"),
    );
    const onComplete = vi.fn();
    render(<ReviewStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Finish setup"));
    expect(await screen.findByText("advance blew up")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    // button re-enabled so the founder can retry (not stuck)
    expect((screen.getByText("Finish setup").closest("button") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe("assembled registry includes the review step", () => {
  it("passes the guard and registers at order 8", () => {
    expect(validateRegistry(ONBOARDING_STEPS)).toEqual([]);
    const r = ONBOARDING_STEPS.find((s) => s.state === "SETUP_COMPLETE");
    expect(r?.order).toBe(8);
    expect(r?.dependsOn).toEqual(["AGENT_ASSIGNED"]);
  });
});
