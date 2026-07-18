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
// Realistic base config: Commander runs the Claude CLI (`cliTool`), and the crew
// `provider` is DELIBERATELY a different value — the Verify step must derive its
// recovery-credential provider from `cliTool` (what the server probes), never
// from the crew `provider` (Codex P2-A).
const getConfig = vi.hoisted(() => vi.fn(async () => ({ cliTool: "claude_cli", provider: "openai" })));
vi.mock("../../../api/internal-agent", () => ({ internalAgentApi: { getConfig } }));
const saveCommanderKey = vi.hoisted(() => vi.fn(async () => ({ ok: true, secretId: "s1" })));
const startCommanderLogin = vi.hoisted(() => vi.fn());
const getCommanderLoginStatus = vi.hoisted(() => vi.fn());
const cancelCommanderLogin = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
vi.mock("../../../api/commander-auth", () => ({
  saveCommanderKey,
  startCommanderLogin,
  getCommanderLoginStatus,
  cancelCommanderLogin,
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

  it("renders no step-local Back control (the FlowEngine chrome owns the shared Back affordance)", () => {
    render(<VerifyStep ctx={ctx} onComplete={vi.fn()} onBack={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /back/i })).toBeNull();
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
    getConfig.mockResolvedValue({ cliTool: "codex", provider: "anthropic" }); // interactive login is Codex-only; crew provider diverges
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
    getConfig.mockResolvedValue({ cliTool: "codex", provider: "anthropic" });
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

  // P2-A: the recovery-credential provider follows Commander's `cliTool` (the CLI
  // the server verify route actually probes), NOT the independent crew `provider`.
  it("P2-A: derives the auth provider from Commander cliTool (claude_cli), ignoring a divergent crew provider", async () => {
    getConfig.mockResolvedValue({ cliTool: "claude_cli", provider: "openai" }); // Claude Commander, OpenAI crew
    post.mockRejectedValueOnce(needsAuthError());
    render(<VerifyStep ctx={ctx} onComplete={vi.fn()} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Verify"));
    // Resolves to anthropic (matches the CLI the server probes) → Claude key path.
    expect(await screen.findByPlaceholderText(/sk-ant/i)).toBeTruthy();
    // NOT the OpenAI crew provider → the Codex-only interactive login is absent.
    expect(screen.queryByRole("button", { name: /sign in with/i })).toBeNull();
  });

  it("P2-A (mirror): cliTool codex with a divergent crew provider → OpenAI/Codex auth path", async () => {
    getConfig.mockResolvedValue({ cliTool: "codex", provider: "anthropic" }); // Codex Commander, Anthropic crew
    post.mockRejectedValueOnce(needsAuthError());
    render(<VerifyStep ctx={ctx} onComplete={vi.fn()} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Verify"));
    // openai → Codex interactive login is offered; the anthropic-only sk-ant hint is not.
    expect(await screen.findByRole("button", { name: /sign in with codex/i })).toBeTruthy();
    expect(screen.queryByPlaceholderText(/sk-ant/i)).toBeNull();
  });

  // P2-B: a still-pending login challenge is cancelled when the founder leaves the
  // step, releasing the detached CLI child + the shared (provider,authHome) slot.
  it("P2-B: cancels a still-pending login challenge when the step unmounts", async () => {
    getConfig.mockResolvedValue({ cliTool: "codex" }); // openai → interactive login available
    post.mockRejectedValueOnce(needsAuthError());
    startCommanderLogin.mockResolvedValueOnce({ challengeId: "ch-1", loginUrl: "https://auth.openai.com/go?c=1" });
    getCommanderLoginStatus.mockResolvedValue({ status: "pending", loginUrl: "https://auth.openai.com/go?c=1" });
    const { unmount } = render(<VerifyStep ctx={ctx} onComplete={vi.fn()} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Verify"));
    fireEvent.click(await screen.findByRole("button", { name: /sign in with codex/i }));
    await screen.findByText("https://auth.openai.com/go?c=1"); // pending challenge surfaced
    unmount();
    await waitFor(() =>
      expect(cancelCommanderLogin).toHaveBeenCalledWith({ companyId: "c1", challengeId: "ch-1" }),
    );
  });

  it("P2-B: does NOT cancel a completed challenge on unmount", async () => {
    getConfig.mockResolvedValue({ cliTool: "codex" });
    post.mockRejectedValueOnce(needsAuthError());
    post.mockResolvedValueOnce({ outcome: "verified", result: { status: "pass" } });
    startCommanderLogin.mockResolvedValueOnce({ challengeId: "ch-2", loginUrl: "https://auth.openai.com/go?c=2" });
    getCommanderLoginStatus.mockResolvedValue({ status: "completed", loginUrl: "https://auth.openai.com/go?c=2" });
    const onComplete = vi.fn();
    const { unmount } = render(<VerifyStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Verify"));
    fireEvent.click(await screen.findByRole("button", { name: /sign in with codex/i }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled()); // completed → login cleared → terminal
    unmount();
    expect(cancelCommanderLogin).not.toHaveBeenCalled();
  });

  it("P2-B: no active challenge → no cancel on unmount", () => {
    getConfig.mockResolvedValue({ cliTool: "claude_cli" });
    const { unmount } = render(<VerifyStep ctx={ctx} onComplete={vi.fn()} onBack={() => {}} />);
    unmount();
    expect(cancelCommanderLogin).not.toHaveBeenCalled();
  });

  // WS3: "I'll sign in myself in the CLI" — a third, provider-agnostic recovery
  // path that re-runs the SAME hello-probe verify check on an interval (mirrors
  // the device-login poll above) until it reports verified, then auto-advances.
  describe("WS3: CLI auto-detect", () => {
    it("is offered for BOTH providers (unlike the Codex-only interactive login)", async () => {
      getConfig.mockResolvedValue({ cliTool: "claude_cli" }); // anthropic — no device login
      post.mockRejectedValueOnce(needsAuthError());
      render(<VerifyStep ctx={ctx} onComplete={vi.fn()} onBack={() => {}} />);
      fireEvent.click(screen.getByText("Verify"));
      expect(await screen.findByRole("button", { name: /sign in myself in the cli/i })).toBeTruthy();
    });

    it("polls the same verify probe (immediate tick, no waiting a full interval) until verified, then auto-advances", async () => {
      post.mockRejectedValueOnce(needsAuthError()); // initial "Verify" click
      post.mockResolvedValueOnce({ outcome: "verified", result: { status: "pass" } }); // auto-detect tick
      const onComplete = vi.fn();
      render(<VerifyStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
      fireEvent.click(screen.getByText("Verify"));

      fireEvent.click(await screen.findByRole("button", { name: /sign in myself in the cli/i }));

      await waitFor(() => expect(onComplete).toHaveBeenCalled());
      expect(post).toHaveBeenCalledTimes(2);
      expect(post).toHaveBeenLastCalledWith("/companies/c1/internal-agent/verify", {});
      expect(advanceOnboarding).toHaveBeenCalledWith({
        companyId: "c1",
        journey: "founder",
        requestedState: "COMMANDER_VERIFIED",
      });
    });

    it("shows a clear watching status while polling, and Cancel stops it (returns the start button)", async () => {
      post.mockRejectedValueOnce(needsAuthError()); // initial "Verify" click
      post.mockRejectedValueOnce(needsAuthError()); // immediate auto-detect tick — still not signed in
      render(<VerifyStep ctx={ctx} onComplete={vi.fn()} onBack={() => {}} />);
      fireEvent.click(screen.getByText("Verify"));

      fireEvent.click(await screen.findByRole("button", { name: /sign in myself in the cli/i }));
      expect(await screen.findByText(/watching for your sign-in/i)).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
      expect(await screen.findByRole("button", { name: /sign in myself in the cli/i })).toBeTruthy();
      expect(screen.queryByText(/watching for your sign-in/i)).toBeNull();
    });

    it("does not crash and does not fire onComplete after unmount while a CLI auto-detect poll is active", async () => {
      post.mockRejectedValueOnce(needsAuthError()); // initial "Verify" click
      post.mockRejectedValueOnce(needsAuthError()); // immediate auto-detect tick — still not signed in
      const onComplete = vi.fn();
      const { unmount } = render(<VerifyStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
      fireEvent.click(screen.getByText("Verify"));

      fireEvent.click(await screen.findByRole("button", { name: /sign in myself in the cli/i }));
      await waitFor(() => expect(post).toHaveBeenCalledTimes(2));

      expect(() => unmount()).not.toThrow();
      expect(onComplete).not.toHaveBeenCalled();
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
