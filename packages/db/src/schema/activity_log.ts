import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, jsonb, index, check } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { organizations } from "./organizations.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

/**
 * ★ E0-F013 DECISION 2, RULED (a2) — 2026-09-09.
 * `docs/replatform/DECISION-REQUEST-unattributable-denial-sink.md` §4.
 *
 * `company_id` was `NOT NULL` and that NOT NULL was, for every product writer,
 * the ONLY enforcement that a row belongs to a company. It was also the reason a
 * denial with no FK-valid tenant — a replayed worker proof (DE-03), a fleet-wide
 * provider kill (DE-15), five of DE-06's six fence throws — could not be
 * recorded at all: `recordSecurityDenial` logged and returned null, so those
 * refusals stayed indistinguishable from traffic that never happened.
 *
 * The ruling relaxes the column and REPLACES the guarantee it carried, rather
 * than trading it away:
 *
 *   1. `company_id` becomes NULLABLE.
 *   2. a NULLABLE `organization_id` is added, because the residual sinks hold a
 *      TOKEN-ATTESTED organization even when they hold no company. A row that
 *      says "this organization was refused" is worth more than one that says
 *      "someone was refused somewhere". ★ It is not stamped by the caller: see
 *      the recorder's contract in `security-denial-audit.ts`.
 *   3. the partial CHECK below retains the NOT NULL guarantee for EVERY product
 *      writer and relaxes it ONLY inside the reserved `security.denied.` action
 *      namespace that `assertUnreservedActivityNamespace` already fences off.
 *      All ~34 direct `insert(activityLog)` product sites are still rejected by
 *      the database if they omit `companyId`.
 *
 * ★ THE CHECK IS THE INVARIANT THE RULING TURNS ON, and a LIKE over text is
 * strictly weaker than NOT NULL, so it carries its own provocation: a NON-denial
 * row with a null `company_id` must be REJECTED
 * (`e0-f013-unattributable-denial-sink.integration.test.ts`, arm 1), observed
 * red against the unchanged tree and mutated to prove the predicate is load
 * bearing.
 *
 * ★ N/N-1 COMPATIBILITY. `remote-compose-deploy.sh` rolls the binary back
 * WITHOUT reverting the database, so this must be expand-only: `DROP NOT NULL`
 * widens the set of rows the old binary can write (it never wrote a null, and
 * still cannot — the CHECK stops it outside the denial namespace) and the old
 * binary's SELECTs never name `organization_id`, so a nullable ADD COLUMN is
 * invisible to it.
 */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // NULLABLE since E0-F013 Decision 2 (a2). Null is admissible ONLY for rows
    // in the reserved `security.denied.` namespace — see `companyOrDenial` below.
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    // The second tenant axis. Null on ~100% of rows by design: no product writer
    // populates it, and it exists so an organization-only denial is attributable
    // to something rather than to nothing. `restrict` (not `cascade`) mirrors
    // `companies.organization_id`: denial evidence must not be deletable by
    // deleting the organization it incriminates.
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    actorType: text("actor_type").notNull().default("system"),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    runId: uuid("run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("activity_log_company_created_idx").on(table.companyId, table.createdAt),
    runIdIdx: index("activity_log_run_id_idx").on(table.runId),
    entityIdx: index("activity_log_entity_type_id_idx").on(table.entityType, table.entityId),
    organizationIdx: index("activity_log_organization_idx").on(table.organizationId),
    // ★ The retained NOT NULL. `action` is the only column that identifies the
    // denial namespace, and the prefix is the literal value of
    // `SECURITY_DENIAL_ACTION_PREFIX` (`server/src/services/activity-namespace.ts`);
    // `activity-reserved-namespace.test.ts` pins that constant so this predicate
    // and that guard cannot drift apart silently.
    companyOrDenial: check(
      "activity_log_company_or_denial_check",
      sql`company_id IS NOT NULL OR action LIKE 'security.denied.%'`,
    ),
  }),
);
