/**
 * Notification creation + delivery-retry surface (Phase G2, T26).
 *
 * Single entry point for inserting notifications. Catches and persists
 * delivery failures so the retry worker can pick them up later instead of
 * dropping the notification entirely. Callers that previously did
 * `db.insert(notifications)` directly should migrate to `createNotification`.
 *
 * The legacy `notificationService(db)` factory below is preserved as the
 * read/mark/dismiss surface used by routes; its `create` method now delegates
 * to `createNotification` so it inherits retry semantics.
 */
import { and, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { notifications } from "@armyofagents/db";
import { notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";

/**
 * Maximum number of delivery attempts before a notification is left for
 * manual triage. After this many failures the row stays in the table with
 * `deliveryError` populated and `deliveredAt` null, but the retry worker
 * stops touching it. `countPersistentlyFailingNotifications` surfaces the
 * cohort for the operator dashboard.
 */
const MAX_DELIVERY_ATTEMPTS = 3;

export interface NotificationInput {
  companyId: string;
  userId: string;
  type: string;
  title: string;
  message?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
}

export interface NotificationRow {
  id: string;
  companyId: string;
  userId: string;
  type: string;
  title: string;
  message: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  deliveryAttempts: number;
  deliveredAt: Date | null;
  deliveryError: string | null;
  createdAt: Date;
}

/**
 * Insert a notification with delivery tracking.
 *
 * On the happy path inserts a row with `deliveryAttempts: 0` and
 * `deliveredAt: now()`. If the primary insert throws (e.g. transient DB
 * failure, deadlock), the function attempts a second insert that records
 * the error in `deliveryError` with `deliveryAttempts: 1` so the retry
 * worker can pick the row up on its next sweep. If even the stub insert
 * fails the original error is rethrown — callers should treat that as a
 * hard failure.
 */
export async function createNotification(
  db: Db,
  params: NotificationInput,
): Promise<NotificationRow> {
  try {
    const [row] = await db
      .insert(notifications)
      .values({
        companyId: params.companyId,
        userId: params.userId,
        type: params.type,
        title: params.title,
        message: params.message ?? null,
        relatedEntityType: params.relatedEntityType ?? null,
        relatedEntityId: params.relatedEntityId ?? null,
        deliveryAttempts: 0,
        deliveredAt: new Date(),
      })
      .returning();
    return row as NotificationRow;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      {
        err,
        companyId: params.companyId,
        userId: params.userId,
        type: params.type,
      },
      "notification.create failed — inserting retry stub",
    );
    // Insert a stub row with deliveryError set so the retry worker can pick it up.
    try {
      const [stub] = await db
        .insert(notifications)
        .values({
          companyId: params.companyId,
          userId: params.userId,
          type: params.type,
          title: params.title,
          message: params.message ?? null,
          relatedEntityType: params.relatedEntityType ?? null,
          relatedEntityId: params.relatedEntityId ?? null,
          deliveryAttempts: 1,
          deliveryError: message.slice(0, 1000),
        })
        .returning();
      return stub as NotificationRow;
    } catch (stubErr) {
      // If we can't even insert the stub, give up — caller sees the original.
      logger.error({ err: stubErr }, "notification stub insert also failed");
      throw err;
    }
  }
}

export interface RetrySweepResult {
  scanned: number;
  delivered: number;
  failed: number;
  /** Rows that hit MAX_DELIVERY_ATTEMPTS on this sweep and were left for manual triage. */
  exhausted: number;
}

/**
 * Pick up to `batchSize` notifications with a recorded delivery error
 * (and < MAX_DELIVERY_ATTEMPTS attempts) and try to mark them delivered.
 *
 * The current implementation just clears the error flag — concrete
 * delivery channels (WS push, email) hook in via the `attempt` callback
 * once those land. This is the queue infrastructure, not the channel
 * adapter.
 *
 * Counters returned:
 *   - `scanned`: total candidates picked up this sweep
 *   - `delivered`: rows where `attempt` succeeded
 *   - `failed`: rows where `attempt` threw but attempts < MAX
 *   - `exhausted`: rows where `attempt` threw and attempts hit MAX
 */
export async function retryFailedNotifications(
  db: Db,
  options: {
    batchSize?: number;
    attempt?: (row: NotificationRow) => Promise<void>;
  } = {},
): Promise<RetrySweepResult> {
  const batchSize = options.batchSize ?? 10;
  const attempt = options.attempt ?? (async () => { /* no-op delivery */ });

  const candidates = (await db
    .select()
    .from(notifications)
    .where(
      and(
        isNotNull(notifications.deliveryError),
        isNull(notifications.deliveredAt),
        lt(notifications.deliveryAttempts, MAX_DELIVERY_ATTEMPTS),
      ),
    )
    .limit(batchSize)) as NotificationRow[];

  let delivered = 0;
  let failed = 0;
  let exhausted = 0;

  for (const row of candidates) {
    try {
      await attempt(row);
      await db
        .update(notifications)
        .set({
          deliveredAt: new Date(),
          deliveryError: null,
        })
        .where(eq(notifications.id, row.id));
      delivered++;
    } catch (err) {
      const nextAttempts = row.deliveryAttempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      await db
        .update(notifications)
        .set({
          deliveryAttempts: nextAttempts,
          deliveryError: message.slice(0, 1000),
        })
        .where(eq(notifications.id, row.id));
      if (nextAttempts >= MAX_DELIVERY_ATTEMPTS) exhausted++;
      else failed++;
    }
  }

  return {
    scanned: candidates.length,
    delivered,
    failed,
    exhausted,
  };
}

/**
 * Monitoring helper — returns the count of notifications that hit
 * MAX_DELIVERY_ATTEMPTS without delivery. Surfaces in operator dashboards
 * and CI smoke tests as a "is delivery still healthy" signal.
 *
 * Pass `companyId` to scope the count to a single tenant; omit for an
 * instance-wide aggregate.
 */
export async function countPersistentlyFailingNotifications(
  db: Db,
  companyId?: string,
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(notifications)
    .where(
      and(
        sql`${notifications.deliveryAttempts} >= ${MAX_DELIVERY_ATTEMPTS}`,
        isNull(notifications.deliveredAt),
        companyId ? eq(notifications.companyId, companyId) : sql`true`,
      ),
    );
  return result[0]?.count ?? 0;
}

export { MAX_DELIVERY_ATTEMPTS };

// ── Legacy read/mark/dismiss surface ────────────────────────────────────────
//
// The original notificationService factory predates Phase G2. Routes still
// import it for list/markRead/dismiss/getUnreadCount and the original
// `create` shape. `create` now delegates to `createNotification` so retry
// semantics are inherited by callers that have not yet migrated.

export function notificationService(db: Db) {
  return {
    /**
     * Create a notification for a user. Delegates to `createNotification`
     * so retry semantics apply uniformly.
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
      return createNotification(db, {
        companyId,
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message ?? null,
        relatedEntityType: data.relatedEntityType ?? null,
        relatedEntityId: data.relatedEntityId ?? null,
      });
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
