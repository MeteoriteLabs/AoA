import { describe, it, expect } from "vitest";
import { getJourneyForUser } from "../routes/onboarding-journey.js";

// Sequence mock: each awaited query resolves the next canned result set.
function seqDb(results: unknown[][]) {
  let i = 0;
  const builder = (): any =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve(results[i++] ?? []);
          }
          return () => builder();
        },
      },
    );
  return { select: () => builder() } as any;
}

describe("getJourneyForUser (A5 + RB7/RB9 wiring)", () => {
  it("returning when memberships exist (invitations still surfaced)", async () => {
    const db = seqDb([
      [{ email: "u@x.com", emailVerified: true }],
      [{ companyId: "c1" }],
      [
        {
          inviteId: "i2",
          companyId: "c2",
          companyName: "Beta",
          createdAt: new Date("2026-07-12T00:00:00Z"),
          defaults: { teamInvite: { role: "team_lead" } },
        },
      ],
    ]);
    const r = await getJourneyForUser(db, { userId: "u1" });
    expect(r.journey).toBe("returning");
    expect(r.targetCompanyId).toBe("c1");
    expect(r.pendingInvitations).toEqual([
      {
        companyId: "c2",
        companyName: "Beta",
        inviteId: "i2",
        role: "team_lead",
        createdAt: "2026-07-12T00:00:00.000Z",
      },
    ]);
  });

  it("invited when a pending human request exists and no membership", async () => {
    const db = seqDb([
      [{ email: "u@x.com", emailVerified: true }],
      [],
      [
        {
          inviteId: "i2",
          companyId: "c2",
          companyName: "Beta",
          createdAt: new Date("2026-07-12T00:00:00Z"),
          defaults: null,
        },
      ],
    ]);
    const r = await getJourneyForUser(db, { userId: "u1" });
    expect(r.journey).toBe("invited");
    expect(r.targetCompanyId).toBe("c2");
    expect(r.pendingInvitations[0].role).toBe("team_member"); // default when defaults absent
  });

  it("founder when no membership and no pending request", async () => {
    const db = seqDb([[{ email: "u@x.com", emailVerified: true }], [], []]);
    const r = await getJourneyForUser(db, { userId: "u1" });
    expect(r).toEqual({
      journey: "founder",
      targetCompanyId: null,
      pendingInvitations: [],
      inviteToken: null,
    });
  });
});
