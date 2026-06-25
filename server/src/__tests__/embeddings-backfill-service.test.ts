import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeTableProxy, drizzleOperatorStubs } from "./helpers/drizzle-mock.js";

/**
 * Unit tests for backfillQueueCompanyIds (Task 4, keyless-except-embeddings).
 *
 * Mocking strategy: follows the same pattern as embedding-retry-persistence.test.ts —
 * Proxy-based table stubs to avoid ESM drizzle-orm circular deps, sequence-based mock
 * DB, and setCalls tracking for update assertions.
 */

vi.mock("@armyofagents/db", () => ({
  embeddingQueue: makeTableProxy("embedding_queue"),
  memoryItems: makeTableProxy("memory_items"),
  discussions: makeTableProxy("discussions"),
  discussionEntries: makeTableProxy("discussion_entries"),
  discussionExtractedItems: makeTableProxy("discussion_extracted_items"),
}));

vi.mock("drizzle-orm", () => drizzleOperatorStubs());

// ---------------------------------------------------------------------------
// Sequence-based mock DB with per-operation tracking
// ---------------------------------------------------------------------------
type MockRow = Record<string, unknown>;

function createSequenceDb(config: {
  selects?: MockRow[][];
  updates?: MockRow[][];
} = {}) {
  let selectIdx = 0;
  let updateIdx = 0;
  const selects = config.selects ?? [];
  const updates = config.updates ?? [];

  const setCalls: Array<Record<string, unknown>> = [];
  const whereCalls: Array<unknown> = [];

  function makeChain(getResult: () => MockRow[], trackSet = false) {
    const chain: Record<string, unknown> = {};
    const chainable = [
      "from", "innerJoin", "leftJoin", "where", "values",
      "returning", "orderBy", "limit", "onConflictDoNothing",
    ];
    for (const m of chainable) {
      chain[m] = (..._args: unknown[]) => chain;
    }
    chain.set = (val: Record<string, unknown>) => {
      if (trackSet) setCalls.push(val);
      return chain;
    };
    // where() is called twice per update (once for the condition, we capture
    // the argument to check the queue ID filter)
    chain.where = (arg: unknown) => {
      whereCalls.push(arg);
      return chain;
    };
    chain.then = (resolve: (v: MockRow[]) => unknown) =>
      Promise.resolve(resolve(getResult()));
    return chain;
  }

  return {
    select: (..._args: unknown[]) => makeChain(() => selects[selectIdx++] ?? []),
    update: (..._args: unknown[]) => makeChain(() => updates[updateIdx++] ?? [], true),
    insert: (..._args: unknown[]) => makeChain(() => []),
    setCalls,
    whereCalls,
  };
}

// Import after mocks are registered
import { backfillQueueCompanyIds } from "../services/embeddings-backfill.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("backfillQueueCompanyIds", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns { updated: 0 } when all three target-table selects return empty", async () => {
    const db = createSequenceDb({
      selects: [[], [], []], // memory_items, discussions, discussion_extracted_items
    });

    const result = await backfillQueueCompanyIds(db as any);
    expect(result).toEqual({ updated: 0 });
    expect(db.setCalls.length).toBe(0);
  });

  it("updates company_id for memory_items rows", async () => {
    const db = createSequenceDb({
      selects: [
        // memory_items join: 2 rows to backfill
        [
          { queueId: "q-1", companyId: "c-1" },
          { queueId: "q-2", companyId: "c-2" },
        ],
        [], // discussions: none
        [], // discussion_extracted_items: none
      ],
      updates: [{}, {}],
    });

    const result = await backfillQueueCompanyIds(db as any);
    expect(result).toEqual({ updated: 2 });
    expect(db.setCalls.length).toBe(2);
    expect(db.setCalls[0]).toEqual({ companyId: "c-1" });
    expect(db.setCalls[1]).toEqual({ companyId: "c-2" });
  });

  it("updates company_id for discussions rows", async () => {
    const db = createSequenceDb({
      selects: [
        [], // memory_items: none
        [{ queueId: "q-3", companyId: "c-10" }], // discussions: 1 row
        [], // discussion_extracted_items: none
      ],
      updates: [{}],
    });

    const result = await backfillQueueCompanyIds(db as any);
    expect(result).toEqual({ updated: 1 });
    expect(db.setCalls.length).toBe(1);
    expect(db.setCalls[0]).toEqual({ companyId: "c-10" });
  });

  it("updates company_id for discussion_extracted_items rows (2-hop join)", async () => {
    const db = createSequenceDb({
      selects: [
        [], // memory_items: none
        [], // discussions: none
        // discussion_extracted_items → entries → discussions: 1 row
        [{ queueId: "q-5", companyId: "c-99" }],
      ],
      updates: [{}],
    });

    const result = await backfillQueueCompanyIds(db as any);
    expect(result).toEqual({ updated: 1 });
    expect(db.setCalls.length).toBe(1);
    expect(db.setCalls[0]).toEqual({ companyId: "c-99" });
  });

  it("aggregates updates across all three target tables", async () => {
    const db = createSequenceDb({
      selects: [
        [{ queueId: "q-A", companyId: "c-A" }], // memory_items: 1
        [{ queueId: "q-B", companyId: "c-B" }], // discussions: 1
        [{ queueId: "q-C", companyId: "c-C" }], // discussion_extracted_items: 1
      ],
      updates: [{}, {}, {}],
    });

    const result = await backfillQueueCompanyIds(db as any);
    expect(result).toEqual({ updated: 3 });
    expect(db.setCalls.length).toBe(3);
    expect(db.setCalls[0]).toEqual({ companyId: "c-A" });
    expect(db.setCalls[1]).toEqual({ companyId: "c-B" });
    expect(db.setCalls[2]).toEqual({ companyId: "c-C" });
  });

  it("is idempotent — second run with no NULL rows updates 0 rows", async () => {
    // All three selects return empty (no NULL company_id rows remain)
    const db = createSequenceDb({ selects: [[], [], []] });

    const result1 = await backfillQueueCompanyIds(db as any);
    expect(result1).toEqual({ updated: 0 });
    expect(db.setCalls.length).toBe(0);
  });

  it("handles multiple rows per target table in a single call", async () => {
    const db = createSequenceDb({
      selects: [
        [
          { queueId: "q-1", companyId: "c-1" },
          { queueId: "q-2", companyId: "c-1" },
          { queueId: "q-3", companyId: "c-2" },
        ],
        [],
        [],
      ],
      updates: [{}, {}, {}],
    });

    const result = await backfillQueueCompanyIds(db as any);
    expect(result).toEqual({ updated: 3 });
    expect(db.setCalls.length).toBe(3);
  });
});
