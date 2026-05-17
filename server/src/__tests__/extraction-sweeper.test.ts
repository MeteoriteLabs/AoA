// Contract test for runExtractionSweep — the durable PRIMARY trigger.
//
// Orphan signal uses the entry's LINKED current run (discussion_entries.
// extraction_run_id), not "any run for the entry". Reclaim BOTH resets the
// entry → 'pending' AND terminalizes the stale linked run → 'failed', so a
// leftover 'running' run can never re-trigger reclaim (the bug that the
// prior join-on-any-running design produced: perpetual re-reclaim of a
// healthily-reprocessing entry + zombie runs). Then drains 'pending'.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { consumerMock, ensurePlatformMock } = vi.hoisted(() => ({
  consumerMock: vi.fn().mockResolvedValue(undefined),
  ensurePlatformMock: vi.fn().mockResolvedValue("pa-1"),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: unknown[]) => ({ and: a })),
  or: vi.fn((...a: unknown[]) => ({ or: a })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  lt: vi.fn((a: unknown, b: unknown) => ({ lt: [a, b] })),
  isNull: vi.fn((c: unknown) => ({ isNull: c })),
  inArray: vi.fn((c: unknown, v: unknown) => ({ inArray: [c, v] })),
}));
vi.mock("@armyofagents/db", () => {
  const t = (n: string) =>
    new Proxy({} as Record<string, unknown>, {
      get: (_x, p) => (typeof p === "string" ? Symbol(`${n}.${p}`) : undefined),
    });
  return {
    discussionEntries: t("discussion_entries"),
    discussions: t("discussions"),
    internalAgentRuns: t("internal_agent_runs"),
  };
});
vi.mock("../services/internal-agent/subagents/extraction-consumer.js", () => ({
  runExtractionConsumer: consumerMock,
}));
vi.mock("../services/internal-agent/subagents/platform-agent.js", () => ({
  ensurePlatformAgent: ensurePlatformMock,
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { runExtractionSweep } from "../services/internal-agent/subagents/extraction-sweeper.js";

/**
 * Sequence-aware mock DB.
 * - select() returns the next queued rows array (1 = orphan-select,
 *   2 = pending-drain).
 * - update().set(v).where() pushes `v` into `_sets` so we can assert which
 *   updates were issued (run-fail vs entry-reset, by payload shape).
 */
function makeDb(selectQueue: unknown[][]) {
  let si = 0;
  const sets: any[] = [];
  const db: any = {
    _sets: sets,
    select: () => {
      const n = si++;
      const c: any = {};
      c.from = () => c;
      c.innerJoin = () => c;
      c.leftJoin = () => c;
      c.where = () => c;
      c.limit = () => c;
      c.then = (resolve: (v: unknown[]) => unknown) =>
        Promise.resolve(selectQueue[n] ?? []).then(resolve);
      return c;
    },
    update: () => ({
      set: (v: any) => {
        sets.push(v);
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
  return db;
}

const runFail = (s: any) => s.status === "failed";
const entryReset = (s: any) =>
  s.extractionStatus === "pending" && s.extractionRunId === null;

describe("runExtractionSweep — linked-run orphan reclaim", () => {
  beforeEach(() => {
    consumerMock.mockClear();
    ensurePlatformMock.mockClear();
  });

  it("true orphan (linked run stale-running): fails the run, resets the entry, re-extracts", async () => {
    const db = makeDb([
      [{ id: "e1", runId: "r1" }], // orphan-select (projected as {id, runId})
      [{ id: "e1", companyId: "c1" }], // pending-drain (now pending)
    ]);
    await runExtractionSweep(db, { limiterMax: 2, staleMs: 600_000 });

    // Stale linked run terminalized so it can never re-trigger reclaim.
    expect(db._sets.some(runFail)).toBe(true);
    // Entry atomically reset.
    expect(db._sets.some(entryReset)).toBe(true);
    // …and actually re-extracted.
    expect(consumerMock).toHaveBeenCalledWith(db, "c1", "e1", "pa-1");
  });

  // NOTE: a 'processing' entry with extraction_run_id = NULL is the untouched
  // reprocess direct-call path (HEALTHY in-flight). The orphan SELECT's WHERE
  // (status='processing' AND linked run 'running' & stale) structurally
  // excludes it — there is NO isNull branch. That exclusion lives entirely in
  // the SQL predicate, which a mock cannot exercise faithfully; it is the
  // authority of the Linux-CI integration test, not this contract test.
  // (A prior design false-reclaimed this case → double extraction — fixed.)

  it("healthy in-flight (orphan-select returns nothing): no updates, only genuine pending drained", async () => {
    const db = makeDb([
      [], // orphan-select: linked run is recent → excluded by the query
      [{ id: "e3", companyId: "c3" }],
    ]);
    await runExtractionSweep(db, { limiterMax: 2, staleMs: 600_000 });

    expect(db._sets).toHaveLength(0); // nothing reclaimed
    expect(consumerMock).toHaveBeenCalledWith(db, "c3", "e3", "pa-1");
    expect(consumerMock).toHaveBeenCalledTimes(1);
  });

  it("no-op when nothing stuck and nothing pending", async () => {
    const db = makeDb([[], []]);
    await runExtractionSweep(db, { limiterMax: 2, staleMs: 600_000 });
    expect(db._sets).toHaveLength(0);
    expect(consumerMock).not.toHaveBeenCalled();
  });

  it("resolves the platform agent once per company within a sweep", async () => {
    const db = makeDb([
      [],
      [
        { id: "e1", companyId: "c1" },
        { id: "e2", companyId: "c1" },
      ],
    ]);
    await runExtractionSweep(db, { limiterMax: 1, staleMs: 600_000 });
    expect(ensurePlatformMock).toHaveBeenCalledTimes(1);
  });
});
