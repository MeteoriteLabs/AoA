import { pgTable, uuid, text, integer, timestamp, index, check, unique, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations.js";
import { jobs } from "./jobs.js";

// The kernel "run" surface (program-design's job/company/run — rich run columns
// deferred to E3). organization_id is DENORMALIZED onto the attempt (NOT NULL, no
// default) so TEN-004 can later add the composite FK to (jobs.organization_id,
// jobs.id) proving attempt↔job share a tenant. At TEN-001a only the plain job_id
// FK (ON DELETE CASCADE — attempts die with their job) + the denormalized
// organization_id column exist; the composite FK is TEN-004.
export const jobAttempts = pgTable(
  "job_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    // TEN-004/E2-F013: NO single-column FK to jobs.id — the composite
    // `job_attempts_org_job_fk` (below) is the SOLE parent FK and carries ON DELETE
    // CASCADE (E2-D09). A redundant single-column parent FK is a cross-tenant
    // existence oracle (FK checks bypass RLS). organization_id keeps its FK.
    jobId: uuid("job_id").notNull(),
    attemptNumber: integer("attempt_number").notNull().default(1),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdx: index("job_attempts_organization_idx").on(table.organizationId),
    jobIdx: index("job_attempts_job_idx").on(table.jobId),
    statusValid: check(
      "job_attempts_status_check",
      sql`status IN ('pending', 'offered', 'leased', 'running', 'cancel_requested', 'succeeded', 'failed', 'cancelled', 'expired')`,
    ),
    // TEN-004: FK-target composite unique so `leases` can bind (organization_id,
    // attempt_id) → job_attempts(organization_id, id).
    orgIdUq: unique("job_attempts_org_id_uq").on(table.organizationId, table.id),
    // TEN-004: composite org-scoped FK — an attempt's (organization_id, job_id)
    // must exist together in jobs(organization_id, id), so an attempt cannot be
    // stamped with a different tenant than its job. The redundant single-column job
    // FK was DROPPED in E2-F013 (0212) — it bypassed RLS and leaked cross-tenant
    // existence; this composite is the SOLE job FK, ON DELETE cascade (E2-D09).
    orgJobFk: foreignKey({
      columns: [table.organizationId, table.jobId],
      foreignColumns: [jobs.organizationId, jobs.id],
      name: "job_attempts_org_job_fk",
    }).onDelete("cascade"),
  }),
);

export type JobAttempt = typeof jobAttempts.$inferSelect;
export type NewJobAttempt = typeof jobAttempts.$inferInsert;
