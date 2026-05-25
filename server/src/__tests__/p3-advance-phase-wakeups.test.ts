/**
 * P3.4 — advancePhase emits phase-advance wakeups
 *
 * Tests that threadService.advancePhase inserts agentWakeupRequests rows for
 * every agent that has an enabled kind="phase-advance" trigger in the company.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must precede imports that transitively import drizzle) ────────────

const { eqMock, andMock } = vi.hoisted(() => ({
  eqMock: vi.fn((a: unknown, b: unknown) => ({ op: "eq", a, b })),
  andMock: vi.fn((...args: unknown[]) => ({ op: "and", args })),
}));

vi.mock("drizzle-orm", () => ({
  eq: eqMock,
  and: andMock,
  sql: vi.fn(),
  asc: vi.fn((c: unknown) => c),
  desc: vi.fn((c: unknown) => c),
  gt: vi.fn((a: unknown, b: unknown) => ({ op: "gt", a, b })),
  ne: vi.fn((a: unknown, b: unknown) => ({ op: "ne", a, b })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ op: "inArray", a, b })),
  notInArray: vi.fn((a: unknown, b: unknown) => ({ op: "notInArray", a, b })),
  isNull: vi.fn((a: unknown) => ({ op: "isNull", a })),
  or: vi.fn((...args: unknown[]) => ({ op: "or", args })),
  count: vi.fn(() => ({ count: true })),
}));

vi.mock("@armyofagents/db", () => {
  const t = (n: string) =>
    new Proxy(
      {},
      { get: (_x, p) => (typeof p === "string" ? `${n}.${p}` : undefined) },
    );
  return {
    discussions: t("discussions"),
    discussionEntries: t("de"),
    agents: t("agents"),
    aoaAgentTriggers: t("triggers"),
    agentWakeupRequests: t("wakeup"),
    activityLog: t("al"),
    userRoles: t("ur"),
    authUsers: t("authUsers"),
    companyMemberships: t("cm"),
    notifications: t("notifications"),
    threadParticipants: t("tp"),
    threadLinks: t("tl"),
    discussionExtractedItems: t("dei"),
    scopeItemDependencies: t("sid"),
    taskDependencies: t("td"),
    issues: t("issues"),
  };
});

vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: vi.fn(),
}));
vi.mock("../services/goals.js", () => ({
  goalService: vi.fn(() => ({})),
}));
vi.mock("../errors.js", () => ({
  notFound: (m: string) => Object.assign(new Error(m), { status: 404 }),
  badRequest: (m: string) => Object.assign(new Error(m), { status: 400 }),
  forbidden: (m: string) => Object.assign(new Error(m), { status: 403 }),
}));

// ── Now import the function under test ────────────────────────────────────────
import { threadService } from "../services/threads.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const COMPANY_ID = "co-1";
const THREAD_ID = "t-1";
// Using role: "founder" so assertCanView short-circuits and skips extra selects
const ACTOR = { userId: "user-1", isHuman: true, role: "founder" as const };

/**
 * Build a mock DB that sequences its select/update/insert calls.
 *
 * `selectResults` - array of arrays; each advancePhase call triggers multiple
 *   selects in order: [threadRow, triggerRows, ...]
 * `insertValues` - captured insert payloads accumulate here
 */
function buildMockDb(selectResults: Array<unknown[]>, insertValues: unknown[]) {
  let selectCallIdx = 0;

  const insertValuesMock = vi.fn().mockImplementation((vals: unknown) => {
    insertValues.push(vals);
    return Promise.resolve([{ id: "w-1" }]);
  });

  const insertMock = vi.fn().mockReturnValue({ values: insertValuesMock });

  const updateSetMock = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue([{ id: THREAD_ID }]),
  });
  const updateMock = vi.fn().mockReturnValue({ set: updateSetMock });

  const selectMock = vi.fn().mockImplementation(() => {
    const idx = selectCallIdx++;
    const result = selectResults[idx] ?? [];
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn().mockImplementation((cb: (r: unknown[]) => unknown) =>
            Promise.resolve(cb(result)),
          ),
          // For cases where .limit() is chained
          limit: vi.fn().mockReturnValue({
            then: vi.fn().mockImplementation((cb: (r: unknown[]) => unknown) =>
              Promise.resolve(cb(result)),
            ),
          }),
        }),
        // For direct awaits without .where
        then: vi.fn().mockImplementation((cb: (r: unknown[]) => unknown) =>
          Promise.resolve(cb(result)),
        ),
      }),
    };
  });

  return { select: selectMock, update: updateMock, insert: insertMock, _insertValuesMock: insertValuesMock };
}

const THREAD_ROW = {
  id: THREAD_ID,
  phase: "discuss",
  companyId: COMPANY_ID,
  ownerUserId: null,
  visibility: "company_members",
  scopeType: null,
  scopeId: null,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("P3.4 — advancePhase emits phase-advance wakeups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits a wakeup row for each agent with an enabled phase-advance trigger", async () => {
    const capturedInserts: unknown[] = [];
    const db = buildMockDb(
      [
        // select 1: get thread
        [THREAD_ROW],
        // select 2: phase-advance triggers
        [
          { agentId: "planner-1", config: { role: "planner" } },
          { agentId: "dispatcher-1", config: { role: "dispatcher" } },
        ],
      ],
      capturedInserts,
    );

    await threadService(db as never).advancePhase(
      COMPANY_ID,
      THREAD_ID,
      "scope",
      ACTOR,
    );

    // Two inserts — one per trigger
    expect(capturedInserts).toHaveLength(2);
    expect(capturedInserts[0]).toMatchObject({
      companyId: COMPANY_ID,
      agentId: "planner-1",
      source: "phase-advance",
      reason: "thread_phase_advanced",
    });
    expect(capturedInserts[1]).toMatchObject({
      companyId: COMPANY_ID,
      agentId: "dispatcher-1",
      source: "phase-advance",
      reason: "thread_phase_advanced",
    });
  });

  it("skips wakeup inserts when no phase-advance triggers exist for the company", async () => {
    const capturedInserts: unknown[] = [];
    const db = buildMockDb(
      [
        // select 1: get thread
        [THREAD_ROW],
        // select 2: no triggers
        [],
      ],
      capturedInserts,
    );

    await threadService(db as never).advancePhase(
      COMPANY_ID,
      THREAD_ID,
      "scope",
      ACTOR,
    );

    expect(capturedInserts).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("payload contains threadId, toPhase, and role from trigger config", async () => {
    const capturedInserts: unknown[] = [];
    const db = buildMockDb(
      [
        [THREAD_ROW],
        [{ agentId: "a-1", config: { role: "planner" } }],
      ],
      capturedInserts,
    );

    await threadService(db as never).advancePhase(
      COMPANY_ID,
      THREAD_ID,
      "scope",
      ACTOR,
    );

    expect(capturedInserts).toHaveLength(1);
    expect(capturedInserts[0]).toMatchObject({
      agentId: "a-1",
      payload: {
        threadId: THREAD_ID,
        toPhase: "scope",
        role: "planner",
      },
    });
  });

  it("payload role is undefined when trigger config is null", async () => {
    const capturedInserts: unknown[] = [];
    const db = buildMockDb(
      [
        [THREAD_ROW],
        [{ agentId: "a-1", config: null }],
      ],
      capturedInserts,
    );

    await threadService(db as never).advancePhase(
      COMPANY_ID,
      THREAD_ID,
      "scope",
      ACTOR,
    );

    expect(capturedInserts).toHaveLength(1);
    expect((capturedInserts[0] as Record<string, unknown>).payload).toMatchObject({
      threadId: THREAD_ID,
      toPhase: "scope",
    });
    // role should be undefined (absent) when config is null
    const payload = (capturedInserts[0] as Record<string, unknown>).payload as Record<string, unknown>;
    expect(payload.role).toBeUndefined();
  });
});
