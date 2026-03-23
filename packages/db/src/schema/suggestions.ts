import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { memoryItems } from "./memory_items.js";

export const suggestions = pgTable(
  "suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    actionType: text("action_type").notNull(),
    actionPayload: jsonb("action_payload").$type<Record<string, unknown>>(),
    title: text("title").notNull(),
    evidence: text("evidence"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    relatedMemoryItemId: uuid("related_memory_item_id").references(() => memoryItems.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("suggestions_company_idx").on(table.companyId),
    companyStatusIdx: index("suggestions_company_status_idx").on(table.companyId, table.status),
    companyCategoryIdx: index("suggestions_company_category_idx").on(table.companyId, table.category),
  }),
);
