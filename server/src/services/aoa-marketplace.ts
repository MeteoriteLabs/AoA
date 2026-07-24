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

/**
 * How long a caller that NEEDS a catalog (today: the company-create crew
 * bootstrap) will wait for one before degrading.
 *
 * Sized to cover a cold boot: `startSyncLoop()` fires its first sync
 * unawaited, so a company created seconds after boot would otherwise read an
 * empty cache and be provisioned from the legacy seeders — permanently
 * `@legacy`, permanently excluded from the update pipeline, and invisible
 * afterwards. `ensureCatalogAvailable` joins that in-flight sync instead of
 * racing it.
 *
 * Deliberately shorter than SYNC_TIMEOUT_MS: a *hung* CDN must not hold
 * onboarding open for 30s. The bounded wait covers the common cold-cache case
 * (CDN answers, or fails fast and the bundled snapshot lands); a genuinely
 * stalled CDN degrades to the legacy seeders.
 */
export const CATALOG_AVAILABILITY_TIMEOUT_MS = 12_000;

interface MarketplaceCatalogServiceDeps {
  db: Db;
  cdnUrl?: string;
  bundledSnapshotProvider: () => Promise<MarketplaceCatalogFile | null>;
}

/**
 * Read the catalog from the DB cache without needing a service instance.
 *
 * This is the cache-only half of catalog resolution — it does NOT fetch and
 * does NOT fall back to the bundled snapshot, so on a cold cache it returns
 * `null` even though a catalog is moments away. Callers that need a catalog
 * (the company-create crew bootstrap) must go through
 * {@link resolveCatalogForBootstrap}, which layers the bounded wait on top.
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
  const parsed = MarketplaceCatalogFileSchema.safeParse(candidate);
  if (!parsed.success) {
    logger.warn({ err: parsed.error }, "marketplace: cached catalog failed schema validation (loadCachedCatalog)");
    return null;
  }
  return parsed.data;
}

export class MarketplaceCatalogService {
  private readonly db: Db;
  private readonly cdnUrl: string;
  private readonly bundledSnapshotProvider: () => Promise<MarketplaceCatalogFile | null>;
  private syncTimer: NodeJS.Timeout | null = null;
  private inFlightSync: Promise<MarketplaceCatalogFile | null> | null = null;

  constructor(deps: MarketplaceCatalogServiceDeps) {
    this.db = deps.db;
    this.cdnUrl = deps.cdnUrl ?? DEFAULT_CDN_URL;
    this.bundledSnapshotProvider = deps.bundledSnapshotProvider;
  }

  /** Start the periodic sync loop. */
  startSyncLoop(): void {
    if (this.syncTimer) return;
    void this.runDedupedSync();
    this.syncTimer = setInterval(() => {
      void this.runDedupedSync();
    }, SYNC_INTERVAL_MS);
  }

  stopSyncLoop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Run `sync()`, but share one in-flight attempt across concurrent callers so
   * the boot sync and a simultaneous company-create bootstrap issue a single
   * CDN fetch rather than two. Never rejects — `sync()` already handles CDN
   * failure internally; anything past that (e.g. a cache write error) is logged
   * and reported as `null`.
   */
  private runDedupedSync(): Promise<MarketplaceCatalogFile | null> {
    if (this.inFlightSync) return this.inFlightSync;
    const started = this.sync().catch((err) => {
      logger.error({ err }, "marketplace: catalog sync failed");
      return null;
    });
    this.inFlightSync = started;
    void started.finally(() => {
      if (this.inFlightSync === started) this.inFlightSync = null;
    });
    return started;
  }

  /**
   * Return a usable catalog, waiting up to `timeoutMs` for one if the cache is
   * cold. Cache hit → immediate. Cache miss → join (or start) a sync, which
   * itself falls back to the bundled snapshot when the CDN is unreachable.
   * Returns `null` if no catalog is available within the budget — callers MUST
   * treat that as "degrade", never as "fail".
   *
   * This exists because `startSyncLoop()` fires its first sync unawaited: any
   * caller that merely *reads* the cache races the boot sync and loses
   * non-deterministically.
   */
  async ensureCatalogAvailable(
    timeoutMs: number = CATALOG_AVAILABILITY_TIMEOUT_MS,
  ): Promise<MarketplaceCatalogFile | null> {
    const cached = await this.readCache();
    if (cached) return cached;

    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([this.runDedupedSync(), budget]);
    } finally {
      if (timer) clearTimeout(timer);
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
    const parsed = MarketplaceCatalogFileSchema.safeParse(candidate);
    if (!parsed.success) {
      logger.warn({ err: parsed.error }, "marketplace: cached catalog failed schema validation");
      return null;
    }
    return parsed.data;
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

// ── Process-wide catalog-service registry ────────────────────────────────────
//
// `MarketplaceCatalogService` is constructed in `app.ts` (it needs the bundled
// snapshot provider, which is an app-layer concern). The company-create path
// lives far below the route layer and cannot reach that instance by
// construction, so app.ts registers it here on boot.
//
// The registry is deliberately allowed to be empty: in unit/integration tests
// nothing registers a service, so `resolveCatalogForBootstrap` degrades to
// "cache only". That is what keeps tests off the network — a test that WANTS
// the marketplace path either seeds `marketplace_catalog_cache` or registers
// its own service instance.

let activeCatalogService: MarketplaceCatalogService | null = null;

/** Register the process-wide catalog service (app.ts on boot). Pass `null` to clear. */
export function registerMarketplaceCatalogService(service: MarketplaceCatalogService | null): void {
  activeCatalogService = service;
}

export function getMarketplaceCatalogService(): MarketplaceCatalogService | null {
  return activeCatalogService;
}

export interface ResolvedBootstrapCatalog {
  catalog: MarketplaceCatalogFile;
  /** Where it came from — `cache` = already synced, `sync` = we waited for one. */
  source: "cache" | "sync";
}

/**
 * Resolve a catalog for the company-create crew bootstrap:
 * cached catalog → (if a service is registered) a bounded wait on the live
 * sync, which itself falls back to the bundled snapshot → `null`.
 *
 * `null` means "no catalog within budget" and the caller must degrade to the
 * legacy seeders. It never throws: a marketplace outage cannot break onboarding.
 */
export async function resolveCatalogForBootstrap(
  db: Db,
  timeoutMs: number = CATALOG_AVAILABILITY_TIMEOUT_MS,
): Promise<ResolvedBootstrapCatalog | null> {
  try {
    const cached = await loadCachedCatalog(db);
    if (cached) return { catalog: cached, source: "cache" };
  } catch (err) {
    logger.warn({ err }, "marketplace: cached catalog read failed during crew bootstrap");
  }

  const service = activeCatalogService;
  if (!service) return null;

  try {
    const synced = await service.ensureCatalogAvailable(timeoutMs);
    return synced ? { catalog: synced, source: "sync" } : null;
  } catch (err) {
    logger.warn({ err }, "marketplace: catalog availability wait failed during crew bootstrap");
    return null;
  }
}
