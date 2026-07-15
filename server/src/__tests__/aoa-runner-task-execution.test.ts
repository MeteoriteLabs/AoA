// Spec B Task 5 — runner `issueId` branch (the integration keystone).
//
// When the dispatcher wakes a crew agent with `payload.issueId`, the runner must:
//   1. stamp the internal_agent_runs row with relatedEntityType="task" (NOT
//      "issue" — that string is not in the column vocabulary) + relatedEntityId.
//   2. CLAIM the task via issueService(db).checkout(issueId, agentId,
//      ["todo","backlog","in_progress"], runId) before running the adapter.
//   3. on a checkout CONFLICT (checkout throws) → mark the run ROW 'failed'
//      (the runs enum has no 'succeeded') with a benign-skip errorMessage, then
//      RETURN { status: "succeeded" } (the AoaRunResult) so the dispatcher's
//      failure brake does NOT count a concurrency skip. Mirrors the entry-claim
//      race precedent (runner.ts:139-152).
//   4. SILENT-STUCK GUARD: after the adapter returns, if the task is still
//      'in_progress' AND its executionRunId === this runId (the agent exited
//      without calling set_task_status — non-claude / hung run), RELEASE the
//      task back to 'todo' (clear executionRunId/checkoutRunId) and THROW so the
//      run is marked failed loudly instead of leaving the task stuck forever.
//
// Harness: proxy-table + hoisted-mock + `_sets`-recording db (mirrors
// aoa-runner-failure-terminalize.test.ts). The dynamic `import("../../issues.js")`
// the runner performs is intercepted by `vi.mock("../services/issues.js", ...)`
// (vitest resolves both relative ids to the same module). Windows-runnable.

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  writeFileMock,
  unlinkMock,
  adapterExecute,
  createEventMock,
  buildMcpMock,
  buildBridgeSpecMock,
  publishLiveEventMock,
  publishIssueStatusChangedMock,
  checkoutMock,
  getByIdMock,
} = vi.hoisted(() => ({
  writeFileMock: vi.fn().mockResolvedValue(undefined),
  unlinkMock: vi.fn().mockResolvedValue(undefined),
  adapterExecute: vi.fn().mockResolvedValue({ exitCode: 0 }),
  createEventMock: vi.fn().mockResolvedValue(undefined),
  buildMcpMock: vi.fn(() => ({})),
  buildBridgeSpecMock: vi.fn(() => ({
    command: "node",
    args: ["/bridge.js"],
    env: { AOA_SESSION_COMPANY_ID: "c" },
  })),
  publishLiveEventMock: vi.fn(),
  publishIssueStatusChangedMock: vi.fn(),
  checkoutMock: vi.fn().mockResolvedValue({ id: "TASK-1", status: "in_progress" }),
  getByIdMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("node:fs/promises", () => ({
  writeFile: writeFileMock,
  unlink: unlinkMock,
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...a: unknown[]) => ({ and: a })),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...vals: unknown[]) => ({
      sql: strings.join("?"),
      vals,
    }),
    {},
  ),
}));

vi.mock("@armyofagents/db", () => {
  const makeTable = (name: string) =>
    new Proxy({} as Record<string, unknown>, {
      get(_t, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (typeof prop === "string") return Symbol(`${name}.${prop}`);
        return undefined;
      },
    });
  return {
    agents: makeTable("agents"),
    internalAgentRuns: makeTable("internal_agent_runs"),
    discussionEntries: makeTable("discussion_entries"),
    issues: makeTable("issues"),
    workQuestions: makeTable("work_questions"),
    memoryItems: makeTable("memory_items"),
    discussions: makeTable("discussions"),
    discussionExtractedItems: makeTable("discussion_extracted_items"),
    embeddingQueue: makeTable("embedding_queue"),
    memoryItemVersions: makeTable("memory_item_versions"),
    memoryRetrievals: makeTable("memory_retrievals"),
    suggestions: makeTable("suggestions"),
  };
});

vi.mock("../adapters/registry.js", () => ({
  getServerAdapter: vi.fn(() => ({ execute: adapterExecute })),
}));

vi.mock("../services/internal-agent/cli-mode.js", () => ({
  buildMcpConfig: buildMcpMock,
  buildMcpBridgeSpec: buildBridgeSpecMock,
}));

vi.mock("../services/heartbeat.js", () => ({
  resolveAdapterExecutionContext: vi.fn(() => ({
    executionTarget: {},
    runtimeCommandSpec: {},
  })),
}));

vi.mock("../services/internal-agent/aoa-agents/bridge-path.js", () => ({
  resolveBridgeEntrypoint: vi.fn(() => "/bridge"),
}));

vi.mock("../services/costs.js", () => ({
  costService: vi.fn(() => ({ createEvent: createEventMock })),
}));

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: publishLiveEventMock,
  // Task 5.6: runner.ts now also imports these from live-events. The silent-
  // stuck → todo release publishes issue.status_changed via this helper; stub it
  // so the call is observable (and never an undefined-call swallowed by the
  // best-effort wrapper). Presence helpers are stubbed for the (no-threadId)
  // task path where they are never invoked.
  publishIssueStatusChanged: publishIssueStatusChangedMock,
  threadWorkingAgents: { add: vi.fn(), remove: vi.fn(() => []), list: vi.fn(() => []) },
  broadcastThreadPresence: vi.fn(),
}));

// The runner reaches the issue surface via a DYNAMIC import("../../issues.js").
// Mock it here; vitest matches the resolved module id regardless of the
// caller-relative specifier. issueService(db) returns our hoisted spies.
vi.mock("../services/issues.js", () => ({
  issueService: () => ({ checkout: checkoutMock, getById: getByIdMock }),
}));

vi.mock("../middleware/logger.js", () => {
  function makeLogger(): any {
    const l: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    l.child = () => makeLogger();
    return l;
  }
  return { logger: makeLogger() };
});

import { runAoaAgent } from "../services/internal-agent/aoa-agents/runner.js";

// Db harness that records every update().set() payload + its where() arg into
// `_sets`. For a task wakeup (issueId set, NO entryId) the runner only calls
// db.select() once — to load the agent row. All issue access (checkout/getById)
// goes through the MOCKED issueService, not db.* — so the db mock here only has
// to model the agent load, the run insert, and the run/issue update writes.
function makeDb(options: { parkedQuestion?: boolean } = {}) {
  const agentRow = {
    id: "a-1",
    companyId: "co-1",
    name: "Scout",
    adapterType: "process",
    runtimeConfig: { aoa: { role: "scout" } },
    adapterConfig: {},
  };
  const sets: any[] = [];

  const db: any = {
    _sets: sets,
    select: () => {
      const c: any = {};
      let source = "";
      c.from = (table: { _?: { name?: string } }) => {
        source = table?._?.name ?? "";
        return c;
      };
      c.where = () => c;
      c.then = (resolve: (v: unknown[]) => unknown) =>
        Promise.resolve(
          source === "work_questions"
            ? (options.parkedQuestion ? [{ id: "question-1" }] : [])
            : [agentRow],
        ).then(resolve);
      return c;
    },
    insert: () => ({
      values: (v: any) => {
        sets.push({ insert: v });
        return { returning: () => Promise.resolve([{ id: "run-1" }]) };
      },
    }),
    update: () => {
      const u: any = {};
      let payload: any;
      u.set = (v: any) => {
        payload = v;
        return u;
      };
      u.where = (w: any) => {
        sets.push({ set: payload, where: w });
        const p: any = Promise.resolve([]);
        // A real guarded UPDATE…RETURNING returns the matched row; the runner's
        // task-release reads released.length to decide whether to publish/throw.
        // Return one row so the release "fires" (the test setups all have the task
        // still in_progress + owned by this run).
        p.returning = () => Promise.resolve([{ id: "TASK-1" }]);
        p.catch = (cb: any) => Promise.resolve().catch(cb);
        return p;
      };
      return u;
    },
  };
  return db;
}

const TASK_PAYLOAD = {
  companyId: "co-1",
  source: "dispatcher.task",
  issueId: "TASK-1",
};

describe("Spec B Task 5: runner issueId branch", () => {
  beforeEach(() => {
    writeFileMock.mockClear().mockResolvedValue(undefined);
    unlinkMock.mockClear().mockResolvedValue(undefined);
    adapterExecute.mockClear().mockResolvedValue({ exitCode: 0 });
    createEventMock.mockClear().mockResolvedValue(undefined);
    buildMcpMock.mockClear().mockReturnValue({});
    publishLiveEventMock.mockClear();
    publishIssueStatusChangedMock.mockClear();
    checkoutMock.mockClear().mockResolvedValue({ id: "TASK-1", status: "in_progress" });
    // Default getById → a non-stuck task so the silent-stuck guard is a no-op
    // (status not in_progress). Individual tests override.
    getByIdMock.mockClear().mockResolvedValue({ id: "TASK-1", status: "in_review", executionRunId: "run-1" });
  });

  it("(a) stamps the run row relatedEntityType='task' + relatedEntityId=issueId (NOT 'issue')", async () => {
    const db = makeDb();
    await runAoaAgent(db as any, "a-1", TASK_PAYLOAD);

    const insertRow = db._sets.find((s: any) => s.insert)?.insert;
    expect(insertRow).toBeDefined();
    expect(insertRow.relatedEntityType).toBe("task");
    expect(insertRow.relatedEntityType).not.toBe("issue");
    expect(insertRow.relatedEntityId).toBe("TASK-1");
  });

  it("(b) claims the task via checkout(issueId, agentId, ['todo','backlog','in_progress'], runId)", async () => {
    const db = makeDb();
    await runAoaAgent(db as any, "a-1", TASK_PAYLOAD);

    expect(checkoutMock).toHaveBeenCalledTimes(1);
    expect(checkoutMock).toHaveBeenCalledWith(
      "TASK-1",
      "a-1",
      ["todo", "backlog", "in_progress"],
      "run-1",
    );
  });

  it("(c) checkout CONFLICT (throws) → run returns { status:'succeeded' }, run ROW set 'failed' (benign skip), adapter NOT called", async () => {
    checkoutMock.mockRejectedValueOnce(new Error("Issue checkout conflict"));
    const db = makeDb();

    const result = await runAoaAgent(db as any, "a-1", TASK_PAYLOAD);

    // AoaRunResult is 'succeeded' — a concurrency skip is benign; the
    // dispatcher's failure brake must NOT count it.
    expect(result.status).toBe("succeeded");

    // The run ROW is terminalized 'failed' (the runs enum has no 'succeeded').
    const runFail = db._sets.find(
      (s: any) =>
        s.set?.status === "failed" &&
        typeof s.set?.errorMessage === "string" &&
        /checkout conflict/i.test(s.set.errorMessage),
    );
    expect(runFail).toBeDefined();

    // The adapter was never invoked — we bailed before execute.
    expect(adapterExecute).not.toHaveBeenCalled();
    // And no benign 'succeeded' string leaked onto any run row write.
    const anySucceededRow = db._sets.some((s: any) => s.set?.status === "succeeded");
    expect(anySucceededRow).toBe(false);
  });

  it("(d) silent-stuck: task still in_progress + executionRunId===runId after execute → released to 'todo' and run ends failed", async () => {
    // Agent exited WITHOUT calling set_task_status: getById reports the task is
    // still locked by THIS run. The guard must release it and throw.
    getByIdMock.mockResolvedValueOnce({
      id: "TASK-1",
      status: "in_progress",
      executionRunId: "run-1",
    });
    const db = makeDb();

    const result = await runAoaAgent(db as any, "a-1", TASK_PAYLOAD);

    // The throw lands in the catch → run row marked failed → failed AoaRunResult.
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/without moving the task|set_task_status/i);

    // The task was RELEASED back to 'todo' with the execution lock cleared.
    const release = db._sets.find(
      (s: any) => s.set?.status === "todo" && s.set?.executionRunId === null,
    );
    expect(release).toBeDefined();
    expect(release.set.checkoutRunId).toBe(null);

    // Task 5.6: the silent-stuck release is a crew status-MOVE (in_progress →
    // todo) that bypasses issueService.update — it must publish
    // issue.status_changed (company-broadcast) so the board drops the card back.
    expect(publishIssueStatusChangedMock).toHaveBeenCalledWith("co-1", "TASK-1", "todo");
  });

  it("(d') no release when task already moved on (status not in_progress) — guard is a no-op", async () => {
    getByIdMock.mockResolvedValueOnce({
      id: "TASK-1",
      status: "in_review",
      executionRunId: "run-1",
    });
    const db = makeDb();

    const result = await runAoaAgent(db as any, "a-1", TASK_PAYLOAD);

    // Agent moved the task forward → normal completion, no release write.
    expect(result.status).not.toBe("failed");
    const release = db._sets.find((s: any) => s.set?.status === "todo");
    expect(release).toBeUndefined();
  });

  it("keeps an in-progress task parked when this Crew run owns an open blocking question", async () => {
    getByIdMock.mockResolvedValueOnce({
      id: "TASK-1",
      status: "in_progress",
      executionRunId: "run-1",
    });
    const db = makeDb({ parkedQuestion: true });

    const result = await runAoaAgent(db as any, "a-1", TASK_PAYLOAD);

    expect(result.status).toBe("succeeded");
    const release = db._sets.find((s: any) => s.set?.status === "todo");
    expect(release).toBeUndefined();
    expect(publishIssueStatusChangedMock).not.toHaveBeenCalledWith("co-1", "TASK-1", "todo");
  });

  it("(d'') no release when a DIFFERENT run owns the task (executionRunId !== runId)", async () => {
    getByIdMock.mockResolvedValueOnce({
      id: "TASK-1",
      status: "in_progress",
      executionRunId: "some-other-run",
    });
    const db = makeDb();

    const result = await runAoaAgent(db as any, "a-1", TASK_PAYLOAD);

    // Not our lock → do not touch it; complete normally.
    expect(result.status).not.toBe("failed");
    const release = db._sets.find((s: any) => s.set?.status === "todo");
    expect(release).toBeUndefined();
  });
});
