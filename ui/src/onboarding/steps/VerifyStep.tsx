import { useState } from "react";
import type { StepProps } from "../registry";
import { api, ApiError } from "../../api/client";
import { advanceOnboarding } from "../../api/onboarding";
import { Button } from "@/components/ui/button";

type Outcome = "idle" | "verified" | "needs_auth" | "not_installed" | "failed";

type VerifyBody = {
  outcome?: Outcome;
  result?: { status?: string; checks?: { code?: string; message?: string }[] };
};

/** OS-appropriate install hint (generic — the CLI name is shown in the copy). */
function installHint(): string {
  const p = typeof navigator !== "undefined" ? navigator.platform.toLowerCase() : "";
  if (p.includes("mac")) return "Install the CLI (e.g. `brew install …`) or download it from the vendor docs.";
  if (p.includes("win")) return "Install the CLI (e.g. `winget install …`) or run the vendor installer.";
  return "Install the CLI (e.g. `npm i -g …`) or follow the vendor install docs.";
}

/**
 * "Verify your tooling" step (Stage C / order 5, revA R14). Drives the shared
 * adapter probe via the verify route. BLOCKING: only a `verified` outcome
 * advances COMMANDER_VERIFIED — needs_auth / not_installed / failed keep the
 * founder here with guidance and a "Check again" loop. In-app subscription
 * login (T-CodexLogin) and API-key paste are deferred follow-ups; today the
 * founder runs the CLI login in a terminal, then re-checks.
 */
export function VerifyStep({ ctx, onComplete }: StepProps) {
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    if (!ctx.companyId) return;
    setBusy(true);
    try {
      const res = await api.post<VerifyBody>(`/companies/${ctx.companyId}/internal-agent/verify`, {});
      setOutcome(res.outcome ?? "verified");
      setMessage(res.result?.checks?.[0]?.message ?? null);
      if ((res.outcome ?? "verified") === "verified") {
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
        <div className="mt-4 rounded-md border border-amber-300/60 bg-amber-50/40 p-3 text-xs space-y-2">
          <p>The CLI is installed but needs sign-in. Run its login command in a terminal, then check again.</p>
          {message && <p className="text-muted-foreground">{message}</p>}
        </div>
      )}
      {outcome === "failed" && (
        <p className="mt-4 text-xs text-destructive">{message ?? "Verification failed."}</p>
      )}

      <Button className="mt-4 w-full" onClick={() => void check()} disabled={busy}>
        {busy ? "Checking…" : outcome === "idle" ? "Verify" : "Check again"}
      </Button>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Prefer the other runtime? Go back to pick Claude or Codex.
      </p>
    </div>
  );
}
