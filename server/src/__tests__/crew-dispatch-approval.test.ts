// W1c Task 1 — crew_dispatch approve() side-effect.
//
// Proves the new `crew_dispatch` branch of approvalService.approve():
//   (a) preflight allowed  → flips each `planning` task to `standard` (via
//       db.update(issues)) and calls dispatchCreatedCrewTasks with those tasks.
//   (b) preflight blocked   → approve() THROWS and dispatchCreatedCrewTasks is
//       NOT called (the route runs approve() in a txn, so the throw rolls the
//       status flip back and the approval stays pending).
//   (c) eng-review finding A → a task already `standard` in the payload is NOT
//       re-flipped and NOT re-dispatched (no duplicate wakeup). This approval
//       only owns the tasks it itself flips planning→standard.
//
// Mock style mirrors approvals-service-companyid.test.ts: makeTableProxy +
// drizzleOperatorStubs for the schema/operator ESM cycle, a hand-rolled db
// whose select() is sequence-driven (first read = the approval row, second
// read = the issues rows) and whose update(issues) is observable.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { makeTableProxy, drizzleOperatorStubs } from "./helpers/drizzle-mock.js";

vi.mock("@armyofagents/db", () => ({
  approvals: makeTableProxy("approvals"),
  approvalComments: makeTableProxy("approval_comments"),
  issues: makeTableProxy("issues"),
  agents: makeTableProxy("agents"),
  companies: makeTableProxy("companies"),
  notifications: makeTableProxy("notifications"),
  agentProjects: makeTableProxy("agent_projects"),
  projects: makeTableProxy("projects"),
}));
vi.mock("drizzle-orm", () => drizzleOperatorStubs());

// approvalService() constructs agentService(db) at build time. We never take
// the hire_agent branch here (type is "crew_dispatch"), so an empty stub is fine.
vi.mock("../services/agents.js", () => ({
  agentService: () => ({
    activatePendingApproval: vi.fn(),
    create: vi.fn(),
    terminate: vi.fn(),
  }),
}));

// The two collaborators under test — hoisted so the mock factories can close
// over them and the test body can assert on them.
const mocks = vi.hoisted(() => ({
  preflightCrewDispatch: vi.fn(),
  dispatchCreatedCrewTasks: vi.fn(),
}));

vi.mock("../services/crew-budget.js", () => ({
  preflightCrewDispatch: mocks.preflightCrewDispatch,
}));
vi.mock("../services/crew-task-service.js", () => ({
  dispatchCreatedCrewTasks: mocks.dispatchCreatedCrewTasks,
}));

import { approvalService } from "../services/approvals.js";

const COMPANY = "company-A";
const THREAD = "thread-1";

/**
 * Build a mock db for a crew_dispatch approve() run.
 *
 * @param updatedApproval  the row returned by the guarded approvals UPDATE.
 * @param taskRows         the issues rows the branch's SELECT returns.
 *
 * select() is sequence-driven: the 1st select is getExistingApproval (returns
 * the pending approval), the 2nd select is the crew_dispatch branch's issues
 * read (returns taskRows). update() is observed via `issueUpdateSets`, which
 * records the .set() payload for every UPDATE targeting the issues table.
 */
function makeDb(updatedApproval: unknown, taskRows: unknown[]) {
  const existingApproval = {
    id: "ap1",
    companyId: COMPANY,
    status: "pending",
    type: "crew_dispatch",
    payload: {},
  };

  // getExistingApproval reads first, then the branch reads issues.
  const selectResults: unknown[][] = [[existingApproval], taskRows];
  let selectIdx = 0;

  const makeSelectChain = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => Promise.resolve(rows);
    chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(rows);
    return chain;
  };

  const issueUpdateSets: Array<Record<string, unknown>> = [];

  return {
    db: {
      select: () => {
        const rows = selectResults[selectIdx] ?? [];
        selectIdx += 1;
        return makeSelectChain(rows);
      },
      update: (table: { _?: { name?: string } }) => ({
        set: (values: Record<string, unknown>) => ({
          where: () => {
            if (table?._?.name === "issues") issueUpdateSets.push(values);
            return {
              returning: () => ({
                then: (resolve: (rows: unknown[]) => unknown) =>
                  resolve(table?._?.name === "approvals" ? [updatedApproval] : []),
              }),
            };
          },
        }),
      }),
      insert: () => ({
        values: () => ({ returning: () => Promise.resolve([]) }),
      }),
      delete: () => ({ where: () => Promise.resolve() }),
    } as any,
    issueUpdateSets,
  };
}

const approvedRow = (payload: Record<string, unknown>) => ({
  id: "ap1",
  companyId: COMPANY,
  type: "crew_dispatch",
  status: "approved",
  payload,
});

beforeEach(() => {
  mocks.preflightCrewDispatch.mockReset();
  mocks.dispatchCreatedCrewTasks.mockReset();
  mocks.dispatchCreatedCrewTasks.mockResolvedValue(undefined);
});

describe("approvalService.approve — crew_dispatch branch", () => {
  it("(a) preflight allowed: flips planning tasks to standard and dispatches them", async () => {
    mocks.preflightCrewDispatch.mockResolvedValue({ allowed: true });

    const taskRows = [
      { id: "t1", assigneeAgentId: "agent-1", workMode: "planning" },
      { id: "t2", assigneeAgentId: "agent-2", workMode: "planning" },
    ];
    const { db, issueUpdateSets } = makeDb(
      approvedRow({ threadId: THREAD, taskIds: ["t1", "t2"] }),
      taskRows,
    );

    const svc = approvalService(db);
    const result = await svc.approve("ap1", COMPANY, "user-A", "go");

    expect(result).not.toBeNull();
    expect(mocks.preflightCrewDispatch).toHaveBeenCalledWith(db, {
      companyId: COMPANY,
      agentId: "",
      threadId: THREAD,
    });

    // both planning tasks flipped to standard
    expect(issueUpdateSets).toHaveLength(2);
    for (const s of issueUpdateSets) {
      expect(s.workMode).toBe("standard");
      expect(s.updatedAt).toBeInstanceOf(Date);
    }

    // dispatched with the flipped tasks (workMode now "standard")
    expect(mocks.dispatchCreatedCrewTasks).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchCreatedCrewTasks).toHaveBeenCalledWith(db, COMPANY, [
      { id: "t1", assigneeAgentId: "agent-1", workMode: "standard" },
      { id: "t2", assigneeAgentId: "agent-2", workMode: "standard" },
    ]);
  });

  it("(b) preflight blocked: approve() throws and does NOT dispatch", async () => {
    mocks.preflightCrewDispatch.mockResolvedValue({
      allowed: false,
      reason: "Crew budget reached",
      reasonCode: "budget_exhausted",
    });

    const { db, issueUpdateSets } = makeDb(
      approvedRow({ threadId: THREAD, taskIds: ["t1"] }),
      [{ id: "t1", assigneeAgentId: "agent-1", workMode: "planning" }],
    );

    const svc = approvalService(db);

    await expect(svc.approve("ap1", COMPANY, "user-A", "go")).rejects.toThrow(
      /Cannot dispatch crew work/,
    );

    expect(issueUpdateSets).toHaveLength(0); // no flip
    expect(mocks.dispatchCreatedCrewTasks).not.toHaveBeenCalled();
  });

  it("(c) finding A: a task already 'standard' is not re-flipped and not re-dispatched", async () => {
    mocks.preflightCrewDispatch.mockResolvedValue({ allowed: true });

    const taskRows = [
      { id: "t1", assigneeAgentId: "agent-1", workMode: "planning" },
      { id: "t2", assigneeAgentId: "agent-2", workMode: "standard" }, // already dispatched
    ];
    const { db, issueUpdateSets } = makeDb(
      approvedRow({ threadId: THREAD, taskIds: ["t1", "t2"] }),
      taskRows,
    );

    const svc = approvalService(db);
    await svc.approve("ap1", COMPANY, "user-A", "go");

    // only the planning task flipped
    expect(issueUpdateSets).toHaveLength(1);
    expect(issueUpdateSets[0].workMode).toBe("standard");

    // only the flipped task dispatched — no duplicate wakeup for t2
    expect(mocks.dispatchCreatedCrewTasks).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchCreatedCrewTasks).toHaveBeenCalledWith(db, COMPANY, [
      { id: "t1", assigneeAgentId: "agent-1", workMode: "standard" },
    ]);
  });
});
