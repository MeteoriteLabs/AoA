import { useCallback, useEffect, useRef, useState } from "react";
import type { StepProps } from "../registry";
import { advanceOnboarding } from "../../api/onboarding";
import { Button } from "@/components/ui/button";

/**
 * Terminal wizard step (WS0c §4.3) — the last step of the founder spine
 * (Profile → Company → Environment → Commander → Verify → **this**). Awaits
 * the `SETUP_COMPLETE` advance on mount and, on success, calls `onComplete()`
 * so the FlowEngine resolves no next step and `onFinished` becomes a pure
 * navigate to Home.
 *
 * Deliberately a real (if minimal) FlowEngine step — NOT a bare `onFinished`
 * side-effect — so a failed advance keeps the same retryable pending/error
 * surface `ReviewStep` used to provide (Codex P1: firing the advance from
 * inside `onFinished` after `FlowEngine` has already rendered "Onboarding
 * complete" leaves no error/retry UI). Advances only the selected-company
 * (org) layer via `ctx.companyId` — the two-layer handshake stays sound.
 *
 * Does NOT write `firstRunCompleted` — that write moves to Home/WS9 (design
 * §5, §6). Interim safety until WS9 lands: `home.ts`'s `isLegacySetupComplete`
 * bridge still covers a founder who completes the legacy checklist.
 *
 * The mount-effect auto-fire is guarded by `startedRef` (same convention as
 * `SplashScreen`'s `firedRef`) so React StrictMode's dev-only double-invoke
 * of effects can't launch two concurrent advances / two `onComplete()`
 * calls. The guard covers only the automatic mount fire — the Retry button
 * calls `advance()` directly, so a genuine failure can still be retried.
 */
export function SpineCompleteStep({ ctx, onComplete }: StepProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const advance = useCallback(async () => {
    if (!ctx.companyId) return;
    setBusy(true);
    try {
      await advanceOnboarding({
        companyId: ctx.companyId,
        journey: ctx.journey,
        requestedState: "SETUP_COMPLETE",
      });
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't finish setup. Please try again.");
      setBusy(false);
    }
  }, [ctx.companyId, ctx.journey, onComplete]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void advance();
    // Fire once on mount (guarded above). `advance` is recreated when
    // companyId/journey change, but this step doesn't remount on those
    // changes mid-flight — the FlowEngine reloads the whole layer instead —
    // so we deliberately don't chase `advance` here (that would re-fire the
    // request on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <h1 className="text-xl font-semibold">Bringing you to your control room…</h1>
      {error ? (
        <div className="mt-6 space-y-3">
          <p className="text-xs text-destructive">{error}</p>
          <Button className="w-full" onClick={() => void advance()} disabled={busy}>
            {busy ? "Retrying…" : "Retry"}
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">Just a moment.</p>
      )}
    </div>
  );
}
