import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { environments } from "./environments.js";
import { environmentLeases } from "./environment_leases.js";

// MIG-008 (E10 desktop-migration): the durable, APPEND-ONLY crosswalk that records
// the pre-cutover reconciliation of every legacy `environment_leases` row + the
// platform-default `environments` resource into exactly ONE mapping OR terminal
// cleanup record. This is the closure store the reconciler asserts against.
//
// SECURITY MODEL (custom RLS migration, C14 / Decision #122; mirrors the DEP-003
// cutover marker 0233 operator-metadata shape — the MIG-008 reconciler is a
// SERVER-SIDE system/operator pass, NOT a per-tenant-request writer):
//   - `aoa_operator` WRITE (SELECT/INSERT/UPDATE, no DELETE — records are durable)
//     — only the operator-authored reconciliation pass writes these rows.
//   - `aoa_app` READ-ONLY — the control plane reads the closure store to gate a
//     cutover, but only OUTSIDE a tenant transaction (read policy predicate is
//     `current_setting('aoa.organization_id', true) IS NULL`).
//   - tenants NONE — an aoa_app query WITH the tenant GUC set never matches the
//     read policy, so the crosswalk is invisible to every tenant.
//   - FORCE ROW LEVEL SECURITY — defense-in-depth against a non-superuser owner
//     mistake (E2-F004 rationale).
//
// COMPANY-SCOPED (not org-scoped): the source (`environment_leases`) is
// company-scoped and closure is asserted per-company, so `companyId` is the data
// key. It is NOT the RLS tenant key (this is operator-metadata infra, keyed like
// the platform cutover marker). A distributed `ResourceLabels`-org attribution is
// recorded as `resourceLabelsHash` (a partial-attribution hash ONLY — never a
// leasable live fence; MIG-008 Invariant #2).
//
// APPEND-ONLY: there is no update path in application code (the operator UPDATE
// grant exists only to satisfy the mirrored 0233 grant shape / idempotent replay).
// `resourceKey` is the deterministic idempotency key (one record per resource):
// for a lease it is the lease id; for the platform-default env resource it is
// `platform-default-env:<environmentId>` (its uuidv5 id is never reminted).
export const legacyResourceReconciliation = pgTable(
  "legacy_resource_reconciliation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    // Nullable FK: a mapped/terminal lease record points at its source lease; the
    // platform-default env resource has no lease (environmentId only).
    environmentLeaseId: uuid("environment_lease_id").references(() => environmentLeases.id, {
      onDelete: "set null",
    }),
    // Nullable: the environments row id (the lease's env, or the platform-default env).
    environmentId: uuid("environment_id").references(() => environments.id, { onDelete: "set null" }),
    // Deterministic idempotency key — one record per resource.
    resourceKey: text("resource_key").notNull(),
    // One of the 5 MIG-008 types: ephemeral | warm_org | warm_commander |
    // workspace_ref | platform_default_env.
    resourceType: text("resource_type").notNull(),
    // The source lease.status at reconcile time (null for the platform-default env resource).
    legacyStatus: text("legacy_status"),
    provider: text("provider"),
    providerLeaseId: text("provider_lease_id"),
    // 'mapped' | 'terminal_cleanup' | 'unattributable'.
    disposition: text("disposition").notNull(),
    // Partial-attribution hash for a mapping record ONLY — never a synthesized live fence.
    resourceLabelsHash: text("resource_labels_hash"),
    // The SECRET-AWARE key-generation identity ("<secretId>:<version>") this resource was
    // attributed with (D3). Secret-aware because runtime_provider_keys.secretId is
    // repointable + per-secret versions restart at 1, so a bare version is not monotonic
    // across a rotation. Null for an operator-env-default (ungenerationed) company.
    keyGeneration: text("key_generation"),
    // 'delegated_cli004' | 'paused_snapshot_reconciled' | 'no_handle' | null (mapping-only).
    cleanupOutcome: text("cleanup_outcome"),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One record per resource: re-running the reconciler is idempotent.
    companyResourceKeyUq: uniqueIndex("legacy_resource_reconciliation_company_resource_key_uq").on(
      table.companyId,
      table.resourceKey,
    ),
    companyIdx: index("legacy_resource_reconciliation_company_idx").on(table.companyId),
    dispositionIdx: index("legacy_resource_reconciliation_disposition_idx").on(table.disposition),
  }),
);

export type LegacyResourceReconciliation = typeof legacyResourceReconciliation.$inferSelect;
export type NewLegacyResourceReconciliation = typeof legacyResourceReconciliation.$inferInsert;
