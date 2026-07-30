import { pgTable, uuid, text, jsonb, timestamp, index, unique } from "drizzle-orm/pg-core";
import { authUsers } from "./auth.js";
import { organizations } from "./organizations.js"; // P1 (0187) — merged before P5

/**
 * Tenant-scoped execution-target registry (fleet inventory).
 *
 * P1 is merged first, so organizationId is a real FK now (M6-FK). It stays
 * NULLABLE: NULL organizationId = a system/shared target (the pooled gVisor row
 * and the seeded control-plane). ON DELETE SET NULL — a deleted org's dedicated
 * targets survive as orphaned/system rows rather than cascading away mid-run
 * (an operator reclaims or disables them). `slug` matches the
 * AOA_EXECUTION_TARGET_ID string that provider_credentials rows bind to.
 */
export const executionTargets = pgTable(
  "execution_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }), // nullable = system/shared
    ownerUserId: text("owner_user_id").references(() => authUsers.id, { onDelete: "set null" }),
    slug: text("slug").notNull(),
    kind: text("kind").notNull(), // pooled_gvisor | dedicated_worker | e2b | local_host | desktop
    trustClass: text("trust_class").notNull(), // shared_multitenant | dedicated_tenant | local_trusted
    status: text("status").notNull().default("active"), // active | draining | offline | disabled
    capabilities: jsonb("capabilities").$type<Record<string, unknown>>().notNull().default({}),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // M5: system rows have organization_id = NULL. Default NULLS DISTINCT would
    // let every NULL-org slug collide-never, so the control-plane seed and any
    // org-null pooled_gvisor row would DUPLICATE on every boot. NULLS NOT
    // DISTINCT (PG15+) makes NULL == NULL so (NULL, "control-plane") is unique
    // and onConflictDoNothing matches. Mirrors provider_quota_windows.ts:48-55.
    orgSlugUq: unique("execution_targets_org_slug_uq")
      .on(table.organizationId, table.slug)
      .nullsNotDistinct(),
    kindStatusIdx: index("execution_targets_kind_status_idx").on(table.kind, table.status),
    orgIdx: index("execution_targets_org_idx").on(table.organizationId),
  }),
);
