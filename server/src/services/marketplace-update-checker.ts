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
import type { CatalogItem } from "@armyofagents/shared";
import { marketplaceNotifications } from "./marketplace-notifications.js";
import { marketplaceSettingsService } from "./marketplace-settings.js";
import {
  applySkillUpdate,
  isWithinUpdateWindow,
  SkillCustomizedError,
  SkillDeletedError,
} from "./marketplace-install/skill-auto-updater.js";
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

// ─────────────────────────────────────────────────────────────────────────────
// Main checker
// ─────────────────────────────────────────────────────────────────────────────

export async function runUpdateCheck(db: Db, catalogItems: CatalogItem[]): Promise<void> {
  const allCompanies = await db.select({ id: companies.id }).from(companies);

  for (const company of allCompanies) {
    try {
      await checkCompany(db, catalogItems, company.id);
    } catch (err) {
      logger.error({ err, companyId: company.id }, "marketplace-update-checker: error processing company");
    }
  }
}

async function checkCompany(db: Db, catalogItems: CatalogItem[], companyId: string): Promise<void> {
  try {
    const catalogMap = new Map<string, { version: string; name: string; type: string }>();
    for (const item of catalogItems) {
      catalogMap.set(item.id, { version: item.version, name: item.name, type: item.type });
    }

    // Read settings once per company — not per skill
    const settings = await marketplaceSettingsService(db).get(companyId);

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

      try {
        const { inserted } = await upsertPendingUpdate(db, companyId, {
          catalogItemId: skill.sourceLocator,
          catalogItemName: catalogEntry.name,
          itemType: "skill",
          currentVersion: skill.sourceRef,
          latestVersion: catalogEntry.version,
        });

        if (!inserted) continue; // Already knew about this update — no action needed

        if (
          settings.skillUpdatePolicy === "auto" &&
          isWithinUpdateWindow(settings.updateWindow)
        ) {
          // Note: customized flag is re-checked inside applySkillUpdate's transaction.
          // We intentionally do NOT pre-check it here to avoid stale data.
          const catalogItem = catalogItems.find((i) => i.id === skill.sourceLocator);
          if (!catalogItem) {
            // Defensive: full CatalogItem not in the provided list
            void marketplaceNotifications
              .updateAvailable(db, companyId, catalogEntry.name, skill.sourceRef, catalogEntry.version)
              .catch((err) => logger.error({ err }, "marketplace: updateAvailable notification failed"));
            continue;
          }

          try {
            await applySkillUpdate({
              db,
              catalogItemId: skill.sourceLocator,
              catalogItemName: catalogEntry.name,
              companyId,
              catalogItem,
            });
            // updateCompleted notification fired inside applySkillUpdate
          } catch (err) {
            if (err instanceof SkillDeletedError) {
              // Skill was deleted between check and apply — skip silently
              logger.error({ err, catalogItemId: skill.sourceLocator }, "marketplace: skill deleted during auto-apply");
            } else {
              // SkillCustomizedError or any other error — fall back to notify
              logger.error({ err, catalogItemId: skill.sourceLocator }, "marketplace: auto-apply failed, falling back to notify");
              void marketplaceNotifications
                .updateAvailable(db, companyId, catalogEntry.name, skill.sourceRef, catalogEntry.version)
                .catch((notifErr) => logger.error({ notifErr }, "marketplace: fallback updateAvailable failed"));
            }
          }
        } else {
          // notify-only path (policy=notify or outside window)
          void marketplaceNotifications
            .updateAvailable(db, companyId, catalogEntry.name, skill.sourceRef, catalogEntry.version)
            .catch((err) => logger.error({ err }, "marketplace: updateAvailable notification failed"));
        }
      } catch (err) {
        // Per-skill isolation: one skill error doesn't block the rest
        logger.error({ err, catalogItemId: skill.sourceLocator, companyId }, "marketplace-update-checker: per-skill error");
      }
    }
    // TODO: Add agent + team template checks when templateOrigin/templateVersion
    // columns are added to those schemas.
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
): Promise<{ inserted: boolean }> {
  if (compareVersions(data.latestVersion, data.currentVersion) <= 0) return { inserted: false };

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

  if (inserted.length > 0) {
    // New row inserted — caller decides whether to notify or auto-apply
    return { inserted: true };
  }

  // Existing pending row — bump latestVersion in case it has advanced since last check
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

  return { inserted: false };
}
