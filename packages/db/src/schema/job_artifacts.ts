import { pgTable, uuid, text, timestamp, index, foreignKey } from "drizzle-orm/pg-core";
import { organizations } from "./organizations.js";
import { jobs } from "./jobs.js";

// Minimal artifact OWNERSHIP index for a job (E2-D06). This is a skeleton so
// TEN-004 can constrain artifact↔job within one tenant; the RICH artifact model
// (content, versioning, storage) is deferred to E5 (additive). `identifier` is an
// opaque artifact key/id — no semantics at the kernel level. organization_id is
// DENORMALIZED (NOT NULL, no default) so TEN-004 can add the composite FK to
// (jobs.organization_id, jobs.id). At TEN-001b only the plain job_id FK
// (ON DELETE CASCADE — artifacts die with their job) + the denormalized
// organization_id column exist; the composite FK is TEN-004.
export const jobArtifacts = pgTable(
  "job_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    // TEN-004/E2-F013: NO single-column FK to jobs.id — the composite
    // `job_artifacts_org_job_fk` (below) is the SOLE parent FK and carries ON DELETE
    // CASCADE (E2-D09). A redundant single-column parent FK is a cross-tenant
    // existence oracle (FK checks bypass RLS). organization_id keeps its FK.
    jobId: uuid("job_id").notNull(),
    identifier: text("identifier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdx: index("job_artifacts_organization_idx").on(table.organizationId),
    jobIdx: index("job_artifacts_job_idx").on(table.jobId),
    // TEN-004: composite org-scoped FK — an artifact's (organization_id, job_id)
    // must exist together in jobs(organization_id, id), so an artifact cannot be
    // owned by a different tenant than its job. Redundant single-column FKs kept
    // (harmless).
    orgJobFk: foreignKey({
      columns: [table.organizationId, table.jobId],
      foreignColumns: [jobs.organizationId, jobs.id],
      name: "job_artifacts_org_job_fk",
    }).onDelete("cascade"),
  }),
);

export type JobArtifact = typeof jobArtifacts.$inferSelect;
export type NewJobArtifact = typeof jobArtifacts.$inferInsert;
