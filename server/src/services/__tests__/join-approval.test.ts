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

import { approveHumanJoinRequestTx, grantsFromDefaults } from "../join-approval.js";

function makeTxDb(updatedRow: Record<string, unknown> | null) {
  return {
    update: () => ({ set: () => ({ where: () => ({ returning: async () => (updatedRow ? [updatedRow] : []) }) }) }),
  } as never;
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
  invite: { id: "i1", defaultsPayload: { teamInvite: { role: "team_member", email: "ada@x.com" } } as Record<string, unknown> },
  approvedByUserId: null,
  attributionUserId: null,
  activityActor: { actorType: "system" as const, actorId: "invite_email_match" },
  approvalSource: "invite_email_match" as const,
};

describe("approveHumanJoinRequestTx", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves: row update + membership + grants + role + seeding + hub + activity", async () => {
    const services = makeServices();
    const row = await approveHumanJoinRequestTx(makeTxDb({ id: "r1", status: "approved" }), services as never, args);
    expect(row).toEqual({ id: "r1", status: "approved" });
    expect(services.access.ensureMembership).toHaveBeenCalledWith("c1", "user", "u1", "member", "active");
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
      details: { requestType: "human", approvalSource: "invite_email_match" },
    }));
  });

  it("returns null (no side effects) when the row is no longer pending (race)", async () => {
    const services = makeServices();
    const row = await approveHumanJoinRequestTx(makeTxDb(null), services as never, args);
    expect(row).toBeNull();
    expect(services.access.ensureMembership).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("seeding failure is non-fatal — approval still completes", async () => {
    const services = makeServices();
    services.team.updateCompanyUserProfile = vi.fn(async () => { throw new Error("boom"); });
    const row = await approveHumanJoinRequestTx(makeTxDb({ id: "r1" }), services as never, args);
    expect(row).toEqual({ id: "r1" });
    expect(reconcile).toHaveBeenCalled(); // hub/activity still run
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
