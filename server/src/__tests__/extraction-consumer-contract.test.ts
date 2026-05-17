// Contract: runExtractionConsumer depends ONLY on (db, companyId, entryId,
// platformAgentId) — it has no knowledge of HOW it was triggered. Invoking
// it directly produces the same extraction call a sweeper invocation would,
// which is what makes the §15 scaling ladder (interval → durable queue →
// worker → fleet) additive rather than a rewrite.
import { describe, expect, it, vi } from "vitest";

const { extractMock } = vi.hoisted(() => ({ extractMock: vi.fn().mockResolvedValue(undefined) }));

vi.mock("drizzle-orm", () => ({ eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })) }));
vi.mock("@armyofagents/db", () => {
  const t = (n: string) =>
    new Proxy({} as Record<string, unknown>, {
      get: (_x, p) => (typeof p === "string" ? Symbol(`${n}.${p}`) : undefined),
    });
  return { internalAgentRuns: t("internal_agent_runs"), discussionEntries: t("discussion_entries") };
});
vi.mock("../services/extraction.js", () => ({
  extractionService: () => ({ extractFromDiscussionEntry: extractMock }),
}));
vi.mock("../services/costs.js", () => ({ costService: () => ({ createEvent: vi.fn() }) }));
vi.mock("../middleware/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { runExtractionConsumer } from "../services/internal-agent/subagents/extraction-consumer.js";

function chain(ret: unknown[]) {
  const c: Record<string, unknown> = {};
  c.values = () => c;
  c.set = () => c;
  c.where = () => c;
  c.returning = () => Promise.resolve(ret);
  return c;
}

describe("extraction consumer is trigger-agnostic (contract)", () => {
  it("a direct invocation produces the same extraction call a sweeper would", async () => {
    const db: any = {
      insert: vi.fn(() => chain([{ id: "r" }])),
      update: vi.fn(() => chain([{ id: "r" }])),
    };
    await runExtractionConsumer(db, "cX", "eX", "pX");
    // Same (companyId, entryId) contract regardless of trigger source.
    expect(extractMock).toHaveBeenCalledWith("cX", "eX");
    expect(extractMock).toHaveBeenCalledTimes(1);
  });
});
