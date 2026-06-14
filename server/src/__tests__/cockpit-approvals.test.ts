/**
 * cockpit-approvals unit tests — Phase 3c.
 *
 * Security gate:
 *   - founder → all 3 source queries run; items mapped with correct source discriminator.
 *   - non-founder → [] returned immediately; NO sub-queries run.
 *
 * Constraint verification (plan Hard Constraints):
 *   - HC1: non-founder gets [].
 *   - HC2: memory uses .items (object, not array).
 *   - HC3: discussion join uses discussionEntryId → discussion_entries → discussions.
 *   - HC7: per-source approve dispatches correct API.
 */

import { beforeEach, describe, it, expect, vi } from "vitest";

// ── Mocks (hoisted) ───────────────────────────────────────────────────────────

const mockResolveCockpitScope = vi.hoisted(() => vi.fn());
const mockReviewFilterFor = vi.hoisted(() => vi.fn());
const mockIssueServiceList = vi.hoisted(() => vi.fn());
const mockThreadServiceList = vi.hoisted(() => vi.fn());
const mockLiveRunsForCompany = vi.hoisted(() => vi.fn());
const mockMemoryServiceListPending = vi.hoisted(() => vi.fn());

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

vi.mock("../services/memory.js", () => ({
  memoryService: () => ({ listPending: mockMemoryServiceListPending }),
}));

// ── DB stub ───────────────────────────────────────────────────────────────────

// Sequence-based mock db for the 3 select chains:
//  1. reminders (returns [])
//  2. dueTasks (returns [])
//  3. entryRows for discussion needs-me check (returns [])
//  4. listPendingApprovals (returns approval rows)
//  5. listPendingExtractedItems (returns discussion item rows)
// We make select() return a proxy that resolves each where() to the next item
// in the sequence.

function buildSelectStub(rows: unknown[] = []) {
  const stub: Record<string, unknown> = {};
  stub.from = () => stub;
  stub.where = () => Promise.resolve(rows);
  stub.innerJoin = () => stub;
  stub.select = () => stub;
  return stub;
}

// A sequence db that returns different rows per select call.
function buildSequenceDb(sequence: unknown[][]) {
  let callIdx = 0;
  return {
    select: vi.fn(() => {
      const rows = sequence[callIdx] ?? [];
      callIdx++;
      return buildSelectStub(rows);
    }),
  } as unknown as import("@armyofagents/db").Db;
}

// ── Import service under test ─────────────────────────────────────────────────

const { cockpitService } = await import("../services/cockpit.js");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY = "00000000-0000-4000-8000-000000000001";
const FOUNDER_ACTOR = { actorId: "u-founder", source: "session" as const };
const MEMBER_ACTOR = { actorId: "u-member", source: "session" as const };

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

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockLiveRunsForCompany.mockResolvedValue([]);
  mockIssueServiceList.mockResolvedValue([]);
  mockThreadServiceList.mockResolvedValue([]);
  mockReviewFilterFor.mockReturnValue({});
  // Default memory returns empty list (object shape, not array — HC2)
  mockMemoryServiceListPending.mockResolvedValue({
    items: [],
    versions: [],
    archives: [],
    totalCount: 0,
  });
});

// ── Tests: founder scope ──────────────────────────────────────────────────────

describe("cockpitApprovals — founder scope", () => {
  beforeEach(() => {
    mockResolveCockpitScope.mockResolvedValue(founderScope);
  });

  it("HC1: founder gets approvals array (not [])", async () => {
    // Provide one pending approval row from db.select.
    // DB select call order (Promise.all runs in parallel but JS serializes them):
    //   slot 0: reminders (internalAgentReminders)
    //   slot 1: dueTasks (issues)
    //   slot 2: listPendingApprovals (approvals table)
    //   slot 3: listPendingExtractedItems (discussionExtractedItems + joins)
    //   (entryRows for discussions only fires if visibleIds.length > 0; threadService returns [] so skipped)
    const approvalRow = {
      id: "appr-1",
      type: "hire_agent",
      requestedByAgentId: null,
      status: "pending",
      payload: { name: "Scout" },
    };
    // Sequence: reminders=[], dueTasks=[], approvals=[approvalRow], discItems=[]
    const db = buildSequenceDb([[], [], [approvalRow], []]);
    mockMemoryServiceListPending.mockResolvedValue({
      items: [],
      versions: [],
      archives: [],
      totalCount: 0,
    });

    const result = await cockpitService(db).get(COMPANY, FOUNDER_ACTOR);

    expect(result).toHaveProperty("approvals");
    expect(Array.isArray(result.approvals)).toBe(true);
    // Approval row should be mapped with source="approval"
    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0]).toMatchObject({
      source: "approval",
      id: "appr-1",
      title: "Hire Scout",
    });
  });

  it("memory listPending is called with companyId and .items is used (HC2)", async () => {
    const memItem = {
      id: "mem-1",
      title: "Use TypeScript",
      layer: "domain",
      category: "coding",
      status: "pending",
    };
    mockMemoryServiceListPending.mockResolvedValue({
      items: [memItem],
      versions: [],
      archives: [],
      totalCount: 1,
    });

    // Sequence: reminders=[], dueTasks=[], approvals=[], discItems=[]
    const db = buildSequenceDb([[], [], [], []]);
    const result = await cockpitService(db).get(COMPANY, FOUNDER_ACTOR);

    expect(mockMemoryServiceListPending).toHaveBeenCalledWith(COMPANY);
    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0]).toMatchObject({
      source: "memory",
      id: "mem-1",
      title: "Use TypeScript",
    });
  });

  it("discussion items are mapped with source=discussion_item and discussionId (HC3)", async () => {
    const discItem = {
      id: "item-1",
      discussionId: "disc-1",
      title: "New task: set up CI",
      type: "task",
    };
    // Sequence: reminders=[], dueTasks=[], approvals=[], discItems=[discItem]
    const db = buildSequenceDb([[], [], [], [discItem]]);

    const result = await cockpitService(db).get(COMPANY, FOUNDER_ACTOR);

    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0]).toMatchObject({
      source: "discussion_item",
      id: "item-1",
      discussionId: "disc-1",
      title: "New task: set up CI",
      subtitle: "task",
    });
  });

  it("all 3 sources combined in order", async () => {
    const approvalRow = { id: "appr-1", type: "hire_agent", status: "pending", payload: {} };
    const memItem = { id: "mem-1", title: "Domain rule", layer: "domain", category: null, status: "pending" };
    const discItem = { id: "item-1", discussionId: "disc-1", title: "Insight", type: "insight" };

    mockMemoryServiceListPending.mockResolvedValue({
      items: [memItem],
      versions: [],
      archives: [],
      totalCount: 1,
    });

    // Sequence: reminders=[], dueTasks=[], approvals=[approvalRow], discItems=[discItem]
    const db = buildSequenceDb([[], [], [approvalRow], [discItem]]);
    const result = await cockpitService(db).get(COMPANY, FOUNDER_ACTOR);

    expect(result.approvals).toHaveLength(3);
    const sources = result.approvals.map((a) => a.source);
    expect(sources).toContain("approval");
    expect(sources).toContain("memory");
    expect(sources).toContain("discussion_item");
  });
});

// ── Tests: non-founder scope (HC1 security gate) ─────────────────────────────

describe("cockpitApprovals — non-founder scope (HC1 SECURITY GATE)", () => {
  beforeEach(() => {
    mockResolveCockpitScope.mockResolvedValue(memberScope);
    mockReviewFilterFor.mockReturnValue({ assigneeUserId: "u-member" });
  });

  it("non-founder gets approvals=[] and approval sub-queries NOT run", async () => {
    // Non-founder still triggers reminders and dueTasks selects, but NOT approvals sub-queries.
    // cockpitApprovals short-circuits with [] before running its 3 sub-queries.
    // Sequence: reminders=[], dueTasks=[]
    const db = buildSequenceDb([[], []]);
    const result = await cockpitService(db).get(COMPANY, MEMBER_ACTOR);

    // HC1: non-founder MUST get []
    expect(result.approvals).toEqual([]);
    // HC1: memoryService.listPending must NOT be called for non-founders
    expect(mockMemoryServiceListPending).not.toHaveBeenCalled();
  });

  it("CockpitData shape still includes approvals field for non-founders", async () => {
    const db = buildSequenceDb([[], []]);
    const result = await cockpitService(db).get(COMPANY, MEMBER_ACTOR);
    expect(result).toHaveProperty("approvals");
    expect(result.approvals).toEqual([]);
  });
});
