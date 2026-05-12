import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const environments = pgTable(
  "environments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    envVars: jsonb("env_vars").$type<Record<string, unknown>>().notNull().default({}),
    // connectionTarget is stored for v2.0 target-aware upgrade; ignored at execution time in v1.x.
    connectionTarget: jsonb("connection_target").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("environments_company_idx").on(table.companyId),
  }),
);
