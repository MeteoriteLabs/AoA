import type { PostAuthJourneyResult } from "@armyofagents/shared";

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
