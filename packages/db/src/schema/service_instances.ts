import { pgTable, uuid, text, integer, timestamp, index, check, unique, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organizations.js";
import { services } from "./services.js";

// A concrete instance of a `service` + its generation (E2-D06). Rich instance
// columns are deferred to E3 (additive). organization_id is DENORMALIZED onto the
// instance (NOT NULL, no default) so TEN-004 can later add the composite FK to
// (services.organization_id, services.id) proving instance↔service share a
// tenant. At TEN-001b only the plain service_id FK (ON DELETE CASCADE — instances
// die with their service) + the denormalized organization_id column exist; the
// composite FK is TEN-004.
export const serviceInstances = pgTable(
  "service_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    // TEN-004/E2-F013: NO single-column FK to services.id — the composite
    // `service_instances_org_service_fk` (below) is the SOLE parent FK and carries
    // ON DELETE CASCADE (E2-D09). A redundant single-column parent FK is a
    // cross-tenant existence oracle (FK checks bypass RLS). organization_id keeps
    // its FK.
    serviceId: uuid("service_id").notNull(),
    generation: integer("generation").notNull().default(1),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdx: index("service_instances_organization_idx").on(table.organizationId),
    serviceIdx: index("service_instances_service_idx").on(table.serviceId),
    // SVC-001: reconciled against the FROZEN authority `SERVICE_INSTANCE_STATUSES`
    // (packages/worker-protocol states.ts) - all NINE. The previous list had five and
    // included `interrupted`, which is not a frozen state at all. Hand-written for the
    // same reason as services (no worker-protocol dependency here); the reconciliation is
    // asserted server-side, and asserts set EQUALITY so an EXTRA value is caught too.
    statusValid: check(
      "service_instances_status_check",
      sql`status IN ('pending', 'leased', 'starting', 'healthy', 'unhealthy', 'stopping', 'stopped', 'failed', 'lost')`,
    ),
    // SVC-001: this table previously had NO unique constraint at all, so nothing could
    // bind a composite tenant FK to an instance. Every child table SVC-002/003 needs was
    // blocked on this one line.
    orgIdUq: unique("service_instances_org_id_uq").on(table.organizationId, table.id),
    // TEN-004: composite org-scoped FK — an instance's (organization_id,
    // service_id) must exist together in services(organization_id, id), so an
    // instance cannot be stamped with a different tenant than its service. The redundant
    // single-column service FK was DROPPED in E2-F013 (0212) — it bypassed RLS and leaked
    // cross-tenant existence; this composite is the SOLE service FK, ON DELETE cascade (E2-D09).
    orgServiceFk: foreignKey({
      columns: [table.organizationId, table.serviceId],
      foreignColumns: [services.organizationId, services.id],
      name: "service_instances_org_service_fk",
    }).onDelete("cascade"),
  }),
);

export type ServiceInstance = typeof serviceInstances.$inferSelect;
export type NewServiceInstance = typeof serviceInstances.$inferInsert;
