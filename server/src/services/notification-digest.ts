import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { notificationDigestItems } from "@armyofagents/db";
import type { HubDigestChangedLivePayload, HubSemanticType, UserRole } from "@armyofagents/shared";
import type { HubListResponse } from "./hub-items.js";
import { publishLiveEvent } from "./live-events.js";

export function notificationDigestService(db: Db) {
  return {
    async queueForUser(args: {
      companyId: string;
      userId: string;
      hubItemId: string;
      semanticType: HubSemanticType;
      publish?: boolean;
    }): Promise<{ queued: boolean }> {
      const created = await db
        .insert(notificationDigestItems)
        .values({
          companyId: args.companyId,
          userId: args.userId,
          hubItemId: args.hubItemId,
          semanticType: args.semanticType,
        })
        .onConflictDoNothing()
        .returning({ id: notificationDigestItems.id });
      if (args.publish !== false && created.length > 0) {
        publishLiveEvent({
          companyId: args.companyId,
          type: "hub.digest.changed",
          payload: { reason: "queued" } satisfies HubDigestChangedLivePayload,
        });
      }
      return { queued: created.length > 0 };
    },

    async listForUser(args: {
      companyId: string;
      userId: string;
      role?: UserRole;
    }): Promise<{ items: HubListResponse["items"] }> {
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

      const { hubItemsService } = await import("./hub-items.js");
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
      if (updated.length > 0) {
        publishLiveEvent({
          companyId: args.companyId,
          type: "hub.digest.changed",
          payload: { reason: "acked" } satisfies HubDigestChangedLivePayload,
        });
      }
      return { acked: updated.length };
    },
  };
}
