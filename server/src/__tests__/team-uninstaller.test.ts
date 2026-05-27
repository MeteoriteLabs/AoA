import { describe, it, expect, vi } from "vitest";

vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return {
    teams: tableProxy,
    teamMembers: tableProxy,
    agents: tableProxy,
    aoaAgentTriggers: tableProxy,
    marketplaceInstallOperations: tableProxy,
  };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("op:eq"),
  and: () => Symbol("op:and"),
  inArray: () => Symbol("op:inArray"),
}));
vi.mock("../../middleware/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { uninstallTeam } from "../services/marketplace-install/team-uninstaller.js";

// ── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock DB for uninstallTeam tests.
 *
 * select is called twice in the happy path:
 *   1. db.select().from(teams).where().limit(1)   → [teamRow] or []
 *   2. db.select().from(teamMembers).where()       → memberRows (no .limit())
 *
 * We use mockReturnValueOnce to deliver different responses for each call.
 */
function makeDb(
  teamRow: Record<string, unknown> | null,
  memberRows: { agentId: string }[],
) {
  const mockDelete = vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(memberRows.map((m) => ({ id: m.agentId }))),
    }),
  });
  const mockInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: "op-1" }]),
    }),
  });

  // First select call returns the team row (has .limit())
  const teamSelect = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(teamRow ? [teamRow] : []),
      }),
    }),
  };

  // Second select call returns member rows (no .limit() — await .where() directly)
  const memberSelect = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(memberRows),
    }),
  };

  const db: any = {
    select: vi.fn()
      .mockReturnValueOnce(teamSelect)
      .mockReturnValueOnce(memberSelect),
    delete: mockDelete,
    insert: mockInsert,
    transaction: vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        delete: mockDelete,
        insert: mockInsert,
        select: db.select,
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      };
      return fn(tx);
    }),
  };

  return { db, mockDelete, mockInsert };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("uninstallTeam", () => {
  it("throws 'Team not found' when team row does not exist", async () => {
    const { db } = makeDb(null, []);
    await expect(
      uninstallTeam({ db, companyId: "co-1", teamId: "t-missing" }),
    ).rejects.toThrow(/Team not found/);
  });

  it("deletes triggers, agents, and team row in a transaction (3 DELETE calls)", async () => {
    const teamRow = {
      id: "t-1",
      companyId: "co-1",
      templateOrigin: "aoa-curated/standard-crew",
    };
    const { db, mockDelete } = makeDb(teamRow, [
      { agentId: "a-1" },
      { agentId: "a-2" },
    ]);

    await uninstallTeam({ db, companyId: "co-1", teamId: "t-1" });

    // 1 delete for triggers, 1 for agents, 1 for team
    expect(mockDelete).toHaveBeenCalledTimes(3);
  });

  it("returns the deleted agent IDs", async () => {
    const teamRow = { id: "t-2", companyId: "co-1", templateOrigin: "aoa-curated/crew" };
    const { db } = makeDb(teamRow, [{ agentId: "a-10" }, { agentId: "a-11" }]);

    const result = await uninstallTeam({ db, companyId: "co-1", teamId: "t-2" });

    expect(result.deletedAgentIds).toEqual(["a-10", "a-11"]);
  });

  it("skips trigger/agent deletes when team has no members (empty crew)", async () => {
    const teamRow = { id: "t-3", companyId: "co-1", templateOrigin: "aoa-curated/crew" };
    const { db, mockDelete } = makeDb(teamRow, []);

    await uninstallTeam({ db, companyId: "co-1", teamId: "t-3" });

    // Only team row deleted (no triggers or agents)
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });

  it("logs the operation to marketplace_install_operations", async () => {
    const teamRow = { id: "t-4", companyId: "co-1", templateOrigin: "aoa-curated/crew" };
    const { db, mockInsert } = makeDb(teamRow, [{ agentId: "a-20" }]);

    await uninstallTeam({ db, companyId: "co-1", teamId: "t-4" });

    // At least one INSERT call (the operation log)
    expect(mockInsert).toHaveBeenCalled();
    const insertValues = mockInsert.mock.results[0]?.value?.values?.mock?.calls?.[0]?.[0];
    expect(insertValues?.operationType ?? insertValues?.itemType).toBeDefined();
  });
});
