/**
 * @fileoverview Marketplace catalog sync service
 *
 * Polls the CDN for the latest catalog.json on a schedule, validates
 * schema version, and stores the result in the marketplaceCatalogCache table.
 * Falls back to the bundled snapshot if CDN unreachable and cache empty.
 *
 * Per spec §5.7.
 */

import { eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { marketplaceCatalogCache } from "@armyofagents/db";
import {
  MarketplaceCatalogFileSchema,
  isSchemaVersionSupported,
  type MarketplaceCatalogFile,
  type CatalogSyncStatus,
} from "@armyofagents/shared";

const DEFAULT_CDN_URL =
  "https://meteoritelabs.github.io/aoa-marketplace-cdn/catalog.json";
const SYNC_TIMEOUT_MS = 30_000;
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h, M.4 makes this configurable

interface MarketplaceCatalogServiceDeps {
  db: Db;
  cdnUrl?: string;
  bundledSnapshotProvider: () => Promise<MarketplaceCatalogFile | null>;
}

export class MarketplaceCatalogService {
  private readonly db: Db;
  private readonly cdnUrl: string;
  private readonly bundledSnapshotProvider: () => Promise<MarketplaceCatalogFile | null>;
  private syncTimer: NodeJS.Timeout | null = null;

  constructor(deps: MarketplaceCatalogServiceDeps) {
    this.db = deps.db;
    this.cdnUrl = deps.cdnUrl ?? DEFAULT_CDN_URL;
    this.bundledSnapshotProvider = deps.bundledSnapshotProvider;
  }

  /** Start the periodic sync loop. */
  startSyncLoop(): void {
    if (this.syncTimer) return;
    void this.sync().catch((err) =>
      console.error("Initial catalog sync failed:", err),
    );
    this.syncTimer = setInterval(() => {
      void this.sync().catch((err) =>
        console.error("Catalog sync failed:", err),
      );
    }, SYNC_INTERVAL_MS);
  }

  stopSyncLoop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /** Fetch catalog from CDN and cache. Returns the synced catalog or null on failure. */
  async sync(): Promise<MarketplaceCatalogFile | null> {
    try {
      const res = await fetch(this.cdnUrl, {
        signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      const parsed = MarketplaceCatalogFileSchema.parse(json);
      if (!isSchemaVersionSupported(parsed.schemaVersion)) {
        throw new Error(
          `Unsupported catalog schemaVersion: ${parsed.schemaVersion}`,
        );
      }
      await this.writeCache(parsed, "cdn", "success", null);
      return parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const cached = await this.writeCache(null, "cdn", "failure", message);

      // Fall back to bundled snapshot if cache is empty
      if (!cached) {
        const bundled = await this.bundledSnapshotProvider();
        if (bundled) {
          await this.writeCache(bundled, "bundled", "success", null);
          return bundled;
        }
      }
      return cached;
    }
  }

  /** Read the current cached catalog (or null if none). */
  async readCache(): Promise<MarketplaceCatalogFile | null> {
    const rows = await this.db
      .select()
      .from(marketplaceCatalogCache)
      .where(eq(marketplaceCatalogCache.id, 1))
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];

    // Validate the cached JSON before returning.
    // Schema drift / corruption between writes (older app version) would otherwise
    // serve unvalidated JSONB to API clients in M.1.K.
    const candidate = {
      schemaVersion: row.schemaVersion,
      generatedAt: row.generatedAt.toISOString(),
      itemCount: row.itemCount,
      items: (row.catalogJson as { items?: unknown }).items ?? [],
    };
    const parsed = MarketplaceCatalogFileSchema.safeParse(candidate);
    if (!parsed.success) {
      console.warn("readCache: cached catalog failed schema validation:", parsed.error.message);
      return null;
    }
    return parsed.data;
  }

  async getStatus(): Promise<CatalogSyncStatus | null> {
    const rows = await this.db
      .select()
      .from(marketplaceCatalogCache)
      .where(eq(marketplaceCatalogCache.id, 1))
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      lastSyncedAt: row.lastSyncedAt.toISOString(),
      lastSyncStatus: row.lastSyncStatus,
      lastSyncError: row.lastSyncError,
      source: row.source,
      schemaVersion: row.schemaVersion,
      itemCount: row.itemCount,
    };
  }

  private async writeCache(
    catalog: MarketplaceCatalogFile | null,
    source: "cdn" | "bundled",
    status: "success" | "failure",
    error: string | null,
  ): Promise<MarketplaceCatalogFile | null> {
    if (!catalog) {
      // Failed sync — only update the status row (preserve existing catalog if any)
      const existing = await this.readCache();
      if (existing) {
        await this.db
          .update(marketplaceCatalogCache)
          .set({
            lastSyncedAt: new Date(),
            lastSyncStatus: status,
            lastSyncError: error,
          })
          .where(eq(marketplaceCatalogCache.id, 1));
      }
      return existing;
    }

    // Upsert the singleton row
    await this.db
      .insert(marketplaceCatalogCache)
      .values({
        id: 1,
        schemaVersion: catalog.schemaVersion,
        generatedAt: new Date(catalog.generatedAt),
        itemCount: catalog.itemCount,
        catalogJson: catalog,
        lastSyncedAt: new Date(),
        lastSyncStatus: status,
        lastSyncError: error,
        source,
      })
      .onConflictDoUpdate({
        target: marketplaceCatalogCache.id,
        set: {
          schemaVersion: catalog.schemaVersion,
          generatedAt: new Date(catalog.generatedAt),
          itemCount: catalog.itemCount,
          catalogJson: catalog,
          lastSyncedAt: new Date(),
          lastSyncStatus: status,
          lastSyncError: error,
          source,
        },
      });
    return catalog;
  }
}
