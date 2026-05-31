/**
 * chronicler.test.ts (sweep behavior)
 *
 * Tests:
 *   - Sweep queues wakeups for threads with stale cards
 *   - Sweep returns 0 when no Chronicler agent exists
 *   - Sweep does NOT re-queue when a recent (queued/processing) wakeup exists (debounce)
 *   - Sweep queues 0 when no stale threads
 *   - Sweep respects CHRONICLER_MAX_CONCURRENT (mock honors .limit)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: unknown[]) => ({ _op: "and", a })),
  eq: vi.fn((a: unknown, b: unknown) => ({ _op: "eq", a, b })),
  ne: vi.fn((a: unknown, b: unknown) => ({ _op: "ne", a, b })),
  gt: vi.fn((a: unknown, b: unknown) => ({ _op: "gt", a, b })),
  or: vi.fn((...a: unknown[]) => ({ _op: "or", a })),
  isNull: vi.fn((a: unknown) => ({ _op: "isNull", a })),
  isNotNull: vi.fn((a: unknown) => ({ _op: "isNotNull", a })),
  inArray: vi.fn((a: unknown, b: unknown) => ({ _op: "inArray", a, b })),
  sql: Object.assign(vi.fn((s: TemplateStringsArray) => ({ _sql: s })), { raw: vi.fn() }),
}));

vi.mock("@armyofagents/db", () => ({
  agents: new Proxy({} as any, { get: (_t, p) => p }),
  aoaAgentTriggers: new Proxy({} as any, { get: (_t, p) => p }),
  discussions: new Proxy({} as any, { get: (_t, p) => p }),
  agentWakeupRequests: new Proxy({} as any, { get: (_t, p) => p }),
}));

import {
  runChroniclerSweep,
  CHRONICLER_MAX_CONCURRENT,
} from "../services/internal-agent/aoa-agents/sweep-chronicler.js";

const AGENT_ID = "agent-chronicler-1";
const COMPANY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const THREAD_1 = "t1-cccc-cccc-cccc-cccccccccccc";
const THREAD_2 = "t2-dddd-dddd-dddd-dddddddddddd";

// A "result holder" that is BOTH awaitable (for the no-limit recentWakeups
// query) AND has a `.limit(n)` (for the staleThreads query, which the real code
// caps at CHRONICLER_MAX_CONCURRENT). `.limit(n)` honors n so the cap test is real.
function holder(rows: object[]) {
  return {
    limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    then: (resolve: (v: object[]) => unknown) => resolve(rows),
  };
}

function makeDb({
  chroniclerRows = [{ agentId: AGENT_ID, companyId: COMPANY_ID }],
  staleThreads = [{ id: THREAD_1 }, { id: THREAD_2 }],
  recentWakeups = [] as object[],
}: {
  chroniclerRows?: object[];
  staleThreads?: object[];
  recentWakeups?: object[];
} = {}) {
  // select call order: 1) chronicler agents (innerJoin) 2) staleThreads 3) recentWakeups
  const seq = [staleThreads, recentWakeups];
  let seqCall = 0;

  const insertSpy = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) });

  return {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Promise.resolve(chroniclerRows),
        }),
        where: () => holder(seq[seqCall++] ?? []),
      }),
    }),
    insert: insertSpy,
  } as any;
}

describe("runChroniclerSweep", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queues wakeups for stale threads", async () => {
    const db = makeDb();
    const result = await runChroniclerSweep(db as any);
    expect(result.queued).toBe(2);
  });

  it("returns 0 when no Chronicler agents found", async () => {
    const db = makeDb({ chroniclerRows: [] });
    const result = await runChroniclerSweep(db as any);
    expect(result.queued).toBe(0);
  });

  it("does not queue when thread is already in recent wakeups (debounce)", async () => {
    const db = makeDb({
      recentWakeups: [
        { payload: { threadId: THREAD_1 } },
        { payload: { threadId: THREAD_2 } },
      ],
    });
    const result = await runChroniclerSweep(db as any);
    expect(result.queued).toBe(0);
  });

  it("queues 0 when no stale threads", async () => {
    const db = makeDb({ staleThreads: [] });
    const result = await runChroniclerSweep(db as any);
    expect(result.queued).toBe(0);
  });

  it("respects CHRONICLER_MAX_CONCURRENT limit (mock honors .limit)", async () => {
    const manyThreads = Array.from({ length: CHRONICLER_MAX_CONCURRENT + 5 }, (_, i) => ({ id: `t${i}` }));
    const db = makeDb({ staleThreads: manyThreads });
    const result = await runChroniclerSweep(db as any);
    expect(result.queued).toBe(CHRONICLER_MAX_CONCURRENT);
  });
});
