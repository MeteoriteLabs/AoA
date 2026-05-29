/**
 * Phase G4.5 — Integration tests for crew dispatch budget gating.
 *
 * Verifies the preflightCrewDispatch gate end-to-end with respect to the
 * thread + budget + cost_events tables. The plan asks for four contracts;
 * the four below assert what the gate enforces today. The plan's
 * "thread_paused" contract is documented as a wiring gap with a TODO test
 * — the current preflight only consults `discussions.adjutantEnabled` and
 * does NOT read `discussions.crewPaused`, so a thread-level crew pause
 * does NOT block preflight at this boundary today (the listener boundary
 * DOES respect crewPaused — see thread-pipeline.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  makeTableProxy,
  drizzleOperatorStubs,
} from "../helpers/drizzle-mock.js";

vi.mock("@armyofagents/db", () => ({
  discussions: makeTableProxy("discussions"),
  discussionEntries: makeTableProxy("discussion_entries"),
  budgetPolicies: makeTableProxy("budget_policies"),
  costEvents: makeTableProxy("cost_events"),
}));

vi.mock("drizzle-orm", () => drizzleOperatorStubs());

import {
  preflightCrewDispatch,
  formatBudgetExhaustedMessage,
} from "../../services/crew-budget.js";

// ---------------------------------------------------------------------------
// Sequence DB harness — mirrors crew-budget.test.ts so we capture .select()
// rows (in order: thread → policy → spend) AND .insert() writes against
// discussion_entries (the budget-exhausted system entry).
// ---------------------------------------------------------------------------

type MockRow = Record<string, unknown>;

interface InsertCall {
  tableName?: string;
  values: Record<string, unknown>;
}

interface SequenceDbConfig {
  selects?: MockRow[][];
}

function tableNameOf(value: unknown): string | undefined {
  if (value && typeof value === "object") {
    const meta = (value as Record<string, unknown>)["_"];
    if (meta && typeof meta === "object") {
      const name = (meta as Record<string, unknown>).name;
      if (typeof name === "string") return name;
    }
  }
  return undefined;
}

function createSequenceDb(config: SequenceDbConfig = {}) {
  const selects = config.selects ?? [];
  let selectIdx = 0;
  const selectCalls: { fromTable?: string }[] = [];
  const insertCalls: InsertCall[] = [];

  function makeSelectChain(): any {
    const call: { fromTable?: string } = {};
    selectCalls.push(call);
    const chain: any = {};
    for (const m of ["where", "orderBy", "limit"]) {
      chain[m] = (..._args: unknown[]) => chain;
    }
    chain.from = (table: unknown) => {
      call.fromTable = tableNameOf(table);
      return chain;
    };
    chain.then = (resolve: (v: MockRow[]) => unknown) =>
      Promise.resolve(resolve(selects[selectIdx++] ?? []));
    return chain;
  }

  function makeInsertChain(tableName?: string): any {
    const call: InsertCall = { tableName, values: {} };
    insertCalls.push(call);
    const chain: any = {
      values: (v: Record<string, unknown>) => {
        call.values = v;
        return chain;
      },
      then: (resolve: (v: MockRow[]) => unknown) =>
        Promise.resolve(resolve([])),
    };
    return chain;
  }

  return {
    select: (..._args: unknown[]) => makeSelectChain(),
    insert: (table: unknown) => makeInsertChain(tableNameOf(table)),
    selectCalls,
    insertCalls,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COMPANY_ID = "co-budget-1";
const AGENT_ID = "agent-budget-caller";
const THREAD_ID = "thread-budget-1";

function threadRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: THREAD_ID,
    adjutantEnabled: true,
    companyId: COMPANY_ID,
    ...overrides,
  };
}

function policyRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "policy-budget-1",
    companyId: COMPANY_ID,
    scopeType: "company",
    scopeId: COMPANY_ID,
    metric: "cost_cents",
    windowKind: "calendar_month_utc",
    amountCents: 10000, // $100 cap
    warnPercent: 80,
    hardStopEnabled: true,
    isActive: true,
    ...overrides,
  };
}

function spendRow(totalCents: number): MockRow {
  return { total: totalCents };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("integration: preflightCrewDispatch budget gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Under budget → allowed; no system entry written ──────────────────

  it("returns {allowed:true} when company is under the budget cap", async () => {
    const db = createSequenceDb({
      selects: [
        [threadRow()],          // 1. thread
        [policyRow()],          // 2. policy ($100 cap)
        [spendRow(5000)],       // 3. spend ($50)
      ],
    });

    const result = await preflightCrewDispatch(db as any, {
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      threadId: THREAD_ID,
    });

    expect(result).toEqual({ allowed: true });
    // Green path → no system entry written into the thread.
    expect(db.insertCalls).toHaveLength(0);
  });

  it("returns {allowed:true} when no budget policy exists (unlimited)", async () => {
    const db = createSequenceDb({
      selects: [
        [threadRow()],
        [],                     // no policy row → unlimited
      ],
    });

    const result = await preflightCrewDispatch(db as any, {
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      threadId: THREAD_ID,
    });

    expect(result).toEqual({ allowed: true });
    // The cost-event scan is short-circuited when no policy exists. The
    // service only issues 2 selects in this branch.
    expect(db.selectCalls).toHaveLength(2);
    expect(db.insertCalls).toHaveLength(0);
  });

  // ── 2. Budget exhausted → blocked + system entry posted ─────────────────

  it("returns {allowed:false, reasonCode:'budget_exhausted'} AND posts a system entry into the thread", async () => {
    const db = createSequenceDb({
      selects: [
        [threadRow()],
        [policyRow()],          // $100 cap
        [spendRow(10500)],      // $105 spend — over cap
      ],
    });

    const result = await preflightCrewDispatch(db as any, {
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      threadId: THREAD_ID,
    });

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.reasonCode).toBe("budget_exhausted");

    // The reason must include the company id and the dollar amounts so the
    // founder can reconstruct exactly which scope hit the cap. (Verified
    // via raw cents — the human-readable USD string is asserted separately.)
    expect(result.reason).toContain(COMPANY_ID);
    expect(result.reason).toContain("10500");
    expect(result.reason).toContain("10000");

    // ── The system entry — this is what the founder SEES in the thread ──
    expect(db.insertCalls).toHaveLength(1);
    const entry = db.insertCalls[0];
    expect(entry.tableName).toBe("discussion_entries");
    expect(entry.values).toMatchObject({
      discussionId: THREAD_ID,
      inputType: "system",
      authorAgentId: null,
      createdBy: "system",
    });
    // The structured failure message — exact match against the exported
    // formatter so a future format drift is caught.
    expect(entry.values.rawContent).toBe(
      formatBudgetExhaustedMessage(10500, 10000),
    );
    expect(entry.values.rawContent).toMatch(/\$105\.00/);
    expect(entry.values.rawContent).toMatch(/\$100\.00/);
  });

  it("budget exhaustion at exactly the cap (spend === cap) still blocks (>= semantics)", async () => {
    const db = createSequenceDb({
      selects: [
        [threadRow()],
        [policyRow({ amountCents: 10000 })],
        [spendRow(10000)],      // exactly at cap
      ],
    });

    const result = await preflightCrewDispatch(db as any, {
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      threadId: THREAD_ID,
    });

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.reasonCode).toBe("budget_exhausted");
    // Boundary semantics: >= cap blocks. < cap allows. This is a
    // contract test for that boundary (vs > cap, which would let users
    // overshoot by a cent before blocking).
    expect(db.insertCalls).toHaveLength(1);
  });

  // ── 3. Per-thread Adjutant opt-out → blocked WITHOUT budget probe ───────

  it("thread.adjutantEnabled=false → reasonCode='thread_disabled', NO budget query, NO system entry", async () => {
    // The plan's "per-thread crewPaused=true causes preflight to return
    // thread_paused" maps to the implemented `adjutantEnabled=false` →
    // `thread_disabled` semantic. See the TODO at the bottom for the
    // subtle gap: crewPaused is NOT consulted by preflight today.
    const db = createSequenceDb({
      selects: [
        [threadRow({ adjutantEnabled: false })],
      ],
    });

    const result = await preflightCrewDispatch(db as any, {
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      threadId: THREAD_ID,
    });

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.reasonCode).toBe("thread_disabled");
    expect(result.reason).toMatch(/disabled/i);

    // Critical: ONLY one select (the thread row). No budget probe, no
    // cost-event scan. Disabled is the most authoritative signal —
    // anything the budget might say is moot.
    expect(db.selectCalls).toHaveLength(1);
    expect(db.insertCalls).toHaveLength(0);
  });

  it("missing thread row → reasonCode='thread_disabled' (defensive default)", async () => {
    const db = createSequenceDb({
      selects: [[]], // thread row not found
    });

    const result = await preflightCrewDispatch(db as any, {
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      threadId: "bad-thread-id",
    });

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.reasonCode).toBe("thread_disabled");
    expect(result.reason).toMatch(/not found/i);
    expect(db.insertCalls).toHaveLength(0);
  });

  // ── 4. Wiring gap: crewPaused is NOT checked at preflight today ─────────

  it(
    "TODO(wiring-gap): per-thread discussions.crewPaused=true is NOT checked by preflight today — " +
      "the plan asks for thread_paused semantics but only the listener boundary respects it",
    async () => {
      // Plan: "Per-thread crewPaused=true causes preflight to return
      // {ok:false, reason:'thread_paused'}".
      //
      // REALITY: preflightCrewDispatch only consults `adjutantEnabled` —
      // see server/src/services/crew-budget.ts lines 119-142. The
      // `discussions.crewPaused` column IS read at the OTHER thread-event
      // boundary (thread-events.ts:146; see thread-pipeline.test.ts test
      // "re-checks thread.crewPaused at fire time"), so the listener
      // honors the pause. The pause is currently NOT enforced at the crew
      // budget preflight boundary; a paused thread can still pass
      // preflight if the budget is healthy and adjutantEnabled=true.
      //
      // We assert the CURRENT behavior so the gap is visible. When this
      // gap is closed, flip the assertion to expect a new
      // reasonCode='thread_paused' (or whatever name lands).

      const db = createSequenceDb({
        selects: [
          // crewPaused=true but adjutantEnabled=true — currently allowed.
          [threadRow({ crewPaused: true, adjutantEnabled: true })],
          [],                  // no policy
        ],
      });

      const result = await preflightCrewDispatch(db as any, {
        companyId: COMPANY_ID,
        agentId: AGENT_ID,
        threadId: THREAD_ID,
      });

      // Today: passes preflight because crewPaused is not consulted here.
      expect(result.allowed).toBe(true);
    },
  );

  // ── 5. Sanity: green path issues no inserts across multiple configs ─────

  it("never writes a system entry on any green-path outcome", async () => {
    const cases: SequenceDbConfig[] = [
      // Under-budget with policy
      { selects: [[threadRow()], [policyRow()], [spendRow(1000)]] },
      // No policy (unlimited)
      { selects: [[threadRow()], []] },
      // Right under the cap by $0.01
      { selects: [[threadRow()], [policyRow({ amountCents: 10000 })], [spendRow(9999)]] },
    ];

    for (const cfg of cases) {
      const db = createSequenceDb(cfg);
      const result = await preflightCrewDispatch(db as any, {
        companyId: COMPANY_ID,
        agentId: AGENT_ID,
        threadId: THREAD_ID,
      });
      expect(result.allowed).toBe(true);
      expect(db.insertCalls).toHaveLength(0);
    }
  });
});
