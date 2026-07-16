import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@armyofagents/db", () => ({
  joinRequests: new Proxy({}, { get: (_t, p) => ({ name: String(p) }) }),
}));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a }));
const reconcile = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../hub-items.js", () => ({ hubItemsService: () => ({ reconcile }) }));
const logActivity = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../activity-log.js", () => ({ logActivity }));
const getUserProfile = vi.hoisted(() =>
  vi.fn(async () => ({
    userId: "u1", displayName: "Ada", avatarUrl: null, title: "Engineer",
    bio: "hi", timezone: "Asia/Kolkata", socialLinks: [],
  })),
);
vi.mock("../user-profiles.js", () => ({ getUserProfile }));
vi.mock("../../middleware/logger.js", () => ({ logger: { warn: vi.fn() } }));
// buildHumanJoinApprovalServices constructs real services — not used in these tests.
vi.mock("../access.js", () => ({ accessService: () => ({}) }));
vi.mock("../team.js", () => ({ teamService: () => ({}) }));
vi.mock("../human-capabilities.js", () => ({ humanCapabilitiesService: () => ({}) }));

import {
  approveHumanJoinRequestTx,
  autoAdmitApprovalIdentity,
  founderApprovalIdentity,
  grantsFromDefaults,
} from "../join-approval.js";

function makeTxDb(updatedRow: Record<string, unknown> | null) {
  const setCalls: Array<Record<string, unknown>> = [];
  const db = {
    update: () => ({ set: (v: Record<string, unknown>) => { setCalls.push(v); return { where: () => ({ returning: async () => (updatedRow ? [updatedRow] : []) }) }; } }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  } as never;
  return { db, setCalls };
}

function makeServices() {
  return {
    access: { ensureMembership: vi.fn(async () => {}), setPrincipalGrants: vi.fn(async () => {}) },
    team: { applyInviteRole: vi.fn(async () => null), updateCompanyUserProfile: vi.fn(async () => ({})) },
    capabilities: { ensureStandardDocuments: vi.fn(async () => {}) },
  };
}

const args = {
  companyId: "c1", requestId: "r1", requestingUserId: "u1",
  invite: {
    id: "i1",
    defaultsPayload: {
      teamInvite: { role: "team_member", email: "ada@x.com" },
      human: { grants: [{ permissionKey: "tasks:assign", scope: null }] },
    } as Record<string, unknown>,
  },
  approvedByUserId: null,
  attributionUserId: null,
  activityActor: { actorType: "system" as const, actorId: "invite_email_match" },
  approvalSource: "invite_email_match" as const,
};

describe("approveHumanJoinRequestTx", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves: row update + membership + grants + role + seeding + hub + activity", async () => {
    const services = makeServices();
    const { db, setCalls } = makeTxDb({ id: "r1", status: "approved" });
    const row = await approveHumanJoinRequestTx(db, services as never, args);
    expect(row).toEqual({ id: "r1", status: "approved" });
    expect(setCalls[0]).toMatchObject({
      status: "approved",
      approvedByUserId: null,
      approvalSource: "invite_email_match",
    });
    expect(services.access.ensureMembership).toHaveBeenCalledWith("c1", "user", "u1", "member", "active");
    expect(services.access.setPrincipalGrants).toHaveBeenCalledWith(
      "c1", "user", "u1",
      [{ permissionKey: "tasks:assign", scope: null }],
      null,
    );
    expect(services.team.applyInviteRole).toHaveBeenCalledWith("c1", "u1", args.invite.defaultsPayload, null);
    // seeding copies the GLOBAL profile (incl timezone) into the company profile
    expect(services.team.updateCompanyUserProfile).toHaveBeenCalledWith(
      "c1", "u1",
      expect.objectContaining({ displayName: "Ada", title: "Engineer", timezone: "Asia/Kolkata" }),
      null,
    );
    expect(services.capabilities.ensureStandardDocuments).toHaveBeenCalledWith("c1", "u1", null);
    expect(reconcile).toHaveBeenCalledWith("c1", { sourceType: "join_request", sourceId: "r1" });
    expect(logActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "join.approved",
      actorType: "system",
      actorId: "invite_email_match",
      details: { requestType: "human", approvalSource: "invite_email_match", inviteId: "i1" },
    }));
  });

  it("returns null (no side effects) when the row is no longer pending (race)", async () => {
    const services = makeServices();
    const { db } = makeTxDb(null);
    const row = await approveHumanJoinRequestTx(db, services as never, args);
    expect(row).toBeNull();
    expect(services.access.ensureMembership).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("seeding failure is non-fatal — approval still completes", async () => {
    const services = makeServices();
    services.team.updateCompanyUserProfile = vi.fn(async () => { throw new Error("boom"); });
    const { db } = makeTxDb({ id: "r1" });
    const row = await approveHumanJoinRequestTx(db, services as never, args);
    expect(row).toEqual({ id: "r1" });
    expect(reconcile).toHaveBeenCalled(); // hub/activity still run
  });
});

describe("approval identity factories", () => {
  it("founderApprovalIdentity: local-implicit board actor without a userId", () => {
    expect(founderApprovalIdentity({ actorUserId: null, localImplicit: true })).toEqual({
      approvedByUserId: "local-board",
      attributionUserId: null,
      activityActor: { actorType: "user", actorId: "board" },
      approvalSource: "founder",
    });
  });

  it("autoAdmitApprovalIdentity: all-null system preset — never impersonates anyone", () => {
    expect(autoAdmitApprovalIdentity()).toEqual({
      approvedByUserId: null,
      attributionUserId: null,
      activityActor: { actorType: "system", actorId: "invite_email_match" },
      approvalSource: "invite_email_match",
    });
  });
});

describe("grantsFromDefaults", () => {
  it("extracts valid grants for the requested key", () => {
    const grants = grantsFromDefaults(
      { human: { grants: [{ permissionKey: "tasks:assign", scope: null }, { permissionKey: "nope" }] } },
      "human",
    );
    expect(grants).toEqual([{ permissionKey: "tasks:assign", scope: null }]);
  });
});
