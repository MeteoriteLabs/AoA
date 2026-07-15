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
const getConfig = vi.hoisted(() => vi.fn(async () => ({ provider: "anthropic" })));
vi.mock("../../../api/internal-agent", () => ({ internalAgentApi: { getConfig } }));
const saveCommanderKey = vi.hoisted(() => vi.fn(async () => ({ ok: true, secretId: "s1" })));
const startCommanderLogin = vi.hoisted(() => vi.fn());
const getCommanderLoginStatus = vi.hoisted(() => vi.fn());
vi.mock("../../../api/commander-auth", () => ({ saveCommanderKey, startCommanderLogin, getCommanderLoginStatus }));

import { advanceOnboarding } from "../../../api/onboarding";

const ctx: StepContext = {
  userId: "u1",
  companyId: "c1",
  journey: "founder",
  completedStates: ["AUTHENTICATED", "PROFILE_SET", "ORGANIZATION_CREATED", "ENVIRONMENT_READY", "COMMANDER_SELECTED"],
};

describe("VerifyStep (Stage C / order 5, blocking)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers a working Back control to change the selected runtime", () => {
    const onBack = vi.fn();
    render(<VerifyStep ctx={ctx} onComplete={vi.fn()} onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /back.*claude.*codex/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

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
    expect(await screen.findByText("sign in")).toBeTruthy(); // the probe message
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

  const needsAuthError = () =>
    new ApiError("Request failed: 422", 422, {
      outcome: "needs_auth",
      result: { status: "fail", checks: [{ code: "claude_hello_probe_auth_required", message: "sign in" }] },
    });

  it("needs_auth → paste an API key → saves it (encrypted) and re-verifies to completion", async () => {
    post.mockRejectedValueOnce(needsAuthError());
    post.mockResolvedValueOnce({ outcome: "verified", result: { status: "pass" } });
    const onComplete = vi.fn();
    render(<VerifyStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Verify"));

    // Provider (Claude/anthropic) loads async → the key field becomes enabled.
    const input = (await screen.findByPlaceholderText(/sk-ant/i)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-ant-SECRET" } });
    fireEvent.click(screen.getByRole("button", { name: /save key & verify/i }));

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(saveCommanderKey).toHaveBeenCalledWith({ companyId: "c1", provider: "anthropic", value: "sk-ant-SECRET" });
    expect(advanceOnboarding).toHaveBeenCalledWith({
      companyId: "c1",
      journey: "founder",
      requestedState: "COMMANDER_VERIFIED",
    });
  });

  it("Claude (anthropic) needs_auth shows API-key only — no interactive 'Sign in' button (gated)", async () => {
    post.mockRejectedValueOnce(needsAuthError());
    render(<VerifyStep ctx={ctx} onComplete={vi.fn()} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Verify"));
    // Key field is present; the interactive sign-in button is not (Claude needs the paste-code bridge).
    expect(await screen.findByPlaceholderText(/sk-ant/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /sign in with/i })).toBeNull();
  });

  it("needs_auth → Codex interactive login → surfaces the verification URL while pending", async () => {
    getCommanderLoginStatus.mockResolvedValue({ status: "pending", loginUrl: "https://auth.openai.com/go?c=1" });
    getConfig.mockResolvedValue({ provider: "openai" }); // interactive login is Codex-only
    post.mockRejectedValueOnce(needsAuthError());
    startCommanderLogin.mockResolvedValueOnce({ challengeId: "ch-1", loginUrl: "https://auth.openai.com/go?c=1" });
    render(<VerifyStep ctx={ctx} onComplete={vi.fn()} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Verify"));

    fireEvent.click(await screen.findByRole("button", { name: /sign in with codex/i }));
    const link = (await screen.findByText("https://auth.openai.com/go?c=1")) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://auth.openai.com/go?c=1");
    expect(startCommanderLogin).toHaveBeenCalledWith({ companyId: "c1", provider: "openai" });
  });

  it("needs_auth → Codex interactive login → polls to completed and re-verifies", async () => {
    getConfig.mockResolvedValue({ provider: "openai" });
    post.mockRejectedValueOnce(needsAuthError());
    startCommanderLogin.mockResolvedValueOnce({ challengeId: "ch-1", loginUrl: "https://auth.openai.com/go?c=1" });
    getCommanderLoginStatus.mockResolvedValue({ status: "completed", loginUrl: "https://auth.openai.com/go?c=1" });
    post.mockResolvedValueOnce({ outcome: "verified", result: { status: "pass" } });
    const onComplete = vi.fn();
    render(<VerifyStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Verify"));

    fireEvent.click(await screen.findByRole("button", { name: /sign in with codex/i }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled()); // immediate poll → completed → re-verify
    expect(getCommanderLoginStatus).toHaveBeenCalledWith({ companyId: "c1", challengeId: "ch-1" });
    expect(advanceOnboarding).toHaveBeenCalledWith({
      companyId: "c1",
      journey: "founder",
      requestedState: "COMMANDER_VERIFIED",
    });
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
