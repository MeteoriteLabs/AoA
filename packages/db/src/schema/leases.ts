import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations.js";
import { jobAttempts } from "./job_attempts.js";

// Lease over a job attempt (fence-token guarded). organization_id is DENORMALIZED
// (NOT NULL, no default) so TEN-004 can constrain lease↔attempt within one tenant.
// `fence` is an unpredictable fence token (text/uuid is fine at the kernel level;
// generation policy is later). At TEN-001a only the plain attempt_id FK (ON DELETE
// CASCADE) + denormalized organization_id exist; the partial-unique "at most one
// active lease per attempt" (uniqueIndex WHERE released_at IS NULL) is TEN-004.
export const leases = pgTable(
  "leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => jobAttempts.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("offered"),
    fence: text("fence").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdx: index("leases_organization_idx").on(table.organizationId),
    attemptIdx: index("leases_attempt_idx").on(table.attemptId),
    statusValid: check(
      "leases_status_check",
      sql`status IN ('offered', 'active', 'released', 'expired', 'revoked')`,
    ),
  }),
);

export type Lease = typeof leases.$inferSelect;
export type NewLease = typeof leases.$inferInsert;
