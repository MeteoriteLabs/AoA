/**
 * @fileoverview Marketplace notification helpers.
 *
 * Emits notifications to company founders for marketplace events:
 * - marketplace.install_completed
 * - marketplace.install_failed
 * - marketplace.install_requested
 * - marketplace.update_available
 * - marketplace.update_completed
 * - marketplace.update_failed
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { userRoles } from "@armyofagents/db";
import { notificationService } from "./notifications.js";
import { logger } from "../middleware/logger.js";

async function notifyFounders(
  db: Db,
  companyId: string,
  notification: {
    type: string;
    title: string;
    message?: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  },
): Promise<void> {
  try {
    // Query founders for the company (role = 'founder', no project scope = company-level role)
    const founders = await db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(
        and(
          eq(userRoles.companyId, companyId),
          eq(userRoles.role, "founder"),
          isNull(userRoles.projectId),
        ),
      );

    const svc = notificationService(db);
    if (founders.length === 0) {
      // Fallback: notify local-board user
      await svc.create(companyId, { ...notification, userId: "local-board" });
      return;
    }

    await Promise.all(
      founders
        .filter((r) => r.userId)
        .map((r) => svc.create(companyId, { ...notification, userId: r.userId! })),
    );
  } catch (err) {
    logger.error({ err, companyId }, "marketplace-notifications: failed to notify founders");
  }
}

export const marketplaceNotifications = {
  installCompleted: (db: Db, companyId: string, catalogItemName: string, operationId: string) =>
    notifyFounders(db, companyId, {
      type: "marketplace.install_completed",
      title: `${catalogItemName} installed`,
      message: "Marketplace install completed successfully.",
      relatedEntityType: "marketplace_operation",
      relatedEntityId: operationId,
    }),

  installRequested: (db: Db, companyId: string, catalogItemName: string, requestingUserId: string, operationId: string) =>
    notifyFounders(db, companyId, {
      type: "marketplace.install_requested",
      title: `Install requested: ${catalogItemName}`,
      message: `User ${requestingUserId} requested installation of ${catalogItemName}.`,
      relatedEntityType: "marketplace_operation",
      relatedEntityId: operationId,
    }),

  installFailed: (db: Db, companyId: string, catalogItemName: string, error: string) =>
    notifyFounders(db, companyId, {
      type: "marketplace.install_failed",
      title: `${catalogItemName} install failed`,
      message: error,
      relatedEntityType: "marketplace_operation",
    }),

  updateAvailable: (db: Db, companyId: string, catalogItemName: string, fromVersion: string, toVersion: string) =>
    notifyFounders(db, companyId, {
      type: "marketplace.update_available",
      title: `Update available: ${catalogItemName}`,
      message: `${fromVersion} → ${toVersion} is available.`,
      relatedEntityType: "marketplace_update",
    }),

  updateCompleted: (db: Db, companyId: string, catalogItemName: string) =>
    notifyFounders(db, companyId, {
      type: "marketplace.update_completed",
      title: `${catalogItemName} updated`,
    }),

  updateFailed: (db: Db, companyId: string, catalogItemName: string, error: string) =>
    notifyFounders(db, companyId, {
      type: "marketplace.update_failed",
      title: `${catalogItemName} update failed`,
      message: error,
    }),
};
