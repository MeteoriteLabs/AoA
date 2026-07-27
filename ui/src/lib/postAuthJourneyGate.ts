import type { PostAuthJourneyResult } from "@armyofagents/shared";

/**
 * Returns the canonical redirect for a protected route, or null when the
 * current route is valid for the resolved post-auth journey.
 */
export function postAuthJourneyRedirect(
  journey: PostAuthJourneyResult,
  pathname: string,
  search = ""
): string | null {
  if (journey.journey === "founder") {
    return pathname === "/onboarding" ? null : "/onboarding";
  }

  if (journey.journey === "invited") {
    const target = `/onboarding/join?company=${encodeURIComponent(
      journey.targetCompanyId
    )}`;
    const currentCompany = new URLSearchParams(search).get("company");
    return pathname === "/onboarding/join" &&
      currentCompany === journey.targetCompanyId
      ? null
      : target;
  }

  if (journey.journey === "access_required") {
    return pathname === "/access-required" ? null : "/access-required";
  }

  if (journey.resumeFirstRunCompanyId) {
    return pathname === "/onboarding" ? null : "/onboarding";
  }

  const isAuthorizedNewCompanyFlow =
    pathname === "/onboarding" &&
    journey.canCreateCompany &&
    new URLSearchParams(search).get("new") === "1";
  if (isAuthorizedNewCompanyFlow) return null;

  if (pathname.startsWith("/onboarding") || pathname === "/access-required") {
    return "/";
  }
  return null;
}
