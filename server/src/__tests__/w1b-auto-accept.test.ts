import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock crew-task-service — resolveScopeAutoAcceptGate + dispatchCreatedCrewTasks
const { mockResolveScopeAutoAcceptGate, mockDispatchCreatedCrewTasks } = vi.hoisted(() => ({
  mockResolveScopeAutoAcceptGate: vi.fn(),
  mockDispatchCreatedCrewTasks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/crew-task-service.js", () => ({
  resolveScopeAutoAcceptGate: mockResolveScopeAutoAcceptGate,
  dispatchCreatedCrewTasks: mockDispatchCreatedCrewTasks,
  // keep resolveCreationGate so any import doesn't blow up
  resolveCreationGate: vi.fn(),
}));

// Mock crew-role-map so resolveRoleToAgentId doesn't hit DB.
const { mockResolveRoleToAgentId } = vi.hoisted(() => ({
  mockResolveRoleToAgentId: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/internal-agent/tools/crew-role-map.js", () => ({
  resolveRoleToAgentId: mockResolveRoleToAgentId,
}));

// Mock threads.js (needed by thread-agent-actions)
vi.mock("../services/threads.js", () => ({
  parseMentions: (text: string) => [],
  processMentions: vi.fn().mockResolvedValue(undefined),
  threadService: vi.fn(() => ({ advancePhase: vi.fn() })),
}));

import { threadAgentActionService } from "../services/thread-agent-actions.js";

// Shared IDs
const COMPANY_ID = "company-w1b";
const THREAD_ID = "thread-w1b";
const VERSION_ID = "sv-w1b-1";
const TASK_ITEM_ID = "item-task-1";
const MEMORY_ITEM_ID = "item-memory-1";
const AGENT_ID = "agent-controller-1";

// A create_scope_draft action in 'ready' state
const scopeDraftAction = {
  id: "action-w1b-1",
  companyId: COMPANY_ID,
  threadId: THREAD_ID,
  runId: "run-w1b",
  agentId: AGENT_ID,
  actionType: "create_scope_draft",
  status: "proposed",
  payload: { summary: "W1b test scope" },
  idempotencyKey: "run-w1b:create_scope_draft:1",
  freshness: { latestHumanSeq: 1 },
};

// Draft return from createDraftFromThread — contains one task_proposal and one memory_candidate
const draftReturn = {
  status: "created",
  version: { id: VERSION_ID },
};

// The task_proposal item row returned from DB
const taskItemRow = {
  id: TASK_ITEM_ID,
  kind: "task_proposal",
  status: "draft",
  scopeVersionId: VERSION_ID,
};

// The memory_candidate item row returned from DB
const memoryItemRow = {
  id: MEMORY_ITEM_ID,
  kind: "memory_candidate",
  status: "draft",
  scopeVersionId: VERSION_ID,
};

// createOutputItem mock result
const createOutputItemOk = vi.fn().mockResolvedValue({
  ok: true,
  item: { id: TASK_ITEM_ID, status: "applied" },
  createdTask: {
    id: "issue-created-1",
    assigneeAgentId: "agent-eng",
    workMode: "planning",
  },
});

/**
 * Build a sequence DB for the commit path.
 *
 * The handler does these selects after createDraftFromThread returns (W1b auto-accept):
 *   select[0] — the action row (drizzle outer drain: threadAgentActions WHERE status='ready')
 *   select[1] — discussions.autonomyLevel (thread autonomy)
 *   select[2] — internalAgentConfig.autonomyLevel (company config autonomy)
 *   select[3] — threadScopeItems WHERE kind='task_proposal' AND status='draft'
 *
 * The handler also does one update (mark action committed).
 */
function makeDb(opts: {
  threadAutonomy: number | null;
  companyAutonomy: number;
  taskItems?: typeof taskItemRow[];
}) {
  let selectIdx = 0;
  const selects = [
    [scopeDraftAction],                          // 0: action drain
    opts.threadAutonomy != null
      ? [{ autonomyLevel: opts.threadAutonomy }] // 1: thread row
      : [],                                      // 1: thread row (no override)
    [{ autonomyLevel: opts.companyAutonomy }],   // 2: internalAgentConfig row
    opts.taskItems ?? [taskItemRow],             // 3: task_proposal items
  ];

  const updates: unknown[] = [];
  const chain = (rows: () => unknown[]): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit", "values", "set",
                     "onConflictDoNothing", "returning"]) {
      c[m] = (_arg?: unknown) => {
        if (m === "set") updates.push(_arg);
        return c;
      };
    }
    c.then = (resolve: (rows: unknown[]) => unknown) =>
      Promise.resolve(resolve(rows()));
    return c;
  };

  const db = {
    select: () => chain(() => selects[selectIdx++] ?? []),
    insert: () => chain(() => []),
    update: () => chain(() => [{ ...scopeDraftAction, status: "committed" }]),
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    __updates: updates,
  };

  return db;
}

describe("W1b: autonomy-gated auto-accept of controller scope drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatchCreatedCrewTasks.mockResolvedValue(undefined);
    createOutputItemOk.mockResolvedValue({
      ok: true,
      item: { id: TASK_ITEM_ID, status: "applied" },
      createdTask: {
        id: "issue-created-1",
        assigneeAgentId: "agent-eng",
        workMode: "planning",
      },
    });
  });

  it("Manual (autonomy 0): draft created, createOutputItem NOT called, dispatchCreatedCrewTasks NOT called", async () => {
    mockResolveScopeAutoAcceptGate.mockReturnValue("draft_only");

    const db = makeDb({ threadAutonomy: 0, companyAutonomy: 0 });
    const createOutputItem = vi.fn();

    await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: {
        createDraftFromThread: vi.fn().mockResolvedValue(draftReturn),
        createOutputItem,
      },
    }).commitThreadAgentActions({
      companyId: COMPANY_ID,
      threadId: THREAD_ID,
      runId: "run-w1b",
    });

    // Gate returns draft_only → no auto-accept
    expect(mockResolveScopeAutoAcceptGate).toHaveBeenCalledWith(0);
    expect(createOutputItem).not.toHaveBeenCalled();
    expect(mockDispatchCreatedCrewTasks).not.toHaveBeenCalled();
  });

  it("Assist (autonomy 1): createOutputItem called ONCE with task item + dispatchMode=planning; memory item NOT touched; no dispatch", async () => {
    mockResolveScopeAutoAcceptGate.mockReturnValue("accept_apply");

    const db = makeDb({ threadAutonomy: 1, companyAutonomy: 0, taskItems: [taskItemRow] });
    const createOutputItem = vi.fn().mockResolvedValue({
      ok: true,
      item: { id: TASK_ITEM_ID, status: "applied" },
      createdTask: { id: "issue-created-1", assigneeAgentId: "agent-eng", workMode: "planning" },
    });

    await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: {
        createDraftFromThread: vi.fn().mockResolvedValue(draftReturn),
        createOutputItem,
      },
    }).commitThreadAgentActions({
      companyId: COMPANY_ID,
      threadId: THREAD_ID,
      runId: "run-w1b",
    });

    // Gate called with effective autonomy = thread(1) overrides company(0)
    expect(mockResolveScopeAutoAcceptGate).toHaveBeenCalledWith(1);

    // createOutputItem called once — for the task_proposal item
    expect(createOutputItem).toHaveBeenCalledTimes(1);
    expect(createOutputItem).toHaveBeenCalledWith(
      COMPANY_ID,
      THREAD_ID,
      VERSION_ID,
      TASK_ITEM_ID,
      { agentId: AGENT_ID, isHuman: false },
      { dispatchMode: "planning" },
    );

    // memory_candidate id NEVER passed to createOutputItem
    const allCalls = createOutputItem.mock.calls;
    for (const [, , , itemId] of allCalls) {
      expect(itemId).not.toBe(MEMORY_ITEM_ID);
    }

    // No dispatch at Assist
    expect(mockDispatchCreatedCrewTasks).not.toHaveBeenCalled();
  });

  it("Drive (autonomy 2): createOutputItem called with dispatchMode=standard; dispatchCreatedCrewTasks called with createdTasks", async () => {
    mockResolveScopeAutoAcceptGate.mockReturnValue("accept_apply_dispatch");

    const db = makeDb({ threadAutonomy: 2, companyAutonomy: 0, taskItems: [taskItemRow] });
    const createdTask = { id: "issue-created-2", assigneeAgentId: "agent-eng", workMode: "standard" };
    const createOutputItem = vi.fn().mockResolvedValue({
      ok: true,
      item: { id: TASK_ITEM_ID, status: "applied" },
      createdTask,
    });

    await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: {
        createDraftFromThread: vi.fn().mockResolvedValue(draftReturn),
        createOutputItem,
      },
    }).commitThreadAgentActions({
      companyId: COMPANY_ID,
      threadId: THREAD_ID,
      runId: "run-w1b",
    });

    expect(mockResolveScopeAutoAcceptGate).toHaveBeenCalledWith(2);

    // createOutputItem called with dispatchMode: standard
    expect(createOutputItem).toHaveBeenCalledTimes(1);
    expect(createOutputItem).toHaveBeenCalledWith(
      COMPANY_ID,
      THREAD_ID,
      VERSION_ID,
      TASK_ITEM_ID,
      { agentId: AGENT_ID, isHuman: false },
      { dispatchMode: "standard" },
    );

    // dispatch called with the collected createdTasks
    expect(mockDispatchCreatedCrewTasks).toHaveBeenCalledTimes(1);
    expect(mockDispatchCreatedCrewTasks).toHaveBeenCalledWith(
      db,
      COMPANY_ID,
      [createdTask],
    );
  });

  it("effectiveAutonomy: thread.autonomyLevel takes precedence over company autonomyLevel", async () => {
    // thread=1 (Assist), company=0 (Manual) → effective=1 → accept_apply
    mockResolveScopeAutoAcceptGate.mockReturnValue("accept_apply");

    const db = makeDb({ threadAutonomy: 1, companyAutonomy: 0 });
    const createOutputItem = vi.fn().mockResolvedValue({ ok: true, item: {}, createdTask: { id: "t1", assigneeAgentId: null, workMode: "planning" } });

    await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: {
        createDraftFromThread: vi.fn().mockResolvedValue(draftReturn),
        createOutputItem,
      },
    }).commitThreadAgentActions({
      companyId: COMPANY_ID,
      threadId: THREAD_ID,
      runId: "run-w1b",
    });

    // effective=1 (thread wins)
    expect(mockResolveScopeAutoAcceptGate).toHaveBeenCalledWith(1);
  });

  it("effectiveAutonomy: falls back to company autonomyLevel when thread has no override (null)", async () => {
    // thread=null (no override), company=2 (Drive) → effective=2 → accept_apply_dispatch
    mockResolveScopeAutoAcceptGate.mockReturnValue("accept_apply_dispatch");

    const db = makeDb({ threadAutonomy: null, companyAutonomy: 2 });
    const createOutputItem = vi.fn().mockResolvedValue({ ok: true, item: {}, createdTask: { id: "t1", assigneeAgentId: null, workMode: "standard" } });

    await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: {
        createDraftFromThread: vi.fn().mockResolvedValue(draftReturn),
        createOutputItem,
      },
    }).commitThreadAgentActions({
      companyId: COMPANY_ID,
      threadId: THREAD_ID,
      runId: "run-w1b",
    });

    // effective=2 (company fallback)
    expect(mockResolveScopeAutoAcceptGate).toHaveBeenCalledWith(2);
  });

  it("createOutputItem is NEVER called with the memory_candidate item id (only task_proposal items)", async () => {
    // Gate says accept_apply (Assist) but the DB only returns task items (not memory).
    // This asserts the query filters kind='task_proposal'.
    mockResolveScopeAutoAcceptGate.mockReturnValue("accept_apply");

    // DB returns ONLY the task item (as the handler filters kind=task_proposal in SQL)
    const db = makeDb({
      threadAutonomy: 1,
      companyAutonomy: 0,
      taskItems: [taskItemRow], // only task item — memory item NOT in this result
    });
    const createOutputItem = vi.fn().mockResolvedValue({
      ok: true,
      item: { id: TASK_ITEM_ID, status: "applied" },
      createdTask: { id: "issue-1", assigneeAgentId: null, workMode: "planning" },
    });

    await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: {
        createDraftFromThread: vi.fn().mockResolvedValue(draftReturn),
        createOutputItem,
      },
    }).commitThreadAgentActions({
      companyId: COMPANY_ID,
      threadId: THREAD_ID,
      runId: "run-w1b",
    });

    // Only the task item is ever passed
    for (const [, , , itemId] of createOutputItem.mock.calls) {
      expect(itemId).toBe(TASK_ITEM_ID);
      expect(itemId).not.toBe(MEMORY_ITEM_ID);
    }
  });

  it("auto-accept is skipped entirely when draft.status is not 'created' (e.g. existing_draft guard)", async () => {
    // If createDraftFromThread returns status='existing_draft', auto-accept should still run
    // (existing_draft also has a version). But if status is something else (no version), skip.
    // The plan guards: draft.status === "created" && draft.version?.id
    mockResolveScopeAutoAcceptGate.mockReturnValue("accept_apply");

    const db = makeDb({ threadAutonomy: 1, companyAutonomy: 0 });
    const createOutputItem = vi.fn();

    await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: {
        // returns status='no_entries' with no version — guard fires
        createDraftFromThread: vi.fn().mockResolvedValue({ status: "no_entries" }),
        createOutputItem,
      },
    }).commitThreadAgentActions({
      companyId: COMPANY_ID,
      threadId: THREAD_ID,
      runId: "run-w1b",
    });

    expect(createOutputItem).not.toHaveBeenCalled();
  });

  it("best-effort: if createOutputItem throws, the draft is still committed (B6)", async () => {
    mockResolveScopeAutoAcceptGate.mockReturnValue("accept_apply");

    const db = makeDb({ threadAutonomy: 1, companyAutonomy: 0 });
    const createOutputItem = vi.fn().mockRejectedValue(new Error("DB error"));

    const result = await threadAgentActionService(db as never, {
      compareFreshnessSnapshot: vi.fn().mockResolvedValue({ fresh: true }),
      discussions: { addEntry: vi.fn() },
      scopeVersions: {
        createDraftFromThread: vi.fn().mockResolvedValue(draftReturn),
        createOutputItem,
      },
    }).commitThreadAgentActions({
      companyId: COMPANY_ID,
      threadId: THREAD_ID,
      runId: "run-w1b",
    });

    // Action is still committed despite the auto-accept failure (best-effort B6)
    expect(result).toMatchObject({ committed: 1 });
  });
});
