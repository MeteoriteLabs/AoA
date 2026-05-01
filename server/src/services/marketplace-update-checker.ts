/**
 * @fileoverview Marketplace update checker.
 *
 * Compares installed catalog items against the current catalog version,
 * creates/updates rows in marketplace_pending_updates.
 *
 * Called after catalog sync completes and on startup.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import {
  marketplacePendingUpdates,
  companies,
  companySkills,
} from "@armyofagents/db";
import { marketplaceNotifications } from "./marketplace-notifications.js";
import { logger } from "../middleware/logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Pure utility functions (exported for unit testing)
// ─────────────────────────────────────────────────────────────────────────────

export function compareVersions(latest: string, current: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((p) => parseInt(p, 10) || 0);
  const [lMaj, lMin, lPat] = parse(latest);
  const [cMaj, cMin, cPat] = parse(current);
  if (lMaj !== cMaj) return lMaj! > cMaj! ? 1 : -1;
  if (lMin !== cMin) return lMin! > cMin! ? 1 : -1;
  if (lPat !== cPat) return lPat! > cPat! ? 1 : -1;
  return 0;
}

type UpdatePolicy = "auto_patch" | "auto_minor" | "notify_all" | "auto" | "notify";

export function isUpdateAvailable(current: string, latest: string, policy: UpdatePolicy): boolean {
  if (compareVersions(latest, current) <= 0) return false;

  if (policy === "auto" || policy === "notify" || policy === "notify_all") return true;

  const [lMaj, lMin] = latest.split(".").map(Number);
  const [cMaj, cMin] = current.split(".").map(Number);

  if (policy === "auto_minor") return lMaj === cMaj;
  if (policy === "auto_patch") return lMaj === cMaj && lMin === cMin;

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main checker
// ─────────────────────────────────────────────────────────────────────────────

interface CatalogItem {
  id: string;
  name: string;
  version?: string;
  type: string;
}

export async function runUpdateCheck(db: Db, catalogItems: CatalogItem[]): Promise<void> {
  const allCompanies = await db.select({ id: companies.id }).from(companies);

  for (const company of allCompanies) {
    await checkCompany(db, catalogItems, company.id);
  }
}

async function checkCompany(db: Db, catalogItems: CatalogItem[], companyId: string): Promise<void> {
  try {
    const catalogMap = new Map<string, { version: string; name: string; type: string }>();
    for (const item of catalogItems) {
      if (item.version) {
        catalogMap.set(item.id, { version: item.version, name: item.name, type: item.type });
      }
    }

    // Check skills (sourceType=catalog means they came from marketplace)
    const skillRows = await db
      .select({ sourceLocator: companySkills.sourceLocator, sourceRef: companySkills.sourceRef })
      .from(companySkills)
      .where(
        and(
          eq(companySkills.companyId, companyId),
          eq(companySkills.sourceType, "catalog"),
        ),
      );

    for (const skill of skillRows) {
      if (!skill.sourceLocator || !skill.sourceRef) continue;
      const catalogEntry = catalogMap.get(skill.sourceLocator);
      if (!catalogEntry) continue;
      await upsertPendingUpdate(db, companyId, {
        catalogItemId: skill.sourceLocator,
        catalogItemName: catalogEntry.name,
        itemType: "skill",
        currentVersion: skill.sourceRef,
        latestVersion: catalogEntry.version,
      });
    }
    // TODO: Add agent + team template checks when templateOrigin/templateVersion
    // columns are added to those schemas. Plugins are instance-scoped and handled
    // separately when plugin update tracking is wired in Task 6.
  } catch (err) {
    logger.error({ err, companyId }, "marketplace-update-checker: error checking company");
  }
}

export async function upsertPendingUpdate(
  db: Db,
  companyId: string,
  data: {
    catalogItemId: string;
    catalogItemName: string;
    itemType: string;
    currentVersion: string;
    latestVersion: string;
  },
): Promise<void> {
  if (compareVersions(data.latestVersion, data.currentVersion) <= 0) return;

  // Two-step: insert ignoring conflict, then update only if still pending
  const inserted = await db
    .insert(marketplacePendingUpdates)
    .values({
      companyId,
      catalogItemId: data.catalogItemId,
      catalogItemName: data.catalogItemName,
      itemType: data.itemType,
      currentVersion: data.currentVersion,
      latestVersion: data.latestVersion,
      status: "pending",
    })
    .onConflictDoNothing()
    .returning({ id: marketplacePendingUpdates.id });

  // Only notify on genuine new detection
  if (inserted.length > 0) {
    void marketplaceNotifications
      .updateAvailable(db, companyId, data.catalogItemName, data.currentVersion, data.latestVersion)
      .catch((err) => logger.error({ err }, "marketplace: failed to emit update_available notification"));
  }

  await db
    .update(marketplacePendingUpdates)
    .set({ latestVersion: data.latestVersion, updatedAt: new Date() })
    .where(
      and(
        eq(marketplacePendingUpdates.companyId, companyId),
        eq(marketplacePendingUpdates.catalogItemId, data.catalogItemId),
        eq(marketplacePendingUpdates.status, "pending"),
      ),
    );
}
