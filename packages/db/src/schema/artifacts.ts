import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    type: text("type").notNull(),
    status: text("status").notNull().default("draft"),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => artifactVersions.id, { onDelete: "set null" }),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("artifacts_company_idx").on(table.companyId),
    companyStatusIdx: index("artifacts_company_status_idx").on(table.companyId, table.status),
  }),
);

export const artifactVersions = pgTable(
  "artifact_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id").notNull().references(() => artifacts.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    source: text("source").notNull(),
    sourceDetail: text("source_detail"),
    changelog: text("changelog"),
    parentVersionId: uuid("parent_version_id").references((): AnyPgColumn => artifactVersions.id, { onDelete: "set null" }),
    content: text("content"),
    fileUrl: text("file_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    artifactIdx: index("artifact_versions_artifact_idx").on(table.artifactId),
    artifactVersionUq: uniqueIndex("artifact_versions_artifact_version_uq").on(table.artifactId, table.versionNumber),
  }),
);
