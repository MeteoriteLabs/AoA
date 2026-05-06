import { describe, it, expect, vi } from "vitest";

vi.mock("@armyofagents/db", () => {
  const tableProxy = new Proxy({}, { get: () => Symbol("col") });
  return { plugins: tableProxy };
});
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("op:eq"),
  and: () => Symbol("op:and"),
}));

import { installMarketplacePlugin } from "../services/marketplace-install/plugin-installer.js";

const makeDb = (existingPlugins: any[]) => ({
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(existingPlugins),
      }),
    }),
  }),
  insert: () => ({ values: () => Promise.resolve() }),
});

describe("installMarketplacePlugin companyId scoping", () => {
  it("idempotency check scopes by packageName — same version returns alreadyInstalled", async () => {
    const db = makeDb([{ id: "plug-1", version: "1.0.0", companyId: "co-a" }]) as any;
    const loader = {
      installPlugin: vi.fn(),
      registry: { getByKeyScoped: vi.fn() },
      lifecycle: { load: vi.fn() },
    };
    const result = await installMarketplacePlugin({
      catalogItem: {
        type: "plugin",
        id: "plugin:test",
        npm: { packageName: "@test/plugin", version: "1.0.0" },
      } as any,
      companyId: "co-a",
      db,
      pluginLoader: loader,
    });
    expect(result.alreadyInstalled).toBe(true);
    expect(loader.installPlugin).not.toHaveBeenCalled();
  });

  it("passes companyId to installPlugin and uses getByKeyScoped for registry lookup", async () => {
    const db = makeDb([]) as any;
    const getByKeyScoped = vi.fn(async () => ({ id: "plug-2", pluginKey: "test.plugin" }));
    const installPlugin = vi.fn(async () => ({
      packagePath: "/tmp/test",
      packageName: "@test/plugin",
      version: "1.0.0",
      source: "npm",
      manifest: { id: "test.plugin" },
    }));
    const load = vi.fn(async () => {});
    const loader = {
      installPlugin,
      registry: { getByKeyScoped },
      lifecycle: { load },
    };

    const result = await installMarketplacePlugin({
      catalogItem: {
        type: "plugin",
        id: "plugin:test",
        npm: { packageName: "@test/plugin", version: "1.0.0" },
      } as any,
      companyId: "co-b",
      db,
      pluginLoader: loader,
    });

    expect(installPlugin).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co-b" }),
    );
    expect(getByKeyScoped).toHaveBeenCalledWith("test.plugin", "co-b");
    expect(load).toHaveBeenCalledWith("plug-2");
    expect(result.pluginId).toBe("plug-2");
    expect(result.alreadyInstalled).toBe(false);
  });
});
