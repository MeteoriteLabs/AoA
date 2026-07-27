import { describe, expect, it } from "vitest";
import type { PostAuthJourneyResult } from "@armyofagents/shared";
import { postAuthJourneyRedirect } from "../postAuthJourneyGate";

function journey(
  variant: PostAuthJourneyResult["journey"],
  overrides: Partial<PostAuthJourneyResult> = {}
): PostAuthJourneyResult {
  const common = {
    schemaVersion: 1 as const,
    pendingInvitations: [],
    inviteToken: null,
    resumeFirstRunCompanyId: null,
  };
  if (variant === "founder") {
    return {
      ...common,
      journey: variant,
      targetCompanyId: null,
      canCreateCompany: true,
      ...overrides,
    } as PostAuthJourneyResult;
  }
  if (variant === "invited") {
    return {
      ...common,
      journey: variant,
      targetCompanyId: "company-2",
      canCreateCompany: false,
      ...overrides,
    } as PostAuthJourneyResult;
  }
  if (variant === "access_required") {
    return {
      ...common,
      journey: variant,
      targetCompanyId: null,
      canCreateCompany: false,
      ...overrides,
    } as PostAuthJourneyResult;
  }
  return {
    ...common,
    journey: variant,
    targetCompanyId: "company-1",
    canCreateCompany: false,
    ...overrides,
  } as PostAuthJourneyResult;
}

describe("postAuthJourneyRedirect", () => {
  it.each([
    ["founder", "/", "", "/onboarding"],
    ["founder", "/onboarding", "", null],
    ["invited", "/", "", "/onboarding/join?company=company-2"],
    [
      "invited",
      "/onboarding/join",
      "?company=wrong",
      "/onboarding/join?company=company-2",
    ],
    ["invited", "/onboarding/join", "?company=company-2", null],
    ["access_required", "/ACME/home", "", "/access-required"],
    ["access_required", "/access-required", "", null],
  ] as const)("%s gates %s%s", (variant, pathname, search, expected) => {
    expect(postAuthJourneyRedirect(journey(variant), pathname, search)).toBe(
      expected
    );
  });

  it("routes an unfinished returning founder back to onboarding", () => {
    expect(
      postAuthJourneyRedirect(
        journey("returning", { resumeFirstRunCompanyId: "company-1" }),
        "/ACME/home"
      )
    ).toBe("/onboarding");
  });

  it("allows only admins to use returning-user new-company onboarding", () => {
    expect(
      postAuthJourneyRedirect(journey("returning"), "/onboarding", "?new=1")
    ).toBe("/");
    expect(
      postAuthJourneyRedirect(
        journey("returning", { canCreateCompany: true }),
        "/onboarding",
        "?new=1"
      )
    ).toBeNull();
  });

  it("allows normal returning routes and exits stale onboarding routes", () => {
    expect(
      postAuthJourneyRedirect(journey("returning"), "/ACME/home")
    ).toBeNull();
    expect(
      postAuthJourneyRedirect(journey("returning"), "/onboarding/join")
    ).toBe("/");
    expect(
      postAuthJourneyRedirect(journey("returning"), "/access-required")
    ).toBe("/");
  });
});
