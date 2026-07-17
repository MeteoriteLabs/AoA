import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// P1 privilege-escalation clamp (Codex round-5): POST /companies/:cid/invites
// must clamp the invite's requested role + embedded permission grants to the
// CREATOR's own authority, so a non-founder holding only `users:invite` can
// never mint a founder / privileged-grant invite and self-escalate at
// auto-admit time.

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

const { canUserMock, getUserRoleMock, logActivityMock } = vi.hoisted(() => ({
  canUserMock: vi.fn(),
  getUserRoleMock: vi.fn(),
  logActivityMock: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({ canUser: canUserMock }),
  agentService: () => ({}),
  deduplicateAgentName: vi.fn((name: string) => name),
  logActivity: logActivityMock,
  notifyHireApproved: vi.fn(),
  teamService: () => ({ getUserRole: getUserRoleMock }),
}));

vi.mock("../services/hub-source-producers.js", () => ({
  emitHubItem: vi.fn(),
  buildJoinRequestHubEmit: vi.fn(),
}));

import { accessRoutes } from "../routes/access.js";

const COMPANY_ID = "company-1";

// db.insert(invites).values({...}).returning().then(rows => rows[0])
function makeCreateDb(createdRow: Record<string, unknown>) {
  return {
    insert: () => {
      const chain: any = {};
      chain.values = () => chain;
      chain.returning = () => chain;
      chain.then = (resolve: (r: unknown[]) => unknown) => Promise.resolve([createdRow]).then(resolve);
      return chain;
    },
  } as any;
}

function makeApp(db: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      source: "session",
      userId: "creator-1",
      companyIds: [COMPANY_ID],
      isInstanceAdmin: false,
    };
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

const createdRow = {
  id: "invite-1",
  companyId: COMPANY_ID,
  inviteType: "company_join",
  allowedJoinTypes: "human",
  defaultsPayload: { teamInvite: { email: "x@x.com", role: "team_member" } },
  expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
};

/** Configure the creator's effective authority for a test. */
function asCreator(role: "founder" | "team_lead" | "team_member", heldKeys: string[]) {
  getUserRoleMock.mockResolvedValue({ role, projectId: null });
  const keys = new Set(heldKeys);
  canUserMock.mockImplementation(async (_c: string, _u: string, key: string) => keys.has(key));
}

function post(db: any, body: Record<string, unknown>) {
  return request(makeApp(db)).post(`/companies/${COMPANY_ID}/invites`).send(body);
}

describe("POST /invites — creator-authority clamp (P1)", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("role clamp", () => {
    it("403s when a non-founder (users:invite only) mints a role:founder invite", async () => {
      asCreator("team_member", ["users:invite"]);
      const res = await post(makeCreateDb(createdRow), {
        allowedJoinTypes: "human",
        defaultsPayload: { teamInvite: { email: "mallory@evil.com", role: "founder" } },
      });
      expect(res.status).toBe(403);
    });

    it("allows a non-founder to invite a team_member (intended delegation)", async () => {
      asCreator("team_member", ["users:invite"]);
      const res = await post(makeCreateDb(createdRow), {
        allowedJoinTypes: "human",
        defaultsPayload: { teamInvite: { email: "ada@x.com", role: "team_member" } },
      });
      expect(res.status).toBe(201);
    });

    it("allows a non-founder to invite a team_lead (intended delegation)", async () => {
      asCreator("team_lead", ["users:invite"]);
      const res = await post(makeCreateDb(createdRow), {
        allowedJoinTypes: "human",
        defaultsPayload: { teamInvite: { email: "ada@x.com", role: "team_lead" } },
      });
      expect(res.status).toBe(201);
    });

    it("allows a FOUNDER to mint a role:founder invite (full capability preserved)", async () => {
      asCreator("founder", ["users:invite", "users:manage_permissions"]);
      const res = await post(makeCreateDb(createdRow), {
        allowedJoinTypes: "human",
        defaultsPayload: { teamInvite: { email: "cofounder@x.com", role: "founder" } },
      });
      expect(res.status).toBe(201);
    });
  });

  describe("grants clamp", () => {
    it("403s when a non-founder embeds a grant without users:manage_permissions", async () => {
      asCreator("team_member", ["users:invite"]);
      const res = await post(makeCreateDb(createdRow), {
        allowedJoinTypes: "human",
        defaultsPayload: {
          teamInvite: { email: "ada@x.com", role: "team_member" },
          human: { grants: [{ permissionKey: "tasks:assign" }] },
        },
      });
      expect(res.status).toBe(403);
    });

    it("403s when a non-founder embeds a permission key they do not themselves hold", async () => {
      // Holds users:manage_permissions (may delegate) but NOT joins:approve.
      asCreator("team_member", ["users:invite", "users:manage_permissions"]);
      const res = await post(makeCreateDb(createdRow), {
        allowedJoinTypes: "human",
        defaultsPayload: {
          teamInvite: { email: "ada@x.com", role: "team_member" },
          human: { grants: [{ permissionKey: "joins:approve" }] },
        },
      });
      expect(res.status).toBe(403);
    });

    it("allows a non-founder to embed a grant they hold (with manage_permissions)", async () => {
      asCreator("team_member", ["users:invite", "users:manage_permissions", "tasks:assign"]);
      const res = await post(makeCreateDb(createdRow), {
        allowedJoinTypes: "human",
        defaultsPayload: {
          teamInvite: { email: "ada@x.com", role: "team_member" },
          human: { grants: [{ permissionKey: "tasks:assign" }] },
        },
      });
      expect(res.status).toBe(201);
    });

    it("allows a FOUNDER to embed any grants (full capability preserved)", async () => {
      asCreator("founder", ["users:invite"]); // founder short-circuits held-key checks
      const res = await post(makeCreateDb(createdRow), {
        allowedJoinTypes: "human",
        defaultsPayload: {
          teamInvite: { email: "ada@x.com", role: "team_member" },
          human: { grants: [{ permissionKey: "users:manage_permissions" }, { permissionKey: "joins:approve" }] },
        },
      });
      expect(res.status).toBe(201);
    });
  });
});
