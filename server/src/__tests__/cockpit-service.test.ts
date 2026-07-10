/**
 * cockpitService unit tests — Phase 3b.
 *
 * Mocks out all sub-services and the DB, asserting:
 *   - resolveCockpitScope is called and drives per-card filters.
 *   - A founder gets unrestricted review (taskScope:'all', no assigneeUserId/projectId).
 *   - A member gets restricted review (taskScope:'all' + assigneeUserId=their id).
 *   - A team_lead gets dept-scoped review (one call per dept with projectId).
 *   - MyTasks always uses the scope.userId as assigneeUserId.
 *   - Discussions uses threadService.list (canonical visibility).
 *   - The response shape matches CockpitData.
 *
 * Security gate: a member MUST NOT get an unrestricted review query.
 */

import { beforeEach, describe, it, expect, vi } from "vitest";

// ── Mocks (hoisted before imports) ───────────────────────────────────────────

const mockResolveCockpitScope = vi.hoisted(() => vi.fn());
const mockReviewFilterFor = vi.hoisted(() => vi.fn());
const mockIssueServiceList = vi.hoisted(() => vi.fn());
const mockThreadServiceList = vi.hoisted(() => vi.fn());
const mockLiveRunsForCompany = vi.hoisted(() => vi.fn());
const mockMemoryServiceListPending = vi.hoisted(() => vi.fn());
const mockUserNotesList = vi.hoisted(() => vi.fn());
const mockHubItemsQuery = vi.hoisted(() => vi.fn());

vi.mock("../services/cockpit-scope.js", () => ({
  resolveCockpitScope: mockResolveCockpitScope,
  reviewFilterFor: mockReviewFilterFor,
}));

vi.mock("../services/issues.js", () => ({
  issueService: () => ({ list: mockIssueServiceList }),
}));

vi.mock("../services/threads.js", () => ({
  threadService: () => ({ list: mockThreadServiceList }),
}));

vi.mock("../routes/agents-live-runs.js", () => ({
  liveRunsForCompany: mockLiveRunsForCompany,
}));

// Phase 3c: mock memory service for approvals aggregation
vi.mock("../services/memory.js", () => ({
  memoryService: () => ({ listPending: mockMemoryServiceListPending }),
}));

vi.mock("../services/user-notes.js", () => ({
  userNotesService: () => ({ list: mockUserNotesList }),
}));

vi.mock("../services/hub-items.js", () => ({
  hubItemsService: () => ({ query: mockHubItemsQuery }),
}));

// Mock drizzle DB queries (select chains for reminders + dueTasks + entryRows
// + approvals + extracted items + userEntityPins + opt-in resolvers).
// We use a simple stub that returns [] for all .from() / .where() / .orderBy() /
// .innerJoin() / .limit() chains.
function buildSelectStub(rows: unknown[] = []) {
  const stub: Record<string, unknown> = {};
  stub.from = () => stub;
  // where() may chain to orderBy() (cockpitPinned, opt-in resolvers) or be terminal.
  stub.where = () => stub;
  stub.innerJoin = () => stub;
  stub.select = () => stub;
  // orderBy() now chains — returns the stub (not a Promise) so .limit() can follow.
  stub.orderBy = () => stub;
  // limit() is terminal — resolves to rows.
  stub.limit = () => Promise.resolve(rows);
  // Make stub awaitable for where()-terminal and orderBy()-terminal paths.
  (stub as any).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
  return stub;
}

const mockDb = {
  select: vi.fn(() => buildSelectStub()),
} as unknown as import("@armyofagents/db").Db;

// ── Import service under test ────────────────────────────────────────────────

const { cockpitService } = await import("../services/cockpit.js");

// ── Fixtures ─────────────────────────────────────────────────────────────────

const COMPANY = "00000000-0000-4000-8000-000000000001";
const FOUNDER_ACTOR = { actorId: "u-founder", source: "session" as const };
const MEMBER_ACTOR = { actorId: "u-member", source: "session" as const };
const LEAD_ACTOR = { actorId: "u-lead", source: "session" as const };

const founderScope = {
  userId: "u-founder",
  role: "founder" as const,
  isFounder: true,
  leadDepartmentIds: [],
};
const memberScope = {
  userId: "u-member",
  role: "team_member" as const,
  isFounder: false,
  leadDepartmentIds: [],
};
const leadScope = {
  userId: "u-lead",
  role: "team_lead" as const,
  isFounder: false,
  leadDepartmentIds: ["dep-a", "dep-b"],
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path returns.
  mockLiveRunsForCompany.mockResolvedValue([]);
  mockIssueServiceList.mockResolvedValue([]);
  mockThreadServiceList.mockResolvedValue([]);
  // Phase 3c: memory listPending returns { items, versions, archives, totalCount } (HC2: object, not array)
  mockMemoryServiceListPending.mockResolvedValue({
    items: [],
    versions: [],
    archives: [],
    totalCount: 0,
  });
  mockUserNotesList.mockResolvedValue([]);
  mockHubItemsQuery.mockResolvedValue({ items: [], nextCursor: null });
  // db.select returns a stub that resolves to []
  (mockDb as Record<string, unknown>).select = vi.fn(() => buildSelectStub());
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("cockpitService.get — founder", () => {
  beforeEach(() => {
    mockResolveCockpitScope.mockResolvedValue(founderScope);
    mockReviewFilterFor.mockReturnValue({}); // founder → no restriction
  });

  it("calls resolveCockpitScope with the right args", async () => {
    await cockpitService(mockDb).get(COMPANY, FOUNDER_ACTOR);
    expect(mockResolveCockpitScope).toHaveBeenCalledWith(
      mockDb,
      COMPANY,
      FOUNDER_ACTOR,
    );
  });

  it("calls issueService.list for review with taskScope:'all' and NO assigneeUserId or projectId", async () => {
    await cockpitService(mockDb).get(COMPANY, FOUNDER_ACTOR);

    const reviewCall = mockIssueServiceList.mock.calls.find(
      (c) => c[1]?.status === "in_review",
    );
    expect(reviewCall).toBeDefined();
    expect(reviewCall![1]).toMatchObject({ status: "in_review", taskScope: "all" });
    // SECURITY: founder review MUST NOT carry assigneeUserId (that would restrict it).
    expect(reviewCall![1]).not.toHaveProperty("assigneeUserId");
    // SECURITY: founder review MUST NOT carry projectId.
    expect(reviewCall![1]).not.toHaveProperty("projectId");
  });

  it("calls issueService.list for myTasks with scope.userId as assigneeUserId", async () => {
    await cockpitService(mockDb).get(COMPANY, FOUNDER_ACTOR);
    const myTasksCall = mockIssueServiceList.mock.calls.find(
      (c) => c[1]?.assigneeUserId === founderScope.userId && c[1]?.status === undefined,
    );
    expect(myTasksCall).toBeDefined();
  });

  it("calls threadService.list with a founder-role actor", async () => {
    await cockpitService(mockDb).get(COMPANY, FOUNDER_ACTOR);
    expect(mockThreadServiceList).toHaveBeenCalledWith(
      COMPANY,
      expect.objectContaining({ userId: founderScope.userId, role: "founder" }),
    );
  });

  it("returns the CockpitData shape including Phase 3c approvals field", async () => {
    const result = await cockpitService(mockDb).get(COMPANY, FOUNDER_ACTOR);
    expect(result).toHaveProperty("running");
    expect(result).toHaveProperty("review");
    expect(result).toHaveProperty("myTasks");
    expect(result).toHaveProperty("today");
    expect(result.today).toHaveProperty("reminders");
    expect(result.today).toHaveProperty("dueTasks");
    expect(result).toHaveProperty("discussions");
    // Phase 3c: approvals field must exist (may be [])
    expect(result).toHaveProperty("approvals");
    expect(Array.isArray(result.approvals)).toBe(true);
  });

  it("maps note DTO timestamps without treating them as Date objects", async () => {
    mockUserNotesList.mockResolvedValue([
      {
        id: "note-1",
        companyId: COMPANY,
        userId: founderScope.userId,
        title: "Today",
        body: "Review Commander",
        color: "yellow",
        createdAt: "2026-07-10T09:00:00.000Z",
        updatedAt: "2026-07-10T10:00:00.000Z",
      },
    ]);

    const result = await cockpitService(mockDb).get(COMPANY, FOUNDER_ACTOR);

    expect(result.stickyNotes).toEqual([
      expect.objectContaining({
        id: "note-1",
        updatedAt: "2026-07-10T10:00:00.000Z",
      }),
    ]);
  });
});

describe("cockpitService.get — team_member (SECURITY GATE)", () => {
  beforeEach(() => {
    mockResolveCockpitScope.mockResolvedValue(memberScope);
    mockReviewFilterFor.mockReturnValue({ assigneeUserId: "u-member" });
  });

  it("review query MUST carry assigneeUserId=scope.userId (no cross-dept leak)", async () => {
    await cockpitService(mockDb).get(COMPANY, MEMBER_ACTOR);
    const reviewCall = mockIssueServiceList.mock.calls.find(
      (c) => c[1]?.status === "in_review",
    );
    expect(reviewCall).toBeDefined();
    // SECURITY: member review MUST be restricted to their own user.
    expect(reviewCall![1]).toMatchObject({
      status: "in_review",
      taskScope: "all",
      assigneeUserId: "u-member",
    });
    // SECURITY: must NOT have projectId (that would be dept-scoped).
    expect(reviewCall![1]).not.toHaveProperty("projectId");
  });

  it("review query MUST NOT be called without assigneeUserId for a member", async () => {
    await cockpitService(mockDb).get(COMPANY, MEMBER_ACTOR);
    const reviewCall = mockIssueServiceList.mock.calls.find(
      (c) => c[1]?.status === "in_review",
    );
    // The call exists but is scoped to assigneeUserId — no unrestricted call.
    const args = reviewCall![1] as Record<string, unknown>;
    expect(args.assigneeUserId).toBe("u-member");
  });

  it("myTasks is scoped to the member's own userId", async () => {
    await cockpitService(mockDb).get(COMPANY, MEMBER_ACTOR);
    const myTasksCall = mockIssueServiceList.mock.calls.find(
      (c) => c[1]?.assigneeUserId === memberScope.userId && !c[1]?.status,
    );
    expect(myTasksCall).toBeDefined();
  });
});

describe("cockpitService.get — team_lead", () => {
  beforeEach(() => {
    mockResolveCockpitScope.mockResolvedValue(leadScope);
    mockReviewFilterFor.mockReturnValue({ projectIds: ["dep-a", "dep-b"] });
  });

  it("makes one review call per department and dedupes results", async () => {
    // Mock first dept returns item-A, second dept returns item-A again + item-B.
    const itemA = {
      id: "task-a",
      identifier: "T-1",
      title: "Task A",
      status: "in_review",
      assigneeUserId: null,
      assigneeAgentId: null,
      dueDate: null,
    };
    const itemB = {
      id: "task-b",
      identifier: "T-2",
      title: "Task B",
      status: "in_review",
      assigneeUserId: null,
      assigneeAgentId: null,
      dueDate: null,
    };
    mockIssueServiceList
      .mockResolvedValueOnce([itemA]) // dep-a
      .mockResolvedValueOnce([itemA, itemB]) // dep-b (itemA duplicated)
      .mockResolvedValue([]); // myTasks fallthrough

    const result = await cockpitService(mockDb).get(COMPANY, LEAD_ACTOR);

    // Should have made 2 review calls (one per dept).
    const reviewCalls = mockIssueServiceList.mock.calls.filter(
      (c) => c[1]?.status === "in_review",
    );
    expect(reviewCalls).toHaveLength(2);
    expect(reviewCalls[0][1]).toMatchObject({
      status: "in_review",
      taskScope: "all",
      projectId: "dep-a",
    });
    expect(reviewCalls[1][1]).toMatchObject({
      status: "in_review",
      taskScope: "all",
      projectId: "dep-b",
    });

    // Deduplication: itemA only once.
    expect(result.review).toHaveLength(2);
    expect(result.review.map((r) => r.id)).toEqual(
      expect.arrayContaining(["task-a", "task-b"]),
    );
    // itemA appears only once.
    expect(result.review.filter((r) => r.id === "task-a")).toHaveLength(1);
  });
});

describe("cockpitService.get — Discussions canonical visibility (Codex #3)", () => {
  beforeEach(() => {
    mockResolveCockpitScope.mockResolvedValue(founderScope);
    mockReviewFilterFor.mockReturnValue({});
  });

  it("uses threadService.list (not hand-rolled query) for visibility", async () => {
    mockThreadServiceList.mockResolvedValue([
      {
        id: "disc-1",
        title: "Thread 1",
        pendingItemCount: 3,
        companyId: COMPANY,
      },
    ]);

    const result = await cockpitService(mockDb).get(COMPANY, FOUNDER_ACTOR);

    // threadService.list was called (canonical visibility).
    expect(mockThreadServiceList).toHaveBeenCalledTimes(1);
    // Items with pendingItemCount > 0 appear with reason "pending_items".
    expect(result.discussions).toHaveLength(1);
    expect(result.discussions[0]).toMatchObject({
      id: "disc-1",
      pendingItemCount: 3,
      reason: "pending_items",
    });
  });

  it("empty threadService result → empty discussions slice", async () => {
    mockThreadServiceList.mockResolvedValue([]);
    const result = await cockpitService(mockDb).get(COMPANY, FOUNDER_ACTOR);
    expect(result.discussions).toHaveLength(0);
  });
});
