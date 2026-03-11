import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";

export const memoryItems = pgTable(
  "memory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    category: text("category").notNull(),
    source: text("source").notNull(),
    status: text("status").notNull().default("pending"),
    tags: jsonb("tags").default([]).$type<string[]>(),
    departmentId: uuid("department_id").references(() => projects.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("memory_items_company_idx").on(table.companyId),
    companyCategoryIdx: index("memory_items_company_category_idx").on(table.companyId, table.category),
    companyStatusIdx: index("memory_items_company_status_idx").on(table.companyId, table.status),
  }),
);
