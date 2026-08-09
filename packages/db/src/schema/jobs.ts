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
    // TEN-004/E2-F013: NO single-column FK to companies.id — a redundant
    // single-column parent FK is a cross-tenant EXISTENCE ORACLE (FK checks bypass
    // RLS, so a company_id that exists in ANOTHER org would pass a single-column FK
    // and fail only the composite FK, while an absent id fails the single-column FK
    // — the differing constraint name leaks existence, banned by H-01). The
    // composite `jobs_org_company_fk` (below) is the SOLE parent FK and carries the
    // ON DELETE (E2-D09). organization_id keeps its single-column FK (tenant key; a
    // cross-org value hits RLS WITH CHECK (42501) before any FK — not an oracle).
    companyId: uuid("company_id").notNull(),
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
    // pair org A with a company owned by org B. The redundant single-column company
    // FK was DROPPED in E2-F013 (migration 0212): FK checks bypass RLS, so a
    // cross-tenant vs absent company id failed a DIFFERENT constraint — a cross-tenant
    // existence oracle. This composite is the SOLE company FK, ON DELETE restrict (E2-D09).
    orgCompanyFk: foreignKey({
      columns: [table.organizationId, table.companyId],
      foreignColumns: [companies.organizationId, companies.id],
      name: "jobs_org_company_fk",
    }).onDelete("restrict"),
  }),
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
