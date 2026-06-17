import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: "eq", a, b })),
  and: vi.fn((...args: unknown[]) => ({ op: "and", args })),
  gt: vi.fn((a: unknown, b: unknown) => ({ op: "gt", a, b })),
  asc: vi.fn((col: unknown) => ({ op: "asc", col })),
  sql: Object.assign(
    vi.fn(() => ({ as: vi.fn().mockReturnThis(), mapWith: vi.fn().mockReturnThis() })),
    { raw: vi.fn((s: unknown) => s), placeholder: vi.fn((s: unknown) => s) },
  ),
}));

function tableProxy(name: string) {
  return new Proxy({}, { get: (_target, prop) => `${name}.${String(prop)}` });
}

vi.mock("@armyofagents/db", () => ({
  threadOrchestrationState: tableProxy("tos"),
  discussionEntries: tableProxy("de"),
  discussions: tableProxy("discussions"),
}));

vi.mock("../services/crew-budget.js", () => ({
  preflightCrewDispatch: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

const { commitThreadAgentActionsMock } = vi.hoisted(() => ({
  commitThreadAgentActionsMock: vi.fn().mockResolvedValue({
    committed: 0,
    suppressed: 0,
    blocked: 0,
    failed: 0,
  }),
}));

vi.mock("../services/thread-agent-actions.js", () => ({
  threadAgentActionService: vi.fn(() => ({
    commitThreadAgentActions: commitThreadAgentActionsMock,
  })),
}));

import { threadOrchestrationService } from "../services/thread-orchestration.js";

type ControllerState = {
  threadId: string;
  runEpoch: number;
  pendingRun: boolean;
  lastProcessedEntryId: string | null;
  lastError: string | null;
};

type EntryRow = {
  id: string;
  discussionId: string;
  seq: number;
  createdAt: Date;
  inputType: string;
  rawContent: string;
};

function createControllerDb(controller: ControllerState, entries: EntryRow[]) {
  const cursorCommits: string[] = [];

  const db = {
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        const isClaim = "pendingRun" in payload && !("lastProcessedEntryId" in payload);
        return {
          where: vi.fn(() => {
            if (isClaim) {
              return {
                returning: vi.fn(async () => {
                  if (!controller.pendingRun) return [];
                  controller.pendingRun = false;
                  return [{ ...controller }];
                }),
              };
            }
            if ("lastProcessedEntryId" in payload) {
              controller.lastProcessedEntryId = payload.lastProcessedEntryId as string | null;
              if (controller.lastProcessedEntryId) cursorCommits.push(controller.lastProcessedEntryId);
            }
            if ("lastError" in payload) {
              controller.lastError = payload.lastError as string | null;
            }
            return Promise.resolve([{ ...controller }]);
          }),
        };
      }),
    })),
    select: vi.fn((projection?: unknown) => ({
      from: vi.fn((table: unknown) => {
        const tableName = String((table as Record<string, unknown>).id ?? table);
        return {
          where: vi.fn(() => {
            if (tableName.startsWith("discussions.")) {
              return { limit: vi.fn(async () => [{ companyId: "company-1" }]) };
            }
            if (tableName.startsWith("tos.")) {
              return Promise.resolve([{ runEpoch: controller.runEpoch }]);
            }
            if (tableName.startsWith("de.") && projection) {
              const cursor = entries.find((entry) => entry.id === controller.lastProcessedEntryId);
              return Promise.resolve(cursor ? [{ seq: cursor.seq }] : []);
            }
            return {
              orderBy: vi.fn(async () => {
                const cursor = entries.find((entry) => entry.id === controller.lastProcessedEntryId);
                const cursorSeq = cursor?.seq ?? 0;
                return entries.filter((entry) => entry.seq > cursorSeq);
              }),
            };
          }),
        };
      }),
    })),
  };

  return { db: db as never, cursorCommits };
}

describe("runController action gate integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits proposed thread actions before advancing the cursor on a fresh run", async () => {
    const threadId = "thread-action-gate-fresh";
    const controller: ControllerState = {
      threadId,
      runEpoch: 1,
      pendingRun: true,
      lastProcessedEntryId: null,
      lastError: null,
    };
    const entry: EntryRow = {
      id: "entry-a",
      discussionId: threadId,
      seq: 1,
      createdAt: new Date("2026-06-15T10:00:00Z"),
      inputType: "write",
      rawContent: "Please help scope this.",
    };
    const { db, cursorCommits } = createControllerDb(controller, [entry]);
    const order: string[] = [];
    commitThreadAgentActionsMock.mockImplementationOnce(async () => {
      order.push("action-gate");
      return { committed: 1, suppressed: 0, blocked: 0, failed: 0 };
    });

    const result = await threadOrchestrationService(db).runController(threadId, {
      adjutantRunner: async () => ({ output: "done", runId: "run-1" }),
      onCommit: async () => {
        order.push("onCommit");
      },
    });

    expect(result).toMatchObject({ ran: true, suppressed: false, cursorAdvancedTo: "entry-a" });
    expect(commitThreadAgentActionsMock).toHaveBeenCalledWith({
      companyId: "company-1",
      threadId,
      runId: "run-1",
    });
    expect(cursorCommits).toEqual(["entry-a"]);
    expect(order).toEqual(["action-gate", "onCommit"]);
  });

  it("does NOT advance the cursor when an action commit reports failures", async () => {
    // Fix (c): a per-action commit failure is swallowed inside
    // commitThreadAgentActions (row set failed, call returns normally). The
    // orchestration loop must NOT advance the cursor in that case, so the
    // triggering entry is retried on the next tick instead of being dropped.
    const threadId = "thread-action-gate-failed";
    const controller: ControllerState = {
      threadId,
      runEpoch: 1,
      pendingRun: true,
      lastProcessedEntryId: null,
      lastError: null,
    };
    const entry: EntryRow = {
      id: "entry-a",
      discussionId: threadId,
      seq: 1,
      createdAt: new Date("2026-06-15T10:00:00Z"),
      inputType: "write",
      rawContent: "Please help scope this.",
    };
    const { db, cursorCommits } = createControllerDb(controller, [entry]);
    commitThreadAgentActionsMock.mockResolvedValueOnce({
      committed: 0,
      suppressed: 0,
      blocked: 0,
      failed: 1,
    });
    const onCommit = vi.fn();

    const result = await threadOrchestrationService(db).runController(threadId, {
      adjutantRunner: async () => ({ output: "done", runId: "run-1" }),
      onCommit,
    });

    expect(result).toMatchObject({
      ran: true,
      suppressed: false,
      error: "action_commit_failed:1",
      cursorAdvancedTo: null,
    });
    expect(commitThreadAgentActionsMock).toHaveBeenCalledWith({
      companyId: "company-1",
      threadId,
      runId: "run-1",
    });
    // Cursor not advanced → entry will be retried next tick.
    expect(cursorCommits).toEqual([]);
    expect(controller.lastProcessedEntryId).toBeNull();
    expect(controller.lastError).toBe("action_commit_failed:1");
    // The post-commit hook must NOT fire on the failed path.
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("does not commit proposed thread actions when a newer human entry makes the run stale", async () => {
    const threadId = "thread-action-gate-stale";
    const controller: ControllerState = {
      threadId,
      runEpoch: 1,
      pendingRun: true,
      lastProcessedEntryId: null,
      lastError: null,
    };
    const entry: EntryRow = {
      id: "entry-a",
      discussionId: threadId,
      seq: 1,
      createdAt: new Date("2026-06-15T10:00:00Z"),
      inputType: "write",
      rawContent: "Please help scope this.",
    };
    const { db, cursorCommits } = createControllerDb(controller, [entry]);

    const result = await threadOrchestrationService(db).runController(threadId, {
      adjutantRunner: async () => {
        controller.runEpoch += 1;
        controller.pendingRun = true;
        return { output: "stale" };
      },
    });

    expect(result).toMatchObject({ ran: true, suppressed: true, startEpoch: 1, endEpoch: 2 });
    expect(commitThreadAgentActionsMock).not.toHaveBeenCalled();
    expect(cursorCommits).toEqual([]);
  });
});
