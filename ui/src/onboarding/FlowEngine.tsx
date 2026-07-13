import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { OnboardingJourney, OnboardingState } from "@armyofagents/shared";
import {
  resolveNextStep,
  ONBOARDING_REGISTRY,
  type StepDefinition,
  type StepContext,
} from "./registry";

export type FlowProgress = { completedStates: OnboardingState[] };

/**
 * The engine only READS progress. Steps perform their own data write + state
 * advance (via the onboarding API) — this keeps the two-layer / org-create
 * handshake correct: the org-create step advances ORGANIZATION_CREATED on the
 * NEW company's layer and sets the selected company, and the engine re-reads.
 */
export type FlowEngineApi = {
  getProgress: (companyId: string | null) => Promise<FlowProgress | null>;
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
  const [backStepId, setBackStepId] = useState<string | null>(null);
  const finishedRef = useRef(false);
  const companyIdRef = useRef(companyId);
  companyIdRef.current = companyId;

  const load = useCallback(async () => {
    const requestedCompanyId = companyId;
    const p = await api.getProgress(requestedCompanyId);
    if (companyIdRef.current !== requestedCompanyId) return;
    setCompleted(p?.completedStates ?? ["AUTHENTICATED"]);
  }, [api, companyId]);

  useEffect(() => {
    finishedRef.current = false;
    setBackStepId(null);
    setCompleted(null);
    void load();
  }, [load]);

  const ctx: StepContext | null =
    completed === null ? null : { userId, companyId, journey, completedStates: completed };
  const applicableSteps = ctx
    ? registry
        .filter((candidate) => candidate.journeys.includes(ctx.journey))
        .filter((candidate) => candidate.shouldInclude(ctx))
        .sort((a, b) => a.order - b.order)
    : [];
  const nextStep = ctx ? resolveNextStep(registry, ctx) : null;
  const step = backStepId
    ? (applicableSteps.find((candidate) => candidate.id === backStepId) ?? nextStep)
    : nextStep;

  useEffect(() => {
    if (completed !== null && !step && !finishedRef.current) {
      finishedRef.current = true;
      onFinished?.();
    }
  }, [completed, step, onFinished]);

  const handleComplete = useCallback(async () => {
    // The step already performed its data write + state advance; re-read the
    // authoritative context (RC/RB1) and resolve the next step.
    setBackStepId(null);
    await load();
  }, [load]);

  const handleBack = useCallback(() => {
    if (!ctx || !step) return;
    const currentIndex = applicableSteps.findIndex((candidate) => candidate.id === step.id);
    const previous = applicableSteps
      .slice(0, currentIndex)
      .reverse()
      .find((candidate) => candidate.isComplete(ctx));
    if (previous) {
      setBackStepId(previous.id);
      return;
    }
    onBack?.();
  }, [applicableSteps, ctx, onBack, step]);

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
      <Step ctx={ctx} onComplete={() => void handleComplete()} onBack={handleBack} />
    </Suspense>
  );
}
