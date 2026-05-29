/**
 * P1-T4 — KILL TEST: Thread orchestration run executor + stale-run suppression.
 *
 * This file verifies the correctness of `runController` under its most dangerous
 * concurrent scenario: a second human entry bumping the epoch WHILE the
 * Adjutant is running. The suppressed run must NOT commit its output; the fresh
 * run MUST pick up both entries.
 *
 * All tests are fully deterministic and mock-based — no live database, no
 * embedded-postgres. The in-memory controller state is mutated directly by the
 * fake DB operations so that epoch changes mid-run are observable to the executor.
 *
 * Test structure:
 *   § 1  The KILL scenario (5-step replay as specified in P1-T4)
 *   § 2  Claim semantics — no-pending, concurrent double-claim
 *   § 3  adjutantRunner error — lastError recorded, cursor not advanced
 *   § 4  Zero unprocessed entries — short-circuit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── drizzle-orm mock ──────────────────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ _op: "eq", a, b })),
  and: vi.fn((...args: unknown[]) => ({ _op: "and", args })),
  gt: vi.fn((a: unknown, b: unknown) => ({ _op: "gt", a, b })),
  asc: vi.fn((col: unknown) => ({ _op: "asc", col })),
  isNull: vi.fn((col: unknown) => ({ _op: "isNull", col })),
  or: vi.fn((...args: unknown[]) => ({ _op: "or", args })),
  desc: vi.fn((col: unknown) => ({ _op: "desc", col })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ _op: "inArray", col, vals })),
  isNotNull: vi.fn((col: unknown) => ({ _op: "isNotNull", col })),
  sql: Object.assign(
    vi.fn((_s: unknown) => {
      const tag: { as: ReturnType<typeof vi.fn>; mapWith: ReturnType<typeof vi.fn>; toString: () => string } = {
        as: vi.fn().mockReturnThis(),
        mapWith: vi.fn().mockReturnThis(),
        toString: () => "sql_expr",
      };
      return tag;
    }),
    {
      raw: vi.fn((s: unknown) => s),
      placeholder: vi.fn((s: unknown) => s),
    },
  ),
}));

// ── @armyofagents/db mock ─────────────────────────────────────────────────────
function tableProxy(name: string) {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        return `${name}.${String(prop)}`;
      },
    },
  );
}

vi.mock("@armyofagents/db", () => ({
  threadOrchestrationState: tableProxy("tos"),
  discussionEntries: tableProxy("de"),
  discussions: tableProxy("discussions"),
  agents: tableProxy("agents"),
  agentWakeupRequests: tableProxy("awr"),
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
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

// ── Imports (after all mocks) ─────────────────────────────────────────────────
import { threadOrchestrationService } from "../services/thread-orchestration.js";
import type { AdjutantRunner, OrchestratedEntry } from "../services/thread-orchestration.js";

// =============================================================================
// In-memory state model
// =============================================================================

/**
 * Represents one `thread_orchestration_state` row.
 * Mutated in-place by the fake DB operations so that epoch changes
 * made mid-run are visible to the executor's later re-read.
 */
interface ControllerState {
  threadId: string;
  runEpoch: number;
  pendingRun: boolean;
  hopCount: number;
  lastProcessedEntryId: string | null;
  lastError: string | null;
}

/**
 * Represents one `discussion_entries` row.
 */
interface EntryRow {
  id: string;
  discussionId: string;
  createdAt: Date;
  inputType: string;
  rawContent: string;
}

/**
 * Build a fully instrumented in-memory DB mock whose state is observable
 * and mutable from outside (so tests can inspect what runController did and
 * trigger side-effects mid-run via the adjutantRunner fake).
 *
 * The mock supports the exact query shapes that runController emits:
 *
 *   db.update(tos).set(…).where(…).returning()     — update controller
 *   db.select(…).from(tos).where(…)                — re-read runEpoch
 *   db.select().from(de).where(…).orderBy(…)       — load entries
 *
 * The `where` predicate in the mock is intentionally ignored — the mock
 * returns the pre-configured state and the tests set that state correctly
 * before each call. This is fine because the WHERE logic is exercised by
 * the real Drizzle query in production; here we only test the executor's
 * control flow.
 */
function makeStateDb(controller: ControllerState, allEntries: EntryRow[]) {
  // Track committed cursor advances and lastError writes
  const commits: { cursorAdvancedTo: string | null }[] = [];
  const lastErrorWrites: (string | null)[] = [];
  let claimCount = 0;

  /**
   * Simulate the claim UPDATE:
   *   SET pendingRun=false WHERE pendingRun=true RETURNING runEpoch, lastProcessedEntryId
   *
   * Returns [] if not pending (nothing to claim), otherwise returns the
   * controller row after claiming.
   */
  function claim(setPayload: Record<string, unknown>): ControllerState[] {
    // The claim only fires if pendingRun=true is part of the WHERE.
    // We check the controller state directly.
    if (!controller.pendingRun) return [];

    claimCount++;
    // Apply the SET payload to the in-memory state.
    if ("pendingRun" in setPayload) controller.pendingRun = setPayload.pendingRun as boolean;
    // Return a snapshot (not a reference) so the caller captures the epoch at claim time.
    return [{ ...controller }];
  }

  /**
   * Simulate a generic UPDATE SET on the controller (lastError writes, cursor advance).
   */
  function applyUpdate(setPayload: Record<string, unknown>): ControllerState[] {
    if ("lastProcessedEntryId" in setPayload) {
      controller.lastProcessedEntryId = setPayload.lastProcessedEntryId as string | null;
      commits.push({ cursorAdvancedTo: controller.lastProcessedEntryId });
    }
    if ("lastError" in setPayload) {
      controller.lastError = setPayload.lastError as string | null;
      lastErrorWrites.push(controller.lastError);
    }
    if ("pendingRun" in setPayload) {
      controller.pendingRun = setPayload.pendingRun as boolean;
    }
    return [{ ...controller }];
  }

  /**
   * Simulate the epoch re-read SELECT.
   * Returns the CURRENT in-memory runEpoch (which may have been bumped by a
   * concurrent triggerOnHumanEntry call inside the adjutantRunner fake).
   */
  function readEpoch(): Array<{ runEpoch: number }> {
    return [{ runEpoch: controller.runEpoch }];
  }

  /**
   * Simulate loading discussion_entries.
   * The mock filters by `discussionId === threadId` and, if a cursor is set,
   * returns only entries that come AFTER the cursor (by array position).
   * Ordering by createdAt/id is implicit in the array order.
   */
  function loadEntries(cursor: string | null): EntryRow[] {
    const forThread = allEntries.filter(e => e.discussionId === controller.threadId);
    if (!cursor) return [...forThread];
    const idx = forThread.findIndex(e => e.id === cursor);
    if (idx === -1) return [...forThread]; // cursor not found → return all
    return forThread.slice(idx + 1);
  }

  /**
   * Build the mock db object.
   *
   * Key design decisions:
   *
   *   update() routing:
   *     - The CLAIM update is the only one that calls `.returning()`. We detect
   *       it by the presence of `pendingRun` in the SET payload combined with
   *       the absence of `lastProcessedEntryId`.
   *     - The COMMIT update sets `{ lastProcessedEntryId, lastError: null, updatedAt }`.
   *       It does NOT call `.returning()` in runController — it just `await`s the
   *       end of the chain. So `where()` must itself be a Promise (a thenable)
   *       that applies the side-effect and resolves.
   *     - The ERROR update sets `{ lastError, updatedAt }`. Same pattern — no
   *       `.returning()`, so `where()` must be a Promise.
   *
   *   select() routing:
   *     - Epoch re-read: `db.select({ runEpoch: ... }).from(tos).where(...)`.
   *       `where()` resolves to `[{ runEpoch: N }]`. No `.orderBy()`.
   *     - Entry load: `db.select().from(de).where(...).orderBy(...)`.
   *       `where()` returns a builder; `orderBy()` resolves to the entry array.
   *
   * We distinguish the two select paths by whether a projection was passed to
   * `select()` (epoch re-read passes `{ runEpoch: ... }`; entry load passes
   * nothing / undefined).
   */
  const db = {
    update: vi.fn(() => {
      return {
        set: vi.fn((payload: Record<string, unknown>) => {
          const isClaim = "pendingRun" in payload && !("lastProcessedEntryId" in payload);
          return {
            where: vi.fn(() => {
              if (isClaim) {
                // Claim: conditionally sets pendingRun=false and returns the row.
                // Called with .returning() by runController.
                return {
                  returning: vi.fn(async () => claim(payload)),
                };
              }
              // Non-claim update (lastError write or cursor advance).
              // runController does NOT call .returning() here — it just
              // awaits the chain. So where() itself must be a thenable.
              return Promise.resolve(applyUpdate(payload));
            }),
          };
        }),
      };
    }),

    select: vi.fn((projection?: Record<string, unknown>) => ({
      from: vi.fn((_table: unknown) => ({
        where: vi.fn((_where: unknown) => {
          // The executor calls select({ runEpoch: tos.runEpoch }) for the epoch
          // re-read. Because `tos` is a tableProxy, `tos.runEpoch` resolves to
          // the string "tos.runEpoch". The projection object has ONE key whose
          // VALUE contains "runEpoch". We detect by checking if the projection
          // is non-null (non-undefined).  Entry loads call select() with no
          // argument (projection === undefined). That's the only distinction we
          // need.
          const isEpochRead = projection != null;
          if (isEpochRead) {
            // Epoch re-read — where() resolves to [{ runEpoch }].
            return Promise.resolve(readEpoch());
          }
          // Entry load — where() returns a builder; orderBy() resolves to rows.
          return {
            orderBy: vi.fn(async (..._args: unknown[]) => {
              return loadEntries(controller.lastProcessedEntryId);
            }),
          };
        }),
      })),
    })),

    // ── Insert (used by ensureController inside triggerOnHumanEntry) ──────────
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({
          returning: vi.fn(async () => []), // conflict → no row returned
        })),
      })),
    })),
  };

  return {
    db: db as unknown as Parameters<typeof threadOrchestrationService>[0],
    controller,
    commits,
    lastErrorWrites,
    get claimCount() { return claimCount; },
  };
}

/**
 * Build a triggerOnHumanEntry that mutates the IN-MEMORY controller state
 * directly (bypassing the DB mock's insert/update fluent chain) so it is safe
 * to call from inside an adjutantRunner fake.
 *
 * This mirrors what threadOrchestrationService.triggerOnHumanEntry does:
 *   runEpoch += 1, pendingRun = true, hopCount = 0
 */
function makeTrigger(controller: ControllerState) {
  return () => {
    controller.runEpoch += 1;
    controller.pendingRun = true;
    controller.hopCount = 0;
  };
}

// =============================================================================
// § 1 — The KILL scenario
// =============================================================================

describe("runController — KILL scenario (stale-run suppression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("suppresses run-1 when epoch bumped mid-run; run-2 commits both entries exactly once", async () => {
    // ── Setup ──────────────────────────────────────────────────────────────────
    const threadId = "thread-kill-1";

    const entryA: EntryRow = {
      id: "entry-a",
      discussionId: threadId,
      createdAt: new Date("2026-01-01T10:00:00Z"),
      inputType: "write",
      rawContent: "Hello from human A",
    };
    const entryB: EntryRow = {
      id: "entry-b",
      discussionId: threadId,
      createdAt: new Date("2026-01-01T10:01:00Z"),
      inputType: "write",
      rawContent: "Hello from human B",
    };

    // Start with the controller at epoch 0, pendingRun = false.
    const controller: ControllerState = {
      threadId,
      runEpoch: 0,
      pendingRun: false,
      hopCount: 0,
      lastProcessedEntryId: null,
      lastError: null,
    };

    // ── Step 1: Human sends entry A → trigger ─────────────────────────────────
    const bumpEpoch = makeTrigger(controller);
    bumpEpoch(); // runEpoch 0→1, pendingRun=true

    expect(controller.runEpoch).toBe(1);
    expect(controller.pendingRun).toBe(true);

    // At this point only entry A is in the thread.
    const allEntries: EntryRow[] = [entryA];

    // ── Step 2: Executor run-1 starts (claims, startEpoch=1) ─────────────────
    // The adjutantRunner fake simulates entry B arriving mid-run by bumping
    // the epoch again BEFORE it resolves.
    let entriesSeenByRun1: OrchestratedEntry[] = [];
    const adjutantRun1: AdjutantRunner = async (input) => {
      entriesSeenByRun1 = input.entries;
      // Simulate: second human entry B arrives while run-1 is in flight.
      allEntries.push(entryB);
      bumpEpoch(); // runEpoch 1→2, pendingRun=true
      // Run-1 finishes — but the epoch has moved on.
      return { output: "run-1 output" };
    };

    const { db: db1, controller: ctrl1, commits: commits1 } = makeStateDb(controller, allEntries);
    const svc1 = threadOrchestrationService(db1);

    const result1 = await svc1.runController(threadId, { adjutantRunner: adjutantRun1 });

    // ── Step 3: Assert run-1 is SUPPRESSED ───────────────────────────────────
    // suppressed=true
    expect(result1).toMatchObject({ ran: true, suppressed: true, startEpoch: 1, endEpoch: 2 });

    // Cursor must NOT have advanced — lastProcessedEntryId still null.
    expect(ctrl1.lastProcessedEntryId).toBeNull();

    // pendingRun must still be true (the bump from bumpEpoch() set it back).
    expect(ctrl1.pendingRun).toBe(true);

    // No commits should have been recorded by run-1.
    expect(commits1).toHaveLength(0);

    // Run-1 DID see entry A (it read before the bump).
    expect(entriesSeenByRun1.map(e => e.id)).toEqual(["entry-a"]);

    // ── Step 4: Fresh run-2 (startEpoch=2) must see BOTH A and B ─────────────
    let entriesSeenByRun2: OrchestratedEntry[] = [];
    const adjutantRun2: AdjutantRunner = async (input) => {
      entriesSeenByRun2 = input.entries;
      // No epoch bump — this run completes successfully.
      return { output: "run-2 output" };
    };

    // Use the SAME shared controller (same in-memory state), now at epoch 2,
    // pendingRun=true, lastProcessedEntryId=null (cursor never advanced).
    const { db: db2, commits: commits2 } = makeStateDb(controller, allEntries);
    const svc2 = threadOrchestrationService(db2);

    const result2 = await svc2.runController(threadId, { adjutantRunner: adjutantRun2 });

    // ── Step 5: Assert run-2 COMMITS ─────────────────────────────────────────
    expect(result2).toMatchObject({
      ran: true,
      suppressed: false,
      startEpoch: 2,
      cursorAdvancedTo: "entry-b",
    });

    // Cursor advanced to entry-b (the last entry).
    expect(controller.lastProcessedEntryId).toBe("entry-b");

    // pendingRun must now be false.
    expect(controller.pendingRun).toBe(false);

    // Exactly one commit recorded.
    expect(commits2).toHaveLength(1);
    expect(commits2[0].cursorAdvancedTo).toBe("entry-b");

    // Run-2 saw BOTH A and B (cursor was null → full scan).
    expect(entriesSeenByRun2.map(e => e.id)).toEqual(["entry-a", "entry-b"]);

    // ── Step 5 (continued): A and B processed EXACTLY once across both runs ──
    // run-1: saw A, output suppressed → A was NOT committed.
    // run-2: saw A+B, output committed → A+B committed once.
    // Total committed processing: [A, B] × 1 each.
    const allCommittedEntryIds = entriesSeenByRun2.map(e => e.id);
    expect(allCommittedEntryIds).toContain("entry-a");
    expect(allCommittedEntryIds).toContain("entry-b");
    // No duplicates in the committed run.
    const unique = new Set(allCommittedEntryIds);
    expect(unique.size).toBe(allCommittedEntryIds.length);
  });
});

// =============================================================================
// § 2 — Claim semantics
// =============================================================================

describe("runController — claim semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no-pending when pendingRun=false", async () => {
    const controller: ControllerState = {
      threadId: "thread-claim-1",
      runEpoch: 3,
      pendingRun: false, // nothing pending
      hopCount: 0,
      lastProcessedEntryId: null,
      lastError: null,
    };
    const { db } = makeStateDb(controller, []);
    const svc = threadOrchestrationService(db);

    const result = await svc.runController("thread-claim-1");

    expect(result).toEqual({ ran: false, reason: "no-pending" });
    // Controller must be untouched.
    expect(controller.pendingRun).toBe(false);
    expect(controller.runEpoch).toBe(3);
  });

  it("concurrent double-claim — only one executor wins; second gets no-pending", async () => {
    const controller: ControllerState = {
      threadId: "thread-concurrent",
      runEpoch: 1,
      pendingRun: true,
      hopCount: 0,
      lastProcessedEntryId: null,
      lastError: null,
    };

    const entryA: EntryRow = {
      id: "entry-concurrent-a",
      discussionId: "thread-concurrent",
      createdAt: new Date("2026-01-01T10:00:00Z"),
      inputType: "write",
      rawContent: "Concurrent entry",
    };

    // Both executors share the same controller state.
    // The claim is a conditional UPDATE (WHERE pendingRun=true). The first
    // executor to run sets pendingRun=false; the second sees pendingRun=false
    // and gets an empty RETURNING.

    let run1Complete = false;
    // Run-1 uses a slow adjutantRunner to ensure run-2 starts after run-1 claims.
    const slowRunner: AdjutantRunner = async () => {
      // Yield to allow run-2 to start (but pendingRun is already false by then).
      await new Promise(resolve => setTimeout(resolve, 0));
      run1Complete = true;
      return { output: "concurrent output" };
    };

    const { db: db1 } = makeStateDb(controller, [entryA]);
    const { db: db2 } = makeStateDb(controller, [entryA]);
    const svc1 = threadOrchestrationService(db1);
    const svc2 = threadOrchestrationService(db2);

    // Start both concurrently.
    const [result1, result2] = await Promise.all([
      svc1.runController("thread-concurrent", { adjutantRunner: slowRunner }),
      svc2.runController("thread-concurrent"),
    ]);

    // Exactly one ran, one got no-pending.
    const results = [result1, result2];
    const ranResults = results.filter(r => r.ran === true && "cursorAdvancedTo" in r && !("suppressed" in r && r.suppressed));
    const noPendingResults = results.filter(r => r.ran === false);

    // One ran (committed), one got no-pending.
    expect(noPendingResults.length).toBe(1);
    expect(run1Complete).toBe(true);
  });
});

// =============================================================================
// § 3 — adjutantRunner error handling
// =============================================================================

describe("runController — adjutantRunner error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records lastError and does NOT advance cursor when adjutantRunner throws", async () => {
    const threadId = "thread-error-1";
    const controller: ControllerState = {
      threadId,
      runEpoch: 1,
      pendingRun: true,
      hopCount: 0,
      lastProcessedEntryId: null,
      lastError: null,
    };

    const entry: EntryRow = {
      id: "entry-err-a",
      discussionId: threadId,
      createdAt: new Date("2026-01-01T10:00:00Z"),
      inputType: "write",
      rawContent: "Entry that causes error",
    };

    const failingRunner: AdjutantRunner = async () => {
      throw new Error("adjutant crew exploded");
    };

    const { db, controller: ctrl, lastErrorWrites } = makeStateDb(controller, [entry]);
    const svc = threadOrchestrationService(db);

    const result = await svc.runController(threadId, { adjutantRunner: failingRunner });

    // Returns an error result.
    expect(result).toMatchObject({
      ran: true,
      suppressed: false,
      error: "adjutant crew exploded",
      startEpoch: 1,
      cursorAdvancedTo: null,
    });

    // lastError is recorded on the controller.
    expect(lastErrorWrites.some(e => e?.includes("adjutant crew exploded"))).toBe(true);

    // Cursor NOT advanced.
    expect(ctrl.lastProcessedEntryId).toBeNull();
  });

  it("does NOT advance cursor when adjutantRunner throws (multiple entries)", async () => {
    const threadId = "thread-error-2";
    const controller: ControllerState = {
      threadId,
      runEpoch: 2,
      pendingRun: true,
      hopCount: 0,
      lastProcessedEntryId: "prev-cursor-id",
      lastError: null,
    };

    const entries: EntryRow[] = [
      { id: "entry-e1", discussionId: threadId, createdAt: new Date("2026-01-01T10:00:00Z"), inputType: "write", rawContent: "A" },
      { id: "entry-e2", discussionId: threadId, createdAt: new Date("2026-01-01T10:01:00Z"), inputType: "write", rawContent: "B" },
    ];

    const { db, controller: ctrl } = makeStateDb(controller, entries);
    const svc = threadOrchestrationService(db);

    await svc.runController(threadId, {
      adjutantRunner: async () => { throw new Error("boom"); },
    });

    // Cursor stays at the previous value.
    expect(ctrl.lastProcessedEntryId).toBe("prev-cursor-id");
  });
});

// =============================================================================
// § 4 — Zero unprocessed entries
// =============================================================================

describe("runController — zero unprocessed entries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("short-circuits with no-pending when there are no entries after cursor", async () => {
    const threadId = "thread-empty-1";
    const controller: ControllerState = {
      threadId,
      runEpoch: 1,
      pendingRun: true,
      hopCount: 0,
      // Cursor already at the only entry
      lastProcessedEntryId: "entry-last",
      lastError: null,
    };

    // No entries come after "entry-last" since we leave allEntries empty
    // (the makeStateDb filter returns [] when discussionId matches nothing
    // beyond cursor).
    const { db } = makeStateDb(controller, []);
    const svc = threadOrchestrationService(db);

    const adjutantCalled = vi.fn(async () => ({ output: "should not be called" }));
    const result = await svc.runController(threadId, { adjutantRunner: adjutantCalled });

    expect(result).toEqual({ ran: false, reason: "no-pending" });
    // adjutantRunner must NOT have been called.
    expect(adjutantCalled).not.toHaveBeenCalled();
  });
});

// =============================================================================
// § 5 — onCommit hook
// =============================================================================

describe("runController — onCommit hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls onCommit with the run result and cursor target on a successful commit", async () => {
    const threadId = "thread-commit-hook";
    const controller: ControllerState = {
      threadId,
      runEpoch: 1,
      pendingRun: true,
      hopCount: 0,
      lastProcessedEntryId: null,
      lastError: null,
    };

    const entry: EntryRow = {
      id: "entry-hook-a",
      discussionId: threadId,
      createdAt: new Date("2026-01-01T10:00:00Z"),
      inputType: "write",
      rawContent: "Hook test entry",
    };

    const { db } = makeStateDb(controller, [entry]);
    const svc = threadOrchestrationService(db);

    const onCommit = vi.fn(async () => {});
    await svc.runController(threadId, {
      adjutantRunner: async () => ({ output: "hook output" }),
      onCommit,
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    const [callResult, callCursor] = onCommit.mock.calls[0] as [{ output: unknown }, string | null];
    expect(callResult.output).toBe("hook output");
    expect(callCursor).toBe("entry-hook-a");
  });

  it("does NOT call onCommit on a suppressed (stale) run", async () => {
    const threadId = "thread-commit-hook-stale";
    const controller: ControllerState = {
      threadId,
      runEpoch: 1,
      pendingRun: true,
      hopCount: 0,
      lastProcessedEntryId: null,
      lastError: null,
    };

    const entry: EntryRow = {
      id: "entry-stale-a",
      discussionId: threadId,
      createdAt: new Date("2026-01-01T10:00:00Z"),
      inputType: "write",
      rawContent: "Stale entry",
    };

    const bumpEpoch = makeTrigger(controller);
    const { db } = makeStateDb(controller, [entry]);
    const svc = threadOrchestrationService(db);

    const onCommit = vi.fn(async () => {});
    await svc.runController(threadId, {
      adjutantRunner: async () => {
        bumpEpoch(); // epoch 1→2 mid-run
        return { output: "stale output" };
      },
      onCommit,
    });

    expect(onCommit).not.toHaveBeenCalled();
  });
});
