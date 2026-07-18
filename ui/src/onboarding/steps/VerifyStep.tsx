import { useEffect, useRef, useState } from "react";
import type { StepProps } from "../registry";
import { api, ApiError } from "../../api/client";
import { advanceOnboarding } from "../../api/onboarding";
import { internalAgentApi } from "../../api/internal-agent";
import {
  saveCommanderKey,
  startCommanderLogin,
  getCommanderLoginStatus,
  cancelCommanderLogin,
  type CommanderLoginStatus,
} from "../../api/commander-auth";
import { cliToolToProvider, type CommanderProvider } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";
import { AgentCharacter, LoadingDots, Reveal } from "../motion";
import { GradientText, StepHeading, StepShell } from "./shared";

type Outcome = "idle" | "verified" | "needs_auth" | "not_installed" | "failed";

type VerifyBody = {
  outcome?: Outcome;
  result?: { status?: string; checks?: { code?: string; message?: string }[] };
};

const PROVIDER_LABEL: Record<CommanderProvider, string> = { anthropic: "Claude", openai: "Codex" };

/** Interval (ms) between CLI-auto-detect poll ticks, once past the immediate first check. */
const CLI_AUTO_DETECT_POLL_MS = 3000;

/** OS-appropriate install hint (generic — the CLI name is shown in the copy). */
function installHint(): string {
  const p = typeof navigator !== "undefined" ? navigator.platform.toLowerCase() : "";
  if (p.includes("mac")) return "Install the CLI (e.g. `brew install …`) or download it from the vendor docs.";
  if (p.includes("win")) return "Install the CLI (e.g. `winget install …`) or run the vendor installer.";
  return "Install the CLI (e.g. `npm i -g …`) or follow the vendor install docs.";
}

/**
 * "Verify your tooling" step (Stage C / order 5). Drives the shared adapter
 * probe via the verify route. BLOCKING: only a `verified` outcome advances
 * COMMANDER_VERIFIED. On `needs_auth` the founder can sign in WITHOUT a terminal
 * — paste an API key (stored encrypted), run the interactive device login (Plan
 * 3 §6.1/§6.2, Codex-only), or (WS3) do it themselves in a terminal and let this
 * step auto-detect completion by polling the same verify probe — then we auto
 * re-verify. The live device flow is dogfood-verified; CI covers the key-paste,
 * device-poll, and CLI-auto-detect-poll wiring.
 */
export function VerifyStep({ ctx, onComplete }: StepProps) {
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const [provider, setProvider] = useState<CommanderProvider | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [login, setLogin] = useState<{ challengeId: string; loginUrl: string; status: CommanderLoginStatus } | null>(
    null,
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // WS3: "do it yourself in the CLI" — instead of a device-login handshake,
  // just keep re-running the SAME hello-probe verify check on an interval
  // until it comes back verified (the founder ran `claude auth login` / etc.
  // themselves in a terminal outside AoA). Works for any provider, unlike the
  // interactive device login below (Codex-only).
  const [cliPolling, setCliPolling] = useState(false);
  const cliPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Derive the recovery-credential provider from Commander's CLI (`cliTool`), NOT
  // the crew `provider` — they are independent config. The verify route probes
  // the adapter resolved from `cliTool` (server resolveCommanderAdapterType), so
  // offering/saving a key for a DIFFERENT CLI than the one being probed would
  // loop the founder forever (e.g. Claude Commander + OpenAI crew → OpenAI key →
  // re-probe Claude → still blocked). Codex P2-A. `cliToolToProvider` is the
  // shared source of truth (also drives the server); we narrow its CrewProvider
  // result to the two Commander providers this step can recover (opencode/google
  // have no key-paste path → provider stays null).
  useEffect(() => {
    if (!ctx.companyId) return;
    let alive = true;
    void internalAgentApi
      .getConfig(ctx.companyId)
      .then((cfg) => {
        const p = cliToolToProvider((cfg as { cliTool?: string | null })?.cliTool);
        if (alive && (p === "anthropic" || p === "openai")) setProvider(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ctx.companyId]);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const clearCliPoll = () => {
    if (cliPollRef.current) {
      clearInterval(cliPollRef.current);
      cliPollRef.current = null;
    }
    setCliPolling(false);
  };

  // Mirror the latest active login challenge (with the company that created it)
  // into a ref so the empty-dep unmount cleanup below sees the CURRENT value — a
  // plain closure would capture the initial null and never cancel anything.
  const activeLoginRef = useRef<{ companyId: string; challengeId: string; status: CommanderLoginStatus } | null>(
    null,
  );
  useEffect(() => {
    activeLoginRef.current =
      login && ctx.companyId
        ? { companyId: ctx.companyId, challengeId: login.challengeId, status: login.status }
        : null;
  }, [login, ctx.companyId]);

  // On unmount (incl. navigating Back, which unmounts this step) stop BOTH poll
  // loops AND cancel a still-`pending` login. Otherwise the detached CLI child +
  // `pending` row stay alive, and the login slot — shared by (provider,
  // authHome) — 409s every other company until it completes/expires. A
  // completed/failed/timeout challenge is already terminal → skip the request.
  // Codex P2-B.
  useEffect(() => {
    return () => {
      clearPoll();
      clearCliPoll();
      const active = activeLoginRef.current;
      if (active && active.status === "pending") {
        void cancelCommanderLogin({ companyId: active.companyId, challengeId: active.challengeId }).catch(
          () => {},
        );
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on unmount; latest state is read via activeLoginRef.
  }, []);

  const check = async () => {
    if (!ctx.companyId) return;
    setBusy(true);
    setAuthError(null);
    try {
      const res = await api.post<VerifyBody>(`/companies/${ctx.companyId}/internal-agent/verify`, {});
      setOutcome(res.outcome ?? "verified");
      setMessage(res.result?.checks?.[0]?.message ?? null);
      if ((res.outcome ?? "verified") === "verified") {
        clearPoll();
        clearCliPoll();
        await advanceOnboarding({
          companyId: ctx.companyId,
          journey: ctx.journey,
          requestedState: "COMMANDER_VERIFIED",
        });
        onComplete();
      }
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as VerifyBody | null) : null;
      setOutcome(body?.outcome ?? "failed");
      setMessage(
        body?.result?.checks?.[0]?.message ?? (e instanceof Error ? e.message : "Verification failed."),
      );
    } finally {
      setBusy(false);
    }
  };

  const saveKeyAndReverify = async () => {
    if (!ctx.companyId || !provider || !apiKey.trim()) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      await saveCommanderKey({ companyId: ctx.companyId, provider, value: apiKey.trim() });
      setApiKey("");
      await check();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Could not save the key.");
    } finally {
      setAuthBusy(false);
    }
  };

  const startLogin = async () => {
    if (!ctx.companyId || !provider) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      const { challengeId, loginUrl } = await startCommanderLogin({ companyId: ctx.companyId, provider });
      setLogin({ challengeId, loginUrl, status: "pending" });
      clearPoll();
      pollRef.current = setInterval(() => void pollLogin(challengeId), 2500);
      void pollLogin(challengeId); // poll once immediately, don't wait a full interval
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Could not start sign-in.");
    } finally {
      setAuthBusy(false);
    }
  };

  const pollLogin = async (challengeId: string) => {
    if (!ctx.companyId) return;
    try {
      const { status } = await getCommanderLoginStatus({ companyId: ctx.companyId, challengeId });
      setLogin((prev) => (prev ? { ...prev, status } : prev));
      if (status === "completed") {
        clearPoll();
        setLogin(null);
        await check();
      } else if (status === "failed" || status === "timeout") {
        clearPoll();
        setAuthError(`Sign-in ${status}. Try again.`);
        setLogin(null);
      }
    } catch {
      // transient — keep polling
    }
  };

  /**
   * WS3 — "I'll sign in myself in the CLI." No handshake to start: just
   * re-run `check()` on an interval until it reports `verified` (which
   * itself advances + completes and calls `clearCliPoll()`). Skips a tick
   * while a check is already in flight (`busyRef`) so overlapping requests
   * can't pile up.
   */
  const startCliAutoDetect = () => {
    if (cliPollRef.current) return;
    setCliPolling(true);
    setAuthError(null);
    const tick = () => {
      if (busyRef.current) return;
      void check();
    };
    cliPollRef.current = setInterval(tick, CLI_AUTO_DETECT_POLL_MS);
    tick(); // check immediately, don't wait a full interval
  };

  const providerLabel = provider ? PROVIDER_LABEL[provider] : "your CLI";

  return (
    <StepShell>
      <Reveal>
        <StepHeading
          title={
            <>
              Verify your <GradientText>tooling</GradientText>
            </>
          }
          subtitle="We check that your Commander CLI is installed, launchable, and signed in. You never have to touch a terminal unless something's missing."
        />
      </Reveal>

      <Reveal delay={0.09}>
        <div className="flex flex-col items-center gap-3">
          <AgentCharacter
            state={busy || cliPolling ? "working" : outcome === "verified" ? "done" : "idle"}
            eyeColor={outcome === "verified" ? "#4a9a4a" : "#D13A26"}
          />
          <LoadingDots state={busy ? "loading" : outcome === "verified" ? "done" : "idle"} />
        </div>
      </Reveal>

      {outcome === "not_installed" && (
        <Reveal delay={0.18}>
          <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-left text-xs text-dim">
            <p className="text-text">The CLI isn't installed or isn't on your PATH.</p>
            <p>{installHint()}</p>
            {message && <p>{message}</p>}
            <p className="text-text">Install it, then choose "Check again".</p>
          </div>
        </Reveal>
      )}
      {outcome === "needs_auth" && (
        <Reveal delay={0.18}>
          <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-left text-xs text-dim">
            <p className="text-text">
              The {providerLabel} CLI is installed but needs sign-in. Choose one — no terminal required:
            </p>
            {message && <p>{message}</p>}

            <div className="space-y-2">
              <label className="block font-medium text-text" htmlFor="commander-api-key">
                Paste an API key
              </label>
              <input
                id="commander-api-key"
                type="password"
                autoComplete="off"
                className="w-full rounded-md border border-border-strong bg-field px-2 py-1.5 text-text outline-none focus:border-brand focus:ring-1 focus:ring-brand"
                placeholder={provider === "openai" ? "sk-…" : "sk-ant-…"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={authBusy || !provider}
              />
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => void saveKeyAndReverify()}
                disabled={authBusy || !provider || !apiKey.trim()}
              >
                {authBusy ? "Working…" : "Save key & verify"}
              </Button>
            </div>

            {/* Interactive login is Codex-only: `codex login` self-completes via a
                local callback. Claude's `claude auth login` needs a paste-code
                bridge (follow-up), so Claude shows the API-key path only. */}
            {provider === "openai" && (
              <>
                <div className="flex items-center gap-2 text-very-dim">
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>

                {login ? (
                  <div className="space-y-1">
                    <p>
                      Open this link to finish signing in, then keep this tab open — we'll continue
                      automatically:
                    </p>
                    <a
                      href={login.loginUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="block break-all font-mono text-[11px] text-brand-hover underline"
                    >
                      {login.loginUrl}
                    </a>
                    <p>Waiting for sign-in… ({login.status})</p>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full"
                    onClick={() => void startLogin()}
                    disabled={authBusy || !provider}
                  >
                    {authBusy ? "Working…" : `Sign in with ${providerLabel}`}
                  </Button>
                )}
              </>
            )}

            {/* WS3 — CLI auto-detect: works for any provider (unlike the
                Codex-only interactive login above). */}
            <div className="flex items-center gap-2 text-very-dim">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            {cliPolling ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <LoadingDots state="loading" />
                  <p>
                    Watching for your sign-in… run it yourself in a terminal and we'll continue
                    automatically.
                  </p>
                </div>
                <Button type="button" variant="ghost" className="w-full" onClick={clearCliPoll}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={startCliAutoDetect}
                disabled={authBusy}
              >
                I'll sign in myself in the CLI
              </Button>
            )}

            {authError && <p className="text-destructive">{authError}</p>}
          </div>
        </Reveal>
      )}
      {outcome === "failed" && (
        <Reveal delay={0.18}>
          <p className="text-xs text-destructive">{message ?? "Verification failed."}</p>
        </Reveal>
      )}

      <Reveal delay={0.27}>
        <Button className="w-full" onClick={() => void check()} disabled={busy}>
          {busy ? "Checking…" : outcome === "idle" ? "Verify" : "Check again"}
        </Button>
      </Reveal>
    </StepShell>
  );
}
