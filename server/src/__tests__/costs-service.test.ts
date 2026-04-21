import { beforeEach, describe, expect, it, vi } from "vitest";

// ── DB / drizzle stubs ────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  desc: vi.fn((col: unknown) => ({ desc: col })),
  asc: vi.fn((col: unknown) => ({ asc: col })),
  gte: vi.fn((a: unknown, b: unknown) => ({ gte: [a, b] })),
  lt: vi.fn((a: unknown, b: unknown) => ({ lt: [a, b] })),
  lte: vi.fn((a: unknown, b: unknown) => ({ lte: [a, b] })),
  isNull: vi.fn((col: unknown) => ({ isNull: col })),
  isNotNull: vi.fn((col: unknown) => ({ isNotNull: col })),
  or: vi.fn((...args: unknown[]) => ({ or: args })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ inArray: [col, vals] })),
  sql: new Proxy(() => ({ sql: true }), {
    get: () => () => ({ sql: true }),
    apply: () => ({ sql: true }),
  }),
}));

vi.mock("@paperclipai/db", () => {
  const makeTable = (name: string) => {
    const cols: Record<string, symbol> = {};
    return new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (typeof prop === "string") {
          if (!cols[prop]) cols[prop] = Symbol(`${name}.${prop}`);
          return cols[prop];
        }
        return undefined;
      },
    });
  };
  return {
    costEvents: makeTable("cost_events"),
    agents: makeTable("agents"),
    companies: makeTable("companies"),
    issues: makeTable("issues"),
    projects: makeTable("projects"),
    activityLog: makeTable("activity_log"),
    heartbeatRuns: makeTable("heartbeat_runs"),
  };
});

const mockEvaluateCostEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../services/budgets.js", () => ({
  budgetService: () => ({ evaluateCostEvent: mockEvaluateCostEvent }),
}));
vi.mock("../middleware/logger.js", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { costService, inferBillingType } from "../services/costs.js";

// ── Mock DB helpers ──────────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

function createSequenceDb(config: {
  selects?: MockRow[][];
  inserts?: MockRow[][];
  updates?: MockRow[][];
} = {}) {
  let selectIdx = 0;
  let insertIdx = 0;
  let updateIdx = 0;

  function makeChain(getResult: () => MockRow[]): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    const methods = [
      "from", "where", "orderBy", "limit", "leftJoin", "innerJoin",
      "values", "set", "returning", "groupBy",
    ];
    for (const m of methods) {
      chain[m] = (..._args: unknown[]) => chain;
    }
    chain.then = (resolve: (v: MockRow[]) => unknown) =>
      Promise.resolve(getResult()).then(resolve);
    return chain;
  }

  return {
    select: (_fields?: unknown) =>
      makeChain(() => config.selects?.[selectIdx++] ?? []),
    insert: (_table: unknown) =>
      makeChain(() => config.inserts?.[insertIdx++] ?? []),
    update: (_table: unknown) =>
      makeChain(() => config.updates?.[updateIdx++] ?? []),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select: (_fields?: unknown) =>
          makeChain(() => config.selects?.[selectIdx++] ?? []),
        insert: (_table: unknown) =>
          makeChain(() => config.inserts?.[insertIdx++] ?? []),
        update: (_table: unknown) =>
          makeChain(() => config.updates?.[updateIdx++] ?? []),
      }),
  };
}

/**
 * DB mock that captures values passed to insert(...).values(...) so tests can
 * assert createEvent derives biller / billingType correctly.
 */
function createCaptureDb(opts: {
  agentRow: MockRow;
  updatedAgentRow?: MockRow;
}) {
  const captured: { inserts: MockRow[] } = { inserts: [] };

  function makeChain(getResult: () => MockRow[]): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    const methods = [
      "from", "where", "orderBy", "limit", "leftJoin", "innerJoin",
      "set", "returning", "groupBy",
    ];
    for (const m of methods) {
      chain[m] = (..._args: unknown[]) => chain;
    }
    chain.then = (resolve: (v: MockRow[]) => unknown) =>
      Promise.resolve(getResult()).then(resolve);
    return chain;
  }

  function makeInsertChain() {
    const chain: Record<string, unknown> = {};
    const methods = ["returning"];
    chain.values = (v: MockRow) => {
      captured.inserts.push(v);
      const resultRow = { ...v, id: "event-id" };
      const inner: Record<string, unknown> = {};
      for (const m of methods) {
        inner[m] = () => inner;
      }
      inner.then = (resolve: (v: MockRow[]) => unknown) =>
        Promise.resolve([resultRow]).then(resolve);
      return inner;
    };
    return chain;
  }

  let selectCalls = 0;

  const select = () => {
    const idx = selectCalls++;
    // first select: lookup agent. second select (inside tx): updated agent.
    return makeChain(() =>
      idx === 0 ? [opts.agentRow] : [opts.updatedAgentRow ?? opts.agentRow],
    );
  };

  const db = {
    select,
    insert: () => makeInsertChain(),
    update: () => makeChain(() => []),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select,
        insert: () => makeInsertChain(),
        update: () => makeChain(() => []),
      }),
  };

  return { db, captured };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const companyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const agentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const baseAgent: MockRow = {
  id: agentId,
  companyId,
  name: "Planner",
  status: "active",
  budgetMonthlyCents: 0,
  spentMonthlyCents: 0,
};

const baseEventData = {
  agentId,
  provider: "claude_api",
  model: "claude-opus-4-7",
  inputTokens: 100,
  outputTokens: 50,
  costCents: 42,
  occurredAt: new Date("2026-04-21T00:00:00.000Z"),
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("inferBillingType", () => {
  it("maps claude_local → subscription_claude", () => {
    expect(inferBillingType("claude_local")).toBe("subscription_claude");
  });

  it("maps codex_local → subscription_codex", () => {
    expect(inferBillingType("codex_local")).toBe("subscription_codex");
  });

  it("maps API adapters → metered_api", () => {
    expect(inferBillingType("claude_api")).toBe("metered_api");
    expect(inferBillingType("openai_api")).toBe("metered_api");
    expect(inferBillingType("gemini_api")).toBe("metered_api");
  });

  it("returns 'unknown' for adapters with no billing assumption", () => {
    for (const p of [
      "cursor",
      "openclaw",
      "opencode_local",
      "gemini_local",
      "hermes_local",
      "http",
      "process",
    ]) {
      expect(inferBillingType(p)).toBe("unknown");
    }
  });

  it("returns 'unknown' for unrecognized providers", () => {
    expect(inferBillingType("mystery_provider")).toBe("unknown");
  });
});

describe("costService — createEvent biller / billingType defaults", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults biller to provider when caller omits it", async () => {
    const { db, captured } = createCaptureDb({ agentRow: baseAgent });
    const svc = costService(db as any);
    await svc.createEvent(companyId, baseEventData as any);
    expect(captured.inserts[0]).toMatchObject({
      biller: "claude_api",
      billingType: "metered_api",
    });
  });

  it("uses caller-provided biller when set", async () => {
    const { db, captured } = createCaptureDb({ agentRow: baseAgent });
    const svc = costService(db as any);
    await svc.createEvent(companyId, {
      ...baseEventData,
      biller: "anthropic_credits",
    } as any);
    expect(captured.inserts[0]?.biller).toBe("anthropic_credits");
  });

  it("uses caller-provided billingType when set", async () => {
    const { db, captured } = createCaptureDb({ agentRow: baseAgent });
    const svc = costService(db as any);
    await svc.createEvent(companyId, {
      ...baseEventData,
      provider: "claude_local",
      billingType: "subscription_overage",
    } as any);
    expect(captured.inserts[0]?.billingType).toBe("subscription_overage");
  });

  it("infers subscription_claude for claude_local", async () => {
    const { db, captured } = createCaptureDb({ agentRow: baseAgent });
    const svc = costService(db as any);
    await svc.createEvent(companyId, {
      ...baseEventData,
      provider: "claude_local",
    } as any);
    expect(captured.inserts[0]).toMatchObject({
      biller: "claude_local",
      billingType: "subscription_claude",
    });
  });

  it("infers 'unknown' for cursor / http / process adapters", async () => {
    for (const provider of ["cursor", "http", "process"]) {
      const { db, captured } = createCaptureDb({ agentRow: baseAgent });
      const svc = costService(db as any);
      await svc.createEvent(companyId, {
        ...baseEventData,
        provider,
      } as any);
      expect(captured.inserts[0]?.billingType).toBe("unknown");
      expect(captured.inserts[0]?.biller).toBe(provider);
    }
  });
});

describe("costService — aggregation methods", () => {
  beforeEach(() => vi.clearAllMocks());

  it("byModel returns rows from db with expected shape", async () => {
    const rows: MockRow[] = [
      { model: "claude-opus-4-7", totalCostCents: 500, eventCount: 3 },
      { model: "gpt-4o", totalCostCents: 250, eventCount: 2 },
    ];
    const db = createSequenceDb({ selects: [rows] });
    const svc = costService(db as any);
    const result = await svc.byModel(companyId);
    expect(result).toEqual(rows);
  });

  it("byProvider returns rows from db", async () => {
    const rows: MockRow[] = [
      { provider: "claude_api", totalCostCents: 300, eventCount: 4 },
    ];
    const db = createSequenceDb({ selects: [rows] });
    const svc = costService(db as any);
    const result = await svc.byProvider(companyId);
    expect(result).toEqual(rows);
  });

  it("byBiller returns rows with biller field (provider fallback encoded server-side)", async () => {
    const rows: MockRow[] = [
      { biller: "anthropic", totalCostCents: 900, eventCount: 5 },
      { biller: "claude_local", totalCostCents: 100, eventCount: 1 },
    ];
    const db = createSequenceDb({ selects: [rows] });
    const svc = costService(db as any);
    const result = await svc.byBiller(companyId);
    expect(result).toEqual(rows);
  });

  it("windowSpend('5h') returns single aggregate with windowKind set", async () => {
    const agg: MockRow[] = [{
      totalCostCents: 1234,
      totalInputTokens: 100,
      totalCachedInputTokens: 20,
      totalOutputTokens: 50,
    }];
    const db = createSequenceDb({ selects: [agg] });
    const svc = costService(db as any);
    const result = await svc.windowSpend(companyId, "5h");
    expect(result).toMatchObject({
      companyId,
      windowKind: "5h",
      totalCostCents: 1234,
      totalInputTokens: 100,
      totalCachedInputTokens: 20,
      totalOutputTokens: 50,
    });
  });

  it("windowSpend('24h') returns zeros when no events in window", async () => {
    const db = createSequenceDb({ selects: [[]] });
    const svc = costService(db as any);
    const result = await svc.windowSpend(companyId, "24h");
    expect(result).toMatchObject({
      companyId,
      windowKind: "24h",
      totalCostCents: 0,
      totalInputTokens: 0,
      totalCachedInputTokens: 0,
      totalOutputTokens: 0,
    });
  });

  it("windowSpend('7d') returns single aggregate with 7d windowKind", async () => {
    const agg: MockRow[] = [{
      totalCostCents: 5000,
      totalInputTokens: 1000,
      totalCachedInputTokens: 200,
      totalOutputTokens: 400,
    }];
    const db = createSequenceDb({ selects: [agg] });
    const svc = costService(db as any);
    const result = await svc.windowSpend(companyId, "7d");
    expect(result.windowKind).toBe("7d");
    expect(result.totalCostCents).toBe(5000);
  });
});

describe("costService — contract", () => {
  it("factory exposes all expected methods", () => {
    const db = createSequenceDb();
    const svc = costService(db as any);
    const methods = [
      "createEvent", "summary", "byAgent", "byProject",
      "byModel", "byProvider", "byBiller", "windowSpend",
    ];
    for (const m of methods) {
      expect(typeof (svc as any)[m], `missing method: ${m}`).toBe("function");
    }
  });
});
