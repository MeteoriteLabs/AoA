import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import { goals } from "./goals.js";
import { issues } from "./issues.js";
import { artifacts } from "./artifacts.js";
import { memoryItemVersions } from "./memory_item_versions.js";

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
    // V2 fields
    layer: text("layer"),
    priority: integer("priority").notNull().default(0),
    visibility: text("visibility").notNull().default("scoped"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references((): AnyPgColumn => issues.id, { onDelete: "set null" }),
    sourceArtifactId: uuid("source_artifact_id").references(() => artifacts.id, { onDelete: "set null" }),
    sourceContext: text("source_context"),
    accessedAt: timestamp("accessed_at", { withTimezone: true }),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => memoryItemVersions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("memory_items_company_idx").on(table.companyId),
    companyCategoryIdx: index("memory_items_company_category_idx").on(table.companyId, table.category),
    companyStatusIdx: index("memory_items_company_status_idx").on(table.companyId, table.status),
    companyLayerStatusIdx: index("memory_items_company_layer_status_idx").on(table.companyId, table.layer, table.status),
    goalActiveContextIdx: index("memory_items_goal_active_context_idx").on(table.goalId, table.expiresAt),
    taskWorkingIdx: index("memory_items_task_working_idx").on(table.taskId),
  }),
);
