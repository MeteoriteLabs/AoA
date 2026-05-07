import { describe, it, expect, vi } from "vitest";

vi.mock("@armyofagents/db", () => {
  const t = new Proxy({}, { get: () => Symbol("col") });
  return {
    plugins: t,
    pluginConfig: t,
    pluginCompanySettings: t,
    pluginVersionSnapshots: t,
  };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("eq"),
  and: () => Symbol("and"),
  desc: () => Symbol("desc"),
}));
vi.mock("../routes/authz.js", () => ({
  assertBoard: vi.fn(),
  assertCompanyAccess: vi.fn(),
}));

import { companyPluginRoutes } from "../routes/company-plugins.js";

// Helper: extract a named route handler from the Express router
function getRouteHandler(router: any, method: string, path: string) {
  const layer = router.stack.find(
    (l: any) =>
      l.route?.path === path &&
      l.route?.methods?.[method.toLowerCase()],
  );
  if (!layer) throw new Error(`Route ${method} ${path} not found`);
  return layer.route.stack[0].handle as (req: any, res: any, next: any) => Promise<void>;
}

describe("POST /:pluginId/upgrade — auto-rollback snapshot cleanup", () => {
  it("deletes the consumed snapshot after a successful auto-rollback", async () => {
    const deletedWhereArgs: unknown[] = [];

    // Mock DB:
    // - Plugin lookup: db.select().from(plugins).where(...) — awaited directly (no .limit())
    // - Snapshot lookup: db.select().from(snapshots).where(...).orderBy(...).limit(1) — awaited after .limit()
    // - delete() chain: captures the call so we can assert it happened
    let fromCallN = 0;
    const mockDb = {
      select: () => ({
        from: () => {
          fromCallN++;
          const callN = fromCallN;
          if (callN === 1) {
            // Plugin lookup — where() is awaited directly
            const whereResult = {
              then: (resolve: any) =>
                resolve([
                  {
                    id: "plugin-1",
                    pluginKey: "test.plugin",
                    companyId: "co-a",
                    status: "ready",
                  },
                ]),
              // also support .orderBy().limit() just in case
              orderBy: () => ({ limit: () => Promise.resolve([]) }),
            };
            return { where: () => whereResult };
          } else {
            // Snapshot lookup — where().orderBy().limit() is awaited
            return {
              where: () => ({
                then: (resolve: any) => resolve([]), // if awaited directly (shouldn't happen)
                orderBy: () => ({
                  limit: () =>
                    Promise.resolve([
                      {
                        id: "snap-1",
                        packageName: "@test/plugin",
                        version: "1.0.0",
                        companyId: "co-a",
                        pluginId: "plugin-1",
                      },
                    ]),
                }),
              }),
            };
          }
        },
      }),
      delete: () => ({
        where: (cond: unknown) => {
          deletedWhereArgs.push(cond);
          return Promise.resolve();
        },
      }),
    };

    const mockLifecycle = {
      upgrade: vi.fn().mockRejectedValue(new Error("upgrade failed intentionally")),
      load: vi.fn().mockResolvedValue(undefined),
    };
    const mockLoader = {
      installPlugin: vi.fn().mockResolvedValue(undefined),
    };

    const router = companyPluginRoutes(
      mockDb as any,
      mockLifecycle as any,
      mockLoader as any,
    );

    const handler = getRouteHandler(router, "post", "/:pluginId/upgrade");

    const req = {
      params: { companyId: "co-a", pluginId: "plugin-1" },
      body: {},
    } as any;
    const res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
    } as any;

    await handler(req, res, vi.fn());

    // Rollback must have fired
    expect(mockLoader.installPlugin).toHaveBeenCalledOnce();
    expect(mockLifecycle.load).toHaveBeenCalledWith("plugin-1");

    // Snapshot must have been deleted after successful rollback
    expect(deletedWhereArgs).toHaveLength(1);
  });

  it("does NOT delete the snapshot if rollback (installPlugin) throws", async () => {
    const deletedWhereArgs: unknown[] = [];

    let fromCallN2 = 0;
    const mockDb = {
      select: () => ({
        from: () => {
          fromCallN2++;
          const callN = fromCallN2;
          if (callN === 1) {
            // Plugin lookup — where() is awaited directly
            const whereResult = {
              then: (resolve: any) =>
                resolve([
                  {
                    id: "plugin-1",
                    pluginKey: "test.plugin",
                    companyId: "co-a",
                    status: "ready",
                  },
                ]),
              orderBy: () => ({ limit: () => Promise.resolve([]) }),
            };
            return { where: () => whereResult };
          } else {
            // Snapshot lookup — where().orderBy().limit() is awaited
            return {
              where: () => ({
                then: (resolve: any) => resolve([]),
                orderBy: () => ({
                  limit: () =>
                    Promise.resolve([
                      {
                        id: "snap-1",
                        packageName: "@test/plugin",
                        version: "1.0.0",
                        companyId: "co-a",
                        pluginId: "plugin-1",
                      },
                    ]),
                }),
              }),
            };
          }
        },
      }),
      delete: () => ({
        where: (cond: unknown) => {
          deletedWhereArgs.push(cond);
          return Promise.resolve();
        },
      }),
    };

    const mockLifecycle = {
      upgrade: vi.fn().mockRejectedValue(new Error("upgrade failed")),
      load: vi.fn().mockResolvedValue(undefined),
    };
    const mockLoader = {
      // installPlugin throws — rollback failed
      installPlugin: vi.fn().mockRejectedValue(new Error("reinstall failed")),
    };

    const router = companyPluginRoutes(
      mockDb as any,
      mockLifecycle as any,
      mockLoader as any,
    );

    const handler = getRouteHandler(router, "post", "/:pluginId/upgrade");
    const req = { params: { companyId: "co-a", pluginId: "plugin-1" }, body: {} } as any;
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() } as any;

    await handler(req, res, vi.fn());

    // Snapshot must NOT be deleted when rollback fails
    expect(deletedWhereArgs).toHaveLength(0);
  });
});
