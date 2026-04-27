import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the order of table.delete() calls inside companyService.remove().
const deleteCalls: string[] = [];

// Build a Proxy-based table stub that records its name when used in tx.delete().
function tableStub(name: string) {
  return new Proxy(
    {} as Record<string, unknown>,
    {
      get(_target, prop) {
        if (prop === "_") return { name };
        if (prop === "_tableName") return name;
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (prop === Symbol.toPrimitive || prop === "toString") {
          return () => `[Table:${name}]`;
        }
        // Drizzle uses column property accesses internally; return a unique
        // symbol per column so equality checks don't collide across tables.
        if (typeof prop === "string") {
          return Symbol(`${name}.${prop}`);
        }
        return undefined;
      },
    },
  );
}

vi.mock("@armyofagents/db", () => {
  const tableNames = [
    "heartbeatRunEvents",
    "agentTaskSessions",
    "heartbeatRuns",
    "agentWakeupRequests",
    "agentApiKeys",
    "agentRuntimeState",
    "issueComments",
    "costEvents",
    "approvalComments",
    "approvals",
    "companySecrets",
    "joinRequests",
    "invites",
    "principalPermissionGrants",
    "companyMemberships",
    "mcpClientConnections",
    "mcpApiKeys",
    "issueReadStates",
    "assets",
    "issues",
    "goals",
    "projects",
    "agents",
    "activityLog",
    "companies",
  ];
  const stubs: Record<string, unknown> = {};
  for (const name of tableNames) {
    stubs[name] = tableStub(name);
  }
  return stubs;
});

vi.mock("drizzle-orm", () => ({
  and: (..._args: unknown[]) => "and",
  eq: (..._args: unknown[]) => "eq",
  count: (..._args: unknown[]) => "count",
}));

import { companyService } from "../services/companies.js";

function makeMockDb() {
  return {
    transaction: async (cb: (tx: any) => Promise<any>) => {
      const tx = {
        delete: (table: any) => {
          const name = table?._tableName ?? "unknown";
          deleteCalls.push(name);
          const chain = {
            where: (..._args: unknown[]) => ({
              returning: () =>
                Promise.resolve([{ id: "comp-1", name: "Test" }]),
              then: (resolve: (rows: unknown[]) => unknown) =>
                Promise.resolve(resolve([])),
            }),
          };
          return chain;
        },
      };
      return cb(tx);
    },
  };
}

describe("companyService.remove() cascade ordering", () => {
  beforeEach(() => {
    deleteCalls.length = 0;
  });

  it("deletes issueReadStates BEFORE issues", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    const irsIdx = deleteCalls.indexOf("issueReadStates");
    const issuesIdx = deleteCalls.indexOf("issues");
    expect(irsIdx).toBeGreaterThanOrEqual(0);
    expect(issuesIdx).toBeGreaterThanOrEqual(0);
    expect(irsIdx).toBeLessThan(issuesIdx);
  });

  it("includes companies as the FINAL delete", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(deleteCalls[deleteCalls.length - 1]).toBe("companies");
  });

  it("deletes assets BEFORE agents and BEFORE issueReadStates", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    const assetsIdx = deleteCalls.indexOf("assets");
    const agentsIdx = deleteCalls.indexOf("agents");
    const irsIdx = deleteCalls.indexOf("issueReadStates");
    expect(assetsIdx).toBeGreaterThanOrEqual(0);
    expect(assetsIdx).toBeLessThan(agentsIdx);
    expect(assetsIdx).toBeLessThan(irsIdx);
  });
});
