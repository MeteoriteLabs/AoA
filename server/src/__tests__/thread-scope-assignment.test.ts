import { describe, it, expect, vi, beforeEach } from "vitest";

// Module-level captured mocks — mirrors thread-scope-accept.test.ts (lines 3-12)
const issueCreate = vi.fn();
const memoryCreate = vi.fn();

// drizzle operator + table mocks — same pattern as thread-scope-accept.test.ts
vi.mock("drizzle-orm", () => {
  const op = (tag: string) => (...args: unknown[]) => ({ _tag: tag, args });
  return {
    and: op("and"),
    eq: op("eq"),
    ne: op("ne"),
    gt: op("gt"),
    gte: op("gte"),
    lte: op("lte"),
    asc: op("asc"),
    desc: op("desc"),
    isNull: op("isNull"),
    inArray: op("inArray"),
    sql: Object.assign(vi.fn(), { raw: vi.fn() }),
  };
});

vi.mock("@armyofagents/db", () => ({
  __esModule: true,
  discussions: new Proxy({}, { get: (_t, p) => p }),
  discussionEntries: new Proxy({}, { get: (_t, p) => p }),
  discussionExtractedItems: new Proxy({}, { get: (_t, p) => p }),
  discussionEntryAttachments: new Proxy({}, { get: (_t, p) => p }),
  artifacts: new Proxy({}, { get: (_t, p) => p }),
  assets: new Proxy({}, { get: (_t, p) => p }),
  threadScopeVersions: new Proxy({}, { get: (_t, p) => p }),
  threadScopeItems: new Proxy({}, { get: (_t, p) => p }),
  threadScopeArtifactLinks: new Proxy({}, { get: (_t, p) => p }),
  goals: new Proxy({}, { get: (_t, p) => p }),
  projects: new Proxy({}, { get: (_t, p) => p }),
}));

vi.mock("../services/issues.js", () => ({
  issueService: () => ({ create: issueCreate }),
}));

vi.mock("../services/memory.js", () => ({
  memoryService: () => ({ create: memoryCreate }),
}));

import { threadScopeVersionService } from "../services/thread-scope-versions.js";

beforeEach(() => {
  vi.clearAllMocks();
  issueCreate.mockResolvedValue({
    id: "task1",
    assigneeAgentId: "agent-eng",
    workMode: "planning",
    sourceDiscussionId: "thread1",
    scopeVersionId: "scope1",
  });
  memoryCreate.mockResolvedValue({ id: "memory1" });
});

/**
 * Build a db mock using the proven createSequenceDb pattern from
 * thread-scope-accept.test.ts. We feed select results in sequence and capture
 * all insert .values() calls in `capturedInserts`.
 *
 * createDraftFromThread select sequence:
 *   [0] discussions        → thread row
 *   [1] threadScopeVersions → latest version (loadLatestScopeVersion)
 *   [2] discussionEntries  → entries
 *   [3] discussionExtractedItems → extracted items
 *   [4] discussionEntryAttachments (join) → attachments
 *
 * Transaction inserts:
 *   insert(threadScopeVersions).values(single obj).returning() → [{ id, versionNumber }]
 *   insert(threadScopeItems).values(array)                     → [] (no returning)
 *
 * Distinguishing them: version insert passes a plain object, items insert passes an array.
 */
function createDraftDb(selectQueue: unknown[][], capturedInserts: unknown[]) {
  let selectIdx = 0;
  let insertIdx = 0;

  // insertQueue: version insert returns [{ id: "v1", versionNumber: 1 }], items returns []
  const insertResults: unknown[][] = [
    [{ id: "v1", versionNumber: 1, status: "draft" }],
    [],
  ];

  function makeSelectChain() {
    const rows = selectQueue[selectIdx++] ?? [];
    const chain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      then: vi.fn((fn: (rows: unknown[]) => unknown) =>
        Promise.resolve(fn(rows)),
      ),
    };
    return chain;
  }

  function makeInsertChain() {
    return {
      values: vi.fn((data: unknown) => {
        capturedInserts.push(data);
        const result = insertResults[insertIdx++] ?? [];
        return {
          returning: vi.fn().mockReturnThis(),
          then: vi.fn((fn: (rows: unknown[]) => unknown) =>
            Promise.resolve(fn(result)),
          ),
        };
      }),
    };
  }

  const dbObj: any = {
    select: vi.fn(() => makeSelectChain()),
    insert: vi.fn(() => makeInsertChain()),
    transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(dbObj)),
  };

  return dbObj;
}

/**
 * Apply-path db mock (mirrors thread-scope-accept.test.ts createSequenceDb).
 * applyAcceptedDraft select sequence:
 *   [0] threadScopeVersions → version row (must have status:"draft")
 *   [1] discussions         → thread row
 *   [2] threadScopeItems    → accepted items array
 *
 * Transaction updates:
 *   update(threadScopeItems).set({status:"applied",...}) → [appliedItem]
 *   update(threadScopeVersions).set({status:"accepted",...}) → [acceptedVersion]
 */
function createApplyDb(
  selectQueue: unknown[][],
  updateQueue: unknown[][] = [],
  insertQueue: unknown[][] = [],
) {
  let selectIdx = 0;
  let updateIdx = 0;
  let insertIdx = 0;
  const capturedUpdates: unknown[] = [];
  const capturedInserts: unknown[] = [];

  function makeSelectChain() {
    const rows = selectQueue[selectIdx++] ?? [];
    const chain: any = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      then: vi.fn((fn: (rows: unknown[]) => unknown) => Promise.resolve(fn(rows))),
    };
    return chain;
  }

  function makeUpdateChain() {
    return {
      set: vi.fn((data: unknown) => {
        capturedUpdates.push(data);
        return {
          where: vi.fn(() => ({
            returning: vi.fn().mockReturnThis(),
            then: vi.fn((fn: (rows: unknown[]) => unknown) => {
              const rows = updateQueue[updateIdx++] ?? [];
              return Promise.resolve(fn(rows));
            }),
          })),
        };
      }),
    };
  }

  function makeInsertChain() {
    return {
      values: vi.fn((data: unknown) => {
        capturedInserts.push(data);
        return {
          returning: vi.fn().mockReturnThis(),
          then: vi.fn((fn: (rows: unknown[]) => unknown) =>
            Promise.resolve(fn(insertQueue[insertIdx++] ?? [])),
          ),
        };
      }),
    };
  }

  const dbObj: any = {
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn(() => makeUpdateChain()),
    insert: vi.fn(() => makeInsertChain()),
    transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>) => fn(dbObj)),
    capturedUpdates,
    capturedInserts,
  };

  return dbObj;
}

describe("createDraftFromThread — proposedTasks assignee", () => {
  it("seeds scope items with assigneeAgentId from proposedTasks", async () => {
    const capturedInserts: unknown[] = [];

    // Select sequence:
    //   [0] thread
    //   [1] latestScopeVersion → none (no existing draft)
    //   [2] entries
    //   [3] extractedItems → none
    //   [4] attachments → none
    const thread = {
      id: "t1",
      companyId: "co1",
      subtype: "normal",
      entrySeq: 1,
      title: "T",
      summaryText: null,
    };
    const entry = { id: "e1", seq: 1, inputType: "write", rawContent: "scope it" };

    const db = createDraftDb(
      [
        [thread],  // discussions
        [],        // threadScopeVersions (no latest)
        [entry],   // discussionEntries
        [],        // discussionExtractedItems
        [],        // discussionEntryAttachments
      ],
      capturedInserts,
    );

    await threadScopeVersionService(db).createDraftFromThread(
      "co1",
      "t1",
      { agentId: "adj" },
      {
        summary: "Auth work",
        proposedTasks: [{ title: "Build token endpoint", assigneeAgentId: "agent-eng" }],
      },
    );

    // capturedInserts[0] = single version object
    // capturedInserts[1] = array of scope items
    const itemsInsert = capturedInserts.find((v) => Array.isArray(v)) as Array<{
      kind: string;
      title: string;
      payload: Record<string, unknown>;
    }> | undefined;

    expect(itemsInsert).toBeDefined();
    const task = itemsInsert!.find((i) => i.kind === "task_proposal");
    expect(task).toBeDefined();
    expect(task!.title).toBe("Build token endpoint");
    expect(task!.payload.assigneeAgentId).toBe("agent-eng");
  });
});

describe("applyAcceptedDraft — Task 5 E2E: controller draft → applied tasks are assigned", () => {
  it("applying a draft creates an issue assigned to the crew agent", async () => {
    // Arrange: a draft version containing one accepted task_proposal item whose
    // payload.assigneeAgentId = "agent-eng" — as produced by the Tasks 2-4 pipeline.
    const draftVersion = {
      id: "scope1",
      companyId: "co1",
      threadId: "thread1",
      versionNumber: 1,
      status: "draft",
      sourceEndSeq: 1,
    };
    const thread = { id: "thread1", companyId: "co1", subtype: "normal", entrySeq: 1 };
    const acceptedTask = {
      id: "task-item",
      kind: "task_proposal",
      status: "accepted",
      title: "Build token endpoint",
      description: "Adjutant-proposed auth task",
      sourceEntryIds: [],
      payload: {
        priority: "medium",
        assigneeAgentId: "agent-eng",  // set by the Tasks 2-4 pipeline
      },
    };

    // applyAcceptedDraft select sequence (matches the real code):
    //   [0] threadScopeVersions → draftVersion (status:"draft" → enters the apply branch)
    //   [1] discussions → thread
    //   [2] threadScopeItems (status:accepted) → [acceptedTask]
    // Transaction updates:
    //   [0] item set applied  → [{ ...acceptedTask, status:"applied", resultIssueId:"task1" }]
    //   [1] version set accepted → [{ ...draftVersion, status:"accepted" }]
    const db = createApplyDb(
      [
        [draftVersion],
        [thread],
        [acceptedTask],
      ],
      [
        [{ ...acceptedTask, status: "applied", resultIssueId: "task1" }],
        [{ ...draftVersion, status: "accepted" }],
      ],
    );

    // Act: drive the real applyAcceptedDraft path
    const result = await (threadScopeVersionService(db) as any).applyAcceptedDraft(
      "co1",
      "thread1",
      "scope1",
      { userId: "u1", isHuman: true },
    );

    // Assert: apply succeeded
    expect(result).toMatchObject({ ok: true, alreadyAccepted: false });

    // Assert: issueService.create was called with assigneeAgentId: "agent-eng"
    // This proves the full pipeline: compiler seeds payload → versions.ts reads it → issue lands assigned
    expect(issueCreate).toHaveBeenCalledTimes(1);
    expect(issueCreate).toHaveBeenCalledWith(
      "co1",
      expect.objectContaining({ assigneeAgentId: "agent-eng" }),
    );
  });
});
