import { beforeEach, describe, expect, it, vi } from "vitest";

// ── drizzle-orm stubs ─────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ and: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  inArray: vi.fn((col: unknown, vals: unknown) => ({ inArray: [col, vals] })),
}));

vi.mock("@armyofagents/db", () => {
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
    issues: makeTable("issues"),
    taskDependencies: makeTable("task_dependencies"),
  };
});

vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

// Keep fireWakeups inert — we assert on the RETURNED wake list, not the enqueue.
vi.mock("../services/issue-assignee-wakeup.js", () => ({
  enqueueIssueAssigneeWakeup: vi.fn().mockResolvedValue(undefined),
}));

import { dependencyService } from "../services/dependencies.js";
import { enqueueIssueAssigneeWakeup } from "../services/issue-assignee-wakeup.js";

// ── Mock DB helpers ──────────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

interface SequenceConfig {
  selects?: MockRow[][];
  inserts?: MockRow[][];
  updates?: MockRow[][];
}

function createSequenceDb(config: SequenceConfig = {}) {
  let selectIdx = 0;
  let insertIdx = 0;
  let updateIdx = 0;
  const updateCalls: unknown[][] = [];

  function makeChain(getResult: () => MockRow[], record?: (args: unknown[]) => void): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    const methods = [
      "from", "where", "orderBy", "limit", "leftJoin", "innerJoin",
      "values", "set", "returning", "groupBy", "catch",
    ];
    for (const m of methods) {
      chain[m] = (...args: unknown[]) => {
        if (m === "set" && record) record(args);
        return chain;
      };
    }
    chain.then = (resolve: (v: MockRow[]) => unknown) =>
      Promise.resolve(getResult()).then(resolve);
    return chain;
  }

  return {
    db: {
      select: (_fields?: unknown) =>
        makeChain(() => config.selects?.[selectIdx++] ?? []),
      insert: (_table: unknown) =>
        makeChain(() => config.inserts?.[insertIdx++] ?? []),
      update: (_table: unknown) =>
        makeChain(() => config.updates?.[updateIdx++] ?? [], (args) => updateCalls.push(args)),
    },
    updateCalls,
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const companyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const issueD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; // dependent
const issueP = "11111111-2222-4333-8444-555555555555"; // dependency (parent/upstream)
const agentX = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.mocked(enqueueIssueAssigneeWakeup).mockClear();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("A-M10 — preserve original status across auto-block via blockedFromStatus", () => {
  it("auto-blocking a backlog task captures blocked_from_status=backlog and status=blocked", async () => {
    const { db, updateCalls } = createSequenceDb({
      selects: [
        // addDependency: Promise.all → dependent (backlog), dependency (todo)
        [{ id: issueD, status: "backlog" }],
        [{ id: issueP, status: "todo" }],
        // assertNoCycle: first upstream walk → no upstream
        [],
      ],
      inserts: [[{ id: "dep-row-1", companyId, dependentIssueId: issueD, dependencyIssueId: issueP }]],
      updates: [[]],
    });

    const svc = dependencyService(db as never);
    await svc.addDependency(companyId, issueD, issueP, db as never);

    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]?.[0]).toMatchObject({
      status: "blocked",
      blockedFromStatus: "backlog",
    });
  });

  it("unblocking a backlog-origin task restores status=backlog, clears blockedFromStatus, and does NOT wake", async () => {
    const { db, updateCalls } = createSequenceDb({
      selects: [
        // resolveDependenciesTx: getDependentsTx → D is blocked
        [{ dependentIssueId: issueD, status: "blocked", blockedFromStatus: "backlog" }],
        // remaining deps of D → the just-completed one is done → all terminal
        [{ status: "done" }],
        // select assignee/workMode of D
        [{ assigneeAgentId: agentX, workMode: null }],
      ],
      updates: [[]],
    });

    const svc = dependencyService(db as never);
    const { tasksToWake } = await svc.resolveDependencies(companyId, issueP, db as never);

    // Restored to its original backlog status, blockedFromStatus cleared.
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]?.[0]).toMatchObject({
      status: "backlog",
      blockedFromStatus: null,
    });

    // A backlog task is not executable → must NOT be dispatched.
    expect(tasksToWake).toEqual([]);
  });

  it("regression: a todo-origin task restores to todo AND is added to tasksToWake", async () => {
    const { db, updateCalls } = createSequenceDb({
      selects: [
        // resolveDependenciesTx: getDependentsTx → D is blocked, origin todo
        [{ dependentIssueId: issueD, status: "blocked", blockedFromStatus: "todo" }],
        // remaining deps of D → done → all terminal
        [{ status: "done" }],
        // assignee of D
        [{ assigneeAgentId: agentX, workMode: null }],
      ],
      updates: [[]],
    });

    const svc = dependencyService(db as never);
    const { tasksToWake } = await svc.resolveDependencies(companyId, issueP, db as never);

    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]?.[0]).toMatchObject({
      status: "todo",
      blockedFromStatus: null,
    });
    expect(tasksToWake).toEqual([
      { companyId, agentId: agentX, issueId: issueD, workMode: null },
    ]);
  });

  it("maybeUnblockTx restores backlog origin, clears blockedFromStatus, and does NOT wake", async () => {
    const { db, updateCalls } = createSequenceDb({
      selects: [
        // handleCancelledDependency: getDependentsTx → D blocked
        [{ dependentIssueId: issueD, status: "blocked", blockedFromStatus: "backlog" }],
        // maybeUnblockTx: select D status + blockedFromStatus
        [{ status: "blocked", blockedFromStatus: "backlog" }],
        // remaining deps of D → none left → unblock
        [],
        // select assignee of D
        [{ assigneeAgentId: agentX, workMode: null }],
      ],
      updates: [[]],
    });

    const svc = dependencyService(db as never);
    // maybeUnblockTx is invoked through removeDependency and the cancelled
    // wrapper. Drive it via handleCancelledDependency with a single blocked
    // dependent whose blockedFromStatus is "backlog".
    const wakes = await svc.handleCancelledDependency(companyId, issueP, db as never);

    // Restored to backlog, blockedFromStatus cleared.
    const unblockUpdate = updateCalls
      .map((c) => c[0] as Record<string, unknown>)
      .find((s) => s && "blockedFromStatus" in s);
    expect(unblockUpdate).toMatchObject({ status: "backlog", blockedFromStatus: null });

    // backlog restore must not be added to the returned wake list
    expect(wakes).toEqual([]);
  });
});
