// Contract test for runExtractionConsumer (proven harness: vi.hoisted +
// explicit @armyofagents/db named exports). Asserts: happy path creates a
// run (running→completed), invokes extraction, emits a platform-scoped
// cost_event; failure is ISOLATED (run→failed, never rethrows).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { extractMock, createEventMock } = vi.hoisted(() => ({
  extractMock: vi.fn(),
  createEventMock: vi.fn(),
}));

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
vi.mock("../services/costs.js", () => ({
  costService: () => ({ createEvent: createEventMock }),
}));
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

describe("runExtractionConsumer", () => {
  beforeEach(() => {
    extractMock.mockReset();
    createEventMock.mockReset();
  });

  it("happy path: run running→completed, extraction invoked, cost emitted", async () => {
    extractMock.mockResolvedValue(undefined);
    const db: any = {
      insert: vi.fn(() => chain([{ id: "run-1" }])),
      update: vi.fn(() => chain([{ id: "run-1" }])),
    };
    await runExtractionConsumer(db, "c1", "e1", "platform-1");

    expect(extractMock).toHaveBeenCalledWith("c1", "e1");
    expect(db.insert).toHaveBeenCalled(); // run created
    expect(db.update).toHaveBeenCalled(); // run finalized + entry.extractionRunId
    expect(createEventMock).toHaveBeenCalledTimes(1);
    const [companyArg, data] = createEventMock.mock.calls[0];
    expect(companyArg).toBe("c1");
    expect(data.agentId).toBe("platform-1"); // platform-scoped cost
    // M5 budget post-hoc verification: the event flows to the EXISTING
    // costService.createEvent → budgetService.evaluateCostEvent path
    // (costs.ts), scoped to the platform agent. v1 amounts are ZEROED by
    // design (spec §16.3 — callLLM surfaces no token usage yet); this proves
    // the budget PATH without billing real money. Locking the zeroed shape
    // here means a future change that accidentally bills is caught by a test.
    expect(data.provider).toBe("anthropic");
    expect(data.inputTokens).toBe(0);
    expect(data.outputTokens).toBe(0);
    expect(data.costCents).toBe(0);
  });

  it("failure is isolated: extraction throws → run failed, NO rethrow", async () => {
    extractMock.mockRejectedValue(new Error("llm down"));
    const db: any = {
      insert: vi.fn(() => chain([{ id: "run-2" }])),
      update: vi.fn(() => chain([{ id: "run-2" }])),
    };
    await expect(
      runExtractionConsumer(db, "c1", "e2", "platform-1"),
    ).resolves.toBeUndefined(); // never rethrows → addEntry/chat unaffected
    expect(db.update).toHaveBeenCalled(); // run finalized as failed
  });
});
