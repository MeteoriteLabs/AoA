import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, bigint, index, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
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
    // DAT-002 — the RICH artifact model (E5, additive). ALL columns are nullable:
    // the table is empty (no backfill), and the thin `authorizeArtifactCommit`
    // ownership path still writes only (org, job, identifier). A `committed` row's
    // completeness is an APPLICATION invariant enforced by `commitArtifactVersion`
    // (fence-first verify → status='committed'), not a DB NOT NULL — chosen to leave
    // the thin callers valid until they are removed.
    objectKey: text("object_key"),
    sha256: text("sha256"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    contentType: text("content_type"),
    kind: text("kind"),
    sensitivity: text("sensitivity"),
    retention: text("retention"),
    attempt: integer("attempt"),
    leaseId: uuid("lease_id"),
    fenceToken: text("fence_token"),
    versionNumber: integer("version_number"),
    status: text("status"),
    // DAT-003 — the workspace-PATCH apply/review disposition (E5, additive,
    // nullable). Populated ONLY on `kind='workspace_patch'` rows at apply time by
    // the fence-guarded `recordPatchApplyState` mutator: `base_manifest_hash` /
    // `result_manifest_hash` are the patch's declared base→result manifest digests
    // (parsed from the committed, integrity-verified patch object), and
    // `apply_status` is the control-plane disposition
    // (`'pending' | 'applied' | 'conflict_quarantined'`, null until an apply runs).
    // A matching base advances the accepted base to `result_manifest_hash`; a
    // mismatched base is `conflict_quarantined` and NEVER auto-applies. This is NOT
    // the frozen device-auth `quarantine/` object prefix (DAT-006) — it is an
    // apply-time disposition on the committed patch row.
    baseManifestHash: text("base_manifest_hash"),
    resultManifestHash: text("result_manifest_hash"),
    applyStatus: text("apply_status"),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdx: index("job_artifacts_organization_idx").on(table.organizationId),
    jobIdx: index("job_artifacts_job_idx").on(table.jobId),
    // DAT-002 — idempotent commit key. The natural commit identity is
    // (organization_id, job_id, attempt, identifier); a partial unique over only
    // committed rows makes a replayed commit a DO-NOTHING (the fence-first mutator
    // returns the existing row). Pending/uncommitted rows are unconstrained.
    committedIdentityUnique: uniqueIndex("job_artifacts_committed_identity_uidx")
      .on(table.organizationId, table.jobId, table.attempt, table.identifier)
      .where(sql`status = 'committed'`),
    // TEN-004: composite org-scoped FK — an artifact's (organization_id, job_id)
    // must exist together in jobs(organization_id, id), so an artifact cannot be
    // owned by a different tenant than its job. The redundant single-column job FK was
    // DROPPED in E2-F013 (0212) — it bypassed RLS and leaked cross-tenant existence;
    // this composite is the SOLE job FK, ON DELETE cascade (E2-D09).
    orgJobFk: foreignKey({
      columns: [table.organizationId, table.jobId],
      foreignColumns: [jobs.organizationId, jobs.id],
      name: "job_artifacts_org_job_fk",
    }).onDelete("cascade"),
  }),
);

export type JobArtifact = typeof jobArtifacts.$inferSelect;
export type NewJobArtifact = typeof jobArtifacts.$inferInsert;
