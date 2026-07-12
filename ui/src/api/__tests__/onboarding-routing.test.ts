import { describe, it, expect } from "vitest";
import { destinationForJourney } from "../onboarding";
import type { PostAuthJourneyResult } from "@armyofagents/shared";

const base = (over: Partial<PostAuthJourneyResult>): PostAuthJourneyResult => ({
  journey: "founder",
  targetCompanyId: null,
  pendingInvitations: [],
  inviteToken: null,
  ...over,
});

describe("destinationForJourney (Stage A / A9)", () => {
  it("returning → lobby", () => {
    expect(destinationForJourney(base({ journey: "returning", targetCompanyId: "c1" }))).toBe("/");
  });

  it("founder → onboarding", () => {
    expect(destinationForJourney(base({ journey: "founder" }))).toBe("/onboarding");
  });

  it("invited → join flow with the target company", () => {
    expect(destinationForJourney(base({ journey: "invited", targetCompanyId: "c2" }))).toBe(
      "/onboarding/join?company=c2",
    );
  });
});
