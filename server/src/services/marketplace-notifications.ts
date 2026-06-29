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
import { hubItemsService } from "./hub-items.js";
import { logger } from "../middleware/logger.js";

async function notifyFounders(
  db: Db,
  companyId: string,
  notification: {
    type: string;
    title: string;
    message?: string;
    relatedEntityType?: string;
    // Stable per-event source id. All marketplace events share semanticType
    // `marketplace_op`, so the source id MUST encode the event type (so distinct
    // events don't collide on one open hub row), plus the operation/catalog ref.
    sourceId: string;
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

    const hub = hubItemsService(db);
    // Each founder is the natural owner of their own hub row; the source id folds
    // in the recipient so per-founder rows stay distinct (and dedupe per founder).
    const emitFor = (ownerUserId: string) =>
      hub.emit({
        companyId,
        semanticType: "marketplace_op",
        sourceType: notification.relatedEntityType ?? "marketplace_operation",
        sourceId: `${notification.sourceId}:${ownerUserId}`,
        title: notification.title,
        summary: notification.message ?? null,
        ownerUserId,
      });

    if (founders.length === 0) {
      // Fallback: notify local-board user
      await emitFor("local-board");
      return;
    }

    await Promise.all(
      founders.filter((r) => r.userId).map((r) => emitFor(r.userId!)),
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
      sourceId: `install_completed:${operationId}`,
    }),

  installRequested: (db: Db, companyId: string, catalogItemName: string, requestingUserId: string, operationId?: string) =>
    notifyFounders(db, companyId, {
      type: "marketplace.install_requested",
      title: `Install requested: ${catalogItemName}`,
      message: `User ${requestingUserId} requested installation of ${catalogItemName}.`,
      relatedEntityType: "marketplace_operation",
      sourceId: `install_requested:${operationId ?? catalogItemName}`,
    }),

  installFailed: (db: Db, companyId: string, catalogItemName: string, error: string) =>
    notifyFounders(db, companyId, {
      type: "marketplace.install_failed",
      title: `${catalogItemName} install failed`,
      message: error,
      relatedEntityType: "marketplace_operation",
      sourceId: `install_failed:${catalogItemName}`,
    }),

  updateAvailable: (db: Db, companyId: string, catalogItemName: string, fromVersion: string, toVersion: string) =>
    notifyFounders(db, companyId, {
      type: "marketplace.update_available",
      title: `Update available: ${catalogItemName}`,
      message: `${fromVersion} → ${toVersion} is available.`,
      relatedEntityType: "marketplace_update",
      sourceId: `update_available:${catalogItemName}:${toVersion}`,
    }),

  updateCompleted: (db: Db, companyId: string, catalogItemName: string) =>
    notifyFounders(db, companyId, {
      type: "marketplace.update_completed",
      title: `${catalogItemName} updated`,
      relatedEntityType: "marketplace_update",
      sourceId: `update_completed:${catalogItemName}`,
    }),

  updateFailed: (db: Db, companyId: string, catalogItemName: string, error: string) =>
    notifyFounders(db, companyId, {
      type: "marketplace.update_failed",
      title: `${catalogItemName} update failed`,
      message: error,
      relatedEntityType: "marketplace_update",
      sourceId: `update_failed:${catalogItemName}`,
    }),
};
