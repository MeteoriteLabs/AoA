// Plan 2 Task 4 — install_mcp_connector approve()/reject() side-effect.
//
// Proves the new `install_mcp_connector` branch of approvalService:
//   approve():
//     (1) activate    → a `pending_approval` connector flips to `active`
//         (mcpConnectorService.update(connectorId, { status: "active" })).
//     (2) idempotent  → an already-`active` connector is NOT re-flipped.
//     (3) deleted     → getById() returns null → no throw, approval still resolves.
//     (4) company scope→ a connector whose companyId !== approval.companyId is NOT
//         flipped (update keys on id ALONE — the handler company-scope-checks itself).
//   reject():
//     (5) disable     → a `pending_approval` connector flips to `disabled`
//         (audit trail — reject disables, never deletes).
//   regression:
//     (6) approving/rejecting a hire_agent or crew_dispatch approval is
//         unaffected by the new code (connector service never touched).
//
// Mock style mirrors crew-dispatch-approval.test.ts: makeTableProxy +
// drizzleOperatorStubs for the schema/operator ESM cycle, a hand-rolled db
// whose select() is sequence-driven and whose update(<table>) is observable.
// mcpConnectorService is mocked at the module boundary so getById/update are
// controllable + assertable.

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
  companyMcpConnectors: makeTableProxy("company_mcp_connectors"),
  companyMcpConnectorAgents: makeTableProxy("company_mcp_connector_agents"),
}));
vi.mock("drizzle-orm", () => drizzleOperatorStubs());

// approve() resolves the deployment mode (for the connector status re-derivation)
// via loadConfig(), which reads the real ~/.aoa/config.json. Pinned here so this
// suite depends on nothing outside the repo. It is NOT benign-by-luck: today the
// mode cannot change the outcome (applyConnectorApproval passes `approved: true`,
// which satisfies the resolver's governance branch in every mode), but that is a
// property of the CURRENT resolver, not of this test — without the mock, a future
// mode-sensitive rule would make these assertions silently machine-dependent.
vi.mock("../config.js", () => ({
  loadConfig: () => ({ deploymentMode: "authenticated" }),
}));

// Hoisted collaborator mocks — the mock factories close over them and the test
// bodies assert on them.
const mocks = vi.hoisted(() => ({
  activatePendingApproval: vi.fn(),
  agentCreate: vi.fn(),
  terminate: vi.fn(),
  preflightCrewDispatch: vi.fn(),
  dispatchCreatedCrewTasks: vi.fn(),
  logActivity: vi.fn(),
  connGetById: vi.fn(),
  connUpdate: vi.fn(),
  connUpdateIfStatus: vi.fn(),
}));

vi.mock("../services/agents.js", () => ({
  agentService: () => ({
    activatePendingApproval: mocks.activatePendingApproval,
    create: mocks.agentCreate,
    terminate: mocks.terminate,
  }),
}));
vi.mock("../services/crew-budget.js", () => ({
  preflightCrewDispatch: mocks.preflightCrewDispatch,
}));
vi.mock("../services/crew-task-service.js", () => ({
  dispatchCreatedCrewTasks: mocks.dispatchCreatedCrewTasks,
}));
vi.mock("../services/activity-log.js", () => ({
  logActivity: mocks.logActivity,
}));
vi.mock("../services/mcp-connectors-crud.js", () => ({
  mcpConnectorService: () => ({
    getById: mocks.connGetById,
    update: mocks.connUpdate,
    updateIfStatus: mocks.connUpdateIfStatus,
  }),
}));

import { approvalService } from "../services/approvals.js";

const COMPANY = "company-A";

/**
 * Build a mock db for an approve()/reject() run.
 *
 * select() is sequence-driven: the 1st select is getExistingApproval. If
 * `taskRows` is provided (crew_dispatch), the 2nd select returns the issues
 * rows. update(<table>) returns [updatedApproval] for the approvals table and a
 * guarded-flip row for the issues table; every issues .set() payload that
 * matched a row is recorded in `issueUpdateSets`.
 */
function makeDb(
  existing: Record<string, unknown>,
  updatedApproval: unknown,
  taskRows?: Array<{ id: string; assigneeAgentId: string | null; workMode?: string; status?: string }>,
) {
  const selectResults: unknown[][] = taskRows ? [[existing], taskRows] : [[existing]];
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
  const state = { approvalsUpdated: false };

  const dispatchable = (taskRows ?? []).filter(
    (t) => t.workMode === "planning" && t.status === "todo",
  );
  let flipIdx = 0;

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
            if (table?._?.name === "approvals") state.approvalsUpdated = true;
            const flipRow = dispatchable[flipIdx];
            if (table?._?.name === "issues") flipIdx += 1;
            const rows =
              table?._?.name === "approvals"
                ? [updatedApproval]
                : table?._?.name === "issues"
                  ? flipRow
                    ? [{ id: flipRow.id, assigneeAgentId: flipRow.assigneeAgentId }]
                    : []
                  : [];
            if (table?._?.name === "issues" && rows.length > 0) issueUpdateSets.push(values);
            return {
              returning: () => ({
                then: (resolve: (r: unknown[]) => unknown) => resolve(rows),
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
    state,
  };
}

const pendingApproval = (type: string, payload: Record<string, unknown>) => ({
  id: "ap1",
  companyId: COMPANY,
  status: "pending",
  type,
  payload,
});

const resolvedApproval = (type: string, status: string, payload: Record<string, unknown>) => ({
  id: "ap1",
  companyId: COMPANY,
  status,
  type,
  payload,
});

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.logActivity.mockResolvedValue(undefined);
  mocks.dispatchCreatedCrewTasks.mockResolvedValue(undefined);
  mocks.connUpdate.mockResolvedValue({ id: "conn-1", status: "active" });
  mocks.connUpdateIfStatus.mockResolvedValue({ id: "conn-1", status: "active" });
});

describe("approvalService.approve — install_mcp_connector branch", () => {
  it("(1) activate: a pending_approval connector flips to active", async () => {
    mocks.connGetById.mockResolvedValue({
      id: "conn-1",
      companyId: COMPANY,
      status: "pending_approval",
      requiresSecret: false,
      secretRef: null,
    });

    const { db } = makeDb(
      pendingApproval("install_mcp_connector", { connectorId: "conn-1", serverName: "github" }),
      resolvedApproval("install_mcp_connector", "approved", {
        connectorId: "conn-1",
        serverName: "github",
      }),
    );

    const svc = approvalService(db);
    const result = await svc.approve("ap1", COMPANY, "user-A", "ok");

    expect(result).not.toBeNull();
    expect(mocks.connGetById).toHaveBeenCalledWith("conn-1");
    expect(mocks.connUpdateIfStatus).toHaveBeenCalledTimes(1);
    expect(mocks.connUpdateIfStatus).toHaveBeenCalledWith("conn-1", "pending_approval", {
      status: "active",
    });
  });

  it("(2) idempotent: an already-active connector is NOT re-flipped", async () => {
    mocks.connGetById.mockResolvedValue({
      id: "conn-1",
      companyId: COMPANY,
      status: "active",
      requiresSecret: false,
      secretRef: null,
    });

    const { db } = makeDb(
      pendingApproval("install_mcp_connector", { connectorId: "conn-1", serverName: "github" }),
      resolvedApproval("install_mcp_connector", "approved", {
        connectorId: "conn-1",
        serverName: "github",
      }),
    );

    const svc = approvalService(db);
    const result = await svc.approve("ap1", COMPANY, "user-A", "ok");

    expect(result).not.toBeNull();
    expect(mocks.connUpdate).not.toHaveBeenCalled();
    expect(mocks.connUpdateIfStatus).not.toHaveBeenCalled();
  });

  it("(3) deleted connector: getById returns null → no throw, approval still resolves", async () => {
    mocks.connGetById.mockResolvedValue(null);

    const { db } = makeDb(
      pendingApproval("install_mcp_connector", { connectorId: "conn-gone", serverName: "github" }),
      resolvedApproval("install_mcp_connector", "approved", {
        connectorId: "conn-gone",
        serverName: "github",
      }),
    );

    const svc = approvalService(db);
    const result = await svc.approve("ap1", COMPANY, "user-A", "ok");

    expect((result as { status?: string } | null)?.status).toBe("approved");
    expect(mocks.connUpdate).not.toHaveBeenCalled();
    expect(mocks.connUpdateIfStatus).not.toHaveBeenCalled();
  });

  it("(4) company scope: a connector from another company is NOT flipped", async () => {
    mocks.connGetById.mockResolvedValue({
      id: "conn-1",
      companyId: "company-OTHER",
      status: "pending_approval",
      requiresSecret: false,
      secretRef: null,
    });

    const { db } = makeDb(
      pendingApproval("install_mcp_connector", { connectorId: "conn-1", serverName: "github" }),
      resolvedApproval("install_mcp_connector", "approved", {
        connectorId: "conn-1",
        serverName: "github",
      }),
    );

    const svc = approvalService(db);
    const result = await svc.approve("ap1", COMPANY, "user-A", "ok");

    expect(result).not.toBeNull();
    expect(mocks.connUpdate).not.toHaveBeenCalled();
    expect(mocks.connUpdateIfStatus).not.toHaveBeenCalled();
  });

  it("no-op when payload.connectorId is missing", async () => {
    const { db } = makeDb(
      pendingApproval("install_mcp_connector", { serverName: "github" }),
      resolvedApproval("install_mcp_connector", "approved", { serverName: "github" }),
    );

    const svc = approvalService(db);
    const result = await svc.approve("ap1", COMPANY, "user-A", "ok");

    expect(result).not.toBeNull();
    expect(mocks.connGetById).not.toHaveBeenCalled();
    expect(mocks.connUpdate).not.toHaveBeenCalled();
    expect(mocks.connUpdateIfStatus).not.toHaveBeenCalled();
  });
});

describe("approvalService.reject — install_mcp_connector branch", () => {
  it("(5) disable: a pending_approval connector flips to disabled (not deleted)", async () => {
    mocks.connGetById.mockResolvedValue({
      id: "conn-1",
      companyId: COMPANY,
      status: "pending_approval",
      requiresSecret: false,
      secretRef: null,
    });
    mocks.connUpdate.mockResolvedValue({ id: "conn-1", status: "disabled" });

    const { db } = makeDb(
      pendingApproval("install_mcp_connector", { connectorId: "conn-1", serverName: "github" }),
      resolvedApproval("install_mcp_connector", "rejected", {
        connectorId: "conn-1",
        serverName: "github",
      }),
    );

    const svc = approvalService(db);
    const result = await svc.reject("ap1", COMPANY, "user-A", "no");

    expect((result as { status?: string }).status).toBe("rejected");
    expect(mocks.connUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.connUpdate).toHaveBeenCalledWith("conn-1", { status: "disabled" });
  });

  it("reject is a no-op when the connector is already active (only pending_approval → disabled)", async () => {
    mocks.connGetById.mockResolvedValue({
      id: "conn-1",
      companyId: COMPANY,
      status: "active",
      requiresSecret: false,
      secretRef: null,
    });

    const { db } = makeDb(
      pendingApproval("install_mcp_connector", { connectorId: "conn-1", serverName: "github" }),
      resolvedApproval("install_mcp_connector", "rejected", {
        connectorId: "conn-1",
        serverName: "github",
      }),
    );

    const svc = approvalService(db);
    await svc.reject("ap1", COMPANY, "user-A", "no");

    expect(mocks.connUpdate).not.toHaveBeenCalled();
    expect(mocks.connUpdateIfStatus).not.toHaveBeenCalled();
  });
});

describe("regression — hire_agent and crew_dispatch unaffected by the connector branch", () => {
  it("(6a) hire_agent approve still activates the pending agent and never touches the connector service", async () => {
    mocks.activatePendingApproval.mockResolvedValue(undefined);

    const { db } = makeDb(
      pendingApproval("hire_agent", { agentId: "agent-9" }),
      resolvedApproval("hire_agent", "approved", { agentId: "agent-9" }),
    );

    const svc = approvalService(db);
    const result = await svc.approve("ap1", COMPANY, "user-A", "hire");

    expect(result).not.toBeNull();
    expect(mocks.activatePendingApproval).toHaveBeenCalledWith("agent-9");
    expect(mocks.connGetById).not.toHaveBeenCalled();
    expect(mocks.connUpdate).not.toHaveBeenCalled();
    expect(mocks.connUpdateIfStatus).not.toHaveBeenCalled();
  });

  it("(6b) hire_agent reject still terminates the pending agent and never touches the connector service", async () => {
    mocks.terminate.mockResolvedValue(undefined);

    const { db } = makeDb(
      pendingApproval("hire_agent", { agentId: "agent-9" }),
      resolvedApproval("hire_agent", "rejected", { agentId: "agent-9" }),
    );

    const svc = approvalService(db);
    const result = await svc.reject("ap1", COMPANY, "user-A", "no");

    expect(result).not.toBeNull();
    expect(mocks.terminate).toHaveBeenCalledWith("agent-9");
    expect(mocks.connGetById).not.toHaveBeenCalled();
    expect(mocks.connUpdate).not.toHaveBeenCalled();
    expect(mocks.connUpdateIfStatus).not.toHaveBeenCalled();
  });

  it("(6c) crew_dispatch approve still dispatches and never touches the connector service", async () => {
    mocks.preflightCrewDispatch.mockResolvedValue({ allowed: true });

    const { db, issueUpdateSets } = makeDb(
      pendingApproval("crew_dispatch", { threadId: "thread-1", taskIds: ["t1"] }),
      resolvedApproval("crew_dispatch", "approved", { threadId: "thread-1", taskIds: ["t1"] }),
      [{ id: "t1", assigneeAgentId: "agent-1", workMode: "planning", status: "todo" }],
    );

    const svc = approvalService(db);
    await svc.approve("ap1", COMPANY, "user-A", "go");

    expect(issueUpdateSets).toHaveLength(1);
    expect(mocks.dispatchCreatedCrewTasks).toHaveBeenCalledTimes(1);
    expect(mocks.connGetById).not.toHaveBeenCalled();
    expect(mocks.connUpdate).not.toHaveBeenCalled();
    expect(mocks.connUpdateIfStatus).not.toHaveBeenCalled();
  });
});
