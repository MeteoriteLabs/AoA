import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { OnboardingJourney, OnboardingState } from "@armyofagents/shared";
import {
  resolveNextStep,
  ONBOARDING_REGISTRY,
  type StepDefinition,
  type StepContext,
} from "./registry";

export type FlowProgress = { completedStates: OnboardingState[] };

export type FlowEngineApi = {
  getProgress: (companyId: string | null) => Promise<FlowProgress | null>;
  advance: (args: {
    companyId: string | null;
    journey: OnboardingJourney;
    requestedState: OnboardingState;
  }) => Promise<FlowProgress | null>;
};

export type FlowEngineProps = {
  userId: string;
  companyId: string | null;
  journey: OnboardingJourney;
  api: FlowEngineApi;
  registry?: StepDefinition[];
  onFinished?: () => void;
  onBack?: () => void;
};

/**
 * Walks the step registry for the given journey (Stage B / B6). On each step's
 * onComplete it PATCH-advances progress and RE-READS the authoritative context
 * from the server (revC/RB1) before resolving the next step. Reloads whenever
 * the layer (companyId) changes — that is how the org-create step's new company
 * switches the engine from the user layer to the org layer.
 */
export function FlowEngine({
  userId,
  companyId,
  journey,
  api,
  registry = ONBOARDING_REGISTRY,
  onFinished,
  onBack,
}: FlowEngineProps) {
  const [completed, setCompleted] = useState<OnboardingState[] | null>(null);
  const finishedRef = useRef(false);

  const load = useCallback(async () => {
    const p = await api.getProgress(companyId);
    setCompleted(p?.completedStates ?? ["AUTHENTICATED"]);
  }, [api, companyId]);

  useEffect(() => {
    finishedRef.current = false;
    setCompleted(null);
    void load();
  }, [load]);

  const ctx: StepContext | null =
    completed === null ? null : { userId, companyId, journey, completedStates: completed };
  const step = ctx ? resolveNextStep(registry, ctx) : null;

  useEffect(() => {
    if (completed !== null && !step && !finishedRef.current) {
      finishedRef.current = true;
      onFinished?.();
    }
  }, [completed, step, onFinished]);

  const handleComplete = useCallback(async () => {
    if (!step) return;
    const updated = await api.advance({ companyId, journey, requestedState: step.state });
    const fresh = updated ?? (await api.getProgress(companyId));
    setCompleted(fresh?.completedStates ?? completed ?? ["AUTHENTICATED"]);
  }, [api, companyId, journey, step, completed]);

  if (!ctx) {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading…</div>;
  }
  if (!step) {
    return (
      <div
        data-testid="onboarding-complete"
        className="mx-auto max-w-xl py-10 text-sm text-muted-foreground"
      >
        Onboarding complete.
      </div>
    );
  }

  const Step = step.Component;
  return (
    <Suspense
      fallback={<div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading step…</div>}
    >
      <Step ctx={ctx} onComplete={() => void handleComplete()} onBack={() => onBack?.()} />
    </Suspense>
  );
}
