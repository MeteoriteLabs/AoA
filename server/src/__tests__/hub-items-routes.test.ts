import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { HttpError } from "../errors.js";
import { hubItemRoutes } from "../routes/hub-items.js";

// Service + permission mocks (mirror routes-finance.test.ts / routes-inbox-dismissals.test.ts).
const mockSvc = vi.hoisted(() => ({
  query: vi.fn(),
  counts: vi.fn(),
  recordAndAct: vi.fn(),
}));

const mockPerms = vi.hoisted(() => ({
  getEffectiveRole: vi.fn(),
  isFounder: vi.fn(),
  getTeamLeadDepartments: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockEmitOpenApprovalHubItems = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockEmitStaleWorkHubItems = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock("../services/index.js", () => ({
  hubItemsService: () => mockSvc,
  permissionService: () => mockPerms,
  logActivity: mockLogActivity,
}));

vi.mock("../services/hub-approval-requests.js", () => ({
  emitOpenApprovalHubItems: mockEmitOpenApprovalHubItems,
}));

vi.mock("../services/hub-stale-work.js", () => ({
  emitStaleWorkHubItems: mockEmitStaleWorkHubItems,
}));

const COMPANY_A = "11111111-1111-1111-1111-111111111111";
const COMPANY_B = "55555555-5555-5555-5555-555555555555";
const ITEM_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// A minimal `db` stub: the route only touches `db` directly in the PATCH
// (insert→onConflictDoUpdate→returning) path. Everything else goes via the
// mocked service. We build a chainable stub whose `returning()` resolves to the
// upserted row, and record the values passed to `insert(...).values(...)`.
function makeDbStub() {
  const calls: { values?: unknown; onConflict?: unknown } = {};
  const chain = {
    values(v: unknown) {
      calls.values = v;
      return chain;
    },
    onConflictDoUpdate(c: unknown) {
      calls.onConflict = c;
      return chain;
    },
    returning() {
      return Promise.resolve([
        { id: "state-1", hubItemId: ITEM_ID, principalId: "user-1", ...(calls.values as object) },
      ]);
    },
  };
  const db = { insert: vi.fn(() => chain) };
  return { db, calls };
}

function createApp(actor: unknown, db: unknown = makeDbStub().db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { actor: unknown }).actor = actor;
    next();
  });
  app.use("/api", hubItemRoutes(db as never));
  app.use(errorHandler);
  return app;
}

function boardActor(
  overrides: Partial<{
    userId: string;
    companyIds: string[];
    isInstanceAdmin: boolean;
    source: string;
  }> = {},
) {
  return {
    type: "board" as const,
    userId: overrides.userId ?? "user-1",
    source: overrides.source ?? "session",
    companyIds: overrides.companyIds ?? [COMPANY_A],
    isInstanceAdmin: overrides.isInstanceAdmin ?? false,
  };
}

describe("hub-items routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("(a) GET list asserts company access and returns the RBAC-scoped service result", async () => {
    mockPerms.getEffectiveRole.mockResolvedValue("team_member");
    mockSvc.query.mockResolvedValue([{ id: ITEM_ID, title: "owned", lane: "waiting_on_you" }]);
    const app = createApp(boardActor());

    const res = await request(app).get(`/api/companies/${COMPANY_A}/hub-items`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("owned");
    expect(mockEmitOpenApprovalHubItems).toHaveBeenCalledWith(expect.anything(), COMPANY_A, expect.any(Number));
    expect(mockEmitStaleWorkHubItems).toHaveBeenCalledWith(expect.anything(), COMPANY_A, expect.any(Number));
    // RBAC scope (resolved role) is threaded into the service.
    expect(mockSvc.query).toHaveBeenCalledWith(
      COMPANY_A,
      expect.objectContaining({ actorUserId: "user-1", role: "team_member" }),
    );
  });

  it("GET list rejects unauthenticated actors with 401", async () => {
    const app = createApp({ type: "none", source: "none" });
    const res = await request(app).get(`/api/companies/${COMPANY_A}/hub-items`);
    expect(res.status).toBe(401);
    expect(mockSvc.query).not.toHaveBeenCalled();
  });

  it("GET list forbids a company the user does not belong to (403)", async () => {
    const app = createApp(boardActor({ companyIds: [COMPANY_B] }));
    const res = await request(app).get(`/api/companies/${COMPANY_A}/hub-items`);
    expect(res.status).toBe(403);
    expect(mockSvc.query).not.toHaveBeenCalled();
  });

  it("(b) POST action with a stale expectedVersion → 409", async () => {
    mockPerms.isFounder.mockResolvedValue(true);
    mockSvc.recordAndAct.mockRejectedValue(
      new HttpError(409, "This item was changed by someone else. Reload and retry.", {
        currentVersion: 3,
      }),
    );
    const app = createApp(boardActor());

    const res = await request(app)
      .post(`/api/companies/${COMPANY_A}/hub-items/${ITEM_ID}/action`)
      .send({ action: "approve", expectedVersion: 1, nextStatus: "resolved" });

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.details).toEqual({ currentVersion: 3 });
  });

  it("(c) POST action on a founder-authority item by a non-founder → 403", async () => {
    // The route computes actorIsFounder=false (non-founder, non-implicit); the
    // service's Authority gate rejects with forbidden → 403.
    mockPerms.isFounder.mockResolvedValue(false);
    mockSvc.recordAndAct.mockRejectedValue(
      new HttpError(403, "This decision requires founder/board authority — route or escalate it."),
    );
    const app = createApp(boardActor());

    const res = await request(app)
      .post(`/api/companies/${COMPANY_A}/hub-items/${ITEM_ID}/action`)
      .send({ action: "approve", expectedVersion: 0, nextStatus: "resolved" });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    // The route resolved actorIsFounder=false and handed it to the service.
    expect(mockSvc.recordAndAct).toHaveBeenCalledWith(
      expect.objectContaining({ actorIsFounder: false, actorId: "user-1" }),
    );
  });

  it("POST action succeeds for a founder and logs activity", async () => {
    mockPerms.isFounder.mockResolvedValue(true);
    mockSvc.recordAndAct.mockResolvedValue({ id: ITEM_ID, status: "resolved", version: 2 });
    const app = createApp(boardActor());

    const res = await request(app)
      .post(`/api/companies/${COMPANY_A}/hub-items/${ITEM_ID}/action`)
      .send({ action: "approve", expectedVersion: 1, nextStatus: "resolved" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("resolved");
    expect(mockSvc.recordAndAct).toHaveBeenCalledWith(
      expect.objectContaining({ actorIsFounder: true, nextStatus: "resolved" }),
    );
    expect(mockLogActivity).toHaveBeenCalledOnce();
  });

  it("POST action rejects an invalid nextStatus with 400", async () => {
    const app = createApp(boardActor());
    const res = await request(app)
      .post(`/api/companies/${COMPANY_A}/hub-items/${ITEM_ID}/action`)
      .send({ action: "approve", expectedVersion: 1, nextStatus: "bogus" });
    expect(res.status).toBe(400);
    expect(mockSvc.recordAndAct).not.toHaveBeenCalled();
  });

  it("(d) PATCH state upserts the per-user state row (read)", async () => {
    const { db, calls } = makeDbStub();
    const app = createApp(boardActor(), db);

    const res = await request(app)
      .patch(`/api/companies/${COMPANY_A}/hub-items/${ITEM_ID}/state`)
      .send({ kind: "read" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(db.insert).toHaveBeenCalledOnce();
    // The upsert carries the principal + a readAt timestamp.
    expect(calls.values).toMatchObject({
      companyId: COMPANY_A,
      hubItemId: ITEM_ID,
      principalType: "user",
      principalId: "user-1",
    });
    expect((calls.values as { readAt?: Date }).readAt).toBeInstanceOf(Date);
    expect(calls.onConflict).toBeDefined();
  });

  it("PATCH state snooze records snoozedUntil from the until datetime", async () => {
    const { db, calls } = makeDbStub();
    const app = createApp(boardActor(), db);

    const until = "2026-07-01T00:00:00.000Z";
    const res = await request(app)
      .patch(`/api/companies/${COMPANY_A}/hub-items/${ITEM_ID}/state`)
      .send({ kind: "snooze", until });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((calls.values as { snoozedUntil?: Date }).snoozedUntil).toEqual(new Date(until));
  });

  it("PATCH state rejects an unknown kind with 400", async () => {
    const app = createApp(boardActor());
    const res = await request(app)
      .patch(`/api/companies/${COMPANY_A}/hub-items/${ITEM_ID}/state`)
      .send({ kind: "bogus" });
    expect(res.status).toBe(400);
  });

  it("(e) GET counts returns { open, unread }", async () => {
    mockPerms.getEffectiveRole.mockResolvedValue("founder");
    mockSvc.counts.mockResolvedValue({ open: 5, unread: 3 });
    const app = createApp(boardActor());

    const res = await request(app).get(`/api/companies/${COMPANY_A}/hub-items/counts`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ open: 5, unread: 3 });
    expect(mockSvc.counts).toHaveBeenCalledWith(COMPANY_A, "user-1", "founder");
  });
});
