import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @paperclipai/db to avoid drizzle-orm ESM cycle
vi.mock("@paperclipai/db", () => {
  const makeTable = (name: string) => {
    const cols: Record<string, symbol> = {};
    return new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        // Return a stable symbol for each column to use in eq/and calls
        if (typeof prop === "string") {
          if (!cols[prop]) cols[prop] = Symbol(prop);
          return cols[prop];
        }
        return undefined;
      },
    });
  };

  return {
    memoryItems: makeTable("memory_items"),
    issues: makeTable("issues"),
    taskDependencies: makeTable("task_dependencies"),
    suggestions: makeTable("suggestions"),
    activityLog: makeTable("activity_log"),
  };
});

// Mock drizzle-orm operators to no-op
vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  eq: (..._args: unknown[]) => "eq",
  lt: (..._args: unknown[]) => "lt",
  isNotNull: (..._args: unknown[]) => "isNotNull",
  isNull: (..._args: unknown[]) => "isNull",
  inArray: (..._args: unknown[]) => "inArray",
  sql: new Proxy(() => "sql", { get: () => () => "sql", apply: () => "sql" }),
}));

// Mock activity-log
vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn(),
}));

// Mock live-events (transitive dep)
vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: vi.fn(),
}));

import { logActivity } from "../services/activity-log.js";
import { memoryLifecycleService } from "../services/memory-lifecycle.js";

// ---------------------------------------------------------------------------
// Sequence-based mock DB: each call to select/update/insert returns the next
// pre-configured result in order.
// ---------------------------------------------------------------------------
type MockRow = Record<string, unknown>;

function createSequenceDb(config: {
  selects?: MockRow[][];
  updates?: MockRow[][];
  inserts?: MockRow[][];
} = {}) {
  let selectIdx = 0;
  let updateIdx = 0;
  let insertIdx = 0;
  const selects = config.selects ?? [];
  const updates = config.updates ?? [];
  const inserts = config.inserts ?? [];

  function makeChain(getResult: () => MockRow[]) {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "set", "values", "returning", "innerJoin", "leftJoin", "orderBy", "limit"]) {
      chain[m] = (..._args: unknown[]) => chain;
    }
    chain.then = (resolve: (v: MockRow[]) => unknown) => Promise.resolve(resolve(getResult()));
    return chain;
  }

  return {
    select: (..._args: unknown[]) => makeChain(() => selects[selectIdx++] ?? []),
    update: (..._args: unknown[]) => makeChain(() => updates[updateIdx++] ?? []),
    insert: (..._args: unknown[]) => makeChain(() => inserts[insertIdx++] ?? []),
  };
}

describe("Memory Lifecycle Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("onGoalCompleted", () => {
    it("archives active_context memory items for the completed goal", async () => {
      const items = [
        { id: "mem-1", title: "Context item 1", layer: "active_context", status: "approved", goalId: "goal-1", companyId: "co-1" },
        { id: "mem-2", title: "Context item 2", layer: "active_context", status: "approved", goalId: "goal-1", companyId: "co-1" },
      ];

      const db = createSequenceDb({
        selects: [items],   // Find items to archive
        updates: [items],   // Archive them
      });

      const svc = memoryLifecycleService(db as any);
      const count = await svc.onGoalCompleted("co-1", "goal-1");

      expect(count).toBe(2);
      expect(logActivity).toHaveBeenCalledTimes(2);
      expect(logActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        companyId: "co-1",
        actorType: "system",
        actorId: "system",
        action: "memory.auto_archived",
        entityType: "memory_item",
        entityId: "mem-1",
        details: expect.objectContaining({ reason: "goal_completed", goalId: "goal-1" }),
      }));
    });

    it("returns 0 when no items match (idempotent — already archived)", async () => {
      const db = createSequenceDb({ selects: [[]] });

      const svc = memoryLifecycleService(db as any);
      const count = await svc.onGoalCompleted("co-1", "goal-1");

      expect(count).toBe(0);
      expect(logActivity).not.toHaveBeenCalled();
    });

    it("works for cancelled goals too", async () => {
      const items = [
        { id: "mem-1", title: "Context item", layer: "active_context", status: "approved", goalId: "goal-2", companyId: "co-1" },
      ];

      const db = createSequenceDb({
        selects: [items],
        updates: [items],
      });

      const svc = memoryLifecycleService(db as any);
      const count = await svc.onGoalCompleted("co-1", "goal-2");

      expect(count).toBe(1);
    });
  });

  describe("archiveExpiredWorkingMemory", () => {
    it("archives working memory when full chain is terminal for 7+ days", async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const workingItems = [
        { id: "wm-1", title: "Working mem", layer: "working", status: "approved", taskId: "task-1", companyId: "co-1" },
      ];

      const db = createSequenceDb({
        selects: [
          workingItems,  // Find working memory items
          [{ status: "done", completedAt: eightDaysAgo, cancelledAt: null }],  // Linked task
          [],  // No dependencies (chain terminal)
        ],
        updates: [workingItems],
      });

      const svc = memoryLifecycleService(db as any);
      const count = await svc.archiveExpiredWorkingMemory("co-1");

      expect(count).toBe(1);
      expect(logActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        action: "memory.auto_archived",
        details: expect.objectContaining({ reason: "working_memory_ttl", taskId: "task-1" }),
      }));
    });

    it("does NOT archive when dependency chain is partially active", async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const workingItems = [
        { id: "wm-1", title: "Working mem", layer: "working", status: "approved", taskId: "task-1", companyId: "co-1" },
      ];

      const db = createSequenceDb({
        selects: [
          workingItems,
          [{ status: "done", completedAt: eightDaysAgo, cancelledAt: null }],  // Linked task done
          [{ depId: "task-2", depntId: "task-1" }],  // Has dependency
          [{ id: "task-2", status: "in_progress", completedAt: null, cancelledAt: null }],  // Not terminal
        ],
      });

      const svc = memoryLifecycleService(db as any);
      const count = await svc.archiveExpiredWorkingMemory("co-1");

      expect(count).toBe(0);
      expect(logActivity).not.toHaveBeenCalled();
    });

    it("does NOT archive when task is terminal but less than 7 days", async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const workingItems = [
        { id: "wm-1", title: "Working mem", layer: "working", status: "approved", taskId: "task-1", companyId: "co-1" },
      ];

      const db = createSequenceDb({
        selects: [
          workingItems,
          [{ status: "done", completedAt: threeDaysAgo, cancelledAt: null }],
        ],
      });

      const svc = memoryLifecycleService(db as any);
      const count = await svc.archiveExpiredWorkingMemory("co-1");

      expect(count).toBe(0);
    });

    it("treats deleted tasks as terminal", async () => {
      const workingItems = [
        { id: "wm-1", title: "Working mem", layer: "working", status: "approved", taskId: "task-deleted", companyId: "co-1" },
      ];

      const db = createSequenceDb({
        selects: [
          workingItems,
          [],  // Task not found (deleted)
        ],
        updates: [workingItems],
      });

      const svc = memoryLifecycleService(db as any);
      const count = await svc.archiveExpiredWorkingMemory("co-1");

      expect(count).toBe(1);
    });
  });

  describe("archiveExpiredItems", () => {
    it("archives items with expiresAt in the past", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const expiredItems = [
        { id: "exp-1", title: "Expired item", layer: "active_context", status: "approved", expiresAt: yesterday, companyId: "co-1" },
      ];

      const db = createSequenceDb({
        selects: [expiredItems],
        updates: [expiredItems],
      });

      const svc = memoryLifecycleService(db as any);
      const count = await svc.archiveExpiredItems("co-1");

      expect(count).toBe(1);
      expect(logActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        action: "memory.auto_archived",
        details: expect.objectContaining({ reason: "expired" }),
      }));
    });

    it("returns 0 when no items are expired", async () => {
      const db = createSequenceDb({ selects: [[]] });

      const svc = memoryLifecycleService(db as any);
      const count = await svc.archiveExpiredItems("co-1");

      expect(count).toBe(0);
      expect(logActivity).not.toHaveBeenCalled();
    });
  });

  describe("flagStaleItems", () => {
    it("creates suggestions for items not accessed in 90+ days", async () => {
      const longAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      const staleItems = [
        { id: "stale-1", title: "Old domain knowledge", layer: "domain", status: "approved", accessedAt: longAgo, companyId: "co-1" },
      ];

      const db = createSequenceDb({
        selects: [staleItems, []],  // stale items, no existing suggestions
        inserts: [[]],
      });

      const svc = memoryLifecycleService(db as any);
      const count = await svc.flagStaleItems("co-1");

      expect(count).toBe(1);
      // Flagging creates suggestions — does NOT create activity log entries
      expect(logActivity).not.toHaveBeenCalled();
    });

    it("does not create duplicate suggestions for already-flagged items", async () => {
      const longAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      const staleItems = [
        { id: "stale-1", title: "Already flagged", layer: "domain", status: "approved", accessedAt: longAgo, companyId: "co-1" },
      ];

      const db = createSequenceDb({
        selects: [staleItems, [{ relatedMemoryItemId: "stale-1" }]],  // item + existing suggestion
      });

      const svc = memoryLifecycleService(db as any);
      const count = await svc.flagStaleItems("co-1");

      expect(count).toBe(0);
    });

    it("returns 0 when no stale items found", async () => {
      const db = createSequenceDb({ selects: [[]] });

      const svc = memoryLifecycleService(db as any);
      const count = await svc.flagStaleItems("co-1");

      expect(count).toBe(0);
    });
  });
});
