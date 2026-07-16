import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@armyofagents/db", () => ({
  joinRequests: new Proxy({}, { get: (_t, p) => ({ name: String(p) }) }),
  invites: new Proxy({}, { get: (_t, p) => ({ name: String(p) }) }),
  authUsers: new Proxy({}, { get: (_t, p) => ({ name: String(p) }) }),
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a, desc: (a: unknown) => a,
}));
const approveTx = vi.hoisted(() =>
  vi.fn(async (): Promise<{ id: string; status: string } | null> => ({ id: "r1", status: "approved" })),
);
vi.mock("../services/join-approval.js", () => ({
  approveHumanJoinRequestTx: approveTx,
  buildHumanJoinApprovalServices: () => ({}),
  autoAdmitApprovalIdentity: () => ({
    approvedByUserId: null,
    attributionUserId: null,
    activityActor: { actorType: "system", actorId: "invite_email_match" },
    approvalSource: "invite_email_match",
  }),
}));
vi.mock("../services/team.js", () => ({
  parseInviteRoleMetadata: (p: Record<string, unknown> | null) =>
    p && (p as { teamInvite?: { email?: string } }).teamInvite?.email
      ? { email: (p as { teamInvite: { email: string } }).teamInvite.email, role: "team_member", projectId: null, parentId: null }
      : null,
}));

import { onboardingJoinRoutes } from "../routes/onboarding-join.js";

type Row = Record<string, unknown>;
/**
 * Sequence db: each select() returns the next configured result set. Captures
 * each select's where() condition (in select order) so tests can regression-lock
 * the WHERE bindings — with the mocked `eq`/`and` returning their args, a
 * condition is a nested array of `[{name: column}, value]` pairs.
 */
function createSequenceDb(selects: Row[][]) {
  let i = 0;
  const whereCalls: unknown[] = [];
  const chain = () => {
    const result = selects[i++] ?? [];
    const q = {
      from: () => q,
      where: (cond: unknown) => { whereCalls.push(cond); return q; },
      orderBy: () => q, limit: () => q,
      then: (resolve: (rows: Row[]) => unknown) => resolve(result),
    };
    return q;
  };
  const db = {
    select: chain,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  } as never;
  return { db, whereCalls };
}

function handler(db: never) {
  const router = onboardingJoinRoutes(db);
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: unknown }> } }> }).stack
    .find((l) => l.route?.path === "/onboarding/join/finalize");
  if (!layer?.route) throw new Error("route not found");
  return layer.route.stack[0]!.handle as (req: unknown, res: unknown) => Promise<void>;
}

function call(db: never, body: Record<string, unknown>, actor: Record<string, unknown> = { type: "board", userId: "u1" }) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return handler(db)({ actor, body }, { json, status }).then(() => ({ json, status }));
}

const pendingRequest = { id: "r1", inviteId: "i1", status: "pending_approval" };
const validInvite = { id: "i1", revokedAt: null, expiresAt: null, defaultsPayload: { teamInvite: { email: "ada@x.com", role: "team_member" } } };

describe("POST /onboarding/join/finalize", () => {
  beforeEach(() => vi.clearAllMocks());

  it("admits on a verified case-insensitive email match", async () => {
    const { db, whereCalls } = createSequenceDb([
      [pendingRequest],
      [validInvite],
      [{ email: "ADA@X.COM", emailVerified: true }],
    ]);
    const { json } = await call(db, { companyId: "c1" });
    expect(approveTx).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      approvedByUserId: null,
      approvalSource: "invite_email_match",
    }));
    expect(json).toHaveBeenCalledWith({ admitted: true, status: "approved" });
    // Regression-lock the self-scoping WHERE: the request lookup must bind
    // requestingUserId to the acting user ("u1") — never finalize someone
    // else's request.
    const requestLookup = JSON.stringify(whereCalls[0]);
    expect(requestLookup).toContain('"requestingUserId"');
    expect(requestLookup).toContain('"u1"');
  });

  it("does NOT admit when the email is unverified", async () => {
    const { db } = createSequenceDb([
      [pendingRequest],
      [validInvite],
      [{ email: "ada@x.com", emailVerified: false }],
    ]);
    const { json } = await call(db, { companyId: "c1" });
    expect(approveTx).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ admitted: false, status: "pending" });
  });

  it("does NOT admit on an email mismatch", async () => {
    const { db } = createSequenceDb([
      [pendingRequest],
      [validInvite],
      [{ email: "mallory@evil.com", emailVerified: true }],
    ]);
    const { json } = await call(db, { companyId: "c1" });
    expect(approveTx).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ admitted: false, status: "pending" });
  });

  it("refuses a revoked invite", async () => {
    const { db } = createSequenceDb([
      [pendingRequest],
      [{ ...validInvite, revokedAt: new Date() }],
    ]);
    const { json } = await call(db, { companyId: "c1" });
    expect(json).toHaveBeenCalledWith({ admitted: false, status: "invite_invalid" });
  });

  it("admits even when expiresAt has passed — validity was established at accept (10-min TTL)", async () => {
    const { db } = createSequenceDb([
      [pendingRequest],
      [{ ...validInvite, expiresAt: new Date(Date.now() - 60_000) }],
      [{ email: "ada@x.com", emailVerified: true }],
    ]);
    const { json } = await call(db, { companyId: "c1" });
    expect(json).toHaveBeenCalledWith({ admitted: true, status: "approved" });
  });

  it("is idempotent — an already-approved request reports admitted", async () => {
    const { db } = createSequenceDb([[{ ...pendingRequest, status: "approved" }]]);
    const { json } = await call(db, { companyId: "c1" });
    expect(json).toHaveBeenCalledWith({ admitted: true, status: "approved" });
    expect(approveTx).not.toHaveBeenCalled();
  });

  it("reports a rejected request", async () => {
    const { db } = createSequenceDb([[{ ...pendingRequest, status: "rejected" }]]);
    const { json } = await call(db, { companyId: "c1" });
    expect(json).toHaveBeenCalledWith({ admitted: false, status: "rejected" });
  });

  it("401s without a board session", async () => {
    const { db } = createSequenceDb([]);
    const { status } = await call(db, { companyId: "c1" }, { type: "none" });
    expect(status).toHaveBeenCalledWith(401);
  });

  it("404s when the caller has no join request for the company", async () => {
    const { db } = createSequenceDb([[]]);
    const { status } = await call(db, { companyId: "c1" });
    expect(status).toHaveBeenCalledWith(404);
  });

  it("400s when companyId is missing", async () => {
    const { db } = createSequenceDb([]);
    const { status } = await call(db, {});
    expect(status).toHaveBeenCalledWith(400);
  });

  it("reports pending when the approval races to null", async () => {
    // approveHumanJoinRequestTx resolves null when the request was concurrently
    // consumed — the endpoint must report the honest non-admitted state.
    approveTx.mockResolvedValueOnce(null);
    const { db } = createSequenceDb([
      [pendingRequest],
      [validInvite],
      [{ email: "ada@x.com", emailVerified: true }],
    ]);
    const { json } = await call(db, { companyId: "c1" });
    expect(json).toHaveBeenCalledWith({ admitted: false, status: "pending" });
  });
});
