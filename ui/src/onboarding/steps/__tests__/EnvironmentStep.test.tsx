import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EnvironmentStep } from "../EnvironmentStep";
import { validateRegistry, type StepContext } from "../../registry";
import { ONBOARDING_STEPS } from "../index";
import { ApiError } from "../../../api/client";

const post = vi.hoisted(() => vi.fn(async () => ({ ok: true, environmentId: "e1" })));
const home = vi.hoisted(() => vi.fn(async () => ({ homePath: "/home/ada", platform: "linux" })));

vi.mock("../../../api/client", async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>;
  return { ...actual, api: { ...(actual.api as object), post } };
});
vi.mock("../../../api/filesystem", () => ({ filesystemApi: { home: () => home() } }));
vi.mock("../../../api/onboarding", () => ({
  advanceOnboarding: vi.fn(async () => ({
    completedStates: ["AUTHENTICATED", "PROFILE_SET", "ORGANIZATION_CREATED", "ENVIRONMENT_READY"],
  })),
}));

import { advanceOnboarding } from "../../../api/onboarding";

const ctx: StepContext = {
  userId: "u1",
  companyId: "c1",
  journey: "founder",
  completedStates: ["AUTHENTICATED", "PROFILE_SET", "ORGANIZATION_CREATED"],
};

describe("EnvironmentStep (Stage C / order 3, revA R13)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prefills the home dir, sets up the env, advances ENVIRONMENT_READY, then completes", async () => {
    const onComplete = vi.fn();
    render(<EnvironmentStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    // Prefilled from the home dir.
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("/home/ada/AoA"),
    );
    fireEvent.click(screen.getByText(/verify/i));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith("/companies/c1/onboarding/environment", {
      rootFolder: "/home/ada/AoA",
    });
    expect(advanceOnboarding).toHaveBeenCalledWith({
      companyId: "c1",
      journey: "founder",
      requestedState: "ENVIRONMENT_READY",
    });
  });

  it("BLOCKS on a 422 probe failure — surfaces the reason, does not advance or complete", async () => {
    post.mockRejectedValueOnce(
      new ApiError("Request failed: 422", 422, {
        ok: false,
        probe: {
          ok: false,
          summary: "Cannot write to /home/ada/AoA.",
          checks: [{ name: "config.path", status: "failed", message: "EACCES: permission denied" }],
        },
      }),
    );
    const onComplete = vi.fn();
    render(<EnvironmentStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("/home/ada/AoA"),
    );
    fireEvent.click(screen.getByText(/verify/i));
    expect(await screen.findByText(/cannot write to/i)).toBeTruthy();
    expect(advanceOnboarding).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("assembled registry includes the environment step", () => {
  it("ONBOARDING_STEPS still passes the registry guard", () => {
    expect(validateRegistry(ONBOARDING_STEPS)).toEqual([]);
  });
  it("registers the environment step at order 3 for the founder journey", () => {
    const env = ONBOARDING_STEPS.find((s) => s.state === "ENVIRONMENT_READY");
    expect(env).toBeTruthy();
    expect(env?.order).toBe(3);
    expect(env?.journeys).toEqual(["founder"]);
    expect(env?.dependsOn).toEqual(["ORGANIZATION_CREATED"]);
  });
});
