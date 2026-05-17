// Contract test for runExtractionSweep — the durable PRIMARY trigger.
//
// Two phases per tick:
//  1. RECLAIM orphans: an entry stuck 'processing' whose internal_agent_runs
//     row is still 'running' and older than staleMs (crash between the M2
//     atomic claim and a terminal status) is atomically reset → 'pending'
//     (extraction_run_id cleared). Healthy in-flight ('running' run younger
//     than staleMs) is NOT reclaimed.
//  2. DRAIN pending (incl. just-reclaimed) → consumer under the limiter.
//
// Proves §6.2/§6.3 end-to-end recovery (the prior createdAt-based code
// selected orphans but never reset them, so the consumer's pending-claim
// no-op'd them — silent permanent stuck-in-processing).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { consumerMock, ensurePlatformMock } = vi.hoisted(() => ({
  consumerMock: vi.fn().mockResolvedValue(undefined),
  ensurePlatformMock: vi.fn().mockResolvedValue("pa-1"),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: unknown[]) => ({ and: a })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  lt: vi.fn((a: unknown, b: unknown) => ({ lt: [a, b] })),
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
 * - select() returns the next queued rows array (phase 1 = orphan ids,
 *   phase 2 = pending rows).
 * - update().set(v).where() captures `v` so we can assert the reclaim reset.
 */
function makeDb(selectQueue: unknown[][]) {
  let si = 0;
  const updates: any[] = [];
  const db: any = {
    _updates: updates,
    select: () => {
      const n = si++;
      const c: any = {};
      c.from = () => c;
      c.innerJoin = () => c;
      c.where = () => c;
      c.limit = () => c;
      c.then = (resolve: (v: unknown[]) => unknown) =>
        Promise.resolve(selectQueue[n] ?? []).then(resolve);
      return c;
    },
    update: () => ({
      set: (v: any) => {
        updates.push(v);
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
  return db;
}

describe("runExtractionSweep — orphan reclaim + pending drain", () => {
  beforeEach(() => {
    consumerMock.mockClear();
    ensurePlatformMock.mockClear();
  });

  it("RECLAIMS an orphaned 'processing' entry (old running run) → reset to pending → re-extracted", async () => {
    const db = makeDb([
      [{ id: "e-orphan" }], // phase1: one orphan
      [{ id: "e-orphan", companyId: "c1" }], // phase2: now pending
    ]);
    await runExtractionSweep(db, { limiterMax: 2, staleMs: 600_000 });

    expect(db._updates).toHaveLength(1);
    expect(db._updates[0].extractionStatus).toBe("pending");
    expect(db._updates[0].extractionRunId).toBeNull();
    expect(consumerMock).toHaveBeenCalledWith(db, "c1", "e-orphan", "pa-1");
  });

  it("does NOT reclaim when there are no stale running runs (healthy in-flight untouched)", async () => {
    const db = makeDb([
      [], // phase1: no orphans
      [{ id: "e2", companyId: "c2" }],
    ]);
    await runExtractionSweep(db, { limiterMax: 2, staleMs: 600_000 });

    expect(db._updates).toHaveLength(0);
    expect(consumerMock).toHaveBeenCalledWith(db, "c2", "e2", "pa-1");
    expect(consumerMock).toHaveBeenCalledTimes(1);
  });

  it("no-op when nothing stuck and nothing pending", async () => {
    const db = makeDb([[], []]);
    await runExtractionSweep(db, { limiterMax: 2, staleMs: 600_000 });
    expect(db._updates).toHaveLength(0);
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
