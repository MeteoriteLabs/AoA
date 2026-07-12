import type {
  PostAuthJourneyResult,
  OnboardingJourney,
  OnboardingState,
} from "@armyofagents/shared";

export type FlowProgress = { completedStates: OnboardingState[] };

export async function getOnboardingProgress(companyId: string | null): Promise<FlowProgress | null> {
  const q = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
  const res = await fetch(`/api/onboarding/progress${q}`, { credentials: "include" });
  if (!res.ok) throw new Error(`progress fetch failed: ${res.status}`);
  const data = (await res.json()) as { progress?: { completedStates?: OnboardingState[] } | null };
  return data.progress ? { completedStates: data.progress.completedStates ?? [] } : null;
}

export async function advanceOnboarding(args: {
  companyId: string | null;
  journey: OnboardingJourney;
  requestedState: OnboardingState;
}): Promise<FlowProgress | null> {
  const res = await fetch("/api/onboarding/progress", {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`advance failed: ${res.status}`);
  const data = (await res.json()) as { progress?: { completedStates?: OnboardingState[] } | null };
  return data.progress ? { completedStates: data.progress.completedStates ?? [] } : null;
}

/** The FlowEngineApi backed by the real endpoints. */
export const onboardingApi = { getProgress: getOnboardingProgress, advance: advanceOnboarding };

/**
 * Fetch the post-auth journey for the signed-in user. The invite token (if any)
 * is NOT sent here — it lives in a server-side handoff consumed at accept time
 * (revC RC3); the server reads it from the handoff cookie when resolving the
 * invited journey.
 */
export async function fetchJourney(): Promise<PostAuthJourneyResult> {
  const res = await fetch("/api/onboarding/journey", { credentials: "include" });
  if (!res.ok) throw new Error(`journey fetch failed: ${res.status}`);
  return (await res.json()) as PostAuthJourneyResult;
}

/** Map a journey to the route the user should land on after login. */
export function destinationForJourney(j: PostAuthJourneyResult): string {
  if (j.journey === "returning") return "/";
  if (j.journey === "invited") return `/onboarding/join?company=${j.targetCompanyId ?? ""}`;
  return "/onboarding";
}
