/**
 * controller-adjutant-runner — unit tests.
 *
 * Tests:
 *   1. Resolves the Adjutant and calls runAgent with the correct payload.
 *   2. Returns { output: null, error: "thread not found" } when thread select is empty.
 *   3. Returns { output: null, error: "no Adjutant agent …" } when no Adjutant found.
 *   4. Propagates runAgent's errorMessage into the returned `error` field.
 *
 * Uses the Proxy-table-stub + sequence-db pattern (see strangler-flag.test.ts).
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
  agents: tableProxy("agents"),
  discussions: tableProxy("discussions"),
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

// ── runner.ts mock — we never want a real CLI spawn ──────────────────────────
vi.mock(
  "../services/internal-agent/aoa-agents/runner.js",
  () => ({ runAoaAgent: vi.fn() }),
);

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import { makeControllerAdjutantRunner } from "../services/internal-agent/aoa-agents/controller-adjutant-runner.js";

// ── DB builder helpers ────────────────────────────────────────────────────────

/**
 * Build a minimal stub db.
 * The runner does:
 *   select 1: discussions (returns threadRow or [])
 *   select 2: agents (returns adjutantRow or [])
 */
function makeDb(opts: {
  threadRow?: Record<string, unknown> | null;
  adjutantRow?: Record<string, unknown> | null;
}) {
  const { threadRow = null, adjutantRow = null } = opts;

  const results: Array<Array<Record<string, unknown>>> = [
    threadRow ? [threadRow] : [],
    adjutantRow ? [adjutantRow] : [],
  ];
  let callIdx = 0;

  const db = {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn(() => {
        const row = results[callIdx] ?? [];
        callIdx++;
        return Promise.resolve(row);
      }),
    })),
  };

  return db;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("makeControllerAdjutantRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1: resolves Adjutant and calls runAgent with correct payload", async () => {
    const fakeRunAgent = vi.fn().mockResolvedValue({ status: "succeeded" });

    const db = makeDb({
      threadRow: { companyId: "company-abc" },
      adjutantRow: { id: "adjutant-agent-1" },
    });

    const runner = makeControllerAdjutantRunner(db as any, { runAgent: fakeRunAgent });
    const result = await runner({
      threadId: "thread-42",
      entries: [],
      startEpoch: 1,
    });

    expect(fakeRunAgent).toHaveBeenCalledOnce();
    expect(fakeRunAgent).toHaveBeenCalledWith(
      db,
      "adjutant-agent-1",
      {
        companyId: "company-abc",
        source: "thread.controller",
        threadId: "thread-42",
      },
    );
    expect(result).toEqual({ output: { status: "succeeded" }, error: undefined });
  });

  it("2: returns { output: null, error: 'thread not found' } when thread select is empty", async () => {
    const fakeRunAgent = vi.fn();

    const db = makeDb({ threadRow: null });

    const runner = makeControllerAdjutantRunner(db as any, { runAgent: fakeRunAgent });
    const result = await runner({ threadId: "thread-missing", entries: [], startEpoch: 1 });

    expect(fakeRunAgent).not.toHaveBeenCalled();
    expect(result).toEqual({ output: null, error: "thread not found" });
  });

  it("3: returns error when no Adjutant agent found for company", async () => {
    const fakeRunAgent = vi.fn();

    const db = makeDb({
      threadRow: { companyId: "company-xyz" },
      adjutantRow: null,
    });

    const runner = makeControllerAdjutantRunner(db as any, { runAgent: fakeRunAgent });
    const result = await runner({ threadId: "thread-no-adj", entries: [], startEpoch: 1 });

    expect(fakeRunAgent).not.toHaveBeenCalled();
    expect(result).toEqual({ output: null, error: "no Adjutant agent for company" });
  });

  it("4: propagates runAgent errorMessage into the returned error field", async () => {
    const fakeRunAgent = vi.fn().mockResolvedValue({
      status: "failed",
      errorMessage: "cli exited with code 1",
    });

    const db = makeDb({
      threadRow: { companyId: "company-fail" },
      adjutantRow: { id: "adjutant-fail" },
    });

    const runner = makeControllerAdjutantRunner(db as any, { runAgent: fakeRunAgent });
    const result = await runner({ threadId: "thread-fail", entries: [], startEpoch: 1 });

    expect(result).toEqual({
      output: { status: "failed" },
      error: "cli exited with code 1",
    });
  });
});
