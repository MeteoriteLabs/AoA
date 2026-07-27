import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, LogOut } from "lucide-react";
import type { OnboardingJourney, OnboardingState } from "@armyofagents/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  resolveNextStep,
  ONBOARDING_REGISTRY,
  type StepDefinition,
  type StepContext,
} from "./registry";
import { StepPosition } from "./StepPosition";
import { journeyHasFirstRunMap } from "./onboardingProgress";

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
  onSwitchAccount?: () => void;
  isSwitchingAccount?: boolean;
  switchAccountError?: string | null;
};

/**
 * Shared dark chrome shell. The standalone route owns one vertical scroller so
 * long verification and authentication errors always remain reachable.
 * Exported so non-FlowEngine onboarding surfaces (e.g. the org-only branch in
 * `pages/OnboardingFlow.tsx`) render the same chrome instead of hand-duplicating
 * it.
 *
 * `fill` (WS9 code review): the `/onboarding` route renders standalone (not
 * nested inside app `Layout`), so `min-h-screen` is correct there — the shell
 * IS the viewport. `FirstRunHome` instead renders inside Layout's padded
 * `<main class="flex-1 overflow-auto">`, which already has a bounded height;
 * stacking a second `min-h-screen` inside it risks a second scroll container.
 * `fill` swaps to `min-h-full` (fills the available height, still grows with
 * content) so `<main>` stays the single scroll container.
 */
export function DarkShell({
  children,
  fill = false,
}: {
  children: React.ReactNode;
  fill?: boolean;
}) {
  return (
    <div
      data-aoa-onboarding-theme="dark"
      className={cn(
        "onboarding-dark relative w-full overflow-x-hidden bg-background text-foreground [color-scheme:dark]",
        fill
          ? "min-h-full"
          : "h-[100dvh] min-h-0 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable]"
      )}
    >
      {children}
    </div>
  );
}

/**
 * Walks the step registry for the given journey (Stage B / B6). On each step's
 * onComplete it PATCH-advances progress and RE-READS the authoritative context
 * from the server (revC/RB1) before resolving the next step. Reloads whenever
 * the layer (companyId) changes — that is how the org-create step's new company
 * switches the engine from the user layer to the org layer.
 *
 * WS3: the whole engine renders inside the dark `.onboarding-dark` /
 * `<ConstellationBg/>` shell (spec screens S2–S5) — the shared Back +
 * "Step N of M" chrome is restyled to a stepper-pip row on top of it, and
 * every step component below assumes this ancestor dark scope for its own
 * card/field/gradient styling (see steps/shared.tsx).
 */
export function FlowEngine({
  userId,
  companyId,
  journey,
  api,
  registry = ONBOARDING_REGISTRY,
  onFinished,
  onBack,
  onSwitchAccount,
  isSwitchingAccount = false,
  switchAccountError,
}: FlowEngineProps) {
  const [completed, setCompleted] = useState<OnboardingState[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progressLoading, setProgressLoading] = useState(true);
  const [backStepId, setBackStepId] = useState<string | null>(null);
  const finishedRef = useRef(false);
  const companyIdRef = useRef(companyId);
  const loadGenerationRef = useRef(0);
  const recoveryHeadingRef = useRef<HTMLHeadingElement>(null);
  companyIdRef.current = companyId;

  const load = useCallback(async () => {
    const requestedCompanyId = companyId;
    if (companyIdRef.current !== requestedCompanyId) return;
    const generation = ++loadGenerationRef.current;
    setProgressLoading(true);
    try {
      const p = await api.getProgress(requestedCompanyId);
      if (
        companyIdRef.current !== requestedCompanyId ||
        loadGenerationRef.current !== generation
      )
        return;
      setCompleted(p?.completedStates ?? ["AUTHENTICATED"]);
      setLoadError(null);
    } catch (error) {
      if (
        companyIdRef.current !== requestedCompanyId ||
        loadGenerationRef.current !== generation
      )
        return;
      setLoadError(
        error instanceof Error
          ? error.message
          : "We couldn't load your onboarding progress."
      );
    } finally {
      if (
        companyIdRef.current === requestedCompanyId &&
        loadGenerationRef.current === generation
      ) {
        setProgressLoading(false);
      }
    }
  }, [api, companyId]);

  useEffect(() => {
    finishedRef.current = false;
    setBackStepId(null);
    setCompleted(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (loadError) recoveryHeadingRef.current?.focus();
  }, [loadError]);

  const ctx: StepContext | null =
    completed === null
      ? null
      : { userId, companyId, journey, completedStates: completed };
  const applicableSteps = ctx
    ? registry
        .filter((candidate) => candidate.journeys.includes(ctx.journey))
        .filter((candidate) => candidate.shouldInclude(ctx))
        .sort((a, b) => a.order - b.order)
    : [];
  const nextStep = ctx ? resolveNextStep(registry, ctx) : null;
  const step = backStepId
    ? applicableSteps.find((candidate) => candidate.id === backStepId) ??
      nextStep
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
    const currentIndex = applicableSteps.findIndex(
      (candidate) => candidate.id === step.id
    );
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

  if (loadError) {
    return (
      <DarkShell>
        <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-4 py-16 sm:px-6">
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card p-5 text-center"
            aria-busy={progressLoading}
          >
            <h1
              ref={recoveryHeadingRef}
              tabIndex={-1}
              className="text-lg font-semibold text-text outline-none"
            >
              We couldn't load onboarding
            </h1>
            <p
              className="mt-2 break-words text-sm text-destructive"
              role="alert"
            >
              {loadError}
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button
                type="button"
                disabled={progressLoading}
                onClick={() => void load()}
              >
                {progressLoading ? "Trying again…" : "Try again"}
              </Button>
              {onSwitchAccount && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isSwitchingAccount}
                  onClick={onSwitchAccount}
                >
                  {isSwitchingAccount ? "Signing out…" : "Switch account"}
                </Button>
              )}
            </div>
            {switchAccountError && (
              <p className="mt-3 text-xs text-destructive" role="alert">
                {switchAccountError}
              </p>
            )}
          </div>
        </div>
      </DarkShell>
    );
  }

  if (progressLoading || !ctx) {
    return (
      <DarkShell>
        {onSwitchAccount && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="fixed right-4 top-4 z-20 gap-1.5 text-dim hover:bg-white/5 hover:text-text"
            disabled={isSwitchingAccount}
            onClick={onSwitchAccount}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            {isSwitchingAccount ? "Signing out…" : "Switch account"}
          </Button>
        )}
        <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-6">
          <p className="text-sm text-dim">Loading…</p>
        </div>
      </DarkShell>
    );
  }
  if (!step) {
    return (
      <DarkShell>
        {onSwitchAccount && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="fixed right-4 top-4 z-20 gap-1.5 text-dim hover:bg-white/5 hover:text-text"
            disabled={isSwitchingAccount}
            onClick={onSwitchAccount}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            {isSwitchingAccount ? "Signing out…" : "Switch account"}
          </Button>
        )}
        <div className="relative z-10 flex min-h-[100dvh] items-center justify-center px-6">
          <div data-testid="onboarding-complete" className="text-sm text-dim">
            Onboarding complete.
          </div>
        </div>
      </DarkShell>
    );
  }

  const Step = step.Component;
  const stepNumber =
    applicableSteps.findIndex((candidate) => candidate.id === step.id) + 1;
  // Back renders only when a COMPLETED predecessor exists to walk back to.
  // On the first step the fallthrough (onBack → navigate "/") would bounce:
  // the index gate resolves the same journey and sends the user straight back
  // here — a flash-reload, not an exit.
  const hasCompletedPredecessor =
    stepNumber > 0 &&
    applicableSteps
      .slice(0, stepNumber - 1)
      .some((candidate) => candidate.isComplete(ctx));
  // BASE = visible spine steps + the Map (founder only). The spine now counts
  // toward this continuous total, so the last spine step reads "N of BASE" and
  // the post-spine Map/In-flight surfaces continue the same count (see
  // onboardingProgress.ts).
  const base =
    applicableSteps.length + (journeyHasFirstRunMap(journey) ? 1 : 0);
  // The chip hides on single-step journeys where it carries no information
  // (e.g. invited's lone human-profile step).
  const showStepChrome = stepNumber > 0 && base > 1;

  return (
    <DarkShell>
      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-xl flex-col px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6 sm:py-8">
        {/* Shared step chrome: one Back affordance + a stepper-pip / "Step N of
            M" position readout for every step (steps no longer render their
            own Back). */}
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="min-w-10 sm:min-w-16">
            {hasCompletedPredecessor && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Back"
                className="-ml-2 gap-1 px-2 text-dim hover:bg-white/5 hover:text-text sm:px-3"
                onClick={handleBack}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">Back</span>
              </Button>
            )}
          </div>
          {showStepChrome && <StepPosition current={stepNumber} total={base} />}
          <div className="flex min-w-10 justify-end sm:min-w-[104px]">
            {onSwitchAccount && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Switch account"
                className="-mr-2 gap-1.5 px-2 text-dim hover:bg-white/5 hover:text-text sm:px-3"
                disabled={isSwitchingAccount}
                onClick={onSwitchAccount}
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">
                  {isSwitchingAccount ? "Signing out…" : "Switch account"}
                </span>
              </Button>
            )}
          </div>
        </div>
        {switchAccountError && (
          <p className="mt-2 text-right text-xs text-destructive" role="alert">
            {switchAccountError}
          </p>
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="w-full py-6 sm:py-10">
            <Suspense
              fallback={
                <p className="text-center text-sm text-dim">Loading step…</p>
              }
            >
              <Step
                ctx={ctx}
                onComplete={() => void handleComplete()}
                onBack={handleBack}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </DarkShell>
  );
}
