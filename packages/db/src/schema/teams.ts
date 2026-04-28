import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { projects } from "./projects.js";
import type { TeamManifest } from "@armyofagents/shared";

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    parentProjectId: uuid("parent_project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    manifest: jsonb("manifest").$type<Partial<TeamManifest>>().notNull().default({}),
    templateOrigin: text("template_origin"),
    templateVersion: text("template_version"),
    status: text("status").notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("teams_company_idx").on(table.companyId),
    parentProjectIdx: index("teams_parent_project_idx").on(table.parentProjectId),
    companySlugUq: uniqueIndex("teams_company_slug_uq").on(table.companyId, table.slug),
  }),
);
