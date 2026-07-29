import { describe, it, expect } from "vitest";
import {
  ONBOARDING_STATES,
  ONBOARDING_JOURNEYS,
  FOUNDER_PHASE1_STATES,
  INVITED_PHASE1_STATES,
  orderedStatesFor,
  parsePostAuthJourneyResult,
} from "../onboarding.js";

describe("onboarding states (Stage B / B2)", () => {
  it("includes JOIN_REQUESTED and the terminal state", () => {
    expect(ONBOARDING_STATES).toContain("JOIN_REQUESTED");
    expect(ONBOARDING_STATES).toContain("SETUP_COMPLETE");
  });

  it("journeys are founder + invited", () => {
    expect([...ONBOARDING_JOURNEYS]).toEqual(["founder", "invited"]);
  });

  it("founder sequence excludes JOIN_REQUESTED; invited is the short approval path", () => {
    expect(FOUNDER_PHASE1_STATES).not.toContain("JOIN_REQUESTED");
    expect(FOUNDER_PHASE1_STATES[0]).toBe("AUTHENTICATED");
    expect(FOUNDER_PHASE1_STATES.at(-1)).toBe("SETUP_COMPLETE");
    expect(INVITED_PHASE1_STATES).toEqual([
      "AUTHENTICATED",
      "PROFILE_SET",
      "JOIN_REQUESTED",
      "SETUP_COMPLETE",
    ]);
  });

  it("WS0c: founder sequence no longer gates on DEPARTMENT_CREATED/AGENT_ASSIGNED, but the values stay valid for stored rows", () => {
    expect(FOUNDER_PHASE1_STATES).not.toContain("DEPARTMENT_CREATED");
    expect(FOUNDER_PHASE1_STATES).not.toContain("AGENT_ASSIGNED");
    expect(FOUNDER_PHASE1_STATES).toEqual([
      "AUTHENTICATED",
      "PROFILE_SET",
      "ORGANIZATION_CREATED",
      "ENVIRONMENT_READY",
      "COMMANDER_SELECTED",
      "COMMANDER_VERIFIED",
      "SETUP_COMPLETE",
    ]);
    expect(ONBOARDING_STATES).toContain("DEPARTMENT_CREATED");
    expect(ONBOARDING_STATES).toContain("AGENT_ASSIGNED");
  });

  it("orderedStatesFor picks the right sequence per journey", () => {
    expect(orderedStatesFor("founder")).toBe(FOUNDER_PHASE1_STATES);
    expect(orderedStatesFor("invited")).toBe(INVITED_PHASE1_STATES);
  });
});

describe("post-auth journey contract", () => {
  it("parses access-required without admitting company creation", () => {
    expect(
      parsePostAuthJourneyResult({
        schemaVersion: 1,
        journey: "access_required",
        targetCompanyId: null,
        pendingInvitations: [],
        inviteToken: null,
        canCreateCompany: false,
        resumeFirstRunCompanyId: null,
      })
    ).toMatchObject({ journey: "access_required", canCreateCompany: false });
  });

  it("fails closed for the previous founder response without verified authority", () => {
    expect(
      parsePostAuthJourneyResult({
        journey: "founder",
        targetCompanyId: null,
        pendingInvitations: [],
        inviteToken: null,
      })
    ).toMatchObject({
      schemaVersion: 1,
      journey: "access_required",
      canCreateCompany: false,
    });
  });

  it("upgrades the previous founder response after independent admin verification", () => {
    expect(
      parsePostAuthJourneyResult(
        {
          journey: "founder",
          targetCompanyId: null,
          pendingInvitations: [],
          inviteToken: null,
        },
        { legacyActorIsInstanceAdmin: true }
      )
    ).toMatchObject({
      schemaVersion: 1,
      journey: "founder",
      canCreateCompany: true,
    });
  });

  it("restores company creation for a previous returning response after admin verification", () => {
    expect(
      parsePostAuthJourneyResult(
        {
          journey: "returning",
          targetCompanyId: "company-1",
          pendingInvitations: [],
          inviteToken: null,
        },
        { legacyActorIsInstanceAdmin: true }
      )
    ).toMatchObject({
      schemaVersion: 1,
      journey: "returning",
      canCreateCompany: true,
    });
  });

  it("keeps company creation disabled for an unverified previous returning response", () => {
    expect(
      parsePostAuthJourneyResult({
        journey: "returning",
        targetCompanyId: "company-1",
        pendingInvitations: [],
        inviteToken: null,
      })
    ).toMatchObject({
      schemaVersion: 1,
      journey: "returning",
      canCreateCompany: false,
    });
  });

  it("does not reinterpret an invalid versioned response as legacy", () => {
    expect(() =>
      parsePostAuthJourneyResult({
        schemaVersion: 1,
        journey: "founder",
        targetCompanyId: null,
        pendingInvitations: [],
        inviteToken: null,
        canCreateCompany: false,
        resumeFirstRunCompanyId: null,
      })
    ).toThrow();
  });

  it("rejects impossible access-required targets", () => {
    expect(() =>
      parsePostAuthJourneyResult({
        schemaVersion: 1,
        journey: "access_required",
        targetCompanyId: "company-1",
        pendingInvitations: [],
        inviteToken: null,
        canCreateCompany: false,
        resumeFirstRunCompanyId: null,
      })
    ).toThrow();
  });
});
