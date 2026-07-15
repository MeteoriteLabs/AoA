import { useEffect, useRef, useState } from "react";
import type { StepProps } from "../registry";
import { api, ApiError } from "../../api/client";
import { advanceOnboarding } from "../../api/onboarding";
import { internalAgentApi } from "../../api/internal-agent";
import {
  saveCommanderKey,
  startCommanderLogin,
  getCommanderLoginStatus,
  type CommanderLoginStatus,
} from "../../api/commander-auth";
import type { CommanderProvider } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";

type Outcome = "idle" | "verified" | "needs_auth" | "not_installed" | "failed";

type VerifyBody = {
  outcome?: Outcome;
  result?: { status?: string; checks?: { code?: string; message?: string }[] };
};

const PROVIDER_LABEL: Record<CommanderProvider, string> = { anthropic: "Claude", openai: "Codex" };

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
 * — either paste an API key (stored encrypted) or run the interactive device
 * login (Plan 3 §6.1/§6.2) — then we auto re-verify. The live device flow is
 * dogfood-verified; CI covers the key-paste + poll-to-completed wiring.
 */
export function VerifyStep({ ctx, onComplete, onBack }: StepProps) {
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [provider, setProvider] = useState<CommanderProvider | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [login, setLogin] = useState<{ challengeId: string; loginUrl: string; status: CommanderLoginStatus } | null>(
    null,
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Learn which CLI the founder chose so the auth affordances name it correctly.
  useEffect(() => {
    if (!ctx.companyId) return;
    let alive = true;
    void internalAgentApi
      .getConfig(ctx.companyId)
      .then((cfg) => {
        const p = (cfg as { provider?: string | null })?.provider;
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
  useEffect(() => clearPoll, []);

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

  const providerLabel = provider ? PROVIDER_LABEL[provider] : "your CLI";

  return (
    <div className="mx-auto max-w-md py-10">
      <h1 className="text-xl font-semibold">Verify your tooling</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        We check that your Commander CLI is installed, launchable, and signed in. You never have to
        touch a terminal unless something's missing.
      </p>

      {outcome === "not_installed" && (
        <div className="mt-4 rounded-md border border-amber-300/60 bg-amber-50/40 p-3 text-xs space-y-2">
          <p>The CLI isn't installed or isn't on your PATH.</p>
          <p className="text-muted-foreground">{installHint()}</p>
          {message && <p className="text-muted-foreground">{message}</p>}
          <p>Install it, then choose “Check again”.</p>
        </div>
      )}
      {outcome === "needs_auth" && (
        <div className="mt-4 rounded-md border border-amber-300/60 bg-amber-50/40 p-3 text-xs space-y-3">
          <p>The {providerLabel} CLI is installed but needs sign-in. Choose one — no terminal required:</p>
          {message && <p className="text-muted-foreground">{message}</p>}

          <div className="space-y-2">
            <label className="block font-medium" htmlFor="commander-api-key">
              Paste an API key
            </label>
            <input
              id="commander-api-key"
              type="password"
              autoComplete="off"
              className="w-full rounded border border-border bg-background px-2 py-1"
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
              <div className="flex items-center gap-2 text-muted-foreground">
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
                className="block break-all font-mono text-[11px] underline"
              >
                {login.loginUrl}
              </a>
              <p className="text-muted-foreground">Waiting for sign-in… ({login.status})</p>
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

          {authError && <p className="text-destructive">{authError}</p>}
        </div>
      )}
      {outcome === "failed" && (
        <p className="mt-4 text-xs text-destructive">{message ?? "Verification failed."}</p>
      )}

      <Button className="mt-4 w-full" onClick={() => void check()} disabled={busy}>
        {busy ? "Checking…" : outcome === "idle" ? "Verify" : "Check again"}
      </Button>
      <Button type="button" variant="ghost" className="mt-2 w-full" onClick={onBack}>
        Back to choose Claude or Codex
      </Button>
    </div>
  );
}
