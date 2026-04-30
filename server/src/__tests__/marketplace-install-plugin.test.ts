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
import type { CatalogItem } from "@armyofagents/shared";

const PLUGIN: CatalogItem = {
  id: "plugin:aoa-curated/aoa-plugin-slack",
  type: "plugin",
  name: "Slack",
  description: "Slack integration",
  version: "1.0.0",
  source: { adapter: "aoa-curated", url: "...", locator: "...", commitSha: "abc" },
  npm: { packageName: "aoa-plugin-slack", version: "1.0.0" },
  trust: { tier: "verified", source: "aoa-curated" },
  status: "active",
  addedAt: "2026-04-30T00:00:00Z",
  capabilities: [],
  category: "integrations",
  tags: [],
};

const DISCOVERED = {
  packagePath: "/tmp/aoa-plugin-slack",
  packageName: "aoa-plugin-slack",
  version: "1.0.0",
  source: "npm" as const,
  manifest: { id: "aoa.slack", displayName: "Slack" } as any,
};

describe("installMarketplacePlugin", () => {
  it("delegates to pluginLoader.installPlugin with packageName+version, then activates via lifecycle.load", async () => {
    const installPluginMock = vi.fn(async () => DISCOVERED);
    const getByKeyMock = vi.fn(async () => ({ id: "plug-uuid-1", pluginKey: "aoa.slack" }));
    const lifecycleLoadMock = vi.fn(async () => {});

    const mockDb = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    };

    const result = await installMarketplacePlugin({
      catalogItem: PLUGIN,
      companyId: "c1",
      db: mockDb as any,
      pluginLoader: {
        installPlugin: installPluginMock,
        registry: { getByKey: getByKeyMock },
        lifecycle: { load: lifecycleLoadMock },
      } as any,
    });

    expect(installPluginMock).toHaveBeenCalledWith({
      packageName: "aoa-plugin-slack",
      version: "1.0.0",
    });
    expect(getByKeyMock).toHaveBeenCalledWith("aoa.slack");
    expect(lifecycleLoadMock).toHaveBeenCalledWith("plug-uuid-1");
    expect(result.pluginId).toBe("plug-uuid-1");
    expect(result.alreadyInstalled).toBe(false);
  });

  it("returns alreadyInstalled=true if plugin row exists at same version (skips installPlugin and lifecycle.load)", async () => {
    const installPluginMock = vi.fn();
    const lifecycleLoadMock = vi.fn();
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([
              { id: "existing-plug", packageName: "aoa-plugin-slack", version: "1.0.0", status: "ready" },
            ]),
          }),
        }),
      }),
    };

    const result = await installMarketplacePlugin({
      catalogItem: PLUGIN,
      companyId: "c1",
      db: mockDb as any,
      pluginLoader: {
        installPlugin: installPluginMock,
        registry: { getByKey: vi.fn() },
        lifecycle: { load: lifecycleLoadMock },
      } as any,
    });

    expect(installPluginMock).not.toHaveBeenCalled();
    expect(lifecycleLoadMock).not.toHaveBeenCalled();
    expect(result.alreadyInstalled).toBe(true);
    expect(result.pluginId).toBe("existing-plug");
  });

  it("throws if catalog item missing npm field", async () => {
    const broken: CatalogItem = { ...PLUGIN, npm: undefined };
    await expect(
      installMarketplacePlugin({
        catalogItem: broken,
        companyId: "c1",
        db: {} as any,
        pluginLoader: {} as any,
      }),
    ).rejects.toThrow(/npm field/i);
  });

  it("throws if discovered manifest is missing (loader edge case)", async () => {
    const installPluginMock = vi.fn(async () => ({ ...DISCOVERED, manifest: null }));
    const mockDb = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    };

    await expect(
      installMarketplacePlugin({
        catalogItem: PLUGIN,
        companyId: "c1",
        db: mockDb as any,
        pluginLoader: {
          installPlugin: installPluginMock,
          registry: { getByKey: vi.fn() },
          lifecycle: { load: vi.fn() },
        } as any,
      }),
    ).rejects.toThrow(/manifest is missing/i);
  });

  it("throws on version mismatch when same package installed at different version", async () => {
    const installPluginMock = vi.fn();
    const lifecycleLoadMock = vi.fn();
    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve([
              { id: "existing-plug", packageName: "aoa-plugin-slack", version: "0.9.0", status: "ready" },
            ]),
          }),
        }),
      }),
    };

    await expect(
      installMarketplacePlugin({
        catalogItem: PLUGIN,
        companyId: "c1",
        db: mockDb as any,
        pluginLoader: {
          installPlugin: installPluginMock,
          registry: { getByKey: vi.fn() },
          lifecycle: { load: lifecycleLoadMock },
        } as any,
      }),
    ).rejects.toThrow(/installed at version 0\.9\.0.*catalog requests 1\.0\.0/);

    expect(installPluginMock).not.toHaveBeenCalled();
    expect(lifecycleLoadMock).not.toHaveBeenCalled();
  });
});
