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

const { consumerMock, ensureExtractionMock, listOutboxMock, publishLiveEventMock, runAoaMock } =
  vi.hoisted(() => ({
    consumerMock: vi.fn().mockResolvedValue(undefined),
    ensureExtractionMock: vi.fn().mockResolvedValue("ext-1"),
    listOutboxMock: vi.fn().mockResolvedValue(["ext-1"]),
    publishLiveEventMock: vi.fn(),
    runAoaMock: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: unknown[]) => ({ and: a })),
  or: vi.fn((...a: unknown[]) => ({ or: a })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  lt: vi.fn((a: unknown, b: unknown) => ({ lt: [a, b] })),
  isNull: vi.fn((c: unknown) => ({ isNull: c })),
  inArray: vi.fn((c: unknown, v: unknown) => ({ inArray: [c, v] })),
  notInArray: vi.fn((c: unknown, v: unknown) => ({ notInArray: [c, v] })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({
      sql: strings.join("?"),
      vals,
    }),
    {},
  ),
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
    agentWakeupRequests: t("agent_wakeup_requests"),
    agents: t("agents"),
  };
});
vi.mock("../services/internal-agent/aoa-agents/runner.js", () => ({
  runAoaAgent: runAoaMock,
}));
vi.mock("../services/internal-agent/subagents/extraction-consumer.js", () => ({
  runExtractionConsumer: consumerMock,
}));
vi.mock("../services/internal-agent/aoa-agents/ensure-extraction-agent.js", () => ({
  ensureExtractionAgent: ensureExtractionMock,
}));
vi.mock("../services/internal-agent/aoa-agents/triggers.js", () => ({
  listEnabledOutboxAgents: listOutboxMock,
}));
vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: publishLiveEventMock,
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { runAoaDispatch } from "../services/internal-agent/aoa-agents/dispatcher.js";

/**
 * Sequence-aware mock DB — VERBATIM the makeDb harness from
 * extraction-sweeper.test.ts (renamed makeSeqDb), extended for FX1.
 * Select slots, in dispatcher call order:
 *   0 = Phase-1 orphan-select (#99 verbatim: processing + linked run 'running' + stale)
 *   1 = Phase-2 pending-drain
 *   (2 = Phase-3 wakeup-select → defaults to [])
 *   3 = Phase-4 FX1 reclaim-select (processing + linked run 'failed')
 * Phase-4 runs LAST (after the wakeup drain) so the #99 select ordering the
 * other suites depend on is unchanged; it is functionally order-independent
 * (output is terminal 'failed', feeds no later phase).
 * - update().set(v).where() pushes `v` into `_sets` so we can assert which
 *   updates were issued (run-fail vs entry-reset vs FX1 entry→failed, by
 *   payload shape).
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
// FX1 Phase-1b: entry terminalized → 'failed' (NOT pending) with a
// sourceInfo.extractionError jsonb_set payload.
const entryFailReclaim = (s: any) =>
  s.extractionStatus === "failed" && s.sourceInfo !== undefined;

describe("runAoaDispatch — generalized #99 dispatcher", () => {
  beforeEach(() => {
    consumerMock.mockClear();
    ensureExtractionMock.mockClear();
    listOutboxMock.mockClear();
    publishLiveEventMock.mockClear();
    runAoaMock.mockClear();
    consumerMock.mockResolvedValue(undefined);
    runAoaMock.mockResolvedValue(undefined);
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

  // ── FX1 Part A / Phase-4: a disjoint reclaim. The existing Phase-1 (#99)
  //    reclaim handles entries whose linked run is still 'running' & stale →
  //    reset to 'pending' (retry). FX1 adds: an entry 'processing' whose
  //    linked run is already 'failed' (the runner's catch terminalized the
  //    RUN but — pre-FX1 — left the entry stuck 'processing' forever). These
  //    must be terminalized → 'failed' (NOT 'pending'; the run already
  //    failed, retrying it is wrong) with the discussion.extraction.failed
  //    LiveEvent. Mirrors extraction.ts. Runs LAST (select slot 3, after the
  //    Phase-3 wakeup select) so the #99 ordering other suites depend on is
  //    unchanged.
  it("Phase-4: processing entry w/ linked FAILED run → entry extractionStatus='failed' (NOT pending) + discussion.extraction.failed LiveEvent", async () => {
    const db = makeSeqDb([
      [], // 0: Phase-1 orphan-select: nothing 'running'+stale
      [], // 1: Phase-2 pending-drain: nothing pending
      [], // 2: Phase-3 wakeup-select: nothing queued
      // 3: Phase-4 reclaim-select — processing entry whose linked run failed.
      // Shape follows the Phase-4 select (id + discussionId + company).
      [
        {
          id: "e9",
          discussionId: "disc-9",
          companyId: "co-9",
        },
      ],
    ]);

    await runAoaDispatch(db, { limiterMax: 2, staleMs: 600_000 });

    // The entry was terminalized → 'failed' (NOT pending) with a
    // sourceInfo.extractionError jsonb_set payload (mirrors extraction.ts).
    const failSets = db._sets.filter(entryFailReclaim);
    expect(failSets).toHaveLength(1);
    expect(failSets[0].extractionStatus).toBe("failed");
    expect(failSets[0].sourceInfo).toBeDefined();
    // It must NOT have been reset to 'pending' (no retry loop on a run that
    // already failed).
    expect(db._sets.some(entryReset)).toBe(false);

    // discussion.extraction.failed LiveEvent published for the reclaimed entry.
    expect(publishLiveEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-9",
        type: "discussion.extraction.failed",
        payload: expect.objectContaining({
          discussionId: "disc-9",
          entryId: "e9",
          error: "reclaimed: extraction run failed (aoa-dispatcher)",
        }),
      }),
    );
    // It was NOT dispatched to the extraction consumer (terminal, not retry).
    expect(consumerMock).not.toHaveBeenCalled();
  });

  it("Phase-4: nothing failed-linked → no FX1 terminalize writes, no failed LiveEvent", async () => {
    const db = makeSeqDb([[], []]);
    await runAoaDispatch(db, { limiterMax: 2, staleMs: 600_000 });
    expect(db._sets.some(entryFailReclaim)).toBe(false);
    expect(publishLiveEventMock).not.toHaveBeenCalled();
  });

  // ── M4 / FX5: Phase-2 (extraction backlog, up to 200/tick) and Phase-3
  //    (@mention / delegate_to_subagent wakeups) must DRAIN CONCURRENTLY.
  //    Pre-fix the dispatcher fully `await`ed Phase-2 before it even queried
  //    Phase-3, with a SINGLE shared limiter — so under an extraction backlog
  //    every wakeup waited behind the entire extraction batch each tick and
  //    one noisy company starved others. This harness records select-slot
  //    order and supports the Phase-3 atomic-claim `.returning()`. The Phase-2
  //    consumer blocks on a manually-resolved gate; the test asserts the
  //    Phase-3 wakeup is claimed/run (runAoaAgent invoked) BEFORE Phase-2 is
  //    allowed to finish — proving the two drains overlap. It also asserts the
  //    Phase-1→Phase-2 ordering invariant and that Phase-4 still runs, and
  //    that the select calls are still issued in the original positional order
  //    (slot0 Phase-1, slot1 Phase-2, slot2 Phase-3, slot3 Phase-4) so the
  //    positional-select-sensitive sibling suites stay byte-stable.
  function makeConcurrencyDb(
    selectQueue: unknown[][],
    returningQueue: unknown[][],
  ) {
    let si = 0;
    let ui = 0;
    const selectOrder: number[] = [];
    const sets: any[] = [];
    const db: any = {
      _sets: sets,
      _selectOrder: selectOrder,
      select: () => {
        const n = si++;
        selectOrder.push(n);
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
          const idx = ui++;
          sets.push(v);
          const ret = returningQueue[idx] ?? [];
          return {
            where: () => ({
              returning: () => Promise.resolve(ret),
              then: (resolve: (x: unknown) => unknown) =>
                Promise.resolve(undefined).then(resolve),
            }),
          };
        },
      }),
    };
    return db;
  }

  it("M4/FX5: Phase-3 wakeup drain is NOT serialized behind Phase-2's full batch (drains overlap; Phase-1 still precedes Phase-2; Phase-4 still runs; positional select order preserved)", async () => {
    // Phase-2 consumer blocks until we explicitly release it.
    let releasePhase2!: () => void;
    const phase2Gate = new Promise<void>((res) => {
      releasePhase2 = res;
    });
    let phase2Resolved = false;
    consumerMock.mockImplementation(async () => {
      await phase2Gate;
      phase2Resolved = true;
    });

    // runAoaAgent (Phase-3) records whether it ran while Phase-2 was still
    // blocked. If the drains overlap it will; if Phase-3 is serialized behind
    // Phase-2 it can only run after we release the gate.
    let phase3RanWhilePhase2Blocked = false;
    runAoaMock.mockImplementation(async () => {
      if (!phase2Resolved) phase3RanWhilePhase2Blocked = true;
    });

    const db = makeConcurrencyDb(
      [
        // slot 0 — Phase-1 orphan-select: nothing stale (keeps writes clean)
        [],
        // slot 1 — Phase-2 pending-drain: a gated-in pending entry
        [{ id: "e1", companyId: "co-1" }],
        // slot 2 — Phase-3 wakeup-select: a queued aoa wakeup
        [{ id: "w1", agentId: "a1", companyId: "co-1", payload: { note: "x" } }],
        // slot 3 — Phase-4 reclaim-select: nothing failed-linked
        [],
      ],
      [
        // update[0] = Phase-3 atomic claim queued→processing → claimed
        [{ id: "w1" }],
      ],
    );

    const dispatch = runAoaDispatch(db, { limiterMax: 4, staleMs: 600_000 });

    // Let microtasks settle: Phase-1 (awaited) completes, then Phase-2 and
    // Phase-3 drains both get a chance to start. Phase-2's consumer is parked
    // on the gate; if the drains overlap, Phase-3's claim+runAoaAgent runs now.
    await new Promise((r) => setTimeout(r, 20));

    // The wakeup must have been claimed AND runAoaAgent invoked even though
    // Phase-2's batch is still blocked — proves Phase-3 is NOT serialized
    // behind Phase-2 (the starvation fix).
    expect(runAoaMock).toHaveBeenCalledWith(
      db,
      "a1",
      expect.objectContaining({ companyId: "co-1", source: "wakeup", wakeupId: "w1", note: "x" }),
    );
    expect(phase3RanWhilePhase2Blocked).toBe(true);
    expect(phase2Resolved).toBe(false); // Phase-2 genuinely still in-flight

    // Now release Phase-2 and let the whole tick finish.
    releasePhase2();
    await dispatch;

    expect(phase2Resolved).toBe(true);
    expect(consumerMock).toHaveBeenCalledWith(db, "co-1", "e1", "ext-1");

    // Ordering invariant: Phase-1 must complete before Phase-2 dispatches
    // (Phase-1 resets orphans → 'pending' which Phase-2's select must see).
    // The orphan select (slot 0) is consumed before the pending select
    // (slot 1), and both before the wakeup select (slot 2) and Phase-4 (slot
    // 3) — i.e. the SELECT calls keep their original positional order even
    // though the DRAINS overlap.
    expect(db._selectOrder).toEqual([0, 1, 2, 3]);

    // Phase-4 still runs last (its select slot was consumed; nothing to do).
    expect(db._sets.some(entryFailReclaim)).toBe(false);
  });
});
