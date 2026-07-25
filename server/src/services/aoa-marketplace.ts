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
  parseMarketplaceCatalog,
  isSchemaVersionSupported,
  type CatalogSyncStatus,
  type MarketplaceCatalogFile,
  type MarketplacePackage,
} from "@armyofagents/shared";
import { derivePackages } from "./derivePackages.js";
import { runUpdateCheck } from "./marketplace-update-checker.js";
import { logger } from "../middleware/logger.js";

const DEFAULT_CDN_URL =
  "https://meteoritelabs.github.io/aoa-marketplace-cdn/catalog.json";
const SYNC_TIMEOUT_MS = 30_000;
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h, M.4 makes this configurable

interface MarketplaceCatalogServiceDeps {
  db: Db;
  cdnUrl?: string;
  bundledSnapshotProvider: () => Promise<MarketplaceCatalogFile | null>;
}

/**
 * Read the catalog from the DB cache without needing a service instance.
 * Used by the company bootstrap path (companies.ts) which runs before the
 * full MarketplaceCatalogService is wired. Returns null if no catalog has
 * been cached yet (caller should skip marketplace-install and fall back to
 * legacy seeders).
 */
export async function loadCachedCatalog(db: Db): Promise<MarketplaceCatalogFile | null> {
  const rows = await db
    .select()
    .from(marketplaceCatalogCache)
    .where(eq(marketplaceCatalogCache.id, 1))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  const candidate = {
    schemaVersion: row.schemaVersion,
    generatedAt: row.generatedAt.toISOString(),
    itemCount: row.itemCount,
    items: (row.catalogJson as { items?: unknown }).items ?? [],
  };
  // FU-14: per-item parse so a single drifted cached item (e.g. written by a newer
  // app version) drops itself instead of nulling the whole cache and forcing a fallback.
  const { catalog, dropped, malformed } = parseMarketplaceCatalog(candidate);
  if (malformed || !catalog) {
    logger.warn(
      { schemaVersion: row.schemaVersion },
      "marketplace: cached catalog envelope malformed (loadCachedCatalog)",
    );
    return null;
  }
  if (dropped.length > 0) {
    logger.warn(
      { dropped },
      `marketplace: dropped ${dropped.length} unparseable cached item(s) (loadCachedCatalog)`,
    );
  }
  return catalog;
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
      logger.error({ err }, "marketplace: initial catalog sync failed"),
    );
    this.syncTimer = setInterval(() => {
      void this.sync().catch((err) =>
        logger.error({ err }, "marketplace: catalog sync failed"),
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

      // FU-14: per-item, drop-and-warn parse. A single unknown-`type` (or otherwise
      // unparseable) item must NOT fail the whole file — that would preserve the old
      // cache forever on every older instance the moment the CDN publishes something
      // this build doesn't understand. Only a broken ENVELOPE is a fetch failure.
      const { catalog: parsed, dropped, malformed } = parseMarketplaceCatalog(json);
      if (malformed || !parsed) {
        // Unintelligible envelope (not an object, or `items` missing/not-an-array):
        // NOT an answer about the catalog's contents. Keep the last known-good cache.
        throw new Error("Malformed catalog envelope");
      }
      // kept-ZERO but dropped-MANY is not a real "empty catalog" answer — every item
      // failed to parse (a schema we tighten later, or a genuinely malformed publish).
      // Treat it like a malformed envelope: keep the last known-good cache rather than
      // blanking the shelf. A legitimately empty catalog (dropped === 0) still replaces.
      if (parsed.items.length === 0 && dropped.length > 0) {
        throw new Error(
          `All ${dropped.length} catalog item(s) were unparseable`,
        );
      }
      if (dropped.length > 0) {
        logger.warn(
          { dropped, kept: parsed.items.length },
          `marketplace: dropped ${dropped.length} unparseable catalog item(s)`,
        );
      }
      if (!isSchemaVersionSupported(parsed.schemaVersion)) {
        throw new Error(
          `Unsupported catalog schemaVersion: ${parsed.schemaVersion}`,
        );
      }
      await this.writeCache(parsed, "cdn", "success", null);
      // Fire-and-forget update check after successful catalog sync
      void runUpdateCheck(this.db, parsed.items).catch((err) =>
        logger.error({ err }, "marketplace: update check failed after sync"),
      );
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
    // FU-14: per-item parse so one drifted cached item drops itself instead of
    // nulling the whole cache (which readCache callers treat as "no catalog" → 503).
    const { catalog, dropped, malformed } = parseMarketplaceCatalog(candidate);
    if (malformed || !catalog) {
      logger.warn(
        { schemaVersion: row.schemaVersion },
        "marketplace: cached catalog envelope malformed",
      );
      return null;
    }
    if (dropped.length > 0) {
      logger.warn(
        { dropped },
        `marketplace: dropped ${dropped.length} unparseable cached item(s)`,
      );
    }
    return catalog;
  }

  /**
   * Read the cached catalog and derive the marketplace package list.
   * Returns `null` if no catalog has been cached yet (caller should respond
   * 503 to mirror `readCache()` semantics).
   *
   * Derivation is in-memory and cheap (~hundreds of items max). No DB write.
   */
  async getPackages(): Promise<MarketplacePackage[] | null> {
    const catalog = await this.readCache();
    if (!catalog) return null;
    return derivePackages(catalog.items);
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
