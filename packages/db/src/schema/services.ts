import { pgTable, uuid, text, integer, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations.js";
import { companies } from "./companies.js";

// Service desired-state row (E2-D06). Rich service columns are deferred to E3
// (additive). Like `jobs`, BOTH tenant identities are MANDATORY and
// NON-DEFAULTED — no sentinel-org fail-open: an insert that omits either FK
// fails the NOT NULL constraint (fail-closed). organization_id / company_id use
// ON DELETE RESTRICT so a tenant cannot be torn down while it still owns
// services (teardown is out of scope). TEN-004 adds the composite
// (organization_id, company_id) FK proving service↔company↔org share a tenant.
export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    desiredState: text("desired_state").notNull().default("running"),
    generation: integer("generation").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdx: index("services_organization_idx").on(table.organizationId),
    organizationCompanyIdx: index("services_organization_company_idx").on(
      table.organizationId,
      table.companyId,
    ),
    desiredStateValid: check(
      "services_desired_state_check",
      sql`desired_state IN ('running', 'stopped', 'deleted')`,
    ),
  }),
);

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
