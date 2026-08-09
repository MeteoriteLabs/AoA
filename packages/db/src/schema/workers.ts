import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations.js";

// Worker / execution-target registration identity (E2-D06). Rich worker columns
// (JOB-002, E3) are deferred (additive). `scope` follows the program-design
// `platform | organization | owner` model:
//   - `platform`  → cross-tenant infrastructure worker; organization_id IS NULL
//                   (a tenant GUC never matches NULL under forced RLS → these are
//                   operator-only, never tenant-visible; the operator-read policy
//                   shape is TEN-002).
//   - `organization` / `owner` → tenant-bound; organization_id IS NOT NULL.
// The `workers_scope_org_check` constraint enforces exactly that pairing at write
// time. organization_id is therefore the ONE new-path table that is legitimately
// NULLABLE (contrast the mandatory identity on jobs/services) — but it uses
// ON DELETE RESTRICT so a tenant cannot be torn down while it still owns workers.
// `owner_user_id` is reserved for the `owner`-scope binding JOB-002 adds later —
// deliberately NO FK at E2 (JOB-002 binds it to the identity source it chooses).
export const workers = pgTable(
  "workers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    ownerUserId: uuid("owner_user_id"),
    label: text("label").notNull(),
    status: text("status").notNull().default("enrolled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdx: index("workers_organization_idx").on(table.organizationId),
    scopeValid: check(
      "workers_scope_check",
      sql`scope IN ('platform', 'organization', 'owner')`,
    ),
    statusValid: check(
      "workers_status_check",
      sql`status IN ('enrolled', 'active', 'draining', 'revoked')`,
    ),
    scopeOrgValid: check(
      "workers_scope_org_check",
      sql`(scope = 'platform' AND organization_id IS NULL) OR (scope IN ('organization', 'owner') AND organization_id IS NOT NULL)`,
    ),
  }),
);

export type Worker = typeof workers.$inferSelect;
export type NewWorker = typeof workers.$inferInsert;
