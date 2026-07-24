import { describe, it, expect, vi } from "vitest";

// Each table is DISTINGUISHABLE (`__table`) rather than one shared proxy, so the
// mock below can dispatch on which table a query reads. A positional/shared mock
// answers the wrong query with the right fixture — the exact failure that let a
// guard silently never execute in team-reconcile.test.ts (T2.3b F6).
vi.mock("@armyofagents/db", () => {
  const table = (name: string) =>
    new Proxy({}, { get: (_t, prop) => (prop === "__table" ? name : Symbol("col")) });
  return {
    teams: table("teams"),
    teamMembers: table("team_members"),
    agents: table("agents"),
    aoaAgentTriggers: table("aoa_agent_triggers"),
    marketplaceInstallOperations: table("marketplace_install_operations"),
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

import {
  uninstallTeam,
  ProtectedAgentUninstallError,
} from "../services/marketplace-install/team-uninstaller.js";

// ── helpers ────────────────────────────────────────────────────────────────

interface MemberRow {
  agentId: string;
  name: string;
  templateOrigin: string | null;
}

/**
 * Build a mock DB for uninstallTeam tests, dispatching on the table each
 * `select().from(...)` reads rather than on call order:
 *   - `teams`        → `[teamRow]` (or `[]`), awaited through `.limit(1)`
 *   - `team_members` → `memberRows`, awaited through `.where()` after an
 *                      `innerJoin` onto `agents`
 */
function makeDb(teamRow: Record<string, unknown> | null, memberRows: MemberRow[]) {
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

  const fromDispatch = (table: { __table?: string }) => {
    if (table?.__table === "teams") {
      return {
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(teamRow ? [teamRow] : []),
        }),
      };
    }
    if (table?.__table === "team_members") {
      return {
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(memberRows),
        }),
        where: vi.fn().mockResolvedValue(memberRows),
      };
    }
    throw new Error(`unexpected select().from(${table?.__table ?? "?"})`);
  };

  const db: any = {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockImplementation(fromDispatch) }),
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

const member = (
  agentId: string,
  name: string,
  templateOrigin: string | null = null,
): MemberRow => ({ agentId, name, templateOrigin });

const SCOUT = member("a-scout", "Scout", "agent:aoa-curated/aoa-scout");
const ENGINEER = member("a-eng", "Engineer", "agent:aoa-curated/aoa-engineer");

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
    const { db, mockDelete } = makeDb(teamRow, [SCOUT, ENGINEER]);

    await uninstallTeam({ db, companyId: "co-1", teamId: "t-1" });

    // 1 delete for triggers, 1 for agents, 1 for team
    expect(mockDelete).toHaveBeenCalledTimes(3);
  });

  it("returns the deleted agent IDs", async () => {
    const teamRow = { id: "t-2", companyId: "co-1", templateOrigin: "aoa-curated/crew" };
    const { db } = makeDb(teamRow, [SCOUT, ENGINEER]);

    const result = await uninstallTeam({ db, companyId: "co-1", teamId: "t-2" });

    expect(result.deletedAgentIds).toEqual(["a-scout", "a-eng"]);
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
    const { db, mockInsert } = makeDb(teamRow, [SCOUT]);

    await uninstallTeam({ db, companyId: "co-1", teamId: "t-4" });

    // At least one INSERT call (the operation log)
    expect(mockInsert).toHaveBeenCalled();
    const insertValues = mockInsert.mock.results[0]?.value?.values?.mock?.calls?.[0]?.[0];
    expect(insertValues?.operationType ?? insertValues?.itemType).toBeDefined();
  });
});

// ── T2.5 (D23): protected agents ───────────────────────────────────────────
//
// Team uninstall deletes member agents with raw SQL, so it bypasses
// `DELETE /agents/:id` entirely — a per-agent route guard cannot see it.

describe("uninstallTeam — protected agents (D23)", () => {
  it("refuses when the team carries Steward, whose templateOrigin is NULL", async () => {
    const teamRow = {
      id: "t-5",
      companyId: "co-1",
      templateOrigin: "team:aoa-curated/default-crew",
    };
    const { db } = makeDb(teamRow, [SCOUT, member("a-steward", "Steward", null)]);

    await expect(
      uninstallTeam({ db, companyId: "co-1", teamId: "t-5" }),
    ).rejects.toBeInstanceOf(ProtectedAgentUninstallError);
  });

  it("refuses BEFORE deleting anything (no partial destruction)", async () => {
    const teamRow = {
      id: "t-6",
      companyId: "co-1",
      templateOrigin: "team:aoa-curated/default-crew",
    };
    const { db, mockDelete, mockInsert } = makeDb(teamRow, [
      SCOUT,
      member("a-steward", "Steward", null),
    ]);

    await expect(uninstallTeam({ db, companyId: "co-1", teamId: "t-6" })).rejects.toThrow();

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("names the protected agents in the refusal", async () => {
    const teamRow = {
      id: "t-7",
      companyId: "co-1",
      templateOrigin: "team:aoa-curated/default-crew",
    };
    const { db } = makeDb(teamRow, [
      SCOUT,
      member("a-cmd", "Commander", "aoa-curated/standard-crew/commander@legacy"),
      member("a-steward", "Steward", null),
    ]);

    const err = await uninstallTeam({ db, companyId: "co-1", teamId: "t-7" }).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ProtectedAgentUninstallError);
    const protectedErr = err as ProtectedAgentUninstallError;
    expect(protectedErr.protectedAgents.map((a) => a.name)).toEqual(["Commander", "Steward"]);
    expect(protectedErr.message).toMatch(/Commander/);
    expect(protectedErr.message).toMatch(/Steward/);
  });

  it("refuses a RENAMED Commander (matched on its origin slug, not its name)", async () => {
    const teamRow = {
      id: "t-8",
      companyId: "co-1",
      templateOrigin: "team:aoa-curated/default-crew",
    };
    const { db } = makeDb(teamRow, [
      member("a-cmd", "Ops Lead", "aoa-curated/standard-crew/commander@legacy"),
    ]);

    await expect(
      uninstallTeam({ db, companyId: "co-1", teamId: "t-8" }),
    ).rejects.toBeInstanceOf(ProtectedAgentUninstallError);
  });

  // THE DISCRIMINATOR. A blanket guard — "refuse if any member is kind='aoa'",
  // or "refuse every crew team" — passes every test above and fails this one.
  it("still uninstalls a team of unprotected crew agents, deleting every one", async () => {
    const teamRow = {
      id: "t-9",
      companyId: "co-1",
      templateOrigin: "team:aoa-curated/default-crew",
    };
    const { db, mockDelete } = makeDb(teamRow, [
      SCOUT,
      ENGINEER,
      // Chronicler shares Steward's NULL origin exactly; only identity separates them.
      member("a-chron", "Chronicler", null),
    ]);

    const result = await uninstallTeam({ db, companyId: "co-1", teamId: "t-9" });

    expect(result.deletedAgentIds).toEqual(["a-scout", "a-eng", "a-chron"]);
    expect(mockDelete).toHaveBeenCalledTimes(3);
  });
});
