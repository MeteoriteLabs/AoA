import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock state (vi.mock factories are hoisted before imports) ─────────

const { mockSaveSnapshot, mockGetById, mockUpdateStatus } = vi.hoisted(() => {
  const basePlugin = {
    id: "plugin-1",
    pluginKey: "test.plugin",
    companyId: "co-a",
    status: "ready" as const,
    version: "1.0.0",
    packageName: "@test/plugin",
    manifestJson: { capabilities: ["tools.register"] },
    installOrder: 1,
    apiVersion: "1.0",
    categories: [],
    lastError: null,
    installedAt: new Date(),
    updatedAt: new Date(),
    catalogItemId: null,
    packagePath: null,
  };
  const mockSaveSnapshot = vi.fn().mockResolvedValue(undefined);
  const mockGetById = vi.fn().mockResolvedValue(basePlugin);
  const mockUpdateStatus = vi.fn().mockImplementation(
    async (_id: string, { status }: { status: string }) => ({ ...basePlugin, status }),
  );
  return { mockSaveSnapshot, mockGetById, mockUpdateStatus };
});

vi.mock("@armyofagents/db", () => ({
  plugins: new Proxy({}, { get: () => Symbol("col") }),
  pluginVersionSnapshots: new Proxy({}, { get: () => Symbol("col") }),
}));
vi.mock("drizzle-orm", () => ({
  eq: () => Symbol("eq"),
  and: () => Symbol("and"),
  asc: () => Symbol("asc"),
}));
vi.mock("../services/plugin-rollback.js", () => ({
  pluginRollbackService: () => ({ saveSnapshot: mockSaveSnapshot }),
}));
vi.mock("../services/plugin-registry.js", () => ({
  pluginRegistryService: () => ({
    getById: mockGetById,
    updateStatus: mockUpdateStatus,
  }),
}));
vi.mock("../services/plugin-loader.js", () => ({ pluginLoader: vi.fn() }));
vi.mock("../middleware/logger.js", () => ({
  logger: {
    child: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })),
  },
}));

import { diffCapabilities, pluginLifecycleManager } from "../services/plugin-lifecycle.js";

// ── diffCapabilities (pure function, no DB) ───────────────────────────────────

describe("plugin lifecycle upgrade helpers", () => {
  it("detects no new capabilities when sets are equal", () => {
    const delta = diffCapabilities(
      ["tools.register", "http.outbound"],
      ["tools.register", "http.outbound"],
    );
    expect(delta).toEqual([]);
  });

  it("detects newly added capabilities", () => {
    const delta = diffCapabilities(
      ["tools.register", "http.outbound"],
      ["tools.register", "http.outbound", "jobs.create"],
    );
    expect(delta).toEqual(["jobs.create"]);
  });

  it("does not flag removed capabilities (backward compat is OK)", () => {
    const delta = diffCapabilities(
      ["tools.register", "http.outbound"],
      ["tools.register"],
    );
    expect(delta).toEqual([]);
  });
});

// ── upgrade() state machine ───────────────────────────────────────────────────

describe("upgrade() state machine", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls pluginRollbackService.saveSnapshot with plugin fields (not raw db.insert)", async () => {
    const mockLoader = {
      upgradePlugin: vi.fn().mockResolvedValue({
        oldManifest: { version: "1.0.0", capabilities: ["tools.register"] },
        newManifest: { version: "2.0.0", capabilities: ["tools.register"] },
        discovered: { version: "2.0.0" },
      }),
    };
    const lifecycle = pluginLifecycleManager({} as any, { loader: mockLoader as any });
    await lifecycle.upgrade("plugin-1");

    expect(mockSaveSnapshot).toHaveBeenCalledOnce();
    expect(mockSaveSnapshot).toHaveBeenCalledWith(
      "plugin-1",
      "co-a",
      "1.0.0",
      "@test/plugin",
      { capabilities: ["tools.register"] },
    );
  });

  it("returns { version, status: 'ready' } when no new capabilities are added", async () => {
    const mockLoader = {
      upgradePlugin: vi.fn().mockResolvedValue({
        oldManifest: { version: "1.0.0", capabilities: ["tools.register"] },
        newManifest: { version: "2.0.0", capabilities: ["tools.register"] },
        discovered: { version: "2.0.0" },
      }),
    };
    const lifecycle = pluginLifecycleManager({} as any, { loader: mockLoader as any });
    const result = await lifecycle.upgrade("plugin-1");
    expect(result).toEqual({ version: "2.0.0", status: "ready" });
  });

  it("returns { version, status: 'upgrade_pending', delta } when new capabilities are added", async () => {
    const mockLoader = {
      upgradePlugin: vi.fn().mockResolvedValue({
        oldManifest: { version: "1.0.0", capabilities: ["tools.register"] },
        newManifest: {
          version: "2.0.0",
          capabilities: ["tools.register", "jobs.create"],
        },
        discovered: { version: "2.0.0" },
      }),
    };
    const lifecycle = pluginLifecycleManager({} as any, { loader: mockLoader as any });
    const result = await lifecycle.upgrade("plugin-1");
    expect(result).toEqual({
      version: "2.0.0",
      status: "upgrade_pending",
      delta: ["jobs.create"],
    });
  });
});
