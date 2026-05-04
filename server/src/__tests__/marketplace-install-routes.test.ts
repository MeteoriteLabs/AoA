import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return {
    marketplaceInstallOperations: tableProxy,
    plugins: tableProxy,
    agents: tableProxy,
    teams: tableProxy,
    companySkills: tableProxy,
    projects: tableProxy,
  };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("op:eq"),
  and: () => Symbol("op:and"),
  gt: () => Symbol("op:gt"),
}));
vi.mock("../services/live-events.js", () => ({ publishLiveEvent: vi.fn() }));
vi.mock("../routes/authz.js", () => ({
  assertBoard: vi.fn(),
  assertCompanyAccess: vi.fn(),
}));

import { createMarketplaceInstallRouter } from "../routes/marketplace-installs.js";

const SKILL = {
  id: "skill:aoa-curated/code-review", type: "skill", name: "Code Review", description: "...", version: "1.0.0",
  source: { adapter: "aoa-curated", url: "...", locator: "...", commitSha: "abc" },
  resourceUrl: "https://.../SKILL.md",
  content: { inline: "# Code Review" },
  trust: { tier: "verified", source: "aoa-curated" }, status: "active",
  addedAt: "2026-04-30T00:00:00Z", category: "engineering", tags: [],
};

// Agent items require a targetDepartmentId; skills do not.
const AGENT = {
  id: "agent:aoa-curated/engineer", type: "agent", name: "Engineer", description: "...", version: "1.0.0",
  source: { adapter: "aoa-curated", url: "...", locator: "...", commitSha: "abc" },
  resourceUrl: "https://.../AGENT.json",
  content: undefined,
  trust: { tier: "verified", source: "aoa-curated" }, status: "active",
  addedAt: "2026-04-30T00:00:00Z", category: "engineering", tags: [],
};

const CATALOG = { schemaVersion: "1.0.0", generatedAt: "2026-04-30T00:00:00Z", itemCount: 2, items: [SKILL, AGENT] };

function buildApp() {
  const app = express();
  app.use(express.json());

  // Inject board actor on every request.
  // source: "local_implicit" bypasses the RBAC gate added in M.4.M so this
  // test suite can focus on install mechanics rather than permission logic
  // (RBAC is covered separately by marketplace-rbac.test.ts).
  app.use((req, _res, next) => {
    (req as any).actor = { type: "board", source: "local_implicit", userId: "u1", companyId: "c1" };
    next();
  });

  const router = createMarketplaceInstallRouter({
    db: {
      insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: "op-1", status: "pending", companyId: "c1", catalogItemId: SKILL.id, itemType: "skill" }]) }) }) }),
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      transaction: async (cb: any) => cb({ insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: "skill-1" }]) }) }) }),
    } as any,
    catalogService: {
      readCache: async () => CATALOG,
      sync: async () => CATALOG,
      getStatus: async () => null,
      startSyncLoop: () => {}, stopSyncLoop: () => {},
    } as any,
    pluginLoader: {
      installPlugin: async () => ({
        packagePath: "/tmp/x", packageName: "aoa-plugin-slack", version: "1.0.0",
        source: "npm" as const,
        manifest: { id: "aoa.slack", displayName: "Slack" } as any,
      }),
      registry: { getByKey: async () => ({ id: "p1", pluginKey: "aoa.slack" }) },
      lifecycle: { load: async () => {} },
    } as any,
  });
  app.use("/api/companies/:companyId/marketplace", router);
  return app;
}

const C_ID = "c1";

describe("POST /api/companies/:companyId/marketplace/install", () => {
  it("returns 202 with operationId for valid skill install", async () => {
    const res = await request(buildApp())
      .post(`/api/companies/${C_ID}/marketplace/install`)
      .send({ catalogItemId: SKILL.id, targetDepartmentId: "00000000-0000-0000-0000-000000000001" });
    expect(res.status).toBe(202);
    expect(res.body.operationId).toBe("op-1");
  });

  it("returns 202 for skill install without targetDepartmentId (skills don't require a dept)", async () => {
    // Fix 5: skills should install successfully without a department.
    const res = await request(buildApp())
      .post(`/api/companies/${C_ID}/marketplace/install`)
      .send({ catalogItemId: SKILL.id });
    expect(res.status).toBe(202);
    expect(res.body.operationId).toBeDefined();
  });

  it("returns 400 when targetDepartmentId missing for agent installs", async () => {
    // Agents (and teams) require a targetDepartmentId.
    const res = await request(buildApp())
      .post(`/api/companies/${C_ID}/marketplace/install`)
      .send({ catalogItemId: AGENT.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/targetDepartmentId/);
  });

  it("returns 404 for unknown catalogItemId", async () => {
    const res = await request(buildApp())
      .post(`/api/companies/${C_ID}/marketplace/install`)
      .send({ catalogItemId: "unknown:item" });
    expect(res.status).toBe(404);
  });

  it("returns 400 for malformed body", async () => {
    const res = await request(buildApp())
      .post(`/api/companies/${C_ID}/marketplace/install`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.details).toBeDefined();
  });
});

describe("GET /api/companies/:companyId/marketplace/resolve/:catalogItemId", () => {
  it("returns InstallPlan for known item", async () => {
    const res = await request(buildApp())
      .get(`/api/companies/${C_ID}/marketplace/resolve/${encodeURIComponent(SKILL.id)}`);
    expect(res.status).toBe(200);
    expect(res.body.rootItem.id).toBe(SKILL.id);
    expect(res.body.steps).toBeInstanceOf(Array);
  });
});
