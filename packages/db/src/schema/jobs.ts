import { pgTable, uuid, text, timestamp, index, check, unique, foreignKey } from "drizzle-orm/pg-core";
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
    // TEN-004: FK-target composite unique. A PK on `id` alone cannot be the
    // target of a composite (organization_id, id) FK — children (job_attempts,
    // job_artifacts, job_secret_handles) reference EXACTLY this column set to
    // prove they share the job's tenant.
    orgIdUq: unique("jobs_org_id_uq").on(table.organizationId, table.id),
    // TEN-004: composite org-scoped FK — a job's (organization_id, company_id)
    // must exist together in companies(organization_id, id). Direct SQL cannot
    // pair org A with a company owned by org B even though both single-column
    // FKs individually resolve. Redundant single-column FKs kept (harmless).
    orgCompanyFk: foreignKey({
      columns: [table.organizationId, table.companyId],
      foreignColumns: [companies.organizationId, companies.id],
      name: "jobs_org_company_fk",
    }),
  }),
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
