/**
 * T2.5 (D23) — `DELETE /api/companies/:companyId/marketplace/teams/:teamId`
 * must surface a protected-agent refusal as a distinguishable client error,
 * not as the generic 500 the catch-all previously produced.
 */
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("@armyofagents/db", () => {
  const table = (name: string) =>
    new Proxy({}, { get: (_t, prop) => (prop === "__table" ? name : Symbol("col")) });
  return {
    marketplaceInstallOperations: table("marketplace_install_operations"),
    plugins: table("plugins"),
    agents: table("agents"),
    teams: table("teams"),
    teamMembers: table("team_members"),
    aoaAgentTriggers: table("aoa_agent_triggers"),
    companySkills: table("company_skills"),
    projects: table("projects"),
    userRoles: table("user_roles"),
  };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("op:eq"),
  and: () => Symbol("op:and"),
  gt: () => Symbol("op:gt"),
  isNull: () => Symbol("op:isNull"),
  inArray: () => Symbol("op:inArray"),
}));
vi.mock("../services/live-events.js", () => ({ publishLiveEvent: vi.fn() }));
vi.mock("../routes/authz.js", () => ({
  assertBoard: vi.fn(),
  assertCompanyAccess: vi.fn(),
}));
vi.mock("../middleware/rbac.js", () => ({ assertRole: vi.fn().mockResolvedValue(undefined) }));

import { createMarketplaceInstallRouter } from "../routes/marketplace-installs.js";

interface MemberRow {
  agentId: string;
  name: string;
  templateOrigin: string | null;
}

function buildApp(teamRow: Record<string, unknown> | null, memberRows: MemberRow[]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = { type: "board", source: "local_implicit", userId: "u1", companyId: "c1" };
    next();
  });

  const deleted = vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(memberRows.map((m) => ({ id: m.agentId }))),
    }),
  });

  const db: any = {
    select: () => ({
      from: (table: { __table?: string }) => {
        if (table?.__table === "teams") {
          return {
            where: () => ({ limit: async () => (teamRow ? [teamRow] : []) }),
          };
        }
        if (table?.__table === "team_members") {
          return { innerJoin: () => ({ where: async () => memberRows }) };
        }
        throw new Error(`unexpected from(${table?.__table ?? "?"})`);
      },
    }),
    delete: deleted,
    insert: () => ({ values: () => ({ returning: async () => [{ id: "op-1" }] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    transaction: async (cb: any) =>
      cb({
        delete: deleted,
        insert: () => ({ values: () => ({ returning: async () => [{ id: "op-1" }] }) }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      }),
  };

  const router = createMarketplaceInstallRouter({
    db,
    catalogService: {
      readCache: async () => ({ schemaVersion: "1.0.0", generatedAt: "", itemCount: 0, items: [] }),
      sync: async () => ({ schemaVersion: "1.0.0", generatedAt: "", itemCount: 0, items: [] }),
      getStatus: async () => null,
      startSyncLoop: () => {},
      stopSyncLoop: () => {},
    } as any,
    pluginLoader: {} as any,
  });
  app.use("/api/companies/:companyId/marketplace", router);
  return { app, deleted };
}

const TEAM_ROW = {
  id: "t-1",
  companyId: "c1",
  templateOrigin: "team:aoa-curated/default-crew",
};

describe("DELETE /marketplace/teams/:teamId — protected agents (D23)", () => {
  it("returns 409 and names the protected agent, deleting nothing", async () => {
    const { app, deleted } = buildApp(TEAM_ROW, [
      { agentId: "a-scout", name: "Scout", templateOrigin: "agent:aoa-curated/aoa-scout" },
      { agentId: "a-steward", name: "Steward", templateOrigin: null },
    ]);

    const res = await request(app).delete("/api/companies/c1/marketplace/teams/t-1");

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Steward/);
    expect(res.body.protectedAgents).toEqual([{ id: "a-steward", name: "Steward", role: "steward" }]);
    expect(deleted).not.toHaveBeenCalled();
  });

  // Discriminator: the route is not simply refusing every team uninstall.
  it("still returns 200 for a team with no protected members", async () => {
    const { app } = buildApp(TEAM_ROW, [
      { agentId: "a-scout", name: "Scout", templateOrigin: "agent:aoa-curated/aoa-scout" },
      { agentId: "a-chron", name: "Chronicler", templateOrigin: null },
    ]);

    const res = await request(app).delete("/api/companies/c1/marketplace/teams/t-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, deletedAgentIds: ["a-scout", "a-chron"] });
  });

  it("still returns 404 for a missing team", async () => {
    const { app } = buildApp(null, []);

    const res = await request(app).delete("/api/companies/c1/marketplace/teams/t-nope");

    expect(res.status).toBe(404);
  });
});
