import { assertSafeRoleName } from "./rls-bootstrap.js";

/**
 * TEN-002 (E2-D01 / product Decision #122): pure, role-name-safe SQL builders that
 * AUTHOR the tenant RLS enforcement DDL for the 8 new-path distributed-execution
 * tables. These builders are the single source of truth for the delta-free
 * `--custom` migration `0211_tenant_rls_enforcement.sql` and are unit-tested on
 * every platform (server/src/__tests__/tenant-rls-enforcement-unit.test.ts).
 *
 * Security model (E2-D01 / finding E2-F004): the DB-enforcement guarantee is that
 * the serving pool authenticates as `aoa_app` — a NON-OWNER, NOSUPERUSER,
 * NOBYPASSRLS role — which plain RLS filters. `FORCE ROW LEVEL SECURITY` only
 * removes a NON-SUPERUSER table OWNER's exemption (superusers / BYPASSRLS always
 * bypass RLS regardless of FORCE), so FORCE is defense-in-depth against a
 * non-superuser-owner serving mistake, proved behaviorally by a dedicated
 * non-superuser owner test plus `pg_class.relforcerowsecurity`.
 *
 * Role names cannot be bound as query parameters, so every builder validates the
 * role/table identifier (`assertSafeRoleName` / the local table-name predicate)
 * before interpolation — mirroring `rls-bootstrap.ts` / `client.ts`.
 */

/** The non-owner (NOSUPERUSER, NOBYPASSRLS) serving role for the new-path tables. */
export const TENANT_APP_ROLE = "aoa_app";

/** The transaction-local tenant GUC the policies read (E2-D02; the shipped `with-tenant-tx.ts` writer). */
export const TENANT_GUC = "aoa.organization_id";

/**
 * The 8 new-path tenant tables that get forced RLS + a tenant-isolation policy
 * (E2-D06). Frozen so a caller cannot silently widen the enforced surface. Legacy
 * `companyId` tables are intentionally EXCLUDED (CAV-005 — they keep their
 * `assertCompanyAccess` app-layer boundary; no legacy RLS retrofit).
 */
export const TENANT_RLS_TABLES = Object.freeze([
  "jobs",
  "job_attempts",
  "leases",
  "workers",
  "services",
  "service_instances",
  "job_artifacts",
  "job_secret_handles",
] as const);

/** drizzle-kit / `applyPendingMigrations` statement separator. */
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** Same identifier grammar as `client.ts` `isSafeIdentifier` — tables cannot be bound as params. */
function assertSafeTableName(table: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new Error(`Unsafe table name: ${table}`);
  }
  return table;
}

/**
 * Idempotent CREATE ROLE for the non-owner serving role. NOLOGIN with NO committed
 * credential (E2-D01) — the LOGIN password is provisioned at boot/runtime from env
 * via `provisionTenantAppRoleLoginSql`. NOSUPERUSER + NOBYPASSRLS are the load-
 * bearing attributes: they are what plain RLS relies on to filter the role.
 */
export function createNonOwnerRoleSql(role: string): string {
  assertSafeRoleName(role);
  return (
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN ` +
    `CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; ` +
    `END IF; END $$;`
  );
}

/** GRANT only DML (no DDL/ownership) on the given tables to the role. Naturally idempotent. */
export function grantDmlSql(role: string, tables: readonly string[]): string {
  assertSafeRoleName(role);
  const list = tables.map((t) => `"${assertSafeTableName(t)}"`).join(",");
  return `GRANT SELECT, INSERT, UPDATE, DELETE ON ${list} TO "${role}";`;
}

/**
 * ENABLE then FORCE ROW LEVEL SECURITY for a table (two statements, breakpoint-
 * separated). Both ALTERs are natural no-ops on re-apply, so this is idempotent.
 */
export function enableForceRlsSql(table: string): string {
  assertSafeTableName(table);
  return (
    `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;\n` +
    `${STATEMENT_BREAKPOINT}\n` +
    `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`
  );
}

/**
 * The tenant-isolation policy for a table, scoped TO the non-owner role. `USING`
 * gates reads/updates/deletes; `WITH CHECK` gates inserts/updated-rows — both on
 * `organization_id = current_setting('aoa.organization_id', true)::uuid` (E2-D02).
 * A tenant GUC never matches `organization_id IS NULL` (NULL = <org> -> NULL ->
 * excluded), so platform null-Org rows are fail-closed to every tenant (E2-D04).
 * DROP POLICY IF EXISTS before CREATE makes it idempotent (CREATE POLICY has no
 * IF NOT EXISTS form).
 */
export function tenantPolicySql(table: string, role: string): string {
  assertSafeTableName(table);
  assertSafeRoleName(role);
  const policy = `${table}_tenant_isolation`;
  const predicate = `organization_id = current_setting('${TENANT_GUC}', true)::uuid`;
  return (
    `DROP POLICY IF EXISTS "${policy}" ON "${table}";\n` +
    `${STATEMENT_BREAKPOINT}\n` +
    `CREATE POLICY "${policy}" ON "${table}" TO "${role}"\n` +
    `  USING (${predicate})\n` +
    `  WITH CHECK (${predicate});`
  );
}

/**
 * Runtime/test-only: idempotently set the non-owner role's LOGIN credential.
 *
 * Postgres does NOT allow binding a parameter to `ALTER ROLE ... PASSWORD` (it is
 * utility DDL, not a Bind-able query), so the secret is escaped exactly like
 * `rls-bootstrap.ts` (`.replace(/'/g, "''")`) rather than parameter-bound. This SQL
 * is built at BOOT/TEST time from an env secret and is NEVER written into a
 * committed file: the migration (`createNonOwnerRoleSql`) creates the role NOLOGIN
 * with no password; this login provisioning happens in the privileged boot phase
 * (E2-D03, `server/src/index.ts`). Re-applying is a harmless no-op.
 */
export function provisionTenantAppRoleLoginSql(role: string, password: string): string {
  assertSafeRoleName(role);
  const escaped = password.replace(/'/g, "''");
  return `ALTER ROLE "${role}" WITH LOGIN PASSWORD '${escaped}';`;
}

/**
 * Assemble the full body of the delta-free `0211_tenant_rls_enforcement.sql`
 * migration: a C14 header comment, then CREATE ROLE, GRANT, and per-table
 * ENABLE+FORCE+DROP POLICY+CREATE POLICY — every statement idempotent and
 * `--> statement-breakpoint` separated. Exported so the unit test asserts the
 * assembled shape; the committed migration file mirrors this output.
 */
export function buildTenantRlsMigrationSql(
  role: string = TENANT_APP_ROLE,
  tables: readonly string[] = TENANT_RLS_TABLES,
): string {
  const header = [
    "-- TEN-002 (E2-D01 / product Decision #122): tenant RLS enforcement for the 8",
    "-- new-path distributed-execution tables. DELTA-FREE `--custom` migration: CREATE",
    "-- ROLE / GRANT / ENABLE + FORCE ROW LEVEL SECURITY / CREATE POLICY are",
    "-- cluster/security DDL that `drizzle-kit generate` CANNOT emit under this repo's",
    "-- config (no entities.roles, no pgPolicy in schema; verified against",
    "-- drizzle-orm@0.45.2 / drizzle-kit@0.31.10), so the entire block is C14",
    "-- hand-authored into the empty custom stub (there is no schema delta to diff onto).",
    "-- Every statement is idempotent (DO $$ IF NOT EXISTS role guard; GRANT/ENABLE/FORCE",
    "-- are natural no-ops on re-apply; DROP POLICY IF EXISTS before CREATE POLICY) so a",
    "-- re-apply under the migration advisory lock is a no-op. The role is created NOLOGIN",
    "-- with NO committed credential; the login credential is provisioned at boot from env",
    "-- (E2-D03, server/src/index.ts). FORCE (E2-F004) is defense-in-depth against a",
    "-- non-superuser-owner mistake; the DB-enforcement guarantee is that aoa_app is",
    "-- non-owner + NOSUPERUSER + NOBYPASSRLS. Authored by the pure builders in",
    "-- server/src/db/rls-tenant.ts (buildTenantRlsMigrationSql) - keep them in sync.",
  ].join("\n");

  const statements: string[] = [createNonOwnerRoleSql(role), grantDmlSql(role, tables)];
  for (const table of tables) {
    statements.push(enableForceRlsSql(table));
    statements.push(tenantPolicySql(table, role));
  }
  return `${header}\n${statements.join(`\n${STATEMENT_BREAKPOINT}\n`)}`;
}
