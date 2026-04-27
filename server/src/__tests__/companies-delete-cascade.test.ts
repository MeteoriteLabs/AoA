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
    // existing
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
    // new in 0066 sweep
    "agentConfigRevisions",
    "agentProjects",
    "companySkills",
    "documentRevisions",
    "documents",
    "executionWorkspaces",
    "feedbackExports",
    "feedbackVotes",
    "financeEvents",
    "heartbeatRunWatchdogDecisions",
    "issueApprovals",
    "issueAttachments",
    "issueDocuments",
    "projectGoals",
    "projectWorkspaces",
    "workspaceOperations",
    "workspaceRuntimeServices",
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

function idx(name: string): number {
  return deleteCalls.indexOf(name);
}

describe("companyService.remove() cascade ordering", () => {
  beforeEach(() => {
    deleteCalls.length = 0;
  });

  it("includes companies as the FINAL delete", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(deleteCalls[deleteCalls.length - 1]).toBe("companies");
  });

  it("deletes issueReadStates BEFORE issues", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("issueReadStates")).toBeGreaterThanOrEqual(0);
    expect(idx("issues")).toBeGreaterThanOrEqual(0);
    expect(idx("issueReadStates")).toBeLessThan(idx("issues"));
  });

  it("deletes assets BEFORE agents and BEFORE issueReadStates", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("assets")).toBeGreaterThanOrEqual(0);
    expect(idx("assets")).toBeLessThan(idx("agents"));
    expect(idx("assets")).toBeLessThan(idx("issueReadStates"));
  });

  // ── Sprint-3 sweep (0066): 17 newly-flagged tables ──────────────────────

  it("deletes workspaceRuntimeServices BEFORE projects, agents, heartbeatRuns", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("workspaceRuntimeServices")).toBeGreaterThanOrEqual(0);
    expect(idx("workspaceRuntimeServices")).toBeLessThan(idx("projects"));
    expect(idx("workspaceRuntimeServices")).toBeLessThan(idx("agents"));
    expect(idx("workspaceRuntimeServices")).toBeLessThan(idx("heartbeatRuns"));
  });

  it("deletes workspaceOperations BEFORE executionWorkspaces, heartbeatRuns", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("workspaceOperations")).toBeGreaterThanOrEqual(0);
    expect(idx("workspaceOperations")).toBeLessThan(idx("executionWorkspaces"));
    expect(idx("workspaceOperations")).toBeLessThan(idx("heartbeatRuns"));
  });

  it("deletes heartbeatRunWatchdogDecisions BEFORE heartbeatRuns", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("heartbeatRunWatchdogDecisions")).toBeGreaterThanOrEqual(0);
    expect(idx("heartbeatRunWatchdogDecisions")).toBeLessThan(idx("heartbeatRuns"));
  });

  it("deletes issueAttachments BEFORE issues, assets, issueComments", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("issueAttachments")).toBeGreaterThanOrEqual(0);
    expect(idx("issueAttachments")).toBeLessThan(idx("issues"));
    expect(idx("issueAttachments")).toBeLessThan(idx("assets"));
    expect(idx("issueAttachments")).toBeLessThan(idx("issueComments"));
  });

  it("deletes issueDocuments BEFORE issues, documents", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("issueDocuments")).toBeGreaterThanOrEqual(0);
    expect(idx("issueDocuments")).toBeLessThan(idx("issues"));
    expect(idx("issueDocuments")).toBeLessThan(idx("documents"));
  });

  it("deletes issueApprovals BEFORE issues, approvals", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("issueApprovals")).toBeGreaterThanOrEqual(0);
    expect(idx("issueApprovals")).toBeLessThan(idx("issues"));
    expect(idx("issueApprovals")).toBeLessThan(idx("approvals"));
  });

  it("deletes financeEvents BEFORE costEvents, agents, issues", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("financeEvents")).toBeGreaterThanOrEqual(0);
    expect(idx("financeEvents")).toBeLessThan(idx("costEvents"));
    expect(idx("financeEvents")).toBeLessThan(idx("agents"));
    expect(idx("financeEvents")).toBeLessThan(idx("issues"));
  });

  it("deletes feedbackExports BEFORE feedbackVotes, issues", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("feedbackExports")).toBeGreaterThanOrEqual(0);
    expect(idx("feedbackExports")).toBeLessThan(idx("feedbackVotes"));
    expect(idx("feedbackExports")).toBeLessThan(idx("issues"));
  });

  it("deletes feedbackVotes BEFORE issues", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("feedbackVotes")).toBeGreaterThanOrEqual(0);
    expect(idx("feedbackVotes")).toBeLessThan(idx("issues"));
  });

  it("deletes documentRevisions BEFORE documents", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("documentRevisions")).toBeGreaterThanOrEqual(0);
    expect(idx("documentRevisions")).toBeLessThan(idx("documents"));
  });

  it("deletes documents BEFORE agents", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("documents")).toBeGreaterThanOrEqual(0);
    expect(idx("documents")).toBeLessThan(idx("agents"));
  });

  it("deletes executionWorkspaces BEFORE projects, projectWorkspaces", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("executionWorkspaces")).toBeGreaterThanOrEqual(0);
    expect(idx("executionWorkspaces")).toBeLessThan(idx("projects"));
    expect(idx("executionWorkspaces")).toBeLessThan(idx("projectWorkspaces"));
  });

  it("deletes projectWorkspaces BEFORE projects", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("projectWorkspaces")).toBeGreaterThanOrEqual(0);
    expect(idx("projectWorkspaces")).toBeLessThan(idx("projects"));
  });

  it("deletes projectGoals BEFORE projects, goals", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("projectGoals")).toBeGreaterThanOrEqual(0);
    expect(idx("projectGoals")).toBeLessThan(idx("projects"));
    expect(idx("projectGoals")).toBeLessThan(idx("goals"));
  });

  it("deletes agentConfigRevisions BEFORE agents", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("agentConfigRevisions")).toBeGreaterThanOrEqual(0);
    expect(idx("agentConfigRevisions")).toBeLessThan(idx("agents"));
  });

  it("deletes agentProjects BEFORE agents AND BEFORE projects", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("agentProjects")).toBeGreaterThanOrEqual(0);
    expect(idx("agentProjects")).toBeLessThan(idx("agents"));
    expect(idx("agentProjects")).toBeLessThan(idx("projects"));
  });

  it("deletes companySkills BEFORE companies (the only constraint)", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    expect(idx("companySkills")).toBeGreaterThanOrEqual(0);
    expect(idx("companySkills")).toBeLessThan(deleteCalls.length - 1);
  });

  it("all 17 newly-flagged tables are present in the delete list", async () => {
    const svc = companyService(makeMockDb() as any);
    await svc.remove("comp-1");
    const newTables = [
      "agentConfigRevisions",
      "agentProjects",
      "companySkills",
      "documentRevisions",
      "documents",
      "executionWorkspaces",
      "feedbackExports",
      "feedbackVotes",
      "financeEvents",
      "heartbeatRunWatchdogDecisions",
      "issueApprovals",
      "issueAttachments",
      "issueDocuments",
      "projectGoals",
      "projectWorkspaces",
      "workspaceOperations",
      "workspaceRuntimeServices",
    ];
    for (const table of newTables) {
      expect(deleteCalls).toContain(table);
    }
  });
});
