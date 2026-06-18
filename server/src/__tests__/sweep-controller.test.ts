/**
 * sweep-controller — unit tests.
 *
 * Tests:
 *   1. Pending controller-path threads → runController called once per thread.
 *   2. No pending threads → runController NOT called.
 *   3. A runController rejection for one thread does NOT abort the others.
 *
 * Uses Proxy-table-stub + sequence-db pattern + module mocks for
 * thread-orchestration.js and controller-adjutant-runner.js.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── drizzle-orm mock ──────────────────────────────────────────────────────────
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  ne: vi.fn((a: unknown, b: unknown) => ({ ne: [a, b] })),
}));

// ── @armyofagents/db mock ─────────────────────────────────────────────────────
function tableProxy(name: string) {
  return new Proxy({}, { get(_t, prop) { return `${name}_${String(prop)}`; } });
}

vi.mock("@armyofagents/db", () => ({
  discussions: tableProxy("discussions"),
  threadOrchestrationState: tableProxy("tos"),
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

// ── thread-orchestration mock ─────────────────────────────────────────────────
const mockRunController = vi.fn().mockResolvedValue({ ran: false, reason: "no-pending" });

vi.mock("../services/thread-orchestration.js", () => ({
  threadOrchestrationService: vi.fn(() => ({
    runController: mockRunController,
  })),
}));

// ── controller-adjutant-runner mock — we inject a fake runner in tests ────────
const fakeAdjutantRunner = vi.fn().mockResolvedValue({ output: { status: "succeeded" } });

vi.mock(
  "../services/internal-agent/aoa-agents/controller-adjutant-runner.js",
  () => ({
    makeControllerAdjutantRunner: vi.fn(() => fakeAdjutantRunner),
  }),
);

// ── stale-action reaper mock — assert the sweep invokes it ────────────────────
// vi.hoisted so the spy exists before vi.mock's hoisted factory references it.
const { mockReapStaleThreadAgentActions } = vi.hoisted(() => ({
  mockReapStaleThreadAgentActions: vi.fn().mockResolvedValue({ reaped: 0 }),
}));

vi.mock("../services/thread-agent-actions.js", () => ({
  reapStaleThreadAgentActions: mockReapStaleThreadAgentActions,
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import { runControllerSweep } from "../services/internal-agent/aoa-agents/sweep-controller.js";

// ── DB builder helper ─────────────────────────────────────────────────────────

/**
 * Build a minimal stub db.
 * The sweep does ONE select (with innerJoin) returning pending thread rows.
 */
function makeDb(pendingThreadIds: string[]) {
  const rows = pendingThreadIds.map((id) => ({ threadId: id }));

  const db = {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn(() => Promise.resolve(rows)),
    })),
  };

  return db;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runControllerSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunController.mockResolvedValue({ ran: false, reason: "no-pending" });
    mockReapStaleThreadAgentActions.mockResolvedValue({ reaped: 0 });
  });

  it("4: reaps stale committing rows once at the start of the sweep", async () => {
    const db = makeDb(["thread-A"]);

    await runControllerSweep(db as any, { adjutantRunner: fakeAdjutantRunner });

    expect(mockReapStaleThreadAgentActions).toHaveBeenCalledTimes(1);
    expect(mockReapStaleThreadAgentActions).toHaveBeenCalledWith(db);
  });

  it("5: a reaper failure does not abort the sweep — pending threads still drain", async () => {
    const db = makeDb(["thread-A"]);
    mockReapStaleThreadAgentActions.mockRejectedValueOnce(new Error("reaper db error"));

    await expect(
      runControllerSweep(db as any, { adjutantRunner: fakeAdjutantRunner }),
    ).resolves.toBeUndefined();

    // The reaper threw but the sweep continued and still drove the pending thread.
    expect(mockRunController).toHaveBeenCalledTimes(1);
    expect(mockRunController).toHaveBeenCalledWith("thread-A", { adjutantRunner: fakeAdjutantRunner });
  });

  it("6: reaps even when there are no pending threads", async () => {
    const db = makeDb([]);

    await runControllerSweep(db as any, { adjutantRunner: fakeAdjutantRunner });

    expect(mockReapStaleThreadAgentActions).toHaveBeenCalledTimes(1);
    expect(mockRunController).not.toHaveBeenCalled();
  });

  it("1: calls runController once per pending thread with the injected adjutantRunner", async () => {
    const db = makeDb(["thread-A", "thread-B"]);

    await runControllerSweep(db as any, { adjutantRunner: fakeAdjutantRunner });

    expect(mockRunController).toHaveBeenCalledTimes(2);
    expect(mockRunController).toHaveBeenCalledWith("thread-A", { adjutantRunner: fakeAdjutantRunner });
    expect(mockRunController).toHaveBeenCalledWith("thread-B", { adjutantRunner: fakeAdjutantRunner });
  });

  it("2: no pending threads → runController NOT called", async () => {
    const db = makeDb([]);

    await runControllerSweep(db as any, { adjutantRunner: fakeAdjutantRunner });

    expect(mockRunController).not.toHaveBeenCalled();
  });

  it("3: a runController rejection for one thread does not abort the others", async () => {
    const db = makeDb(["thread-bad", "thread-good"]);

    mockRunController
      .mockRejectedValueOnce(new Error("db connection lost"))
      .mockResolvedValueOnce({ ran: true, suppressed: false, startEpoch: 1, cursorAdvancedTo: "entry-9" });

    // Must not throw
    await expect(
      runControllerSweep(db as any, { adjutantRunner: fakeAdjutantRunner }),
    ).resolves.toBeUndefined();

    // Both threads were attempted
    expect(mockRunController).toHaveBeenCalledTimes(2);
    expect(mockRunController).toHaveBeenCalledWith("thread-bad", { adjutantRunner: fakeAdjutantRunner });
    expect(mockRunController).toHaveBeenCalledWith("thread-good", { adjutantRunner: fakeAdjutantRunner });
  });
});
