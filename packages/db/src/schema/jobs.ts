import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations.js";
import { companies } from "./companies.js";

// New-path distributed-execution kernel: immutable job intent + aggregate status
// (E2-D06). Rich job columns are deferred to E3 (additive). Both tenant identities
// are MANDATORY and NON-DEFAULTED — no sentinel-org fail-open (contrast
// companies.organization_id): an insert that omits either FK fails the NOT NULL
// constraint (fail-closed). organization_id / company_id use ON DELETE RESTRICT so
// a tenant cannot be torn down while it still owns jobs (teardown is out of scope).
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("queued"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdx: index("jobs_organization_idx").on(table.organizationId),
    organizationCompanyIdx: index("jobs_organization_company_idx").on(
      table.organizationId,
      table.companyId,
    ),
    statusValid: check(
      "jobs_status_check",
      sql`status IN ('queued', 'running', 'cancel_requested', 'succeeded', 'failed', 'cancelled', 'dead_letter')`,
    ),
  }),
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
