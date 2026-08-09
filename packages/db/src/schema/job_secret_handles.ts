import { pgTable, uuid, text, timestamp, index, foreignKey } from "drizzle-orm/pg-core";
import { organizations } from "./organizations.js";
import { jobs } from "./jobs.js";

// Minimal opaque secret-HANDLE ownership index for a job (E2-D06). This is a
// skeleton so TEN-004 can constrain secret-handle↔job within one tenant; the RICH
// secret model (materialization, canaries, rotation) is deferred to E5
// (additive). `handle` is an opaque secret-handle id — no materialized secret
// value ever lands here. organization_id is DENORMALIZED (NOT NULL, no default)
// so TEN-004 can add the composite FK to (jobs.organization_id, jobs.id). At
// TEN-001b only the plain job_id FK (ON DELETE CASCADE — handles die with their
// job) + the denormalized organization_id column exist; the composite FK is
// TEN-004.
export const jobSecretHandles = pgTable(
  "job_secret_handles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    handle: text("handle").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdx: index("job_secret_handles_organization_idx").on(table.organizationId),
    jobIdx: index("job_secret_handles_job_idx").on(table.jobId),
    // TEN-004: composite org-scoped FK — a secret handle's (organization_id,
    // job_id) must exist together in jobs(organization_id, id), so a handle
    // cannot be owned by a different tenant than its job. Redundant single-column
    // FKs kept (harmless).
    orgJobFk: foreignKey({
      columns: [table.organizationId, table.jobId],
      foreignColumns: [jobs.organizationId, jobs.id],
      name: "job_secret_handles_org_job_fk",
    }),
  }),
);

export type JobSecretHandle = typeof jobSecretHandles.$inferSelect;
export type NewJobSecretHandle = typeof jobSecretHandles.$inferInsert;
