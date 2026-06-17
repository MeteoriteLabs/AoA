/**
 * Owner-authz contract tests for the conversation memory-retrievals endpoint.
 *
 * Codex P2 finding #1: GET /companies/:cid/conversations/:convId/memory-retrievals
 * previously lacked an owner/founder guard (only assertCompanyAccess). This test
 * suite locks the guard introduced in Task 2 of the authz plan.
 *
 * Strategy (Codex #6 — no tautology): loadOwnedConversation is NOT mocked.
 * We drive the route against realistic mocked DB rows (a conversation row with a
 * known userId) and observe the HTTP status/body outcome. permissionService is
 * mocked at module level so we can control the effective role per actor class.
 *
 * Actor class matrix (Codex #1):
 *   - founder role                               → 200 rows
 *   - local_implicit board (loopback)            → 200 rows (founder-equivalent bypass)
 *   - instance-admin board                       → 200 rows (founder-equivalent bypass)
 *   - non-founder board user, userId === owner   → 200 rows
 *   - non-founder board user, userId ≠ owner     → 404 (existence-leak-safe)
 *   - agent/mcp token (non-founder)              → 404 (actorId ≠ conversation.userId)
 *
 * Issue endpoint distinction (Codex #3): the issue endpoint is intentionally NOT
 * owner-guarded (tasks are company resources). An explicit test locks this.
 */

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzleOperatorStubs, makeTableProxy } from "./helpers/drizzle-mock.js";

// ── drizzle-orm mock ─────────────────────────────────────────────────────────
vi.mock("drizzle-orm", () => drizzleOperatorStubs());

// ── DB table stubs ───────────────────────────────────────────────────────────
vi.mock("@armyofagents/db", () => ({
  internalAgentConversations: makeTableProxy("internal_agent_conversations"),
  memoryRetrievals: makeTableProxy("memory_retrievals"),
}));

// ── memoryService mock ───────────────────────────────────────────────────────
// We mock the service so the test doesn't need a real DB for retrievals.
// The guard (loadOwnedConversation) runs before this call — if it throws 404 the
// service is never reached.
const mockListRetrievalsForConversation = vi.fn(async () => [{ id: "ret-1" }]);
const mockListRetrievalsForIssue = vi.fn(async () => [{ id: "ret-issue-1" }]);

vi.mock("../services/index.js", () => ({
  memoryService: vi.fn(() => ({
    listRetrievalsForConversation: mockListRetrievalsForConversation,
    listRetrievalsForIssue: mockListRetrievalsForIssue,
  })),
}));

// ── permissionService mock ───────────────────────────────────────────────────
// Controlled per test via mockGetEffectiveRole.mockResolvedValue(...)
const mockGetEffectiveRole = vi.fn().mockResolvedValue("team_member");

vi.mock("../services/permissions.js", () => ({
  permissionService: vi.fn(() => ({
    getEffectiveRole: mockGetEffectiveRole,
  })),
}));

// ── assertCompanyAccess mock — always passes ─────────────────────────────────
vi.mock("../routes/authz.js", () => ({
  assertCompanyAccess: vi.fn(),
  getActorInfo: vi.fn((req: { actor: { type: string; agentId?: string; userId?: string } }) => {
    if (req.actor.type === "agent") {
      return { actorType: "agent" as const, actorId: req.actor.agentId ?? "agent-id", agentId: req.actor.agentId ?? null, runId: null };
    }
    return { actorType: "user" as const, actorId: (req.actor as { userId?: string }).userId ?? "unknown", agentId: null, runId: null };
  }),
}));

import { memoryRetrievalsRoutes } from "../routes/memory-retrievals.js";
import { errorHandler } from "../middleware/index.js";

// ── Constants ────────────────────────────────────────────────────────────────
const COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONV_ID    = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ISSUE_ID   = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OWNER_ID   = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // conversation.userId
const OTHER_ID   = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // different user

// Fake conversation row owned by OWNER_ID
const CONV_ROW = { id: CONV_ID, companyId: COMPANY_ID, userId: OWNER_ID };

// ── DB factory ────────────────────────────────────────────────────────────────
// Returns convRows for the conversation select; permissionService is mocked above.
function makeDb(convRows: unknown[] = [CONV_ROW]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(convRows)),
      })),
    })),
  };
}

// ── App factory ───────────────────────────────────────────────────────────────
type ActorShape =
  | { type: "board"; source: "session" | "local_implicit"; userId: string; companyIds: string[]; isInstanceAdmin: boolean }
  | { type: "agent"; companyId: string; agentId: string; runId: null }
  | { type: "mcp"; companyId: string; userId: string; runId: null };

function makeApp(db: ReturnType<typeof makeDb>, actor: ActorShape) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = actor;
    next();
  });
  app.use("/api", memoryRetrievalsRoutes(db as never));
  app.use(errorHandler);
  return app;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const sessionActor = (userId: string): ActorShape => ({
  type: "board",
  source: "session",
  userId,
  companyIds: [COMPANY_ID],
  isInstanceAdmin: false,
});

const localImplicitActor = (userId: string): ActorShape => ({
  type: "board",
  source: "local_implicit",
  userId,
  companyIds: [COMPANY_ID],
  isInstanceAdmin: false,
});

const instanceAdminActor = (userId: string): ActorShape => ({
  type: "board",
  source: "session",
  userId,
  companyIds: [COMPANY_ID],
  isInstanceAdmin: true,
});

const agentActor = (): ActorShape => ({
  type: "agent",
  companyId: COMPANY_ID,
  agentId: "agent-00000000-0000-4000-8000-000000000001",
  runId: null,
});

const convUrl = `/api/companies/${COMPANY_ID}/conversations/${CONV_ID}/memory-retrievals`;
const issueUrl = `/api/companies/${COMPANY_ID}/issues/${ISSUE_ID}/memory-retrievals`;

// ── Tests: conversation endpoint (owner-guarded) ──────────────────────────────

describe("GET /companies/:cid/conversations/:convId/memory-retrievals — owner guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveRole.mockResolvedValue("team_member");
    mockListRetrievalsForConversation.mockResolvedValue([{ id: "ret-1" }]);
  });

  it("founder role → 200 rows (owner bypass)", async () => {
    mockGetEffectiveRole.mockResolvedValue("founder");
    // Founder: DB can return any conversation in the company (no userId filter)
    // We still return CONV_ROW since no userId condition is added for founder.
    const res = await request(makeApp(makeDb([CONV_ROW]), sessionActor(OTHER_ID)))
      .get(convUrl);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("local_implicit board actor → 200 rows (founder-equivalent, no DB role check)", async () => {
    // local_implicit bypasses permissionService entirely — no getEffectiveRole call
    const res = await request(makeApp(makeDb([CONV_ROW]), localImplicitActor(OTHER_ID)))
      .get(convUrl);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // getEffectiveRole should NOT be called for local_implicit (it's a founder bypass)
    expect(mockGetEffectiveRole).not.toHaveBeenCalled();
  });

  it("instance-admin board actor → 200 rows (founder-equivalent, no DB role check)", async () => {
    const res = await request(makeApp(makeDb([CONV_ROW]), instanceAdminActor(OTHER_ID)))
      .get(convUrl);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(mockGetEffectiveRole).not.toHaveBeenCalled();
  });

  it("non-founder board user whose userId === conversation.userId → 200 rows", async () => {
    // team_member but owns the conversation — WHERE includes userId filter,
    // and the DB returns the row (userId matches).
    mockGetEffectiveRole.mockResolvedValue("team_member");
    const res = await request(makeApp(makeDb([CONV_ROW]), sessionActor(OWNER_ID)))
      .get(convUrl);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("non-founder board user whose userId ≠ conversation owner → 404 (existence-leak-safe, not 403)", async () => {
    // team_member, different user → WHERE adds userId constraint → DB returns [] → 404
    mockGetEffectiveRole.mockResolvedValue("team_member");
    const res = await request(makeApp(makeDb([]), sessionActor(OTHER_ID)))
      .get(convUrl);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it("agent/mcp token actor (non-founder) → 404 (actorId is not a userId, no ownership match)", async () => {
    // Agent actor: actorId = agentId string, never matches conversation.userId.
    // DB returns [] (no userId match) → 404.
    mockGetEffectiveRole.mockResolvedValue("team_member");
    const res = await request(makeApp(makeDb([]), agentActor()))
      .get(convUrl);
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });
});

// ── Tests: issue endpoint (company-scoped, intentionally NOT owner-guarded) ───

describe("GET /companies/:cid/issues/:issueId/memory-retrievals — NOT owner-guarded (Codex #3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRetrievalsForIssue.mockResolvedValue([{ id: "ret-issue-1" }]);
  });

  it("non-founder non-owner actor → 200 rows (tasks are company resources, no owner check)", async () => {
    // This test documents that the issue endpoint is intentionally company-scoped
    // only (assertCompanyAccess). A future reviewer must NOT add an owner guard here.
    mockGetEffectiveRole.mockResolvedValue("team_member");
    const res = await request(makeApp(makeDb([]), sessionActor(OTHER_ID)))
      .get(issueUrl);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // loadOwnedConversation must NOT have been called for the issue route
    // (the DB mock's select is only wired for conversation lookup; if it were
    // called here it would return [] and potentially 404 — but 200 proves no call).
    expect(res.body).toEqual([{ id: "ret-issue-1" }]);
  });

  it("agent actor → 200 rows (issue endpoint is company-scoped, not user-scoped)", async () => {
    const res = await request(makeApp(makeDb([]), agentActor()))
      .get(issueUrl);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
