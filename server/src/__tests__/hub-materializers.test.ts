import { beforeEach, describe, expect, it, vi } from "vitest";

const { emitHubItem, buildApprovalHubEmit, buildStaleIssueHubEmit } = vi.hoisted(() => ({
  emitHubItem: vi.fn(),
  buildApprovalHubEmit: vi.fn((approval) => ({ sourceType: "approval", sourceId: approval.id })),
  buildStaleIssueHubEmit: vi.fn((issue) => ({ sourceType: "issue", sourceId: issue.id })),
}));

vi.mock("../services/hub-source-producers.js", () => ({
  buildApprovalHubEmit,
  buildStaleIssueHubEmit,
  emitHubItem,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (...args: unknown[]) => ({ eq: args }),
  inArray: (...args: unknown[]) => ({ inArray: args }),
  isNull: (...args: unknown[]) => ({ isNull: args }),
  lt: (...args: unknown[]) => ({ lt: args }),
}));

vi.mock("@armyofagents/db", () => ({
  approvals: { companyId: "approvals.companyId", status: "approvals.status" },
  issues: {
    companyId: "issues.companyId",
    status: "issues.status",
    assigneeAgentId: "issues.assigneeAgentId",
    updatedAt: "issues.updatedAt",
  },
}));

import { emitOpenApprovalHubItems } from "../services/hub-approval-requests.js";
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

describe("hub source materializers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emitHubItem.mockResolvedValue({ id: "hub-1" });
  });

  it("caps open approval materialization at 50", async () => {
    const { db, limits } = makeSelectDb([{ id: "approval-1" }]);

    await emitOpenApprovalHubItems(db as any, "co-1", 500);

    expect(limits).toEqual([50]);
    expect(buildApprovalHubEmit).toHaveBeenCalledWith({ id: "approval-1" });
    expect(emitHubItem).toHaveBeenCalledWith(db, { sourceType: "approval", sourceId: "approval-1" });
  });

  it("caps stale-work materialization at 50", async () => {
    const { db, limits } = makeSelectDb([{ id: "issue-1" }]);

    await emitStaleWorkHubItems(db as any, "co-1", 500);

    expect(limits).toEqual([50]);
    expect(buildStaleIssueHubEmit).toHaveBeenCalledWith({ id: "issue-1" });
    expect(emitHubItem).toHaveBeenCalledWith(db, { sourceType: "issue", sourceId: "issue-1" });
  });
});
