// Contract test for runExtractionSweep — the durable PRIMARY trigger.
// Polls pending entries (+ reclaims stale 'processing'), invokes the
// consumer per row under the limiter with that row's companyId + platform
// agent id. Proven harness (vi.hoisted + explicit named exports).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { consumerMock, ensurePlatformMock } = vi.hoisted(() => ({
  consumerMock: vi.fn().mockResolvedValue(undefined),
  ensurePlatformMock: vi.fn().mockResolvedValue("pa-1"),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: unknown[]) => ({ and: a })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  or: vi.fn((...a: unknown[]) => ({ or: a })),
  lt: vi.fn((a: unknown, b: unknown) => ({ lt: [a, b] })),
}));
vi.mock("@armyofagents/db", () => {
  const t = (n: string) =>
    new Proxy({} as Record<string, unknown>, {
      get: (_x, p) => (typeof p === "string" ? Symbol(`${n}.${p}`) : undefined),
    });
  return { discussionEntries: t("discussion_entries"), discussions: t("discussions") };
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

function selectChain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  c.from = () => c;
  c.innerJoin = () => c;
  c.where = () => c;
  c.limit = () => c;
  c.then = (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve);
  return c;
}

describe("runExtractionSweep", () => {
  beforeEach(() => {
    consumerMock.mockClear();
    ensurePlatformMock.mockClear();
  });

  it("invokes the consumer for each stuck entry with its companyId + platform id", async () => {
    const db: any = {
      select: () =>
        selectChain([
          { id: "e1", companyId: "c1" },
          { id: "e2", companyId: "c2" },
        ]),
    };
    await runExtractionSweep(db, { limiterMax: 2, staleMs: 600_000 });

    expect(consumerMock).toHaveBeenCalledWith(db, "c1", "e1", "pa-1");
    expect(consumerMock).toHaveBeenCalledWith(db, "c2", "e2", "pa-1");
    expect(consumerMock).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when nothing is stuck", async () => {
    const db: any = { select: () => selectChain([]) };
    await runExtractionSweep(db, { limiterMax: 2, staleMs: 600_000 });
    expect(consumerMock).not.toHaveBeenCalled();
  });

  it("resolves the platform agent once per company (cached within a sweep)", async () => {
    const db: any = {
      select: () =>
        selectChain([
          { id: "e1", companyId: "c1" },
          { id: "e2", companyId: "c1" }, // same company
        ]),
    };
    await runExtractionSweep(db, { limiterMax: 1, staleMs: 600_000 });
    expect(ensurePlatformMock).toHaveBeenCalledTimes(1); // cached, not per-row
  });
});
