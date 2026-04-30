import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
}));

vi.mock("@armyofagents/db", () => ({
  marketplaceCatalogCache: {
    id: "id",
    schemaVersion: "schema_version",
    generatedAt: "generated_at",
    itemCount: "item_count",
    catalogJson: "catalog_json",
    lastSyncedAt: "last_synced_at",
    lastSyncStatus: "last_sync_status",
    lastSyncError: "last_sync_error",
    source: "source",
  } as any,
}));

import { MarketplaceCatalogService } from "../services/aoa-marketplace.js";

const VALID_CATALOG = {
  schemaVersion: "1.0.0",
  generatedAt: "2026-04-30T00:00:00.000Z",
  itemCount: 1,
  items: [
    {
      id: "plugin:test/example",
      type: "plugin",
      name: "Test",
      description: "test plugin",
      version: "1.0.0",
      source: {
        adapter: "aoa-curated",
        url: "https://example.com",
        locator: "test",
      },
      trust: { tier: "verified", source: "aoa-curated" },
      status: "active",
      addedAt: "2026-04-30T00:00:00.000Z",
      category: "engineering",
      tags: [],
    },
  ],
};

function makeSelectChain(results: any[]) {
  const queue = [...results];
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn((fn: (rows: any[]) => any) =>
      Promise.resolve(fn(queue.shift() ?? [])),
    ),
  };
}

function makeDb(selectQueue: any[]) {
  const inserted: any[] = [];
  const updated: any[] = [];

  const db = {
    select: vi.fn(() => makeSelectChain(selectQueue)),
    insert: vi.fn(() => ({
      values: vi.fn((values: any) => {
        inserted.push(values);
        return {
          onConflictDoUpdate: vi.fn().mockResolvedValue([]),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: any) => {
        updated.push(values);
        return {
          where: vi.fn().mockResolvedValue([]),
        };
      }),
    })),
  } as any;

  return { db, inserted, updated };
}

describe("MarketplaceCatalogService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncs from CDN successfully", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(VALID_CATALOG),
    }) as any;

    // readCache returns empty (no existing cache)
    const { db, inserted } = makeDb([[]]);

    const service = new MarketplaceCatalogService({
      db,
      cdnUrl: "https://example.com/catalog.json",
      bundledSnapshotProvider: async () => null,
    });

    const result = await service.sync();
    expect(result?.schemaVersion).toBe("1.0.0");
    expect(result?.itemCount).toBe(1);
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted[0].schemaVersion).toBe("1.0.0");
    expect(inserted[0].source).toBe("cdn");
    expect(inserted[0].lastSyncStatus).toBe("success");
  });

  it("rejects unsupported schemaVersion", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ ...VALID_CATALOG, schemaVersion: "99.0.0" }),
    }) as any;

    // First select: writeCache(null) -> readCache() returns [] (no existing row)
    // Second select: readCache() at end of catch returns [] (no fallback)
    const { db } = makeDb([[], []]);

    const service = new MarketplaceCatalogService({
      db,
      cdnUrl: "https://example.com/catalog.json",
      bundledSnapshotProvider: async () => null,
    });

    const result = await service.sync();
    // Failed sync + no existing cache + no bundled snapshot -> null
    expect(result).toBeNull();
  });

  it("falls back to bundled snapshot on CDN failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    // First call: writeCache(null) -> readCache() returns [] (no existing row, so no update)
    // Second call: readCache() in catch returns [] (triggers bundled path)
    const { db, inserted } = makeDb([[], []]);

    const service = new MarketplaceCatalogService({
      db,
      cdnUrl: "https://example.com/catalog.json",
      bundledSnapshotProvider: async () => VALID_CATALOG as any,
    });

    const result = await service.sync();
    expect(result?.schemaVersion).toBe("1.0.0");
    // bundled snapshot written via insert
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted[0].source).toBe("bundled");
    expect(inserted[0].lastSyncStatus).toBe("success");
  });
});
