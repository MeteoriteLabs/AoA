import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  integer,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { companies } from "./companies.js";

// ── Table 11: notifications ─────────────────────────────────────────────────

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(), // recipient

    // Notification content
    type: text("type").notNull(),
    // 'discussion.extraction_complete' | 'discussion.extraction_failed'
    // | 'internal_agent.reminder' | 'internal_agent.proactive'
    // | 'internal_agent.action_result'
    // | 'thread.mention' | 'thread.scope_proposal_posted'
    // | 'thread.artifact_needs_review' | 'thread.crew_failed'
    // | 'thread.spinoff_suggested' | 'thread.human_input_needed'
    title: text("title").notNull(),
    message: text("message"),

    // Link to related entity
    relatedEntityType: text("related_entity_type"),
    // 'discussion' | 'task' | 'goal' | 'agent' | 'memory' | 'reminder'
    relatedEntityId: uuid("related_entity_id"),

    // State
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),

    // Delivery tracking (Phase G2, T26).
    // `deliveryAttempts` increments on every retry attempt. `deliveredAt` is
    // stamped when the row is considered successfully delivered (or queued
    // for the realtime channel — concrete delivery adapters land later).
    // `deliveryError` is the most recent failure message; rows with a non-
    // null error and < MAX_DELIVERY_ATTEMPTS attempts are picked up by the
    // notification retry worker. See server/src/services/notifications.ts.
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deliveryError: text("delivery_error"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    companyUserIdx: index("notifications_company_user_idx").on(
      table.companyId,
      table.userId,
    ),
    unreadIdx: index("notifications_unread_idx").on(
      table.companyId,
      table.userId,
      table.readAt,
    ),
    createdAtIdx: index("notifications_created_at_idx").on(
      table.companyId,
      table.createdAt,
    ),
    retryQueueIdx: index("notifications_retry_queue_idx")
      .on(table.deliveryAttempts, table.deliveryError)
      .where(
        sql`delivery_error IS NOT NULL AND delivered_at IS NULL`,
      ),
  }),
);

// ── Relations ───────────────────────────────────────────────────────────────

export const notificationsRelations = relations(
  notifications,
  ({ one }) => ({
    company: one(companies, {
      fields: [notifications.companyId],
      references: [companies.id],
    }),
  }),
);
