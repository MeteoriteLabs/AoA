import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return {
    marketplaceInstallOperations: tableProxy,
    plugins: tableProxy, agents: tableProxy, teams: tableProxy,
    companySkills: tableProxy, projects: tableProxy,
  };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("op:eq"),
  and: () => Symbol("op:and"),
  gt: () => Symbol("op:gt"),
}));

import { startInstallOperation, dispatchInstall } from "../services/marketplace-install/orchestrator.js";
import type { CatalogItem, MarketplaceCatalogFile } from "@armyofagents/shared";

const SKILL: CatalogItem = {
  id: "skill:aoa-curated/code-review", type: "skill", name: "Code Review", description: "...", version: "1.0.0",
  source: { adapter: "aoa-curated", url: "...", locator: "...", commitSha: "abc" },
  resourceUrl: "https://.../SKILL.md",
  content: { inline: "# Code Review" },
  trust: { tier: "verified", source: "aoa-curated" }, status: "active",
  addedAt: "2026-04-30T00:00:00Z", category: "engineering", tags: [],
};
const CATALOG: MarketplaceCatalogFile = {
  schemaVersion: "1.0.0", generatedAt: "2026-04-30T00:00:00Z", itemCount: 1, items: [SKILL],
};

describe("startInstallOperation", () => {
  let insertedOps: any[] = [];
  const mockDb = {
    insert: () => ({
      values: (row: any) => {
        insertedOps.push(row);
        return { onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ ...row, id: "op-uuid-1" }]) }) };
      },
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
  };

  beforeEach(() => { insertedOps = []; });

  it("creates an operation row with status=pending", async () => {
    const op = await startInstallOperation({
      request: { catalogItemId: SKILL.id, targetDepartmentId: "dept-1" },
      catalogItem: SKILL, companyId: "c1", requestedByUserId: "u1", db: mockDb as any,
    });
    expect(insertedOps).toHaveLength(1);
    expect(insertedOps[0].status).toBe("pending");
    expect(insertedOps[0].catalogItemId).toBe(SKILL.id);
    expect(insertedOps[0].itemType).toBe("skill");
    expect(insertedOps[0].targetDepartmentId).toBe("dept-1");
    expect(op.id).toBe("op-uuid-1");
  });

  it("idempotency: returns existing op if idempotencyKey matches in last 24h", async () => {
    const dbWithExisting = {
      ...mockDb,
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: "existing-op", status: "success", idempotencyKey: "abc" }]),
          }),
        }),
      }),
    };
    const op = await startInstallOperation({
      request: { catalogItemId: SKILL.id, idempotencyKey: "abc" },
      catalogItem: SKILL, companyId: "c1", requestedByUserId: "u1", db: dbWithExisting as any,
    });
    expect(insertedOps).toHaveLength(0);
    expect(op.id).toBe("existing-op");
  });
});

describe("findOperationById", () => {
  it("returns the row when company matches", async () => {
    const { findOperationById } = await import("../services/marketplace-install/operation-store.js");
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([{ id: "op-1", companyId: "c1", status: "success" }]),
          }),
        }),
      }),
    };
    const op = await findOperationById(db as any, "op-1", "c1");
    expect(op?.id).toBe("op-1");
  });

  it("returns null when operation belongs to different company (RBAC isolation)", async () => {
    const { findOperationById } = await import("../services/marketplace-install/operation-store.js");
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([]),
          }),
        }),
      }),
    };
    const op = await findOperationById(db as any, "op-1", "wrong-company");
    expect(op).toBeNull();
  });
});

describe("dispatchInstall", () => {
  it("calls installSkill for skill items + updates operation row to success", async () => {
    const installSkillMock = vi.fn(async () => ({ skillId: "skill-uuid-1" }));
    const updateOp = vi.fn(async () => {});
    const publish = vi.fn();

    await dispatchInstall({
      operation: { id: "op-uuid-1", catalogItemId: SKILL.id, itemType: "skill", companyId: "c1", targetDepartmentId: "dept-1" } as any,
      catalogItem: SKILL, catalog: CATALOG, db: {} as any,
      installers: { installSkill: installSkillMock, installAgent: vi.fn(), installTeam: vi.fn(), installPlugin: vi.fn() },
      updateOperation: updateOp, publishLiveEvent: publish,
    });

    expect(installSkillMock).toHaveBeenCalled();
    expect(updateOp).toHaveBeenCalledWith("op-uuid-1", expect.objectContaining({ status: "success", resultEntityId: "skill-uuid-1" }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "marketplace.install.completed" }));
  });

  it("on installer error, updates operation to failure + publishes failed event", async () => {
    const installSkillMock = vi.fn(async () => { throw new Error("fetch failed"); });
    const updateOp = vi.fn(async () => {});
    const publish = vi.fn();

    await dispatchInstall({
      operation: { id: "op-uuid-1", catalogItemId: SKILL.id, itemType: "skill", companyId: "c1" } as any,
      catalogItem: SKILL, catalog: CATALOG, db: {} as any,
      installers: { installSkill: installSkillMock, installAgent: vi.fn(), installTeam: vi.fn(), installPlugin: vi.fn() },
      updateOperation: updateOp, publishLiveEvent: publish,
    });

    expect(updateOp).toHaveBeenCalledWith("op-uuid-1", expect.objectContaining({ status: "failure", errorMessage: "fetch failed" }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "marketplace.install.failed" }));
  });

  it("throws when team install missing targetDepartmentId", async () => {
    const installTeamMock = vi.fn();
    const updateOp = vi.fn(async () => {});
    const publish = vi.fn();

    const TEAM_ITEM = { ...SKILL, id: "team:test", type: "team" as const };

    await dispatchInstall({
      operation: { id: "op-uuid-1", catalogItemId: TEAM_ITEM.id, itemType: "team", companyId: "c1", targetDepartmentId: null } as any,
      catalogItem: TEAM_ITEM,
      catalog: { ...CATALOG, items: [TEAM_ITEM] },
      db: {} as any,
      installers: {
        installSkill: vi.fn(),
        installAgent: vi.fn(),
        installTeam: installTeamMock,
        installPlugin: vi.fn(),
      },
      updateOperation: updateOp,
      publishLiveEvent: publish,
    });

    expect(installTeamMock).not.toHaveBeenCalled();
    expect(updateOp).toHaveBeenCalledWith("op-uuid-1", expect.objectContaining({
      status: "failure",
      errorMessage: expect.stringMatching(/targetDepartmentId/),
    }));
  });

  it("publishes started event before installer runs", async () => {
    const events: any[] = [];
    const publish = vi.fn((e) => events.push(e));
    const installSkillMock = vi.fn(async () => {
      // Capture event order: started must come before installer's resolution
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("marketplace.install.started");
      return { skillId: "s1" };
    });

    await dispatchInstall({
      operation: { id: "op-1", catalogItemId: SKILL.id, itemType: "skill", companyId: "c1", targetDepartmentId: "d1" } as any,
      catalogItem: SKILL,
      catalog: CATALOG,
      db: {} as any,
      installers: { installSkill: installSkillMock, installAgent: vi.fn(), installTeam: vi.fn(), installPlugin: vi.fn() },
      updateOperation: vi.fn(),
      publishLiveEvent: publish,
    });

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("marketplace.install.started");
    expect(events[1].type).toBe("marketplace.install.completed");
  });

  it("events carry companyId for per-company SSE routing", async () => {
    const publish = vi.fn();
    await dispatchInstall({
      operation: { id: "op-1", catalogItemId: SKILL.id, itemType: "skill", companyId: "specific-co", targetDepartmentId: "d1" } as any,
      catalogItem: SKILL,
      catalog: CATALOG,
      db: {} as any,
      installers: { installSkill: async () => ({ skillId: "s1" }), installAgent: vi.fn(), installTeam: vi.fn(), installPlugin: vi.fn() },
      updateOperation: vi.fn(),
      publishLiveEvent: publish,
    });

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ companyId: "specific-co" }));
  });
});
