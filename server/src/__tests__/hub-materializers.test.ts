import { beforeEach, describe, expect, it, vi } from "vitest";

const { emitHubItem, buildApprovalHubEmit, buildBudgetAlertHubEmit, buildFailedRunHubEmit, buildStaleIssueHubEmit } = vi.hoisted(() => ({
  emitHubItem: vi.fn(),
  buildApprovalHubEmit: vi.fn((approval) => ({
    companyId: approval.companyId,
    semanticType: "approval_request",
    sourceType: "approval",
    sourceId: approval.id,
  })),
  buildStaleIssueHubEmit: vi.fn((issue) => ({
    companyId: issue.companyId,
    semanticType: "stale_work",
    sourceType: "issue",
    sourceId: issue.id,
  })),
  buildBudgetAlertHubEmit: vi.fn((alert) => ({
    companyId: alert.companyId,
    semanticType: "budget_alert",
    sourceType: "company_budget",
    sourceId: alert.companyId,
  })),
  buildFailedRunHubEmit: vi.fn((run) => ({
    companyId: run.companyId,
    semanticType: "run_failed",
    sourceType: "heartbeat_run",
    sourceId: run.id,
  })),
}));

vi.mock("../services/hub-source-producers.js", () => ({
  buildApprovalHubEmit,
  buildBudgetAlertHubEmit,
  buildFailedRunHubEmit,
  buildStaleIssueHubEmit,
  emitHubItem,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  desc: (...args: unknown[]) => ({ desc: args }),
  eq: (...args: unknown[]) => ({ eq: args }),
  gte: (...args: unknown[]) => ({ gte: args }),
  inArray: (...args: unknown[]) => ({ inArray: args }),
  isNull: (...args: unknown[]) => ({ isNull: args }),
  lt: (...args: unknown[]) => ({ lt: args }),
  not: (...args: unknown[]) => ({ not: args }),
  sql: () => "sql",
}));

vi.mock("@armyofagents/db", () => ({
  agents: {
    id: "agents.id",
    name: "agents.name",
    companyId: "agents.companyId",
    status: "agents.status",
  },
  approvals: { companyId: "approvals.companyId", status: "approvals.status" },
  companies: {
    id: "companies.id",
    budgetMonthlyCents: "companies.budgetMonthlyCents",
    updatedAt: "companies.updatedAt",
  },
  costEvents: {
    companyId: "costEvents.companyId",
    costCents: "costEvents.costCents",
    occurredAt: "costEvents.occurredAt",
  },
  heartbeatRuns: {
    id: "heartbeatRuns.id",
    companyId: "heartbeatRuns.companyId",
    agentId: "heartbeatRuns.agentId",
    status: "heartbeatRuns.status",
    error: "heartbeatRuns.error",
    createdAt: "heartbeatRuns.createdAt",
    updatedAt: "heartbeatRuns.updatedAt",
  },
  issues: {
    companyId: "issues.companyId",
    status: "issues.status",
    assigneeAgentId: "issues.assigneeAgentId",
    updatedAt: "issues.updatedAt",
  },
}));

import { emitOpenApprovalHubItems } from "../services/hub-approval-requests.js";
import { emitLegacyAlertHubItems } from "../services/hub-legacy-alerts.js";
import { emitStaleWorkHubItems } from "../services/hub-stale-work.js";

function makeSelectDb(rows: Array<Record<string, unknown>>) {
  const limits: number[] = [];
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn((value: number) => {
      limits.push(value);
      return Promise.resolve(rows);
    }),
  };
  return {
    db: { select: vi.fn(() => chain) },
    limits,
  };
}

function makeLegacyAlertDb() {
  const latestRuns = [
    {
      id: "run-failed",
      companyId: "co-1",
      agentId: "agent-1",
      agentName: "Scout",
      status: "failed",
      error: "boom",
      updatedAt: new Date("2026-06-30T00:00:00Z"),
    },
    {
      id: "run-ok",
      companyId: "co-1",
      agentId: "agent-2",
      agentName: "Builder",
      status: "succeeded",
      error: null,
      updatedAt: new Date("2026-06-30T00:00:00Z"),
    },
  ];
  const companyRows = [{ id: "co-1", budgetMonthlyCents: 10000, updatedAt: new Date("2026-06-30T00:00:00Z") }];
  const spendRows = [{ monthSpend: 8500 }];
  let selectCalls = 0;

  const latestChain = {
    from: vi.fn(() => latestChain),
    innerJoin: vi.fn(() => latestChain),
    where: vi.fn(() => latestChain),
    orderBy: vi.fn(() => Promise.resolve(latestRuns)),
  };
  const companyChain = {
    from: vi.fn(() => companyChain),
    where: vi.fn(() => companyChain),
    limit: vi.fn(() => Promise.resolve(companyRows)),
  };
  const spendChain = {
    from: vi.fn(() => spendChain),
    where: vi.fn(() => Promise.resolve(spendRows)),
  };

  return {
    db: {
      selectDistinctOn: vi.fn(() => latestChain),
      select: vi.fn(() => {
        selectCalls += 1;
        return selectCalls === 1 ? companyChain : spendChain;
      }),
    },
  };
}

describe("hub source materializers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emitHubItem.mockResolvedValue({ id: "hub-1" });
  });

  it("caps open approval materialization at 50", async () => {
    const { db, limits } = makeSelectDb([{ id: "approval-1", companyId: "co-1" }]);

    await emitOpenApprovalHubItems(db as any, "co-1", 500);

    expect(limits).toEqual([50]);
    expect(buildApprovalHubEmit).toHaveBeenCalledWith({ id: "approval-1", companyId: "co-1" });
    expect(emitHubItem).toHaveBeenCalledWith(db, {
      companyId: "co-1",
      semanticType: "approval_request",
      sourceType: "approval",
      sourceId: "approval-1",
    });
  });

  it("caps stale-work materialization at 50", async () => {
    const { db, limits } = makeSelectDb([{ id: "issue-1", companyId: "co-1" }]);

    await emitStaleWorkHubItems(db as any, "co-1", 500);

    expect(limits).toEqual([50]);
    expect(buildStaleIssueHubEmit).toHaveBeenCalledWith({ id: "issue-1", companyId: "co-1" });
    expect(emitHubItem).toHaveBeenCalledWith(db, {
      companyId: "co-1",
      semanticType: "stale_work",
      sourceType: "issue",
      sourceId: "issue-1",
    });
  });

  it("materializes latest failed runs and budget threshold alerts", async () => {
    const { db } = makeLegacyAlertDb();

    const result = await emitLegacyAlertHubItems(db as any, "co-1");

    expect(result).toEqual({ emitted: 2, failedRuns: 1, budgetAlerts: 1 });
    expect(buildFailedRunHubEmit).toHaveBeenCalledWith(expect.objectContaining({ id: "run-failed" }));
    expect(buildFailedRunHubEmit).not.toHaveBeenCalledWith(expect.objectContaining({ id: "run-ok" }));
    expect(buildBudgetAlertHubEmit).toHaveBeenCalledWith({
      companyId: "co-1",
      monthSpendCents: 8500,
      monthBudgetCents: 10000,
      monthUtilizationPercent: 85,
      updatedAt: new Date("2026-06-30T00:00:00Z"),
    });
    expect(emitHubItem).toHaveBeenCalledWith(db, {
      companyId: "co-1",
      semanticType: "run_failed",
      sourceType: "heartbeat_run",
      sourceId: "run-failed",
    });
    expect(emitHubItem).toHaveBeenCalledWith(db, {
      companyId: "co-1",
      semanticType: "budget_alert",
      sourceType: "company_budget",
      sourceId: "co-1",
    });
  });
});
