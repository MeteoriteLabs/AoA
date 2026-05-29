/**
 * P1-T7: Tests for the secure scope-proposal Approve handler.
 *
 * Structure:
 *  A. Service unit tests — real threadDeliverablesService with mock DB (via vi.importActual).
 *  B. parseScopeProposalContent pure-helper tests.
 *  C. Route contract test — POST endpoint exists.
 *  D. Route integration tests (supertest) — authz, stale, happy path, idempotency.
 *
 * Mocking strategy:
 *  - `@armyofagents/db` and `drizzle-orm` are mocked with Proxy stubs (whole file).
 *  - `issueService` is mocked so service tests don't pull Drizzle internals.
 *  - `thread-deliverables.js` is mocked via `importOriginal` so the route mock
 *    intercepts the dynamic import inside the route handler. Section A/B bypass
 *    this via `vi.importActual` to exercise the real code.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Drizzle + DB mocks ────────────────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: any, b: any) => ({ _tag: "eq", a, b })),
  and: vi.fn((...args: any[]) => ({ _tag: "and", args })),
  gt: vi.fn((a: any, b: any) => ({ _tag: "gt", a, b })),
  asc: vi.fn((col: any) => ({ _tag: "asc", col })),
  desc: vi.fn((col: any) => ({ _tag: "desc", col })),
  inArray: vi.fn((col: any, vals: any) => ({ _tag: "inArray", col, vals })),
  sql: vi.fn(),
}));

vi.mock("@armyofagents/db", () => ({
  discussionEntries: new Proxy({} as any, { get: (_t, p) => p }),
  discussions: new Proxy({} as any, { get: (_t, p) => p }),
  threadPlanSteps: new Proxy({} as any, { get: (_t, p) => p }),
  threadInboxItems: new Proxy({} as any, { get: (_t, p) => p }),
  userRoles: new Proxy({} as any, { get: (_t, p) => p }),
  activityLog: new Proxy({} as any, { get: (_t, p) => p }),
  issues: new Proxy({} as any, { get: (_t, p) => p }),
  projects: new Proxy({} as any, { get: (_t, p) => p }),
  goals: new Proxy({} as any, { get: (_t, p) => p }),
  projectGoals: new Proxy({} as any, { get: (_t, p) => p }),
  assets: new Proxy({} as any, { get: (_t, p) => p }),
  artifacts: new Proxy({} as any, { get: (_t, p) => p }),
  memoryItems: new Proxy({} as any, { get: (_t, p) => p }),
  agents: new Proxy({} as any, { get: (_t, p) => p }),
  heartbeatRuns: new Proxy({} as any, { get: (_t, p) => p }),
}));

// ── issueService mock ─────────────────────────────────────────────────────────
const mockIssueCreate = vi.fn();

vi.mock("../services/issues.js", () => ({
  issueService: vi.fn(() => ({ create: mockIssueCreate })),
}));

// ── thread-deliverables: mock for route integration tests.
// Section A uses vi.importActual to bypass and get the real factory. ──────────
const mockApproveProposalFn = vi.fn();
const mockCreateDeliverableTasksFn = vi.fn();

vi.mock("../services/thread-deliverables.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/thread-deliverables.js")>();
  return {
    ...actual,
    // Override the factory so the route's dynamic `await import(...)` gets the mock
    threadDeliverablesService: vi.fn(() => ({
      createDeliverableTasks: mockCreateDeliverableTasksFn,
      approveProposal: mockApproveProposalFn,
    })),
    default: vi.fn(() => ({
      createDeliverableTasks: mockCreateDeliverableTasksFn,
      approveProposal: mockApproveProposalFn,
    })),
  };
});

// ── Route-level mocks ─────────────────────────────────────────────────────────
vi.mock("../services/index.js", () => ({
  discussionService: vi.fn(() => ({
    list: vi.fn(), getById: vi.fn(), create: vi.fn(), update: vi.fn(),
    addEntry: vi.fn(), reprocessEntry: vi.fn(), reprocessAllEntries: vi.fn(),
    updateItem: vi.fn(), approveItems: vi.fn(), rejectItems: vi.fn(),
    addAnnotation: vi.fn(), linkEntry: vi.fn(),
  })),
  logActivity: vi.fn().mockResolvedValue(undefined),
  permissionService: vi.fn(() => ({
    getEffectiveRole: vi.fn().mockResolvedValue("founder"),
  })),
  dependencyService: vi.fn(() => ({ addDependency: vi.fn() })),
}));

vi.mock("../services/threads.js", () => ({
  threadService: vi.fn(() => ({
    advancePhase: vi.fn(), claim: vi.fn(), transferOwnership: vi.fn(),
    addParticipant: vi.fn(), promoteToGoal: vi.fn(), assignScopeItems: vi.fn(),
    getPlanSteps: vi.fn(), updatePlanSteps: vi.fn(), entriesSince: vi.fn(),
    spinOff: vi.fn(), addScopeItemDependency: vi.fn(),
    graduateScopeItemDependencies: vi.fn(), routeItem: vi.fn(),
    createLink: vi.fn(), listLinks: vi.fn(),
  })),
  parseMentions: vi.fn(() => []),
  processMentions: vi.fn(),
}));

vi.mock("../middleware/validate.js", () => ({
  validate: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../middleware/rbac.js", () => ({
  assertRole: vi.fn().mockResolvedValue(undefined),
  assertDepartmentAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../routes/authz.js", () => ({
  assertCompanyAccess: vi.fn(),
  getActorInfo: vi.fn().mockReturnValue({ actorType: "user", actorId: "u1", agentId: null }),
}));

vi.mock("../redaction.js", () => ({
  sanitizeRecord: vi.fn((r: any) => r),
}));

vi.mock("../errors.js", () => ({
  badRequest: (msg: string) => Object.assign(new Error(msg), { status: 400 }),
  notFound: (msg: string) => Object.assign(new Error(msg), { status: 404 }),
  unauthorized: () => Object.assign(new Error("Unauthorized"), { status: 401 }),
  forbidden: (msg: string) => Object.assign(new Error(msg ?? "Forbidden"), { status: 403 }),
  conflict: (msg: string) => Object.assign(new Error(msg), { status: 409 }),
  unprocessable: (msg: string) => Object.assign(new Error(msg), { status: 422 }),
  HttpError: class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
  },
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: vi.fn(),
}));

vi.mock("../services/permissions.js", () => ({
  permissionService: vi.fn(() => ({
    getEffectiveRole: vi.fn().mockResolvedValue("founder"),
    isFounder: vi.fn().mockResolvedValue(true),
    isTeamLeadForDepartment: vi.fn().mockResolvedValue(false),
  })),
}));

// ── Import routes + rbac mock after all vi.mock declarations ──────────────────
import { discussionRoutes } from "../routes/discussions.js";
import { assertRole } from "../middleware/rbac.js";
import express from "express";
import request from "supertest";

const mockedAssertRole = vi.mocked(assertRole);

// ─── Constants ─────────────────────────────────────────────────────────────────
const CO_ID = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const THREAD_ID = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
const ENTRY_ID = "cccccccc-0000-4000-8000-cccccccccccc";
const USER_ID = "dddddddd-0000-4000-8000-dddddddddddd";

// ─── Mock DB helpers ──────────────────────────────────────────────────────────

/**
 * A minimal mock Drizzle db. `selectResults` is consumed in order.
 * Chain: select().from().innerJoin?().where() → resolves to the queued result.
 */
function makeMockDb(opts: {
  selectResults?: any[][];
  updateShouldSucceed?: boolean;
} = {}) {
  const selectQueue = [...(opts.selectResults ?? [])];
  let selectCallIdx = 0;

  function selectChain(): any {
    const idx = selectCallIdx++;
    const result = selectQueue[idx] ?? [];
    const chain: any = {};
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.where = () => Promise.resolve(result);
    chain.orderBy = () => Promise.resolve(result);
    chain.then = (resolve: any) => Promise.resolve(resolve(result));
    return chain;
  }

  function updateChain(): any {
    const chain: any = {};
    chain.set = () => chain;
    chain.where = () =>
      Promise.resolve(opts.updateShouldSucceed !== false ? [{ id: ENTRY_ID }] : []);
    return chain;
  }

  return {
    select: vi.fn(selectChain),
    update: vi.fn(updateChain),
    transaction: vi.fn(async (cb: any) =>
      cb({
        select: vi.fn(selectChain),
        update: vi.fn(updateChain),
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]),
          })),
        })),
      }),
    ),
  };
}

/** Valid scope proposal rawContent JSON. */
function makeProposalRaw(opts: {
  proposalCursorSeq?: number;
  proposedTasks?: Array<{ title: string; [k: string]: unknown }>;
} = {}) {
  return JSON.stringify({
    summary: "Build the auth flow",
    proposedTasks: opts.proposedTasks ?? [{ title: "Task A" }, { title: "Task B" }],
    proposalCursorSeq: opts.proposalCursorSeq ?? 5,
  });
}

/** Pending proposal entry row (extractionStatus = "pending" by default). */
function makePendingEntry(overrides: Partial<{
  id: string;
  discussionId: string;
  rawContent: string;
  extractionStatus: string;
}> = {}) {
  return {
    id: overrides.id ?? ENTRY_ID,
    discussionId: overrides.discussionId ?? THREAD_ID,
    inputType: "scope_proposal",
    rawContent: overrides.rawContent ?? makeProposalRaw({ proposalCursorSeq: 5 }),
    extractionStatus: overrides.extractionStatus ?? "pending",
  };
}

// ════════════════════════════════════════════════════════════════════════
// A. Service unit tests (real service via vi.importActual, mock DB)
// ════════════════════════════════════════════════════════════════════════

describe("threadDeliverablesService.approveProposal (real service, mock DB)", () => {
  // Load the REAL service factory, bypassing the vi.mock override.
  // vi.importActual skips the factory replacement and returns the actual module.
  let realThreadDeliverablesService: typeof import("../services/thread-deliverables.js")["threadDeliverablesService"];

  beforeEach(async () => {
    vi.clearAllMocks();
    const actual = await vi.importActual<typeof import("../services/thread-deliverables.js")>(
      "../services/thread-deliverables.js",
    );
    realThreadDeliverablesService = actual.threadDeliverablesService;
  });

  // ── A1. Happy path ────────────────────────────────────────────────────────────
  it("happy path: creates tasks and marks proposal approved", async () => {
    mockIssueCreate
      .mockResolvedValueOnce({ id: "task-1", title: "Task A" })
      .mockResolvedValueOnce({ id: "task-2", title: "Task B" });

    const db = makeMockDb({
      selectResults: [
        // 1st select: entry + company join
        [makePendingEntry()],
        // 2nd select: thread's current entrySeq
        [{ entrySeq: 5 }],
      ],
    });

    const svc = realThreadDeliverablesService(db as any);
    const result = await svc.approveProposal({
      threadId: THREAD_ID,
      companyId: CO_ID,
      proposalEntryId: ENTRY_ID,
      approver: { userId: USER_ID },
    });

    expect(result.ok).toBe(true);
    if (result.ok && !result.alreadyApproved) {
      expect(result.taskIds).toHaveLength(2);
      expect(result.taskIds).toContain("task-1");
      expect(result.taskIds).toContain("task-2");
    }
    expect(mockIssueCreate).toHaveBeenCalledTimes(2);
    expect(db.update).toHaveBeenCalled();
  });

  // ── A2. createDeliverableTasks called with correct args ───────────────────────
  it("passes sourceDiscussionId=threadId and createdByUserId=approver to each task", async () => {
    mockIssueCreate.mockResolvedValue({ id: "task-x", title: "Task X" });

    const db = makeMockDb({
      selectResults: [
        [makePendingEntry({
          rawContent: makeProposalRaw({
            proposedTasks: [{ title: "Task X" }],
            proposalCursorSeq: 3,
          }),
        })],
        [{ entrySeq: 3 }],
      ],
    });

    const svc = realThreadDeliverablesService(db as any);
    await svc.approveProposal({
      threadId: THREAD_ID,
      companyId: CO_ID,
      proposalEntryId: ENTRY_ID,
      approver: { userId: USER_ID },
    });

    const createArg = mockIssueCreate.mock.calls[0][1];
    expect(createArg.sourceDiscussionId).toBe(THREAD_ID);
    expect(createArg.createdByUserId).toBe(USER_ID);
  });

  // ── A3. STALE — kill-test invariant ──────────────────────────────────────────
  it("STALE: rejects when currentSeq > proposalCursorSeq — NO tasks created", async () => {
    const db = makeMockDb({
      selectResults: [
        // Proposal stamped at seq=5
        [makePendingEntry({ rawContent: makeProposalRaw({ proposalCursorSeq: 5 }) })],
        // Thread now at seq=8 (3 newer entries)
        [{ entrySeq: 8 }],
      ],
    });

    const svc = realThreadDeliverablesService(db as any);
    const result = await svc.approveProposal({
      threadId: THREAD_ID,
      companyId: CO_ID,
      proposalEntryId: ENTRY_ID,
      approver: { userId: USER_ID },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("stale");
      expect(result.message).toMatch(/out of date/i);
    }
    expect(mockIssueCreate).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  // ── A4. Double-approve idempotency ────────────────────────────────────────────
  it("idempotent: second approve → alreadyApproved:true, no tasks created", async () => {
    const db = makeMockDb({
      selectResults: [
        [makePendingEntry({ extractionStatus: "completed" })],
      ],
    });

    const svc = realThreadDeliverablesService(db as any);
    const result = await svc.approveProposal({
      threadId: THREAD_ID,
      companyId: CO_ID,
      proposalEntryId: ENTRY_ID,
      approver: { userId: USER_ID },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.alreadyApproved).toBe(true);
    expect(mockIssueCreate).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  // ── A5. Not found ─────────────────────────────────────────────────────────────
  it("returns not_found when entry does not exist for this company", async () => {
    const db = makeMockDb({ selectResults: [[]] });

    const svc = realThreadDeliverablesService(db as any);
    const result = await svc.approveProposal({
      threadId: THREAD_ID,
      companyId: CO_ID,
      proposalEntryId: "nonexistent-id",
      approver: { userId: USER_ID },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
    expect(mockIssueCreate).not.toHaveBeenCalled();
  });

  // ── A6. Wrong thread ──────────────────────────────────────────────────────────
  it("returns wrong_thread when proposal belongs to a different thread", async () => {
    const OTHER_THREAD = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";
    const db = makeMockDb({
      selectResults: [
        [makePendingEntry({ discussionId: OTHER_THREAD })],
      ],
    });

    const svc = realThreadDeliverablesService(db as any);
    const result = await svc.approveProposal({
      threadId: THREAD_ID,
      companyId: CO_ID,
      proposalEntryId: ENTRY_ID,
      approver: { userId: USER_ID },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("wrong_thread");
    expect(mockIssueCreate).not.toHaveBeenCalled();
  });

  // ── A7. Already rejected ──────────────────────────────────────────────────────
  it("returns rejected when proposal was already rejected (skipped status)", async () => {
    const db = makeMockDb({
      selectResults: [
        [makePendingEntry({ extractionStatus: "skipped" })],
      ],
    });

    const svc = realThreadDeliverablesService(db as any);
    const result = await svc.approveProposal({
      threadId: THREAD_ID,
      companyId: CO_ID,
      proposalEntryId: ENTRY_ID,
      approver: { userId: USER_ID },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("rejected");
    expect(mockIssueCreate).not.toHaveBeenCalled();
  });

  // ── A8. Equal seq is NOT stale ────────────────────────────────────────────────
  it("fresh: currentSeq === stampedSeq is NOT stale", async () => {
    mockIssueCreate.mockResolvedValue({ id: "task-z", title: "Task Z" });

    const db = makeMockDb({
      selectResults: [
        [makePendingEntry({ rawContent: makeProposalRaw({ proposalCursorSeq: 7 }) })],
        [{ entrySeq: 7 }], // exact match
      ],
    });

    const svc = realThreadDeliverablesService(db as any);
    const result = await svc.approveProposal({
      threadId: THREAD_ID,
      companyId: CO_ID,
      proposalEntryId: ENTRY_ID,
      approver: { userId: USER_ID },
    });

    expect(result.ok).toBe(true);
    expect(mockIssueCreate).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════
// B. parseScopeProposalContent pure-helper tests (via vi.importActual)
// ════════════════════════════════════════════════════════════════════════

describe("parseScopeProposalContent (pure helper via importActual)", () => {
  let parseScopeProposalContent: typeof import("../services/thread-deliverables.js")["parseScopeProposalContent"];

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("../services/thread-deliverables.js")>(
      "../services/thread-deliverables.js",
    );
    parseScopeProposalContent = actual.parseScopeProposalContent;
  });

  it("parses valid JSON with proposalCursorSeq", () => {
    const raw = JSON.stringify({
      summary: "Proposal",
      proposedTasks: [{ title: "T1" }],
      proposalCursorSeq: 12,
    });
    const result = parseScopeProposalContent(raw);
    expect(result).not.toBeNull();
    expect(result?.proposalCursorSeq).toBe(12);
    expect(result?.proposedTasks[0].title).toBe("T1");
  });

  it("defaults proposalCursorSeq to 0 for legacy proposals without the field", () => {
    const legacy = JSON.stringify({ summary: "Legacy", proposedTasks: [] });
    const result = parseScopeProposalContent(legacy);
    expect(result?.proposalCursorSeq).toBe(0);
  });

  it("returns null for invalid JSON", () => {
    expect(parseScopeProposalContent("not-json")).toBeNull();
  });

  it("returns null when proposedTasks is missing", () => {
    expect(parseScopeProposalContent(JSON.stringify({ summary: "No tasks" }))).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════
// C. Route contract test
// ════════════════════════════════════════════════════════════════════════

function extractRoutes(router: any): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  for (const layer of router.stack ?? []) {
    if (layer.route) {
      const path = layer.route.path as string;
      const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase());
      for (const method of methods) routes.push({ method, path });
    }
  }
  return routes;
}

describe("route contract: POST approve-proposal endpoint exists", () => {
  it("POST …/discussions/:discussionId/proposals/:proposalEntryId/approve exists", () => {
    const router = discussionRoutes({} as any);
    const routes = extractRoutes(router);
    const found = routes.some(
      (r) =>
        r.method === "POST" &&
        r.path.includes("proposals") &&
        r.path.includes("approve"),
    );
    expect(found).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
// D. Route integration tests (supertest)
// The mocked threadDeliverablesService factory returns mockApproveProposalFn.
// ════════════════════════════════════════════════════════════════════════

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.actor = { type: "board", source: "authenticated", isInstanceAdmin: false };
    next();
  });
  app.use(discussionRoutes({} as any));
  return app;
}

describe("route integration: POST …/proposals/:proposalEntryId/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAssertRole.mockResolvedValue(undefined);
  });

  it("happy path: returns 201 with tasksCreated", async () => {
    mockApproveProposalFn.mockResolvedValue({
      ok: true,
      alreadyApproved: false,
      taskIds: ["task-1", "task-2"],
    });

    const res = await request(makeApp())
      .post(`/companies/${CO_ID}/discussions/${THREAD_ID}/proposals/${ENTRY_ID}/approve`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.tasksCreated).toEqual(["task-1", "task-2"]);
    expect(res.body.alreadyApproved).toBe(false);
  });

  it("unauthorized (team_member): 403 — approveProposal NOT called", async () => {
    mockedAssertRole.mockRejectedValue(
      Object.assign(new Error("Requires one of: founder, team_lead"), { status: 403 }),
    );

    const res = await request(makeApp())
      .post(`/companies/${CO_ID}/discussions/${THREAD_ID}/proposals/${ENTRY_ID}/approve`)
      .send({});

    expect(res.status).toBe(403);
    expect(mockApproveProposalFn).not.toHaveBeenCalled();
  });

  it("stale proposal: returns 409 with reason stale", async () => {
    mockApproveProposalFn.mockResolvedValue({
      ok: false,
      reason: "stale",
      message: "Proposal is out of date",
    });

    const res = await request(makeApp())
      .post(`/companies/${CO_ID}/discussions/${THREAD_ID}/proposals/${ENTRY_ID}/approve`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("stale");
  });

  it("double-approve: 200 with alreadyApproved:true — no duplicate tasks", async () => {
    mockApproveProposalFn.mockResolvedValue({
      ok: true,
      alreadyApproved: true,
    });

    const res = await request(makeApp())
      .post(`/companies/${CO_ID}/discussions/${THREAD_ID}/proposals/${ENTRY_ID}/approve`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.alreadyApproved).toBe(true);
    expect(res.body.tasksCreated).toEqual([]);
  });

  it("not found: returns 404", async () => {
    mockApproveProposalFn.mockResolvedValue({
      ok: false,
      reason: "not_found",
      message: "Proposal not found",
    });

    const res = await request(makeApp())
      .post(`/companies/${CO_ID}/discussions/${THREAD_ID}/proposals/nonexistent/approve`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.reason).toBe("not_found");
  });
});
