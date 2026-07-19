import { useEffect, useState } from "react";
import { getFirstRunProgress, setFirstRunCompleted, setFirstRunPersona } from "../api/onboarding";
import { DarkShell } from "./FlowEngine";
import { InFlightFlow } from "./inflight/InFlightFlow";
import { Map, type MapDoorPersona } from "./Map";

export type FirstRunHomeProps = {
  companyId: string;
  /** Fired once the first-run experience is fully done (Explorer picked, or
   * the In-flight tail finished) — the caller (`Dashboard`) should re-fetch
   * `firstRunCompleted` (e.g. invalidate the home-summary query) and swap to
   * steady Home. */
  onComplete?: () => void;
};

type Phase = "loading" | "door" | "in_flight" | "done";

/**
 * WS9 — Home's first-run branch (replaces the old Getting-Started checklist
 * branch in `Dashboard.tsx`). Renders inside the dark spine chrome
 * (`.onboarding-dark` + `ConstellationBg`, via `DarkShell`) so the Map and
 * every In-flight surface it hosts (which assume that ancestor scope — see
 * `steps/shared.tsx`) render correctly outside `FlowEngine`.
 *
 * Resume (WS0c §5): if `firstRunPersona` is already `"in_flight"` (the
 * founder picked that door on an earlier visit and left mid-sequence), skip
 * the door band entirely and go straight back into `InFlightFlow` — its own
 * data-driven resume takes it from there. Any other persona (including
 * `"explorer"`, which should already be completed by the time it's
 * persisted — see `handlePick`) falls back to showing the door band, which
 * is a safe, re-askable default.
 */
export function FirstRunHome({ companyId, onComplete }: FirstRunHomeProps) {
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let cancelled = false;
    getFirstRunProgress(companyId)
      .then((progress) => {
        if (cancelled) return;
        setPhase(progress.firstRunPersona === "in_flight" ? "in_flight" : "door");
      })
      .catch(() => {
        if (!cancelled) setPhase("door");
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  async function handlePick(persona: MapDoorPersona) {
    await setFirstRunPersona(companyId, persona);
    if (persona === "explorer") {
      await setFirstRunCompleted(companyId);
      setPhase("done");
      onComplete?.();
      return;
    }
    setPhase("in_flight");
  }

  function handleInFlightDone() {
    // InFlightFlow already wrote firstRunCompleted before calling this.
    setPhase("done");
    onComplete?.();
  }

  // "done": the caller (Dashboard) is expected to swap away on `onComplete`
  // (e.g. by invalidating/refetching `firstRunCompleted`) — render nothing
  // rather than a second dark-chrome flash while that refetch is in flight.
  if (phase === "done") return null;

  return (
    <DarkShell>
      {phase === "in_flight" ? (
        <InFlightFlow companyId={companyId} onDone={handleInFlightDone} />
      ) : phase === "door" ? (
        <Map onPick={handlePick} />
      ) : null}
    </DarkShell>
  );
}
