import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
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
    afterEach(() => {
      vi.useRealTimers();
    });

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

    // Code-review fix: the earlier "polls the same verify probe" test above only
    // proves the IMMEDIATE tick fires (real timers, no interval wait). This test
    // uses fake timers to advance clock time PAST CLI_AUTO_DETECT_POLL_MS
    // (~3000ms) and asserts the interval itself re-fires the probe — not just
    // the immediate tick — before transitioning to verified.
    it("re-fires the verify probe on the ~3000ms interval (not just the immediate tick), then verifies", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      post.mockRejectedValueOnce(needsAuthError()); // initial "Verify" click
      post.mockRejectedValueOnce(needsAuthError()); // immediate auto-detect tick — still not signed in
      post.mockResolvedValueOnce({ outcome: "verified", result: { status: "pass" } }); // interval tick — now verified
      const onComplete = vi.fn();
      render(<VerifyStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
      fireEvent.click(screen.getByText("Verify"));

      fireEvent.click(await screen.findByRole("button", { name: /sign in myself in the cli/i }));
      await waitFor(() => expect(post).toHaveBeenCalledTimes(2)); // immediate tick, still not signed in

      // Advance past a single interval tick (CLI_AUTO_DETECT_POLL_MS) — the
      // interval must re-fire the SAME verify probe on its own, without any
      // further user interaction.
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      await waitFor(() => expect(post).toHaveBeenCalledTimes(3));
      expect(post).toHaveBeenLastCalledWith("/companies/c1/internal-agent/verify", {});
      await waitFor(() => expect(onComplete).toHaveBeenCalled());
      expect(advanceOnboarding).toHaveBeenCalledWith({
        companyId: "c1",
        journey: "founder",
        requestedState: "COMMANDER_VERIFIED",
      });
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

  // Task 7: the server's `*_auth_expired` checks (Tasks 1-6) carry a precise,
  // founder-ready sentence naming the account and distinguishing "expired" from
  // "never signed in" — prefer that over the generic client-side guess, and
  // never let raw stream-json (`detail`) reach the founder.
  describe("Task 7: expired-session copy + no raw JSON leakage", () => {
    const expiredError = (overrides: { detail?: string } = {}) =>
      new ApiError("Request failed: 422", 422, {
        outcome: "needs_auth",
        result: {
          status: "fail",
          checks: [
            {
              code: "claude_hello_probe_auth_expired",
              level: "error",
              message: "Signed in as ada@example.com, but that session has expired or been revoked.",
              hint: "Sign in again — paste an API key below, or run `claude login` in a terminal and we'll detect it.",
              ...overrides,
            },
          ],
        },
      });

    it("names the account and offers recovery when the session has expired", async () => {
      post.mockRejectedValueOnce(expiredError());
      render(<VerifyStep ctx={ctx} onComplete={vi.fn()} onBack={() => {}} />);
      fireEvent.click(screen.getByText("Verify"));

      expect((await screen.findAllByText(/ada@example\.com/)).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/expired or been revoked/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/paste an api key/i).length).toBeGreaterThan(0);
    });

    it("uses different copy for a founder who was never signed in", async () => {
      post.mockRejectedValueOnce(
        new ApiError("Request failed: 422", 422, {
          outcome: "needs_auth",
          result: {
            status: "fail",
            checks: [
              {
                code: "claude_hello_probe_auth_required",
                level: "error",
                message: "Claude CLI is installed, but you're not signed in yet.",
              },
            ],
          },
        }),
      );
      render(<VerifyStep ctx={ctx} onComplete={vi.fn()} onBack={() => {}} />);
      fireEvent.click(screen.getByText("Verify"));

      expect(await screen.findByText(/not signed in yet/i)).toBeTruthy();
      expect(screen.queryByText(/expired or been revoked/i)).toBeNull();
    });

    it("never renders raw stream-json from a check's `detail`", async () => {
      post.mockRejectedValueOnce(
        expiredError({
          detail: '{"type":"system","subtype":"init","session_id":"s","model":"claude-opus-4-8"}',
        }),
      );
      const { container } = render(<VerifyStep ctx={ctx} onComplete={vi.fn()} onBack={() => {}} />);
      fireEvent.click(screen.getByText("Verify"));

      await screen.findAllByText(/ada@example\.com/);
      expect(container.textContent).not.toContain("session_id");
      expect(container.textContent).not.toContain('{"type":"system"');
    });

    it("Codex expired copy names ChatGPT", async () => {
      getConfig.mockResolvedValue({ cliTool: "codex", provider: "anthropic" });
      post.mockRejectedValueOnce(
        new ApiError("Request failed: 422", 422, {
          outcome: "needs_auth",
          result: {
            status: "fail",
            checks: [
              {
                code: "codex_hello_probe_auth_expired",
                level: "error",
                message: "Codex is signed in using ChatGPT, but that session has expired or been rejected.",
                hint: "Sign in again below, or run `codex login` in a terminal and we'll detect it.",
              },
            ],
          },
        }),
      );
      render(<VerifyStep ctx={ctx} onComplete={vi.fn()} onBack={() => {}} />);
      fireEvent.click(screen.getByText("Verify"));

      expect((await screen.findAllByText(/ChatGPT/)).length).toBeGreaterThan(0);
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

// ---------------------------------------------------------------------------
// Check breakdown — the "it said valid but it wasn't" bug.
//
// The verify probe returns several checks. A real revoked-token run passes the
// first three (cwd, command resolvable, auth mode) and fails the last (hello
// probe). Rendering only checks[0] showed a single reassuring line and no way
// to tell success from failure.
// ---------------------------------------------------------------------------
describe("VerifyStep — per-check breakdown", () => {
  beforeEach(() => vi.clearAllMocks());

  const REVOKED_RUN = {
    outcome: "failed",
    result: {
      status: "fail",
      checks: [
        { code: "claude_cwd_valid", level: "info", message: "Working directory is valid: /home/ada/AoA" },
        { code: "claude_command_resolvable", level: "info", message: "Command is executable: claude" },
        { code: "claude_subscription_mode_possible", level: "info", message: "ANTHROPIC_API_KEY is not set" },
        {
          code: "claude_hello_probe_failed",
          level: "error",
          message: "Claude hello probe failed.",
          detail: '{"error":{"message":"OAuth access token has been revoked."}}',
          hint: "Run `claude --print` manually in this directory to debug.",
        },
      ],
    },
  };

  it("shows EVERY check, not just the first one", async () => {
    post.mockResolvedValue(REVOKED_RUN);
    render(<VerifyStep ctx={ctx} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText(/Claude hello probe failed/)).toBeTruthy();
    expect(screen.getByText(/Working directory is valid/)).toBeTruthy();
    expect(screen.getByText(/Command is executable/)).toBeTruthy();
  });

  it("marks the FAILING check as failed and the passing ones as passed", async () => {
    post.mockResolvedValue(REVOKED_RUN);
    const { container } = render(<VerifyStep ctx={ctx} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    // Only the failure is styled as a failure — "Working directory is valid"
    // must never be what reads as the error, which is what confused the founder.
    await waitFor(() => {
      const failures = [...container.querySelectorAll(".text-destructive")].map((e) => e.textContent ?? "");
      expect(failures.join(" ")).toMatch(/hello probe failed/i);
      expect(failures.join(" ")).not.toMatch(/Working directory is valid/i);
    });
  });

  it("decodes a revoked token into plain language instead of a JSON dump", async () => {
    post.mockResolvedValue(REVOKED_RUN);
    render(<VerifyStep ctx={ctx} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText(/sign-in has expired or been revoked/i)).toBeTruthy();
    // The raw stream-json must never reach the founder.
    expect(screen.queryByText(/OAuth access token has been revoked\."\}\}/)).toBeNull();
  });

  it("surfaces the server's hint for the failing check", async () => {
    post.mockResolvedValue(REVOKED_RUN);
    render(<VerifyStep ctx={ctx} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByText(/Run `claude --print` manually/)).toBeTruthy();
  });

  it("hides the breakdown once everything passes", async () => {
    post.mockResolvedValue({
      outcome: "verified",
      result: { status: "pass", checks: [{ code: "ok", level: "info", message: "Working directory is valid: /home/ada/AoA" }] },
    });
    render(<VerifyStep ctx={ctx} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalled());
    expect(screen.queryByText(/Working directory is valid/)).toBeNull();
  });
});

// Caught by live verification against a genuinely revoked token, not by any
// unit test: auth checks arrive at level "warn" (recoverable, not fatal), and
// keying the tick on level==="error" rendered a GREEN CHECK beside "your
// session has expired or been revoked".
describe("VerifyStep — a warn-level check must not render as a pass", () => {
  beforeEach(() => vi.clearAllMocks());

  const WARN_EXPIRED = {
    outcome: "needs_auth",
    result: {
      status: "warn",
      checks: [
        { code: "claude_cwd_valid", level: "info", message: "Working directory is valid: /home/ada" },
        {
          code: "claude_hello_probe_auth_expired",
          level: "warn",
          message: "Signed in as ada@example.com, but that session has expired or been revoked.",
          hint: "Sign in again — paste an API key below.",
        },
      ],
    },
  };

  it("marks the warn-level auth check as a problem, not a pass", async () => {
    post.mockRejectedValueOnce(new ApiError("Request failed: 422", 422, WARN_EXPIRED));
    const { container } = render(<VerifyStep ctx={ctx} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await screen.findAllByText(/expired or been revoked/i);
    const problems = [...container.querySelectorAll(".text-destructive")].map((e) => e.textContent ?? "");
    expect(problems.join(" ")).toMatch(/expired or been revoked/i);
    // The passing check must NOT be styled as a problem.
    expect(problems.join(" ")).not.toMatch(/Working directory is valid/);
  });

  it("still renders genuinely passing checks as passes", async () => {
    post.mockRejectedValueOnce(new ApiError("Request failed: 422", 422, WARN_EXPIRED));
    const { container } = render(<VerifyStep ctx={ctx} onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));

    await screen.findAllByText(/expired or been revoked/i);
    const items = [...container.querySelectorAll("li")];
    const cwdItem = items.find((li) => /Working directory is valid/.test(li.textContent ?? ""));
    expect(cwdItem?.textContent).toContain("✓");
    const authItem = items.find((li) => /expired or been revoked/.test(li.textContent ?? ""));
    expect(authItem?.textContent).not.toContain("✓");
  });
});
