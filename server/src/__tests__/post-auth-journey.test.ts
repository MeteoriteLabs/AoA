import { describe, it, expect } from "vitest";
import { resolvePostAuthJourney } from "../services/post-auth-journey.js";
import type { PendingInvitation } from "@armyofagents/shared";

const inv = (
  companyId: string,
  over: Partial<PendingInvitation> = {}
): PendingInvitation => ({
  companyId,
  companyName: `Co ${companyId}`,
  inviteId: `i-${companyId}`,
  role: "team_member",
  createdAt: "2026-07-12T00:00:00Z",
  filed: true,
  ...over,
});

describe("resolvePostAuthJourney (RB7/RB9)", () => {
  it("returning when the user has a membership", () => {
    const r = resolvePostAuthJourney({
      memberships: ["c1"],
      pendingInvitations: [],
      canCreateCompany: false,
    });
    expect(r).toMatchObject({
      journey: "returning",
      targetCompanyId: "c1",
      pendingInvitations: [],
    });
  });

  it("returning surfaces pending invitations (not auto-routed)", () => {
    const r = resolvePostAuthJourney({
      memberships: ["c1"],
      pendingInvitations: [inv("c2")],
      canCreateCompany: false,
    });
    expect(r.journey).toBe("returning");
    expect(r.targetCompanyId).toBe("c1");
    expect(r.pendingInvitations.map((i) => i.companyId)).toEqual(["c2"]);
  });

  it("invited when no membership but an open invitation", () => {
    const r = resolvePostAuthJourney({
      memberships: [],
      pendingInvitations: [inv("c2")],
      canCreateCompany: false,
    });
    expect(r).toMatchObject({ journey: "invited", targetCompanyId: "c2" });
  });

  it("invited prefers the deep-linked company when it matches an invitation", () => {
    const r = resolvePostAuthJourney({
      memberships: [],
      pendingInvitations: [inv("c2"), inv("c3")],
      deepLinkCompanyId: "c3",
      canCreateCompany: false,
    });
    expect(r.targetCompanyId).toBe("c3");
  });

  it("invited falls back to the first invitation when deep-link is absent/unmatched", () => {
    const r = resolvePostAuthJourney({
      memberships: [],
      pendingInvitations: [inv("c2"), inv("c3")],
      deepLinkCompanyId: "cX",
      canCreateCompany: false,
    });
    expect(r.targetCompanyId).toBe("c2");
  });

  it("founder when an instance admin has no membership or invitation", () => {
    const r = resolvePostAuthJourney({
      memberships: [],
      pendingInvitations: [],
      canCreateCompany: true,
    });
    expect(r).toEqual({
      schemaVersion: 1,
      journey: "founder",
      targetCompanyId: null,
      pendingInvitations: [],
      inviteToken: null,
      canCreateCompany: true,
      resumeFirstRunCompanyId: null,
    });
  });

  it("requires access when a non-admin has no membership or invitation", () => {
    expect(
      resolvePostAuthJourney({
        memberships: [],
        pendingInvitations: [],
        canCreateCompany: false,
      })
    ).toMatchObject({
      journey: "access_required",
      targetCompanyId: null,
      canCreateCompany: false,
    });
  });

  it("never returns a token (RC3 — token lives in the server-side handoff)", () => {
    const r = resolvePostAuthJourney({
      memberships: [],
      pendingInvitations: [inv("c2")],
      canCreateCompany: false,
    });
    expect(r.inviteToken ?? null).toBeNull();
  });
});
