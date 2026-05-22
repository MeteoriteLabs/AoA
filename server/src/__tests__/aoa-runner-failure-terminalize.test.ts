// FX1 / B1: a failed extraction RUN must terminalize its claimed entry —
// mirroring extraction.ts:639-659's failure branch VERBATIM (status='failed'
// + sourceInfo.extractionError + the discussion.extraction.failed LiveEvent),
// guarded on extractionRunId=runId AND extractionStatus='processing' (the
// runner is concurrent; extraction.ts guards by id only because it owns the
// lifecycle linearly). NO notification — extraction.ts writes none.
//
// Contract test (proxy-table + hoisted-mock harness, mirrors
// aoa-runner-tmpfile-cleanup.test.ts). Windows-runnable.
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  writeFileMock,
  unlinkMock,
  adapterExecute,
  createEventMock,
  buildMcpMock,
  buildBridgeSpecMock,
  publishLiveEventMock,
} = vi.hoisted(() => ({
  writeFileMock: vi.fn().mockResolvedValue(undefined),
  unlinkMock: vi.fn().mockResolvedValue(undefined),
  adapterExecute: vi.fn().mockResolvedValue(undefined),
  createEventMock: vi.fn().mockResolvedValue(undefined),
  buildMcpMock: vi.fn(() => ({})),
  buildBridgeSpecMock: vi.fn(() => ({
    command: "node",
    args: ["/bridge.js"],
    env: { AOA_SESSION_COMPANY_ID: "c" },
  })),
  publishLiveEventMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  writeFile: writeFileMock,
  unlink: unlinkMock,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: unknown[]) => ({ and: a })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({
      sql: strings.join("?"),
      vals,
    }),
    {},
  ),
}));

vi.mock("@armyofagents/db", () => {
  const makeTable = (name: string) =>
    new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (typeof prop === "string") return Symbol(`${name}.${prop}`);
        return undefined;
      },
    });
  return {
    agents: makeTable("agents"),
    internalAgentRuns: makeTable("internal_agent_runs"),
    discussionEntries: makeTable("discussion_entries"),
  };
});

vi.mock("../adapters/registry.js", () => ({
  getServerAdapter: vi.fn(() => ({ execute: adapterExecute })),
}));

vi.mock("../services/internal-agent/cli-mode.js", () => ({
  buildMcpConfig: buildMcpMock,
  buildMcpBridgeSpec: buildBridgeSpecMock,
}));

vi.mock("../services/heartbeat.js", () => ({
  resolveAdapterExecutionContext: vi.fn(() => ({
    executionTarget: {},
    runtimeCommandSpec: {},
  })),
}));

vi.mock("../services/internal-agent/aoa-agents/bridge-path.js", () => ({
  resolveBridgeEntrypoint: vi.fn(() => "/bridge"),
}));

vi.mock("../services/costs.js", () => ({
  costService: vi.fn(() => ({ createEvent: createEventMock })),
}));

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: publishLiveEventMock,
}));

vi.mock("../middleware/logger.js", () => {
  function makeLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => makeLogger();
    return l;
  }
  return { logger: makeLogger() };
});

import { runAoaAgent } from "../services/internal-agent/aoa-agents/runner.js";

// Db harness that records every update().set() payload + its where() arg, and
// drives the discussionEntries atomic-claim path. select() returns the agent
// row first (db.select().from(agents)...), then the discussionId resolution
// row (db.select({discussionId}).from(discussionEntries)...).
function makeDb(opts: { claim: boolean }) {
  const agentRow = {
    id: "a-1",
    companyId: "co-1",
    adapterType: "process",
    runtimeConfig: {},
    adapterConfig: {},
  };
  const sets: any[] = [];
  let selN = 0;

  const db: any = {
    _sets: sets,
    select: (proj?: any) => {
      const n = selN++;
      const c: any = {};
      c.from = () => c;
      c.where = () => c;
      c.then = (resolve: (v: unknown[]) => unknown) => {
        // n===0 → agent row (no projection). Later select() with a projection
        // arg → discussionId resolution.
        if (proj && "discussionId" in proj) {
          return Promise.resolve([{ discussionId: "disc-1" }]).then(resolve);
        }
        return Promise.resolve([agentRow]).then(resolve);
      };
      return c;
    },
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([{ id: "run-1" }]) }),
    }),
    update: () => {
      const u: any = {};
      let payload: any;
      u.set = (v: any) => {
        payload = v;
        return u;
      };
      u.where = (w: any) => {
        sets.push({ set: payload, where: w });
        const p: any = Promise.resolve(
          opts.claim ? [{ id: "e-1" }] : [],
        );
        // .where(...).returning() for the atomic claim; .where(...).catch()
        // for the extraction.ts-shaped guarded terminalizer.
        p.returning = () => Promise.resolve(opts.claim ? [{ id: "e-1" }] : []);
        p.catch = (cb: any) => Promise.resolve().catch(cb);
        return p;
      };
      return u;
    },
  };
  return db;
}

describe("FX1/B1: failed extraction run terminalizes its claimed entry", () => {
  beforeEach(() => {
    writeFileMock.mockClear().mockResolvedValue(undefined);
    unlinkMock.mockClear().mockResolvedValue(undefined);
    adapterExecute.mockClear().mockResolvedValue(undefined);
    createEventMock.mockClear().mockResolvedValue(undefined);
    buildMcpMock.mockClear().mockReturnValue({});
    publishLiveEventMock.mockClear();
  });

  it("claimed entry + adapter throws → entry updated extractionStatus='failed' guarded by extractionRunId=runId AND status='processing', LiveEvent published, run row failed; NO notification", async () => {
    adapterExecute.mockRejectedValueOnce(new Error("agent boom"));
    const db = makeDb({ claim: true });

    await expect(
      runAoaAgent(db as any, "a-1", {
        companyId: "co-1",
        source: "wakeup",
        entryId: "e-1",
      }),
    ).resolves.toBeUndefined();

    // The run row was terminalized → failed (internalAgentRuns update).
    const runFail = db._sets.find(
      (s: any) => s.set?.status === "failed" && "errorMessage" in (s.set ?? {}),
    );
    expect(runFail).toBeDefined();

    // The claimed entry was terminalized mirroring extraction.ts: status
    // 'failed' + sourceInfo jsonb_set(extractionError).
    const entryFail = db._sets.find(
      (s: any) =>
        s.set?.extractionStatus === "failed" && "sourceInfo" in (s.set ?? {}),
    );
    expect(entryFail).toBeDefined();
    expect(entryFail.set.sourceInfo).toBeDefined();

    // FX1 concurrency guard: the where-clause for the entry terminalizer is
    // and(eq(id, claimedEntryId), eq(extractionStatus,'processing'),
    // eq(extractionRunId, runId)) — NOT id-only. The @armyofagents/db proxy
    // returns Symbol(table.col) for columns (not JSON-serializable), so assert
    // structurally: each predicate is {eq:[colSymbol, value]}; match on
    // String(colSymbol) + the literal value.
    const preds: Array<{ eq: [unknown, unknown] }> = entryFail.where.and;
    expect(Array.isArray(preds)).toBe(true);
    const pred = (colNeedle: string, val: unknown) =>
      preds.some(
        (p) =>
          p &&
          Array.isArray(p.eq) &&
          String(p.eq[0]).includes(colNeedle) &&
          p.eq[1] === val,
      );
    // id = the claimed entry id
    expect(pred("discussion_entries.id", "e-1")).toBe(true);
    // status guard = 'processing'
    expect(pred("discussion_entries.extractionStatus", "processing")).toBe(
      true,
    );
    // run guard = this run's id ("run-1" from the harness)
    expect(pred("discussion_entries.extractionRunId", "run-1")).toBe(true);

    // discussion.extraction.failed LiveEvent published with the right shape.
    expect(publishLiveEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co-1",
        type: "discussion.extraction.failed",
        payload: expect.objectContaining({
          discussionId: "disc-1",
          entryId: "e-1",
          error: "agent boom",
        }),
      }),
    );

    // NO notification: nothing in db._sets writes a notifications row, and
    // there is no notifications insert (mirrors extraction.ts exactly).
    const anyNotif = db._sets.some((s: any) =>
      JSON.stringify(s).includes("notification"),
    );
    expect(anyNotif).toBe(false);
  });

  it("not-claimable path (claim returns empty) → entry NOT terminalized, no failed LiveEvent", async () => {
    // claim:false → the atomic claim RETURNING is empty → early return BEFORE
    // adapter.execute; the catch terminalizer must never run for this entry.
    const db = makeDb({ claim: false });

    await expect(
      runAoaAgent(db as any, "a-1", {
        companyId: "co-1",
        source: "wakeup",
        entryId: "e-1",
      }),
    ).resolves.toBeUndefined();

    // No entry → 'failed' + sourceInfo write happened.
    const entryFail = db._sets.find(
      (s: any) =>
        s.set?.extractionStatus === "failed" && "sourceInfo" in (s.set ?? {}),
    );
    expect(entryFail).toBeUndefined();
    // No discussion.extraction.failed event.
    expect(publishLiveEventMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "discussion.extraction.failed" }),
    );
  });
});
