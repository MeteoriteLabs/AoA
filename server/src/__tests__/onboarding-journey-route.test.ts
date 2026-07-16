import express from "express";
import request from "supertest";
import { describe, it, expect } from "vitest";
import {
  getJourneyForUser,
  onboardingJourneyRoutes,
} from "../routes/onboarding-journey.js";

// Sequence mock: each awaited query resolves the next canned result set.
// `_whereCalls` captures each where() condition (REAL drizzle-orm SQL objects —
// this file does not mock drizzle) so tests can regression-lock query gates.
function seqDb(results: unknown[][]) {
  let i = 0;
  const whereCalls: unknown[] = [];
  const builder = (): any =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve(results[i++] ?? []);
          }
          if (prop === "where") {
            return (cond: unknown) => {
              whereCalls.push(cond);
              return builder();
            };
          }
          return () => builder();
        },
      },
    );
  return { select: () => builder(), _whereCalls: whereCalls } as any;
}

/**
 * Recursively collect the DB column names bound in a real drizzle-orm SQL
 * condition (Columns carry `name` + `table`; SQL nodes carry `queryChunks`).
 */
function conditionColumns(cond: unknown): string[] {
  const out: string[] = [];
  const walk = (c: unknown) => {
    if (!c || typeof c !== "object") return;
    const rec = c as Record<string, unknown>;
    if (typeof rec.name === "string" && rec.table) out.push(rec.name);
    if (Array.isArray(rec.queryChunks)) rec.queryChunks.forEach(walk);
  };
  walk(cond);
  return out;
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
      [], // open invites (tokenless detection)
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

describe("getJourneyForUser — open-invite detection (tokenless invited entry)", () => {
  it("surfaces an OPEN verified-email invite as an invitation → journey invited", async () => {
    const db = seqDb([
      [{ email: "u@x.com", emailVerified: true }],
      [], // memberships
      [], // filed join_requests
      [
        {
          inviteId: "i9",
          companyId: "c2",
          companyName: "Beta",
          createdAt: new Date("2026-07-12T00:00:00Z"),
          defaults: { teamInvite: { email: "u@x.com", role: "team_lead" } },
        },
      ],
    ]);
    const r = await getJourneyForUser(db, { userId: "u1" });
    expect(r.journey).toBe("invited");
    expect(r.targetCompanyId).toBe("c2");
    // inviteId here is the INVITE id (no join_request exists yet).
    expect(r.pendingInvitations).toEqual([
      {
        companyId: "c2",
        companyName: "Beta",
        inviteId: "i9",
        role: "team_lead",
        createdAt: "2026-07-12T00:00:00.000Z",
      },
    ]);
  });

  it("does NOT run open-invite detection for an unverified email", async () => {
    const db = seqDb([
      [{ email: "u@x.com", emailVerified: false }],
      [], // memberships
      [], // filed join_requests
      // Would-be open invite: MUST NOT be consumed — detection is gated on a
      // verified email. If the query ran, this row would flip the journey.
      [{ inviteId: "i9", companyId: "c2", companyName: "Beta", createdAt: new Date(), defaults: null }],
    ]);
    const r = await getJourneyForUser(db, { userId: "u1" });
    expect(r.journey).toBe("founder");
    expect(r.pendingInvitations).toEqual([]);
  });

  it("gates detection on acceptedAt/revokedAt/expiresAt/inviteType/allowedJoinTypes in SQL", async () => {
    // The sequence db can't evaluate SQL, so expired/revoked/accepted exclusion
    // is regression-locked structurally: the open-invite WHERE must bind every
    // gate column (expiry MUST gate detection — nothing was accepted yet).
    const db = seqDb([
      [{ email: "u@x.com", emailVerified: true }],
      [], // memberships
      [], // filed join_requests
      [], // open invites — an expired/revoked/accepted invite comes back empty
    ]);
    const r = await getJourneyForUser(db, { userId: "u1" });
    expect(r.journey).toBe("founder");
    const openInviteWhere = (db._whereCalls as unknown[]).find((c) =>
      conditionColumns(c).includes("expires_at"),
    );
    expect(openInviteWhere).toBeDefined();
    expect(conditionColumns(openInviteWhere)).toEqual(
      expect.arrayContaining([
        "accepted_at",
        "revoked_at",
        "expires_at",
        "invite_type",
        "allowed_join_types",
        "defaults_payload",
      ]),
    );
  });

  it("dedupes by company — a FILED join_request wins over an open invite", async () => {
    const db = seqDb([
      [{ email: "u@x.com", emailVerified: true }],
      [], // memberships
      [
        {
          inviteId: "jr-invite",
          companyId: "c2",
          companyName: "Beta",
          createdAt: new Date("2026-07-12T00:00:00Z"),
          defaults: null,
        },
      ],
      [
        {
          inviteId: "i9",
          companyId: "c2",
          companyName: "Beta",
          createdAt: new Date("2026-07-11T00:00:00Z"),
          defaults: null,
        },
      ],
    ]);
    const r = await getJourneyForUser(db, { userId: "u1" });
    expect(r.journey).toBe("invited");
    expect(r.pendingInvitations).toHaveLength(1);
    expect(r.pendingInvitations[0].inviteId).toBe("jr-invite");
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
      [], // open invites (tokenless detection)
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
      [], // open invites (tokenless detection)
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
