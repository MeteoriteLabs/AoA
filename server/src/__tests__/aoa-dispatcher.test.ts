// Contract test for runAoaDispatch — the generalized AoA dispatcher.
//
// Phase 1 is the VERBATIM Decision-#99 linked-run orphan reclaim (same
// predicates as extraction-sweeper.ts): orphan = entry 'processing' AND its
// LINKED current run still 'running' & older than staleMs → terminalize that
// run → 'failed' AND reset the entry → 'pending'. Phase 2 generalizes the
// drain: each 'pending' entry is gated per-company by an enabled `outbox`
// trigger (listEnabledOutboxAgents). A company with no enabled outbox agent
// is SKIPPED; otherwise the extraction agent is resolved (memoized per
// company) and runExtractionConsumer is invoked under a bounded limiter.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { consumerMock, ensureExtractionMock, listOutboxMock } = vi.hoisted(
  () => ({
    consumerMock: vi.fn().mockResolvedValue(undefined),
    ensureExtractionMock: vi.fn().mockResolvedValue("ext-1"),
    listOutboxMock: vi.fn().mockResolvedValue(["ext-1"]),
  }),
);

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
vi.mock("../services/internal-agent/aoa-agents/ensure-extraction-agent.js", () => ({
  ensureExtractionAgent: ensureExtractionMock,
}));
vi.mock("../services/internal-agent/aoa-agents/triggers.js", () => ({
  listEnabledOutboxAgents: listOutboxMock,
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { runAoaDispatch } from "../services/internal-agent/aoa-agents/dispatcher.js";

/**
 * Sequence-aware mock DB — VERBATIM the makeDb harness from
 * extraction-sweeper.test.ts (renamed makeSeqDb).
 * - select() returns the next queued rows array (1 = orphan-select,
 *   2 = pending-drain).
 * - update().set(v).where() pushes `v` into `_sets` so we can assert which
 *   updates were issued (run-fail vs entry-reset, by payload shape).
 */
function makeSeqDb(selectQueue: unknown[][]) {
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

describe("runAoaDispatch — generalized #99 dispatcher", () => {
  beforeEach(() => {
    consumerMock.mockClear();
    ensureExtractionMock.mockClear();
    listOutboxMock.mockClear();
    ensureExtractionMock.mockResolvedValue("ext-1");
    listOutboxMock.mockResolvedValue(["ext-1"]);
  });

  it("Phase-2: company WITH an enabled outbox agent → entry dispatched via runExtractionConsumer(db, companyId, entryId, agentId)", async () => {
    const db = makeSeqDb([
      [], // Phase-1 orphan-select: nothing stale
      [{ id: "e1", companyId: "co-1" }], // Phase-2 pending-drain
    ]);
    listOutboxMock.mockResolvedValue(["ext-1"]);
    ensureExtractionMock.mockResolvedValue("ext-1");

    await runAoaDispatch(db, { limiterMax: 2, staleMs: 600_000 });

    expect(listOutboxMock).toHaveBeenCalledWith(db, "co-1");
    expect(ensureExtractionMock).toHaveBeenCalledWith(db, "co-1");
    expect(consumerMock).toHaveBeenCalledWith(db, "co-1", "e1", "ext-1");
  });

  it("Phase-2 gate: company with NO enabled outbox agent → its pending entry is NOT dispatched", async () => {
    const db = makeSeqDb([
      [], // Phase-1: nothing stale
      [{ id: "e2", companyId: "co-no-outbox" }], // Phase-2 pending
    ]);
    listOutboxMock.mockResolvedValue([]); // no enabled outbox trigger

    await runAoaDispatch(db, { limiterMax: 2, staleMs: 600_000 });

    expect(listOutboxMock).toHaveBeenCalledWith(db, "co-no-outbox");
    // Gated out: neither the agent is resolved nor the consumer invoked.
    expect(ensureExtractionMock).not.toHaveBeenCalled();
    expect(consumerMock).not.toHaveBeenCalled();
  });

  // ── #99 Phase-1 linked-run reclaim (relocated verbatim from the retired
  //    extraction-sweeper.test.ts canary; this test now carries that
  //    coverage and must stay rigorous). The invariant has TWO halves:
  //    (positive) a STALE linked run → terminalize run + reset entry, and
  //    (negative) NOTHING stale → ZERO reclaim writes even when there is
  //    genuine pending work to drain (no false-reclaim of healthy in-flight).
  it("Phase-1 reclaim (#99 verbatim) POSITIVE: stale linked run terminalized → 'failed' AND entry reset → 'pending' (exactly one of each, then re-dispatched)", async () => {
    const db = makeSeqDb([
      [{ id: "e1", runId: "r1" }], // orphan-select (projected {id, runId})
      [{ id: "e1", companyId: "co-1" }], // pending-drain (now pending)
    ]);

    await runAoaDispatch(db, { limiterMax: 2, staleMs: 600_000 });

    // Exactly one stale linked run terminalized → 'failed' (guarded
    // status='running'); errorMessage is the aoa-dispatcher variant. The
    // exact-count guard proves no spurious extra run writes.
    const runFailSets = db._sets.filter(runFail);
    expect(runFailSets).toHaveLength(1);
    expect(runFailSets[0]).toMatchObject({
      status: "failed",
      errorMessage: "reclaimed: orphaned (aoa-dispatcher)",
    });
    expect(runFailSets[0].completedAt).toBeInstanceOf(Date);
    // Exactly one entry atomically reset → 'pending', extractionRunId null.
    const entryResetSets = db._sets.filter(entryReset);
    expect(entryResetSets).toHaveLength(1);
    // Precisely those two writes — nothing else was mutated.
    expect(db._sets).toHaveLength(2);
    // …and the just-reclaimed entry is then re-dispatched through the gate.
    expect(consumerMock).toHaveBeenCalledWith(db, "co-1", "e1", "ext-1");
  });

  it("Phase-1 reclaim (#99 verbatim) NEGATIVE: orphan-select empty (no stale linked run) → ZERO reclaim writes, but genuine pending is still drained", async () => {
    const db = makeSeqDb([
      [], // orphan-select: linked run recent/terminal → excluded by the query
      [{ id: "e3", companyId: "co-3" }], // a genuine pending entry still exists
    ]);

    await runAoaDispatch(db, { limiterMax: 2, staleMs: 600_000 });

    // No false-reclaim of healthy in-flight: NOTHING was terminalized/reset.
    expect(db._sets).toHaveLength(0);
    expect(db._sets.some(runFail)).toBe(false);
    expect(db._sets.some(entryReset)).toBe(false);
    // …yet the genuine pending entry was still drained exactly once.
    expect(consumerMock).toHaveBeenCalledWith(db, "co-3", "e3", "ext-1");
    expect(consumerMock).toHaveBeenCalledTimes(1);
  });

  it("memoizes the per-company outbox-check and extraction-agent within a tick", async () => {
    const db = makeSeqDb([
      [],
      [
        { id: "e1", companyId: "co-1" },
        { id: "e2", companyId: "co-1" },
      ],
    ]);
    listOutboxMock.mockResolvedValue(["ext-1"]);
    ensureExtractionMock.mockResolvedValue("ext-1");

    await runAoaDispatch(db, { limiterMax: 1, staleMs: 600_000 });

    expect(listOutboxMock).toHaveBeenCalledTimes(1);
    expect(ensureExtractionMock).toHaveBeenCalledTimes(1);
    expect(consumerMock).toHaveBeenCalledTimes(2);
  });

  it("no-op when nothing stuck and nothing pending", async () => {
    const db = makeSeqDb([[], []]);
    await runAoaDispatch(db, { limiterMax: 2, staleMs: 600_000 });
    expect(db._sets).toHaveLength(0);
    expect(consumerMock).not.toHaveBeenCalled();
  });
});
