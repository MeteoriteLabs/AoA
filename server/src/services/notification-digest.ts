import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { notificationDigestItems } from "@armyofagents/db";
import type { HubSemanticType, UserRole } from "@armyofagents/shared";
import { hubItemsService } from "./hub-items.js";

export function notificationDigestService(db: Db) {
  return {
    async queueForUser(args: {
      companyId: string;
      userId: string;
      hubItemId: string;
      semanticType: HubSemanticType;
    }): Promise<void> {
      await db
        .insert(notificationDigestItems)
        .values({
          companyId: args.companyId,
          userId: args.userId,
          hubItemId: args.hubItemId,
          semanticType: args.semanticType,
        })
        .onConflictDoNothing();
    },

    async listForUser(args: {
      companyId: string;
      userId: string;
      role?: UserRole;
    }): Promise<{ items: Awaited<ReturnType<ReturnType<typeof hubItemsService>["query"]>>["items"] }> {
      const rows = await db
        .select({ hubItemId: notificationDigestItems.hubItemId })
        .from(notificationDigestItems)
        .where(
          and(
            eq(notificationDigestItems.companyId, args.companyId),
            eq(notificationDigestItems.userId, args.userId),
            isNull(notificationDigestItems.ackedAt),
          ),
        );
      if (rows.length === 0) return { items: [] };

      const visible = await hubItemsService(db).query(args.companyId, {
        actorUserId: args.userId,
        role: args.role,
        status: "open",
        includeDismissed: true,
        includeSnoozed: true,
        limit: 50,
      });
      const wanted = new Set(rows.map((row) => row.hubItemId));
      return {
        items: visible.items.filter((item) => wanted.has(item.id)),
      };
    },

    async ackForUser(args: {
      companyId: string;
      userId: string;
    }): Promise<{ acked: number }> {
      const updated = await db
        .update(notificationDigestItems)
        .set({ ackedAt: new Date() })
        .where(
          and(
            eq(notificationDigestItems.companyId, args.companyId),
            eq(notificationDigestItems.userId, args.userId),
            isNull(notificationDigestItems.ackedAt),
          ),
        )
        .returning({ id: notificationDigestItems.id });
      return { acked: updated.length };
    },
  };
}
