import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// P1 privilege-escalation clamp — MANUAL approve seam (symmetric with the
// invite-CREATION clamp and the AUTO-ADMIT sink). `POST /companies/:cid/
// join-requests/:id/approve` applies the invite's defaultsPayload (role +
// grants) VERBATIM via approveHumanJoinRequestTx, gated only by the delegable
// `joins:approve`. A non-founder approver must NOT be able to approve an invite
// that confers founder-tier authority (role above team_lead, or a privileged
// grant); such an approval requires a founder / instance admin in the loop.

vi.mock("@armyofagents/db", () => {
  const makeTable = () =>
    new Proxy(
      {},
      { get: (_t, prop) => (prop === "$inferSelect" || prop === "$inferInsert" ? {} : Symbol(String(prop))) },
    );
  return {
    agentApiKeys: makeTable(),
    authUsers: makeTable(),
    companies: makeTable(),
    companyMemberships: makeTable(),
    invites: makeTable(),
    joinRequests: makeTable(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  desc: (..._args: unknown[]) => "desc",
  eq: (..._args: unknown[]) => "eq",
  inArray: (..._args: unknown[]) => "inArray",
  isNull: (..._args: unknown[]) => "isNull",
}));

const { canUserMock, hasPermissionMock, getUserRoleMock, logActivityMock } = vi.hoisted(() => ({
  canUserMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  getUserRoleMock: vi.fn(),
  logActivityMock: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: canUserMock,
    hasPermission: hasPermissionMock,
    ensureMembership: vi.fn(),
    setPrincipalGrants: vi.fn(),
  }),
  agentService: () => ({ list: vi.fn(), create: vi.fn() }),
  deduplicateAgentName: vi.fn((name: string) => name),
  logActivity: logActivityMock,
  notifyHireApproved: vi.fn(),
  teamService: () => ({ getUserRole: getUserRoleMock, applyInviteRole: vi.fn() }),
}));

vi.mock("../services/hub-source-producers.js", () => ({
  emitHubItem: vi.fn(),
  buildJoinRequestHubEmit: vi.fn(),
}));

vi.mock("../services/hub-items.js", () => ({
  hubItemsService: () => ({ reconcile: vi.fn() }),
}));

// Control approveHumanJoinRequestTx so we can assert it is NEVER reached on a
// refusal, and stand in a faithful shared predicate (role above team_lead OR a
// privileged human grant) mirroring the module the route imports it from.
const { approveTxMock } = vi.hoisted(() => ({
  approveTxMock: vi.fn(async () => ({ id: "join-1", status: "approved", claimSecretHash: "x" })),
}));

vi.mock("../services/join-approval.js", () => ({
  approveHumanJoinRequestTx: approveTxMock,
  buildHumanJoinApprovalServices: () => ({}),
  founderApprovalIdentity: () => ({
    approvedByUserId: "approver-1",
    attributionUserId: "approver-1",
    activityActor: { actorType: "user", actorId: "approver-1" },
    approvalSource: "founder",
  }),
  grantsFromDefaults: (p: Record<string, unknown> | null, key: "human" | "agent") => {
    const scoped = p && (p as Record<string, unknown>)[key];
    const grants =
      scoped && typeof scoped === "object" && Array.isArray((scoped as { grants?: unknown }).grants)
        ? (scoped as { grants: Array<Record<string, unknown>> }).grants
        : [];
    return grants
      .filter((g) => g && typeof g.permissionKey === "string")
      .map((g) => ({ permissionKey: g.permissionKey as string, scope: null }));
  },
  inviteConfersPrivilegedAuthority: (p: Record<string, unknown> | null) => {
    const teamInvite = p && (p as { teamInvite?: { role?: string } }).teamInvite;
    if ((teamInvite?.role ?? null) === "founder") return true;
    const human = p && (p as { human?: { grants?: unknown } }).human;
    const grants =
      human && typeof human === "object" && Array.isArray((human as { grants?: unknown }).grants)
        ? (human as { grants: Array<Record<string, unknown>> }).grants
        : [];
    const privileged = new Set(["users:manage_permissions", "joins:approve", "users:invite"]);
    return grants.some((g) => typeof g?.permissionKey === "string" && privileged.has(g.permissionKey as string));
  },
}));

import { accessRoutes } from "../routes/access.js";

const COMPANY_ID = "company-1";
const REQUEST_ID = "join-1";
const INVITE_ID = "invite-1";

function makeApproveDb(invite: Record<string, unknown>) {
  const joinRequest = {
    id: REQUEST_ID,
    inviteId: INVITE_ID,
    companyId: COMPANY_ID,
    requestType: "human",
    status: "pending_approval",
    requestingUserId: "user-joiner",
    createdAgentId: null,
  };
  let selectCall = 0;
  return {
    select: () => {
      const chain: any = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.then = (resolve: (rows: unknown[]) => unknown) => {
        selectCall += 1;
        if (selectCall === 1) return Promise.resolve([joinRequest]).then(resolve);
        if (selectCall === 2) return Promise.resolve([invite]).then(resolve);
        return Promise.resolve([]).then(resolve);
      };
      return chain;
    },
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
  } as any;
}

type Actor = {
  type: string;
  source: string;
  userId?: string;
  agentId?: string;
  companyId?: string;
  isInstanceAdmin?: boolean;
};

function makeApp(db: any, actor: Actor) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = { companyIds: [COMPANY_ID], ...actor };
    next();
  });
  app.use(
    accessRoutes(db, {
      deploymentMode: "authenticated",
      deploymentExposure: "public",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    }),
  );
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });
  return app;
}

const founderInvite = {
  id: INVITE_ID,
  companyId: COMPANY_ID,
  defaultsPayload: { teamInvite: { email: "mallory@evil.com", role: "founder" } },
};
const privilegedGrantInvite = {
  id: INVITE_ID,
  companyId: COMPANY_ID,
  defaultsPayload: {
    teamInvite: { email: "mallory@evil.com", role: "team_member" },
    human: { grants: [{ permissionKey: "joins:approve" }] },
  },
};
const ordinaryInvite = {
  id: INVITE_ID,
  companyId: COMPANY_ID,
  defaultsPayload: { teamInvite: { email: "ada@x.com", role: "team_member" } },
};

const boardSession = (userId: string): Actor => ({ type: "board", source: "session", userId, isInstanceAdmin: false });

// Agent run actor: no userId (never a founder), company-scoped so
// assertCompanyAccess passes and assertCompanyPermission takes the agent branch.
const agentActor = (): Actor => ({ type: "agent", source: "agent_run", agentId: "agent-1", companyId: COMPANY_ID });

/** joins:approve gate always passes; only the CLAMP is under test. */
function asApprover(role: "founder" | "team_lead" | "team_member") {
  getUserRoleMock.mockResolvedValue({ role, projectId: null });
  canUserMock.mockResolvedValue(true); // holds joins:approve
}

function approve(db: any, actor: Actor) {
  return request(makeApp(db, actor))
    .post(`/companies/${COMPANY_ID}/join-requests/${REQUEST_ID}/approve`)
    .send({});
}

describe("POST /join-requests/:id/approve — approver-authority clamp (P1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("403s when a non-founder (joins:approve) approves a role:founder invite, and never applies it", async () => {
    asApprover("team_lead");
    const res = await approve(makeApproveDb(founderInvite), boardSession("approver-1"));
    expect(res.status).toBe(403);
    expect(approveTxMock).not.toHaveBeenCalled();
  });

  it("403s when a non-founder (joins:approve) approves a privileged-grant invite", async () => {
    asApprover("team_lead");
    const res = await approve(makeApproveDb(privilegedGrantInvite), boardSession("approver-1"));
    expect(res.status).toBe(403);
    expect(approveTxMock).not.toHaveBeenCalled();
  });

  it("REGRESSION: a non-founder (joins:approve) still approves an ordinary team_member invite", async () => {
    asApprover("team_lead");
    const res = await approve(makeApproveDb(ordinaryInvite), boardSession("approver-1"));
    expect(res.status).toBe(200);
    expect(approveTxMock).toHaveBeenCalledTimes(1);
  });

  it("a FOUNDER may approve a role:founder invite (full capability preserved)", async () => {
    asApprover("founder");
    const res = await approve(makeApproveDb(founderInvite), boardSession("founder-1"));
    expect(res.status).toBe(200);
    expect(approveTxMock).toHaveBeenCalledTimes(1);
  });

  it("the local_trusted synthetic board actor is exempt (approves a privileged invite, no crash)", async () => {
    // local_implicit short-circuits the joins:approve gate AND the clamp — a
    // single trust boundary, mirroring the creation clamp's actor handling.
    const res = await approve(makeApproveDb(founderInvite), { type: "board", source: "local_implicit", userId: "local" });
    expect(res.status).toBe(200);
    expect(approveTxMock).toHaveBeenCalledTimes(1);
    expect(getUserRoleMock).not.toHaveBeenCalled();
  });

  // Codex round-6 P1 — the exploit sink. The round-5 clamp only ran for
  // `req.actor.type === "board"`, so an AGENT holding joins:approve could
  // approve an agent-minted (or pre-existing) role:"founder" / privileged-grant
  // invite and self-apply founder authority with NO founder in the loop — the
  // auto-admit sink does not cover this manual route. An agent is never a
  // founder → refused, and approveHumanJoinRequestTx must never be reached.
  describe("agent-actor bypass (round-6)", () => {
    it("403s when an AGENT approves a role:founder invite, and never applies it", async () => {
      getUserRoleMock.mockResolvedValue({ role: "founder", projectId: null }); // even if resolvable, agent has no userId
      hasPermissionMock.mockResolvedValue(true); // agent holds joins:approve
      const res = await approve(makeApproveDb(founderInvite), agentActor());
      expect(res.status).toBe(403);
      expect(approveTxMock).not.toHaveBeenCalled();
    });

    it("403s when an AGENT approves a privileged-grant invite", async () => {
      hasPermissionMock.mockResolvedValue(true);
      const res = await approve(makeApproveDb(privilegedGrantInvite), agentActor());
      expect(res.status).toBe(403);
      expect(approveTxMock).not.toHaveBeenCalled();
    });

    it("still allows an AGENT to approve an ordinary team_member invite", async () => {
      hasPermissionMock.mockResolvedValue(true);
      const res = await approve(makeApproveDb(ordinaryInvite), agentActor());
      expect(res.status).toBe(200);
      expect(approveTxMock).toHaveBeenCalledTimes(1);
    });
  });
});
