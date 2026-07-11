import { describe, expect, it, vi } from "vitest";

const ensureStandardDocumentsMock = vi.hoisted(() => vi.fn());

vi.mock("@armyofagents/db", () => {
  const makeTable = (name: string) => {
    const cols: Record<string, symbol> = {};
    return new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (typeof prop === "string") {
          if (!cols[prop]) cols[prop] = Symbol(prop);
          return cols[prop];
        }
        return undefined;
      },
    });
  };

  return {
    agents: makeTable("agents"),
    assets: makeTable("assets"),
    authUsers: makeTable("auth_users"),
    companyMemberships: makeTable("company_memberships"),
    companyUserProfiles: makeTable("company_user_profiles"),
    instanceUserRoles: makeTable("instance_user_roles"),
    invites: makeTable("invites"),
    issues: makeTable("issues"),
    mcpApiKeys: makeTable("mcp_api_keys"),
    principalPermissionGrants: makeTable("principal_permission_grants"),
    projects: makeTable("projects"),
    userRoles: makeTable("user_roles"),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  count: (..._args: unknown[]) => "count",
  eq: (..._args: unknown[]) => "eq",
  inArray: (..._args: unknown[]) => "inArray",
  isNull: (..._args: unknown[]) => "isNull",
  ne: (..._args: unknown[]) => "ne",
  sql: new Proxy(() => "sql", { get: () => () => "sql", apply: () => "sql" }),
}));

vi.mock("../services/access.js", () => ({
  accessService: () => ({
    ensureMembership: vi.fn(),
    getMembership: vi.fn().mockResolvedValue({ id: "membership-1", status: "active" }),
    setPrincipalGrants: vi.fn(),
  }),
}));

vi.mock("../services/org-hierarchy.js", () => ({
  orgHierarchyService: () => ({
    ensureParent: vi.fn(),
    assertNoCycle: vi.fn(),
    reparentChildren: vi.fn(),
  }),
}));

vi.mock("../services/human-capabilities.js", () => ({
  humanCapabilitiesService: () => ({
    ensureStandardDocuments: ensureStandardDocumentsMock,
  }),
}));

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: vi.fn(),
}));

import { teamService } from "../services/team.js";

type MockRow = Record<string, unknown>;

function createSequenceDb(config: { selects?: MockRow[][] } = {}) {
  let selectIdx = 0;
  const insertValues: unknown[] = [];

  function makeChain(getResult: () => MockRow[]) {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "innerJoin", "leftJoin", "orderBy", "limit"]) {
      chain[m] = (..._args: unknown[]) => chain;
    }
    chain.values = (value: unknown) => {
      insertValues.push(value);
      return chain;
    };
    chain.set = (..._args: unknown[]) => chain;
    chain.returning = () => chain;
    chain.then = (resolve: (v: MockRow[]) => unknown) => Promise.resolve(resolve(getResult()));
    return chain;
  }

  const db = {
    select: (..._args: unknown[]) => makeChain(() => config.selects?.[selectIdx++] ?? []),
    insert: (..._args: unknown[]) => makeChain(() => []),
    update: (..._args: unknown[]) => makeChain(() => []),
    delete: (..._args: unknown[]) => makeChain(() => []),
    transaction: async (fn: (tx: unknown) => Promise<void>) => {
      await fn(db);
    },
    _insertValues: insertValues,
  };
  return db;
}

describe("teamService addMember capability seeding", () => {
  it("seeds standard human capability documents for newly added members", async () => {
    ensureStandardDocumentsMock.mockReset();
    const db = createSequenceDb({
      selects: [
        [], // assertFounder: instance admin lookup
        [{ role: "founder", projectId: null }], // assertFounder: actor role lookup
        [], // duplicate member lookup
        [], // existing auth user lookup
        [], // updateUserRole current role: instance admin lookup
        [], // updateUserRole current role: existing role lookup
      ],
    });

    const result = await teamService(db as any).addMember(
      "company-1",
      { name: "Ada", email: "ada@example.com", role: "team_member" },
      "founder-1",
    );

    expect(result.userId).toMatch(/[0-9a-f-]{36}/);
    expect(ensureStandardDocumentsMock).toHaveBeenCalledWith("company-1", result.userId, "founder-1");
  });
});
