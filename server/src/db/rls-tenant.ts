import { assertSafeRoleName } from "./rls-bootstrap.js";
import {
  JOB_CONTROL_LEGACY_GRANTS,
  JOB_CONTROL_NEW_PATH_GRANTS,
  OPERATOR_METADATA_COLUMN_GRANTS,
  type TablePrivilege,
} from "./job-control-legacy-grants.js";

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

/** Bounded non-owner role for null-Organization platform worker/target metadata. */
export const OPERATOR_ROLE = "aoa_operator";

export const OPERATOR_METADATA_TABLES = Object.freeze([
  "workers",
  "execution_targets",
] as const);

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

/** Grant one traced operation set; identifiers and privileges are closed enums. */
export function grantTablePrivilegesSql(
  role: string,
  table: string,
  privileges: readonly TablePrivilege[],
): string {
  assertSafeRoleName(role);
  assertSafeTableName(table);
  if (privileges.length === 0) throw new Error(`No privileges supplied for ${table}`);
  return `GRANT ${privileges.join(", ")} ON "${table}" TO "${role}";`;
}

/** Grant one operation on an exact, reviewed set of columns. */
export function grantColumnPrivilegesSql(
  role: string,
  table: string,
  privilege: "SELECT",
  columns: readonly string[],
): string {
  assertSafeRoleName(role);
  assertSafeTableName(table);
  if (columns.length === 0) throw new Error(`No columns supplied for ${table}`);
  const list = columns.map((column) => `"${assertSafeTableName(column)}"`).join(", ");
  return `GRANT ${privilege} (${list}) ON "${table}" TO "${role}";`;
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
 * Preserve RLS for bounded non-owner roles while restoring PostgreSQL's normal
 * table-owner exemption for the default-off legacy path.
 */
export function enableRlsWithoutForceSql(table: string): string {
  assertSafeTableName(table);
  return (
    `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;\n` +
    `${STATEMENT_BREAKPOINT}\n` +
    `ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY;`
  );
}

function revokeInheritedRolesSql(role: string): string {
  assertSafeRoleName(role);
  return (
    "DO $$ DECLARE inherited_role record; BEGIN " +
    "FOR inherited_role IN " +
    "SELECT parent.rolname AS role_name FROM pg_auth_members membership " +
    "JOIN pg_roles member ON member.oid = membership.member " +
    "JOIN pg_roles parent ON parent.oid = membership.roleid " +
    `WHERE member.rolname = '${role}' LOOP ` +
    `EXECUTE format('REVOKE %I FROM %I', inherited_role.role_name, '${role}'); ` +
    "END LOOP; END $$;"
  );
}

function assertRoleOwnsNoApplicationObjectsSql(role: string): string {
  assertSafeRoleName(role);
  return (
    "DO $$ BEGIN IF EXISTS (" +
    "SELECT 1 FROM pg_roles role WHERE role.rolname = " +
    `'${role}' AND (` +
    "EXISTS (SELECT 1 FROM pg_database database WHERE database.datdba = role.oid AND database.datname = current_database()) OR " +
    "EXISTS (SELECT 1 FROM pg_namespace namespace WHERE namespace.nspowner = role.oid " +
    "AND namespace.nspname <> 'information_schema' AND namespace.nspname NOT LIKE 'pg_%') OR " +
    "EXISTS (SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace " +
    "WHERE relation.relowner = role.oid AND namespace.nspname <> 'information_schema' AND namespace.nspname NOT LIKE 'pg_%') OR " +
    "EXISTS (SELECT 1 FROM pg_proc function JOIN pg_namespace namespace ON namespace.oid = function.pronamespace " +
    "WHERE function.proowner = role.oid AND namespace.nspname <> 'information_schema' AND namespace.nspname NOT LIKE 'pg_%') OR " +
    "EXISTS (SELECT 1 FROM pg_type type JOIN pg_namespace namespace ON namespace.oid = type.typnamespace " +
    "WHERE type.typowner = role.oid AND namespace.nspname <> 'information_schema' AND namespace.nspname NOT LIKE 'pg_%'))) " +
    `THEN RAISE EXCEPTION 'Serving role ${role} owns an application object'; ` +
    "END IF; END $$;"
  );
}

/**
 * aoa_operator policy for the two platform metadata tables. The owner-user guard
 * on targets keeps user-owned metadata outside the platform seam as well as all
 * Organization-owned rows. There is no permissive fallback policy for this role.
 */
export function operatorMetadataPolicySql(
  table: (typeof OPERATOR_METADATA_TABLES)[number],
  role: string = OPERATOR_ROLE,
): string {
  assertSafeTableName(table);
  assertSafeRoleName(role);
  const policy = `${table}_platform_operator`;
  const predicate = table === "workers"
    ? "organization_id IS NULL AND scope = 'platform'"
    : "organization_id IS NULL AND owner_user_id IS NULL";
  return (
    `DROP POLICY IF EXISTS "${policy}" ON "${table}";\n` +
    `${STATEMENT_BREAKPOINT}\n` +
    `CREATE POLICY "${policy}" ON "${table}" TO "${role}"\n` +
    `  USING (${predicate})\n` +
    `  WITH CHECK (${predicate});`
  );
}

/**
 * execution_targets predates the E2 8-table kernel but is Organization-scoped
 * target metadata used by the traced resolver. Tenant serving may read its own
 * or platform targets; writes remain denied because aoa_app receives SELECT only.
 */
export function tenantExecutionTargetPolicySql(role: string = TENANT_APP_ROLE): string {
  assertSafeRoleName(role);
  const policy = "execution_targets_tenant_serving";
  const predicate =
    `organization_id IS NULL OR ` +
    `organization_id = current_setting('${TENANT_GUC}', true)::uuid`;
  return (
    `DROP POLICY IF EXISTS "${policy}" ON "execution_targets";\n` +
    `${STATEMENT_BREAKPOINT}\n` +
    `CREATE POLICY "${policy}" ON "execution_targets" FOR SELECT TO "${role}"\n` +
    `  USING (${predicate});`
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

/**
 * Corrective successor to 0211 (E3-F001/F002). This is a delta-free custom
 * migration under product Decision #122/C14: role/grant/policy DDL is outside
 * drizzle-kit's configured schema diff, and every statement is idempotent.
 */
export function buildServingRoleCorrectionMigrationSql(): string {
  const header = [
    "-- Corrective E2 serving/operator-role gate (successor to E2-D03; Decision #123).",
    "-- DELTA-FREE `--custom` migration under Decision #122/C14: the configured",
    "-- drizzle schema cannot emit cluster roles, operation-level grants, or policies.",
    "-- Every hand-authored statement is idempotent: guarded CREATE ROLE; attribute",
    "-- ALTER/GRANT/ENABLE/FORCE natural re-apply; DROP POLICY IF EXISTS before CREATE.",
    "-- aoa_app retains the 8 E2 grants and receives only traced JOB-010..014 legacy",
    "-- operations. aoa_operator receives only null-Organization platform metadata.",
    "-- Future enrollment/proof/revocation grants remain owned by JOB-002.",
    "-- Generated from server/src/db/rls-tenant.ts; keep this file byte-for-byte aligned.",
  ].join("\n");

  const statements: string[] = [
    createNonOwnerRoleSql(TENANT_APP_ROLE),
    `ALTER ROLE "${TENANT_APP_ROLE}" NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;`,
    createNonOwnerRoleSql(OPERATOR_ROLE),
    `ALTER ROLE "${OPERATOR_ROLE}" NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;`,
  ];

  for (const [table, privileges] of Object.entries(JOB_CONTROL_LEGACY_GRANTS)) {
    // Preserve byte identity for the already-applied 0213 artifact. Its successor
    // 0214 consumes the current trace below; applied migrations are immutable.
    if (
      table === "user_roles" ||
      table === "company_memberships" ||
      table === "notification_preferences" ||
      table === "notification_digest_items" ||
      table === "hub_counter_snapshots"
    ) continue;
    const correctionPrivileges = table === "notifications"
      ? (["SELECT", "UPDATE"] as const)
      : privileges;
    statements.push(grantTablePrivilegesSql(TENANT_APP_ROLE, table, correctionPrivileges));
  }
  statements.push(grantDmlSql(OPERATOR_ROLE, OPERATOR_METADATA_TABLES));
  statements.push(enableForceRlsSql("execution_targets"));
  statements.push(tenantExecutionTargetPolicySql());
  statements.push(operatorMetadataPolicySql("workers"));
  statements.push(operatorMetadataPolicySql("execution_targets"));

  const annotatedStatements = statements.map((statement) =>
    statement
      .split(`\n${STATEMENT_BREAKPOINT}\n`)
      .map(
        (part) =>
          "-- C14 hand-authored security DDL: drizzle-kit cannot emit this statement; " +
          "its guarded/natural/drop-before-create form is idempotent.\n" +
          part,
      )
      .join(`\n${STATEMENT_BREAKPOINT}\n`),
  );
  return `${header}\n${annotatedStatements.join(`\n${STATEMENT_BREAKPOINT}\n`)}`;
}

/**
 * Attempt-1 review hardening. Additive successor to applied migration 0213:
 * resets stale ACLs and memberships, fails closed on serving-role ownership,
 * restores exact traced authority, and preserves the flag-off table-owner path.
 */
export function buildServingRoleHardeningMigrationSql(): string {
  const header = [
    "-- Corrective E2 serving-role hardening after prerequisite review (Decision #123).",
    "-- DELTA-FREE `--custom` migration under Decision #122/C14: drizzle-kit cannot",
    "-- emit cluster-role attributes, membership reconciliation, ACL resets, or RLS",
    "-- policy transitions. The custom stub was generated by drizzle-kit, then this",
    "-- idempotent security DDL was appended from the authoritative builder below.",
    "-- Applied migration 0213 is intentionally unchanged. Re-application converges",
    "-- direct grants/memberships/attributes; ownership drift raises and stops closed.",
    "-- Generated from server/src/db/rls-tenant.ts; keep this file byte-for-byte aligned.",
  ].join("\n");

  const statements: string[] = [];
  for (const role of [TENANT_APP_ROLE, OPERATOR_ROLE]) {
    statements.push(assertRoleOwnsNoApplicationObjectsSql(role));
    statements.push(revokeInheritedRolesSql(role));
    statements.push(
      `ALTER ROLE "${role}" NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;`,
    );
    statements.push(`REVOKE ALL PRIVILEGES ON SCHEMA public FROM "${role}";`);
    statements.push(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "${role}";`);
    statements.push(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM "${role}";`);
    statements.push(`GRANT USAGE ON SCHEMA public TO "${role}";`);
  }

  for (const [table, privileges] of Object.entries(JOB_CONTROL_NEW_PATH_GRANTS)) {
    statements.push(grantTablePrivilegesSql(TENANT_APP_ROLE, table, privileges));
  }
  for (const [table, privileges] of Object.entries(JOB_CONTROL_LEGACY_GRANTS)) {
    statements.push(grantTablePrivilegesSql(TENANT_APP_ROLE, table, privileges));
  }
  for (const [table, columns] of Object.entries(OPERATOR_METADATA_COLUMN_GRANTS)) {
    statements.push(grantColumnPrivilegesSql(OPERATOR_ROLE, table, "SELECT", columns));
  }

  statements.push(enableRlsWithoutForceSql("execution_targets"));
  statements.push(tenantExecutionTargetPolicySql());
  statements.push(operatorMetadataPolicySql("workers"));
  statements.push(operatorMetadataPolicySql("execution_targets"));

  const annotatedStatements = statements.map((statement) =>
    statement
      .split(`\n${STATEMENT_BREAKPOINT}\n`)
      .map(
        (part) =>
          "-- C14 hand-authored security DDL: drizzle-kit cannot emit this statement; " +
          "its convergent assertion/revoke/grant/drop-before-create form is idempotent.\n" +
          part,
      )
      .join(`\n${STATEMENT_BREAKPOINT}\n`),
  );
  return `${header}\n${annotatedStatements.join(`\n${STATEMENT_BREAKPOINT}\n`)}`;
}
