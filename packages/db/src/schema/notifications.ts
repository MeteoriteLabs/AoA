import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
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
    title: text("title").notNull(),
    message: text("message"),

    // Link to related entity
    relatedEntityType: text("related_entity_type"),
    // 'discussion' | 'task' | 'goal' | 'agent' | 'memory' | 'reminder'
    relatedEntityId: uuid("related_entity_id"),

    // State
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),

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
