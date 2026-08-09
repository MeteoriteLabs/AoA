import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
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
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    identifier: text("identifier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdx: index("job_artifacts_organization_idx").on(table.organizationId),
    jobIdx: index("job_artifacts_job_idx").on(table.jobId),
  }),
);

export type JobArtifact = typeof jobArtifacts.$inferSelect;
export type NewJobArtifact = typeof jobArtifacts.$inferInsert;
