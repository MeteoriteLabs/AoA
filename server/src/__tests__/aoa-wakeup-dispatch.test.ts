import { beforeEach, describe, expect, it, vi } from "vitest";
const { runAoaMock } = vi.hoisted(() => ({ runAoaMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../services/internal-agent/aoa-agents/runner.js", () => ({ runAoaAgent: runAoaMock }));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ and: a }),
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  lt: (a: unknown, b: unknown) => ({ lt: [a, b] }),
  gt: (a: unknown, b: unknown) => ({ gt: [a, b] }),
  inArray: (a: unknown, b: unknown) => ({ inArray: [a, b] }),
  notInArray: (a: unknown, b: unknown) => ({ notInArray: [a, b] }),
}));
vi.mock("@armyofagents/db", () => {
  const t = (n: string) => new Proxy({}, { get: (_x, p) => typeof p === "string" ? Symbol(`${n}.${p}`) : undefined });
  return {
    agentWakeupRequests: t("awr"),
    agents: t("a"),
    discussionEntries: t("de"),
    discussions: t("d"),
    internalAgentConfig: t("iac"),
    internalAgentRuns: t("iar"),
  };
});
vi.mock("../services/internal-agent/aoa-agents/triggers.js", () => ({
  listEnabledOutboxAgents: vi.fn().mockResolvedValue([]),
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
import { runAoaDispatch } from "../services/internal-agent/aoa-agents/dispatcher.js";

/**
 * Build a chainable select mock that resolves to `val` when awaited.
 * The `.then(fn)` method correctly calls `fn(val)` so that `await chain`
 * and `.then(resolve)` both work.
 */
function makeSelectChain(val: unknown): any {
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: () => chain,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(val).then(resolve, reject),
  };
  return chain;
}

/**
 * Build a sequence-based mock db for Phase-3 tests.
 *
 * selectResults: array of values returned in order for each db.select() call.
 * Each update().set(v) → calls onSet(v, idx) and returns a where() object that:
 *   - .returning() → resolves to returningResults[idx] (or [])
 *   - is itself awaitable (plain update path) resolving to undefined
 */
function makePhase3Db(
  selectResults: unknown[],
  returningResults: unknown[][],
  onSet?: (v: unknown, idx: number) => void,
) {
  let selectIdx = 0;
  let updateIdx = 0;

  const db: any = {
    select: () => {
      const val = selectResults[selectIdx++] ?? [];
      return makeSelectChain(val);
    },
    update: () => ({
      set: (v: unknown) => {
        const idx = updateIdx++;
        onSet?.(v, idx);
        const ret = returningResults[idx] ?? [];
        return {
          where: () => ({
            // Support .returning() for the claim update
            returning: () => Promise.resolve(ret),
            // Support plain await (done/failed update)
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve(undefined).then(resolve, reject),
          }),
        };
      },
    }),
  };
  return db;
}

describe("aoa-wakeup-dispatch", () => {
  beforeEach(() => {
    runAoaMock.mockClear();
    runAoaMock.mockResolvedValue(undefined);
  });

  it("claims a queued wakeup for a kind='aoa' agent and runs it", async () => {
    // db call sequence:
    // select[0]: Phase 1 orphan select → []
    // select[1]: Phase 2 outbox select → []
    // select[2]: Phase 3 wakeup select → [{ id:'w1', agentId:'a1', companyId:'co-1', payload:{note:'x'} }]
    // update[0].set({status:'processing',...}).where().returning() → [{ id:'w1' }]  (claim)
    // update[1].set({status:'done',...}).where() → undefined  (done)
    const db = makePhase3Db(
      [
        [], // Phase 1 orphan
        [], // Phase 2 outbox
        // T1.2 (codex F6): the dispatcher now selects `source` from
        // agentWakeupRequests and passes it through to runAoaAgent unchanged
        // (previously hardcoded "wakeup", losing the real trigger context).
        // Test fixtures must include source so the pass-through is observable.
        [{ id: "w1", agentId: "a1", companyId: "co-1", source: "thread_mention", payload: { note: "x" } }], // Phase 3 wakeup rows
        [{ autonomyLevel: 0, crewPaused: false, model: "claude-sonnet-4-20250514" }], // resolveCompanyConfig
        [], // D3 run-rate window count (internalAgentRuns gt)
        [{ runtimeConfig: {}, adapterConfig: {} }], // agent row select
        [], // Phase 4 failedRunRows
      ],
      [
        [{ id: "w1" }], // claim RETURNING
        [],             // done update (not used via returning)
      ],
    );

    await runAoaDispatch(db, { limiterMax: 2, staleMs: 600_000 });

    expect(runAoaMock).toHaveBeenCalledWith(db, "a1", expect.objectContaining({
      companyId: "co-1",
      // T1.2 (codex F6): the ORIGINAL wakeup source flows through, not the
      // pre-T1.2 hardcoded "wakeup". Asserting against the actual fixture
      // ("thread_mention") is what pins this fix against future regressions.
      source: "thread_mention",
      wakeupId: "w1",
      note: "x",
    }));
  });

  it("skips a wakeup that is already claimed by another concurrent tick", async () => {
    // claim RETURNING is [] → already claimed by someone else
    const db = makePhase3Db(
      [
        [],
        [],
        [{ id: "w2", agentId: "a2", companyId: "co-2", source: "sweep.adjutant", payload: null }], // Phase 3 wakeup rows
        [{ autonomyLevel: 0, crewPaused: false, model: "claude-sonnet-4-20250514" }], // resolveCompanyConfig
        [], // D3 run-rate window count (internalAgentRuns gt)
        [{ runtimeConfig: {}, adapterConfig: {} }], // agent row select
        [], // Phase 4 failedRunRows
      ],
      [
        [], // claim returns empty → already claimed
      ],
    );

    await runAoaDispatch(db, { limiterMax: 2, staleMs: 600_000 });

    expect(runAoaMock).not.toHaveBeenCalled();
  });

  it("marks a wakeup as failed when runAoaAgent throws", async () => {
    runAoaMock.mockRejectedValueOnce(new Error("agent exploded"));

    const capturedSets: unknown[] = [];

    const db = makePhase3Db(
      [
        [],
        [],
        [{ id: "w3", agentId: "a3", companyId: "co-3", source: "phase-advance", payload: {} }], // Phase 3 wakeup rows
        [{ autonomyLevel: 0, crewPaused: false, model: "claude-sonnet-4-20250514" }], // resolveCompanyConfig
        [], // D3 run-rate window count (internalAgentRuns gt)
        [{ runtimeConfig: {}, adapterConfig: {} }], // agent row select
        [], // Phase 4 failedRunRows
      ],
      [
        [{ id: "w3" }], // claim RETURNING
        [],             // failed update (not used via returning)
      ],
      (v, _idx) => capturedSets.push(v),
    );

    await runAoaDispatch(db, { limiterMax: 2, staleMs: 600_000 });

    expect(runAoaMock).toHaveBeenCalledWith(db, "a3", expect.objectContaining({
      companyId: "co-3",
      // T1.2 (codex F6): original source flows through (was hardcoded "wakeup").
      source: "phase-advance",
      wakeupId: "w3",
    }));

    const failedUpdate = capturedSets.find((s: any) => s.status === "failed");
    expect(failedUpdate).toBeDefined();
    expect((failedUpdate as any).error).toBe("agent exploded");
  });
});
