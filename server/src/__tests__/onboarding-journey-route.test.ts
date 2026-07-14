import express from "express";
import request from "supertest";
import { describe, it, expect } from "vitest";
import {
  getJourneyForUser,
  onboardingJourneyRoutes,
} from "../routes/onboarding-journey.js";

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

  it("returns an instance admin to an existing company without creating a membership", async () => {
    const db = seqDb([
      [{ email: "admin@x.com", emailVerified: true }],
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
      [{ companyId: "c1" }],
    ]);

    const r = await getJourneyForUser(db, {
      userId: "admin-1",
      isInstanceAdmin: true,
    });

    expect(r.journey).toBe("returning");
    expect(r.targetCompanyId).toBe("c1");
    expect(r.pendingInvitations.map((invite) => invite.companyId)).toEqual(["c2"]);
  });

  it("prefers an instance admin's active membership over the global fallback", async () => {
    const db = seqDb([
      [{ email: "admin@x.com", emailVerified: true }],
      [{ companyId: "member-company" }],
      [],
    ]);

    const r = await getJourneyForUser(db, {
      userId: "admin-1",
      isInstanceAdmin: true,
    });

    expect(r.journey).toBe("returning");
    expect(r.targetCompanyId).toBe("member-company");
  });

  it("keeps an instance admin on the founder journey when the instance is empty", async () => {
    const db = seqDb([[{ email: "admin@x.com", emailVerified: true }], [], [], []]);

    const r = await getJourneyForUser(db, {
      userId: "admin-1",
      isInstanceAdmin: true,
    });

    expect(r).toEqual({
      journey: "founder",
      targetCompanyId: null,
      pendingInvitations: [],
      inviteToken: null,
    });
  });
});

describe("GET /api/onboarding/journey", () => {
  function makeApp(db: any, actor: Record<string, unknown>) {
    const app = express();
    app.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    app.use("/api", onboardingJourneyRoutes(db));
    return app;
  }

  it("uses the authenticated actor's instance-admin visibility", async () => {
    const db = seqDb([
      [{ email: "admin@x.com", emailVerified: true }],
      [],
      [],
      [{ companyId: "c1" }],
    ]);
    const app = makeApp(db, {
      type: "board",
      userId: "admin-1",
      source: "session",
      isInstanceAdmin: true,
      companyIds: [],
    });

    const res = await request(app).get("/api/onboarding/journey");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      journey: "returning",
      targetCompanyId: "c1",
    });
  });

  it("does not expose an existing company to a non-admin without membership", async () => {
    const db = seqDb([
      [{ email: "member@x.com", emailVerified: true }],
      [],
      [],
      [{ companyId: "c1" }],
    ]);
    const app = makeApp(db, {
      type: "board",
      userId: "member-1",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [],
    });

    const res = await request(app).get("/api/onboarding/journey");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      journey: "founder",
      targetCompanyId: null,
    });
  });

  it("rejects callers without a board identity before querying", async () => {
    const db = { select: () => { throw new Error("database should not be queried"); } };
    const app = makeApp(db, { type: "none", source: "none" });

    const res = await request(app).get("/api/onboarding/journey");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "authentication required" });
  });
});
