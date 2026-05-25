import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: any[]) => args),
  eq: vi.fn((a: any, b: any) => ({ eq: [a, b] })),
  desc: vi.fn((col: any) => ({ desc: col })),
  sql: vi.fn((strings: any, ...values: any[]) => ({
    sql: true,
    strings,
    values,
  })),
  inArray: vi.fn((col: any, vals: any) => ({ inArray: [col, vals] })),
}));

vi.mock("@armyofagents/db", () => ({
  discussions: {
    id: "discussions_id",
    companyId: "discussions_company_id",
    title: "discussions_title",
    status: "discussions_status",
    scopeType: "discussions_scope_type",
    scopeId: "discussions_scope_id",
    tags: "discussions_tags",
    entryCount: "discussions_entry_count",
    entrySeq: "discussions_entry_seq",
    pendingItemCount: "discussions_pending_item_count",
    lastEntryAt: "discussions_last_entry_at",
    createdBy: "discussions_created_by",
    createdAt: "discussions_created_at",
    updatedAt: "discussions_updated_at",
  },
  discussionEntries: {
    id: "entries_id",
    discussionId: "entries_discussion_id",
    inputType: "entries_input_type",
    rawContent: "entries_raw_content",
    title: "entries_title",
    departmentId: "entries_department_id",
    projectId: "entries_project_id",
    goalId: "entries_goal_id",
    parentEntryId: "entries_parent_entry_id",
    sourceInfo: "entries_source_info",
    extractionStatus: "entries_extraction_status",
    extractionRunId: "entries_extraction_run_id",
    seq: "entries_seq",
    createdBy: "entries_created_by",
    createdAt: "entries_created_at",
  },
  discussionExtractedItems: {
    id: "items_id",
    discussionEntryId: "items_discussion_entry_id",
    type: "items_type",
    title: "items_title",
    description: "items_description",
    status: "items_status",
    suggestedPriority: "items_suggested_priority",
    suggestedAssigneeId: "items_suggested_assignee_id",
    suggestedDepartmentId: "items_suggested_department_id",
    suggestedProjectId: "items_suggested_project_id",
    suggestedLayer: "items_suggested_layer",
    suggestedGoalId: "items_suggested_goal_id",
    layer: "items_layer",
    priority: "items_priority",
    dedupAction: "items_dedup_action",
    selectedMemoryId: "items_selected_memory_id",
    mergedContent: "items_merged_content",
    resultTaskId: "items_result_task_id",
    resultMemoryId: "items_result_memory_id",
    conflictsWith: "items_conflicts_with",
    createdAt: "items_created_at",
    updatedAt: "items_updated_at",
  },
  discussionAnnotations: {
    id: "annotations_id",
    discussionEntryId: "annotations_discussion_entry_id",
    content: "annotations_content",
    anchorStart: "annotations_anchor_start",
    anchorEnd: "annotations_anchor_end",
    createdBy: "annotations_created_by",
    createdAt: "annotations_created_at",
    updatedAt: "annotations_updated_at",
  },
  projects: {
    id: "projects_id",
    type: "projects_type",
    companyId: "projects_company_id",
    name: "projects_name",
  },
  goals: {
    id: "goals_id",
  },
}));

vi.mock("../errors.js", () => ({
  badRequest: (msg: string) => {
    const err = new Error(msg);
    (err as any).status = 400;
    return err;
  },
  notFound: (msg: string) => {
    const err = new Error(msg);
    (err as any).status = 404;
    return err;
  },
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: vi.fn(),
}));

vi.mock("../services/issues.js", () => ({
  issueService: vi.fn(() => ({
    create: vi.fn().mockResolvedValue({ id: "task-1" }),
  })),
}));

vi.mock("../services/memory.js", () => ({
  memoryService: vi.fn(() => ({
    create: vi.fn().mockResolvedValue({ id: "mem-1" }),
    findSimilarItems: vi.fn().mockResolvedValue([]),
  })),
}));

import { discussionService } from "../services/discussions.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a mock DB that sequences through select/update/insert results.
 * Also captures the values passed to insert().values() for assertion.
 */
function createCapturingDb(config: {
  selects: any[][];
  updates?: any[][];
  inserts?: any[][];
}) {
  let selectIdx = 0;
  let updateIdx = 0;
  let insertIdx = 0;
  const captured: { insertedEntry?: Record<string, unknown> } = {};

  function makeSelectChain() {
    return {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: vi.fn((fn: (rows: any[]) => any) =>
        Promise.resolve(fn(config.selects[selectIdx++] ?? [])),
      ),
    };
  }

  function makeUpdateChain() {
    return {
      set: vi.fn().mockReturnThis(),
      where: vi.fn(() => ({
        returning: vi.fn().mockReturnThis(),
        then: vi.fn((fn: (rows: any[]) => any) =>
          Promise.resolve(fn((config.updates ?? [])[updateIdx++] ?? [])),
        ),
      })),
    };
  }

  function makeInsertChain(captureValues: boolean) {
    const idx = insertIdx++;
    return {
      values: vi.fn((v: Record<string, unknown>) => {
        if (captureValues) captured.insertedEntry = v;
        return {
          returning: vi.fn().mockReturnThis(),
          then: vi.fn((fn: (rows: any[]) => any) =>
            Promise.resolve(fn((config.inserts ?? [])[idx] ?? [])),
          ),
        };
      }),
    };
  }

  const db: any = {
    select: vi.fn(() => makeSelectChain()),
    update: vi.fn(() => makeUpdateChain()),
    insert: vi.fn(() => makeInsertChain(false)),
    delete: vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    })),
    transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
      const tx: any = {
        select: vi.fn(() => makeSelectChain()),
        update: vi.fn(() => makeUpdateChain()),
        insert: vi.fn(() => makeInsertChain(true)),
        delete: vi.fn(() => ({
          where: vi.fn().mockResolvedValue(undefined),
        })),
      };
      return fn(tx);
    }),
  };

  return { db, captured };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("discussionService.addEntry — parentEntryId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets parentEntryId when a valid same-discussion parent is given", async () => {
    const { db, captured } = createCapturingDb({
      selects: [
        // 1. select discussion → found
        [{ id: "disc-1", companyId: "co" }],
        // 2. select parent entry → found in same discussion
        [{ id: "entry-parent" }],
      ],
      updates: [
        // tx.update discussions → returns new entrySeq
        [{ entrySeq: 5 }],
      ],
      inserts: [
        // tx.insert entry → returned row
        [{ id: "entry-new", seq: 5, parentEntryId: "entry-parent" }],
      ],
    });

    await discussionService(db).addEntry(
      "co",
      "disc-1",
      { rawContent: "a reply", inputType: "write", parentEntryId: "entry-parent" },
      "user:1",
    );

    expect(captured.insertedEntry?.parentEntryId).toBe("entry-parent");
  });

  it("rejects a parentEntryId that is not in the same discussion", async () => {
    const { db } = createCapturingDb({
      selects: [
        // 1. select discussion → found
        [{ id: "disc-1", companyId: "co" }],
        // 2. select parent entry → NOT found (different discussion or missing)
        [],
      ],
    });

    await expect(
      discussionService(db).addEntry(
        "co",
        "disc-1",
        { rawContent: "x", inputType: "write", parentEntryId: "foreign" },
        "user:1",
      ),
    ).rejects.toThrow(/same discussion/i);
  });

  it("leaves parentEntryId null for a normal top-level entry", async () => {
    const { db, captured } = createCapturingDb({
      selects: [
        // 1. select discussion → found (no parent lookup needed)
        [{ id: "disc-1", companyId: "co" }],
      ],
      updates: [
        // tx.update discussions → returns new entrySeq
        [{ entrySeq: 1 }],
      ],
      inserts: [
        // tx.insert entry → returned row
        [{ id: "entry-new", seq: 1 }],
      ],
    });

    await discussionService(db).addEntry(
      "co",
      "disc-1",
      { rawContent: "hello", inputType: "write" },
      "user:1",
    );

    expect(captured.insertedEntry?.parentEntryId ?? null).toBeNull();
  });
});
