import { and, eq, desc, isNull, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { notifications } from "@armyofagents/db";
import { notFound } from "../errors.js";

export function notificationService(db: Db) {
  return {
    /**
     * Create a notification for a user.
     */
    create: async (
      companyId: string,
      data: {
        userId: string;
        type: string;
        title: string;
        message?: string | null;
        relatedEntityType?: string | null;
        relatedEntityId?: string | null;
      },
    ) => {
      const [notification] = await db
        .insert(notifications)
        .values({
          companyId,
          userId: data.userId,
          type: data.type,
          title: data.title,
          message: data.message ?? null,
          relatedEntityType: data.relatedEntityType ?? null,
          relatedEntityId: data.relatedEntityId ?? null,
        })
        .returning();

      return notification;
    },

    /**
     * List notifications for a user, optionally filtering to unread only.
     */
    list: async (
      companyId: string,
      userId: string,
      filters?: { unreadOnly?: boolean },
    ) => {
      const conditions = [
        eq(notifications.companyId, companyId),
        eq(notifications.userId, userId),
        isNull(notifications.dismissedAt),
      ];

      if (filters?.unreadOnly) {
        conditions.push(isNull(notifications.readAt));
      }

      return db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt));
    },

    /**
     * Mark a notification as read.
     * Scoped by companyId + userId to prevent cross-user access.
     */
    markRead: async (companyId: string, userId: string, id: string) => {
      const [updated] = await db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.id, id),
            eq(notifications.companyId, companyId),
            eq(notifications.userId, userId),
          ),
        )
        .returning();

      if (!updated) {
        throw notFound("Notification not found");
      }

      return updated;
    },

    /**
     * Dismiss a notification (soft-delete).
     * Scoped by companyId + userId to prevent cross-user access.
     */
    dismiss: async (companyId: string, userId: string, id: string) => {
      const [updated] = await db
        .update(notifications)
        .set({ dismissedAt: new Date() })
        .where(
          and(
            eq(notifications.id, id),
            eq(notifications.companyId, companyId),
            eq(notifications.userId, userId),
          ),
        )
        .returning();

      if (!updated) {
        throw notFound("Notification not found");
      }

      return updated;
    },

    /**
     * Get unread count for badge display.
     */
    getUnreadCount: async (companyId: string, userId: string) => {
      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(
            eq(notifications.companyId, companyId),
            eq(notifications.userId, userId),
            isNull(notifications.readAt),
            isNull(notifications.dismissedAt),
          ),
        );

      return result[0]?.count ?? 0;
    },
  };
}
