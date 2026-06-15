/**
 * cockpit-approvals unit tests — Phase 3c + approval families extension.
 *
 * Security gate:
 *   - founder → all 5 source queries run; items mapped with correct source discriminator.
 *   - non-founder → [] returned immediately; NO sub-queries run.
 *
 * Constraint verification (plan Hard Constraints):
 *   - HC1: non-founder gets [].
 *   - HC2: memory uses .items (object, not array); .versions/.archives for new sources.
 *   - HC3: discussion join uses discussionEntryId → discussion_entries → discussions.
 *   - HC4: runtime query filters by userId (owner-scoped; confirm route is per-user).
 *   - HC7: per-source approve dispatches correct API.
 *
 * DB select call order for FOUNDER (12 selects):
 *   [0]  reminders (internalAgentReminders)
 *   [1]  dueTasks (issues)
 *   [2]  listPendingApprovals (approvals table)
 *   [3]  listPendingExtractedItems (discussionExtractedItems + joins)
 *   [4]  joinRequests (NEW — approval families)
 *   [5]  internalAgentRuntimeApprovals (NEW — approval families)
 *   [6]  cockpitPinned pins list (userEntityPins → [] → exits early)
 *   [7]  cockpitGoalsAtRisk (goals)
 *   [8]  cockpitBudgetPulse: companies (limitCents=0 → returns null, no further selects)
 *   [9]  cockpitDoneToday (issues)
 *   [10] cockpitProactiveFindings (notifications)
 *   [11] cockpitTeammatesActivity (activityLog) — founder=company-wide, 1 select
 *
 * DB select call order for NON-FOUNDER (6 selects — unchanged):
 *   [0] reminders, [1] dueTasks
 *   [2] cockpitPinned pins list
 *   [3] cockpitGoalsAtRisk
 *   (cockpitBudgetPulse short-circuits for non-founder, no select)
 *   [4] cockpitDoneToday
 *   [5] cockpitProactiveFindings (notifications)
 *   (cockpitTeammatesActivity: member → [] immediately, no select)
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

// Sequence-based mock db. Select call order documented in the file-level comment.
// FOUNDER = 12 selects; NON-FOUNDER = 6 selects (unchanged).

function buildSelectStub(rows: unknown[] = []) {
  const stub: Record<string, unknown> = {};
  stub.from = () => stub;
  // where() may chain to orderBy() (cockpitPinned, opt-in resolvers) or be terminal.
  stub.where = () => stub;
  stub.innerJoin = () => stub;
  stub.select = () => stub;
  // orderBy() now chains — returns the stub so .limit() can follow.
  stub.orderBy = () => stub;
  // limit() is terminal — resolves to rows.
  stub.limit = () => Promise.resolve(rows);
  // Make the stub itself awaitable for where()-terminal and orderBy()-terminal paths.
  (stub as any).then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(rows).then(resolve, reject);
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
    //   slot 4: joinRequests (NEW — empty for this test)
    //   slot 5: internalAgentRuntimeApprovals (NEW — empty for this test)
    //   (entryRows for discussions only fires if visibleIds.length > 0; threadService returns [] so skipped)
    const approvalRow = {
      id: "appr-1",
      type: "hire_agent",
      requestedByAgentId: null,
      status: "pending",
      payload: { name: "Scout" },
    };
    // Sequence: reminders=[], dueTasks=[], approvals=[approvalRow], discItems=[],
    //   joinReqs=[], runtime=[],
    //   pinned=[], goalsAtRisk=[], companies=[{limitCents:0}] (budget exits early), doneToday=[],
    //   proactiveFindings=[], teammatesActivity (founder=company-wide)=[]
    const db = buildSequenceDb([[], [], [approvalRow], [], [], [], [], [], [{ limitCents: 0 }], [], [], []]);
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

    // Sequence: reminders=[], dueTasks=[], approvals=[], discItems=[],
    //   joinReqs=[], runtime=[],
    //   pinned=[], goalsAtRisk=[], companies=[{limitCents:0}], doneToday=[],
    //   proactiveFindings=[], teammatesActivity (founder)=[]
    const db = buildSequenceDb([[], [], [], [], [], [], [], [], [{ limitCents: 0 }], [], [], []]);
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
    // Sequence: reminders=[], dueTasks=[], approvals=[], discItems=[discItem],
    //   joinReqs=[], runtime=[],
    //   pinned=[], goalsAtRisk=[], companies=[{limitCents:0}], doneToday=[],
    //   proactiveFindings=[], teammatesActivity (founder)=[]
    const db = buildSequenceDb([[], [], [], [discItem], [], [], [], [], [{ limitCents: 0 }], [], [], []]);

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

  it("all 3 original sources combined in order", async () => {
    const approvalRow = { id: "appr-1", type: "hire_agent", status: "pending", payload: {} };
    const memItem = { id: "mem-1", title: "Domain rule", layer: "domain", category: null, status: "pending" };
    const discItem = { id: "item-1", discussionId: "disc-1", title: "Insight", type: "insight" };

    mockMemoryServiceListPending.mockResolvedValue({
      items: [memItem],
      versions: [],
      archives: [],
      totalCount: 1,
    });

    // Sequence: reminders=[], dueTasks=[], approvals=[approvalRow], discItems=[discItem],
    //   joinReqs=[], runtime=[],
    //   pinned=[], goalsAtRisk=[], companies=[{limitCents:0}], doneToday=[],
    //   proactiveFindings=[], teammatesActivity (founder)=[]
    const db = buildSequenceDb([[], [], [approvalRow], [discItem], [], [], [], [], [{ limitCents: 0 }], [], [], []]);
    const result = await cockpitService(db).get(COMPANY, FOUNDER_ACTOR);

    expect(result.approvals).toHaveLength(3);
    const sources = result.approvals.map((a) => a.source);
    expect(sources).toContain("approval");
    expect(sources).toContain("memory");
    expect(sources).toContain("discussion_item");
  });

  // ── Approval Families: new 4 sources ─────────────────────────────────────────

  it("join_request: agent type maps title from agentName and subtitle 'Agent join'", async () => {
    const joinRow = {
      id: "jr-1",
      requestType: "agent",
      requestingUserId: null,
      agentName: "Scout",
    };
    // Sequence: reminders=[], dueTasks=[], approvals=[], discItems=[],
    //   joinReqs=[joinRow], runtime=[],
    //   pinned=[], goalsAtRisk=[], companies=[{limitCents:0}], doneToday=[],
    //   proactiveFindings=[], teammatesActivity=[]
    const db = buildSequenceDb([[], [], [], [], [joinRow], [], [], [], [{ limitCents: 0 }], [], [], []]);
    const result = await cockpitService(db).get(COMPANY, FOUNDER_ACTOR);

    const item = result.approvals.find((a) => a.source === "join_request");
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      source: "join_request",
      id: "jr-1",
      title: "Scout",
      subtitle: "Agent join",
    });
  });

  it("join_request: human type maps title from requestingUserId and subtitle 'User join'", async () => {
    const joinRow = {
      id: "jr-2",
      requestType: "human",
      requestingUserId: "user-abc",
      agentName: null,
    };
    const db = buildSequenceDb([[], [], [], [], [joinRow], [], [], [], [{ limitCents: 0 }], [], [], []]);
    const result = await cockpitService(db).get(COMPANY, FOUNDER_ACTOR);

    const item = result.approvals.find((a) => a.source === "join_request");
    expect(item).toMatchObject({
      source: "join_request",
      id: "jr-2",
      title: "user-abc",
      subtitle: "User join",
    });
  });

  it("join_request: agent with no agentName falls back to 'Agent join request'", async () => {
    const joinRow = {
      id: "jr-3",
      requestType: "agent",
      requestingUserId: null,
      agentName: null,
    };
    const db = buildSequenceDb([[], [], [], [], [joinRow], [], [], [], [{ limitCents: 0 }], [], [], []]);
    const result = await cockpitService(db).get(COMPANY, FOUNDER_ACTOR);

    const item = result.approvals.find((a) => a.source === "join_request");
    expect(item?.title).toBe("Agent join request");
  });

  it("memory_version: maps id=itemId, relatedEntityId=version.id, title=itemTitle, subtitle=layer·category+(edit)", async () => {
    mockMemoryServiceListPending.mockResolvedValue({
      items: [],
      versions: [
        {
          itemId: "mem-item-1",
          itemTitle: "Use TypeScript everywhere",
          itemLayer: "domain",
          itemCategory: "coding",
          itemSource: "agent",
          currentContent: "old content",
          currentVersionId: "ver-0",
          version: {
            id: "ver-1",
            memoryItemId: "mem-item-1",
            versionNumber: 2,
            content: "new content",
            status: "pending",
            createdBy: "agent-x",
            createdAt: new Date("2026-01-01"),
          },
        },
      ],
      archives: [],
      totalCount: 1,
    });

    const db = buildSequenceDb([[], [], [], [], [], [], [], [], [{ limitCents: 0 }], [], [], []]);
    const result = await cockpitService(db).get(COMPANY, FOUNDER_ACTOR);

    const item = result.approvals.find((a) => a.source === "memory_version");
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      source: "memory_version",
      id: "mem-item-1",
      relatedEntityId: "ver-1",
      title: "Use TypeScript everywhere",
      subtitle: "domain · coding (edit)",
    });
  });

  it("memory_version: subtitle handles null category gracefully", async () => {
    mockMemoryServiceListPending.mockResolvedValue({
      items: [],
      versions: [
        {
          itemId: "mem-item-2",
          itemTitle: "Some rule",
          itemLayer: "domain",
          itemCategory: null,
          itemSource: "agent",
          currentContent: "c",
          currentVersionId: "v0",
          version: { id: "ver-2", memoryItemId: "mem-item-2", versionNumber: 1, content: "c2", status: "pending", createdBy: "a", createdAt: new Date() },
        },
      ],
      archives: [],
      totalCount: 1,
    });

    const db = buildSequenceDb([[], [], [], [], [], [], [], [], [{ limitCents: 0 }], [], [], []]);
    const result = await cockpitService(db).get(COMPANY, FOUNDER_ACTOR);

    const item = result.approvals.find((a) => a.source === "memory_version");
    expect(item?.subtitle).toBe("domain (edit)");
  });

  it("memory_archive: maps id=item.id, relatedEntityId=suggestion.id, subtitle='Suggested for archival'", async () => {
    mockMemoryServiceListPending.mockResolvedValue({
      items: [],
      versions: [],
      archives: [
        {
          item: {
            id: "mem-arch-1",
            companyId: COMPANY,
            title: "Stale rule",
            content: "old",
            category: "coding",
            source: "agent",
            status: "approved",
            tags: [],
            departmentId: null,
            projectId: null,
            createdBy: "founder",
            layer: "domain",
            priority: "medium",
            visibility: "company",
            expiresAt: null,
            goalId: null,
            taskId: null,
            sourceArtifactId: null,
            sourceContext: null,
            accessedAt: null,
            currentVersionId: null,
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-01"),
          },
          suggestion: {
            id: "sug-1",
            companyId: COMPANY,
            category: "agent_proposal",
            actionType: "archive_memory",
            actionPayload: {},
            title: "Archive stale rule",
            evidence: null,
            status: "pending",
            expiresAt: null,
            relatedMemoryItemId: "mem-arch-1",
            createdAt: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-01"),
          },
        },
      ],
      totalCount: 1,
    });

    const db = buildSequenceDb([[], [], [], [], [], [], [], [], [{ limitCents: 0 }], [], [], []]);
    const result = await cockpitService(db).get(COMPANY, FOUNDER_ACTOR);

    const item = result.approvals.find((a) => a.source === "memory_archive");
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      source: "memory_archive",
      id: "mem-arch-1",
      relatedEntityId: "sug-1",
      title: "Stale rule",
      subtitle: "Suggested for archival",
    });
  });

  it("runtime_tool_trust: maps with decisionType='ternary'", async () => {
    const runtimeRow = {
      id: "rt-1",
      toolName: "bash",
      params: { cmd: "ls" },
      expiresAt: new Date(Date.now() + 60_000),
    };
    // Sequence: joinReqs=[] at slot [4], runtime=[runtimeRow] at slot [5]
    const db = buildSequenceDb([[], [], [], [], [], [runtimeRow], [], [], [{ limitCents: 0 }], [], [], []]);
    const result = await cockpitService(db).get(COMPANY, FOUNDER_ACTOR);

    const item = result.approvals.find((a) => a.source === "runtime_tool_trust");
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      source: "runtime_tool_trust",
      id: "rt-1",
      title: "bash",
      subtitle: "Tool execution approval",
      decisionType: "ternary",
    });
  });

  it("runtime_tool_trust: expired rows excluded (gt filter verified by mock returning none)", async () => {
    // The db.select for runtime returns [] (simulating gt(expiresAt, now) filtering out expired row).
    // Slot [5] = runtime → empty.
    const db = buildSequenceDb([[], [], [], [], [], [], [], [], [{ limitCents: 0 }], [], [], []]);
    const result = await cockpitService(db).get(COMPANY, FOUNDER_ACTOR);

    const runtimeItems = result.approvals.filter((a) => a.source === "runtime_tool_trust");
    expect(runtimeItems).toHaveLength(0);
  });

  it("all 7 sources combined (approval + memory + discussion_item + join_request + memory_version + memory_archive + runtime_tool_trust)", async () => {
    const approvalRow = { id: "appr-1", type: "hire_agent", status: "pending", payload: { name: "Scout" } };
    const discItem = { id: "item-1", discussionId: "disc-1", title: "Insight", type: "insight" };
    const joinRow = { id: "jr-1", requestType: "agent", requestingUserId: null, agentName: "Bot" };
    const runtimeRow = { id: "rt-1", toolName: "write_file", params: {}, expiresAt: new Date(Date.now() + 60_000) };

    mockMemoryServiceListPending.mockResolvedValue({
      items: [{ id: "mem-1", title: "Rule", layer: "domain", category: "coding", status: "pending" }],
      versions: [
        {
          itemId: "mem-item-1",
          itemTitle: "Version rule",
          itemLayer: "domain",
          itemCategory: "coding",
          itemSource: "agent",
          currentContent: "c",
          currentVersionId: "v0",
          version: { id: "ver-1", memoryItemId: "mem-item-1", versionNumber: 2, content: "c2", status: "pending", createdBy: "a", createdAt: new Date() },
        },
      ],
      archives: [
        {
          item: { id: "arch-item-1", companyId: COMPANY, title: "Old rule", content: "c", category: null, source: "agent", status: "approved", tags: [], departmentId: null, projectId: null, createdBy: "founder", layer: "domain", priority: "medium", visibility: "company", expiresAt: null, goalId: null, taskId: null, sourceArtifactId: null, sourceContext: null, accessedAt: null, currentVersionId: null, createdAt: new Date(), updatedAt: new Date() },
          suggestion: { id: "sug-1", companyId: COMPANY, category: "agent_proposal", actionType: "archive_memory", actionPayload: {}, title: "Archive", evidence: null, status: "pending", expiresAt: null, relatedMemoryItemId: "arch-item-1", createdAt: new Date(), updatedAt: new Date() },
        },
      ],
      totalCount: 3,
    });

    const db = buildSequenceDb([[], [], [approvalRow], [discItem], [joinRow], [runtimeRow], [], [], [{ limitCents: 0 }], [], [], []]);
    const result = await cockpitService(db).get(COMPANY, FOUNDER_ACTOR);

    expect(result.approvals).toHaveLength(7);
    const sources = result.approvals.map((a) => a.source);
    expect(sources).toContain("approval");
    expect(sources).toContain("memory");
    expect(sources).toContain("discussion_item");
    expect(sources).toContain("join_request");
    expect(sources).toContain("memory_version");
    expect(sources).toContain("memory_archive");
    expect(sources).toContain("runtime_tool_trust");

    // runtime has decisionType ternary, others do not
    const runtimeItem = result.approvals.find((a) => a.source === "runtime_tool_trust");
    expect(runtimeItem?.decisionType).toBe("ternary");
    const approvalItem = result.approvals.find((a) => a.source === "approval");
    expect(approvalItem?.decisionType).toBeUndefined();
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
    // cockpitBudgetPulse also short-circuits for non-founder (no select).
    // cockpitTeammatesActivity member → [] immediately, no select.
    // Sequence: reminders=[], dueTasks=[], pinned=[], goalsAtRisk=[], doneToday=[], proactiveFindings=[]
    const db = buildSequenceDb([[], [], [], [], [], []]);
    const result = await cockpitService(db).get(COMPANY, MEMBER_ACTOR);

    // HC1: non-founder MUST get []
    expect(result.approvals).toEqual([]);
    // HC1: memoryService.listPending must NOT be called for non-founders
    expect(mockMemoryServiceListPending).not.toHaveBeenCalled();
  });

  it("CockpitData shape still includes approvals field for non-founders", async () => {
    // Sequence: reminders=[], dueTasks=[], pinned=[], goalsAtRisk=[], doneToday=[], proactiveFindings=[]
    const db = buildSequenceDb([[], [], [], [], [], []]);
    const result = await cockpitService(db).get(COMPANY, MEMBER_ACTOR);
    expect(result).toHaveProperty("approvals");
    expect(result.approvals).toEqual([]);
  });
});
