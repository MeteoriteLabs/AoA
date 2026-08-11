import { createHash, randomBytes } from "node:crypto";
import {
  assertNonOwnerConnection,
  createOperatorDbConnection,
  createTenantAppDbConnection,
  type Db,
  type NonOwnerDbConnection,
  type RequiredMigrationIdentity,
} from "@armyofagents/db";
import { sql } from "drizzle-orm";
import { logger } from "../middleware/logger.js";
import {
  APP_EXECUTION_TARGET_COLUMN_GRANTS,
  APP_ENROLLMENT_TARGET_SELECT_COLUMNS,
  APP_ENROLLMENT_TARGET_UPDATE_COLUMNS,
  APP_JOB_PLACEMENT_TARGET_SELECT_COLUMNS,
  APP_JOB_PLACEMENT_TARGET_UPDATE_COLUMNS,
  APP_MCP_API_KEY_COLUMN_GRANTS,
  JOB_CONTROL_LEGACY_GRANTS,
  JOB_CONTROL_NEW_PATH_GRANTS,
  JOB_LEASING_NEW_PATH_GRANTS,
  JOB_SUBMISSION_LEGACY_GRANTS,
  JOB_SUBMISSION_NEW_PATH_GRANTS,
  OPERATOR_METADATA_COLUMN_GRANTS,
  OPERATOR_ENROLLMENT_TARGET_SELECT_COLUMNS,
  OPERATOR_ENROLLMENT_TARGET_UPDATE_COLUMNS,
  OPERATOR_JOB_PLACEMENT_TARGET_SELECT_COLUMNS,
  OPERATOR_JOB_PLACEMENT_TARGET_UPDATE_COLUMNS,
  APP_SERVING_RELATIONS,
  COLUMN_ACL_MANIFEST,
  FORCE_RLS_RELATIONS,
  NON_FORCE_RLS_RELATIONS,
  POLICY_COUNTS,
  RELATION_ACL_MANIFEST,
  RLS_POLICY_MANIFEST,
  RLS_RELATIONS,
  WORKER_ENROLLMENT_APP_GRANTS,
  WORKER_ENROLLMENT_OPERATOR_GRANTS,
  type TablePrivilege,
} from "./job-control-legacy-grants.js";

export interface DistributedExecutionDatabases {
  appDb: Db;
  operatorDb: Db;
  close(): Promise<void>;
}

type ServingRole = "aoa_app" | "aoa_operator";
type SqlExecutor = Pick<Db, "execute">;

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

function appTablePrivileges(): Readonly<Record<string, readonly TablePrivilege[]>> {
  return {
    ...JOB_CONTROL_NEW_PATH_GRANTS,
    ...JOB_CONTROL_LEGACY_GRANTS,
    ...JOB_SUBMISSION_NEW_PATH_GRANTS,
    ...JOB_SUBMISSION_LEGACY_GRANTS,
    ...WORKER_ENROLLMENT_APP_GRANTS,
    ...JOB_LEASING_NEW_PATH_GRANTS,
  };
}

function operatorTablePrivileges(): Readonly<Record<string, readonly TablePrivilege[]>> {
  return WORKER_ENROLLMENT_OPERATOR_GRANTS;
}

/** Fail closed unless effective ACLs are exact across every non-system table-like object. */
async function assertExactServingRoleAuthority(db: Db, role: ServingRole): Promise<void> {
  const schemaRows = rowsOf<{ schema_name: string; usage: boolean; create: boolean }>(await db.execute(sql`
    SELECT
      namespace.nspname AS schema_name,
      has_schema_privilege(current_user, namespace.oid, 'USAGE') AS usage,
      has_schema_privilege(current_user, namespace.oid, 'CREATE') AS create
    FROM pg_namespace namespace
    WHERE namespace.nspname <> 'information_schema'
      AND namespace.nspname NOT LIKE 'pg_%'
    ORDER BY namespace.nspname
  `));
  for (const schemaPosture of schemaRows) {
    const expectedUsage = schemaPosture.schema_name === "public";
    if (schemaPosture.usage !== expectedUsage || schemaPosture.create) {
      throw new Error(
        `${role} effective schema authority is not exact for ${schemaPosture.schema_name} ` +
          `(USAGE=${schemaPosture.usage} expected ${expectedUsage}, CREATE=${schemaPosture.create})`,
      );
    }
  }

  const tableRows = rowsOf<{
    schema_name: string;
    table_name: string;
    select_allowed: boolean;
    insert_allowed: boolean;
    update_allowed: boolean;
    delete_allowed: boolean;
    truncate_allowed: boolean;
    references_allowed: boolean;
    trigger_allowed: boolean;
  }>(await db.execute(sql`
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      has_table_privilege(current_user, relation.oid, 'SELECT') AS select_allowed,
      has_table_privilege(current_user, relation.oid, 'INSERT') AS insert_allowed,
      has_table_privilege(current_user, relation.oid, 'UPDATE') AS update_allowed,
      has_table_privilege(current_user, relation.oid, 'DELETE') AS delete_allowed,
      has_table_privilege(current_user, relation.oid, 'TRUNCATE') AS truncate_allowed,
      has_table_privilege(current_user, relation.oid, 'REFERENCES') AS references_allowed,
      has_table_privilege(current_user, relation.oid, 'TRIGGER') AS trigger_allowed
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname <> 'information_schema'
      AND namespace.nspname NOT LIKE 'pg_%'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
    ORDER BY relation.relname
  `));
  const expectedTables = role === "aoa_app" ? appTablePrivileges() : operatorTablePrivileges();
  const tableOperations = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;
  for (const row of tableRows) {
    const expected = new Set(
      row.schema_name === "public" ? expectedTables[row.table_name] ?? [] : [],
    );
    const actualByOperation: Record<TablePrivilege, boolean> = {
      SELECT: row.select_allowed,
      INSERT: row.insert_allowed,
      UPDATE: row.update_allowed,
      DELETE: row.delete_allowed,
    };
    for (const operation of tableOperations) {
      const actual = actualByOperation[operation];
      if (actual !== expected.has(operation)) {
        throw new Error(
          `${role} effective table authority drift: ${row.schema_name}.${row.table_name} ${operation}=` +
            `${actual} expected ${expected.has(operation)}`,
        );
      }
    }
    for (const [operation, allowed] of [
      ["TRUNCATE", row.truncate_allowed],
      ["REFERENCES", row.references_allowed],
      ["TRIGGER", row.trigger_allowed],
    ] as const) {
      if (allowed) {
        throw new Error(
          `${role} effective table authority drift: ${row.schema_name}.${row.table_name} ${operation}=true`,
        );
      }
    }
  }

  const columnRows = rowsOf<{
    schema_name: string;
    table_name: string;
    column_name: string;
    select_allowed: boolean;
    insert_allowed: boolean;
    update_allowed: boolean;
    references_allowed: boolean;
  }>(await db.execute(sql`
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      attribute.attname AS column_name,
      has_column_privilege(current_user, relation.oid, attribute.attnum, 'SELECT') AS select_allowed,
      has_column_privilege(current_user, relation.oid, attribute.attnum, 'INSERT') AS insert_allowed,
      has_column_privilege(current_user, relation.oid, attribute.attnum, 'UPDATE') AS update_allowed,
      has_column_privilege(current_user, relation.oid, attribute.attnum, 'REFERENCES') AS references_allowed
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
    WHERE namespace.nspname <> 'information_schema'
      AND namespace.nspname NOT LIKE 'pg_%'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
    ORDER BY relation.relname, attribute.attnum
  `));
  for (const row of columnRows) {
    const appExpected = new Set(
      row.schema_name === "public" ? expectedTables[row.table_name] ?? [] : [],
    );
    const operatorColumns = new Set([
      ...((OPERATOR_METADATA_COLUMN_GRANTS as Readonly<Record<string, readonly string[]>>)[row.table_name] ?? []),
      ...(row.table_name === "execution_targets" ? OPERATOR_ENROLLMENT_TARGET_SELECT_COLUMNS : []),
      ...(row.table_name === "execution_targets" ? OPERATOR_JOB_PLACEMENT_TARGET_SELECT_COLUMNS : []),
    ]);
    const appColumnSelect = row.schema_name === "public" && (
      (row.table_name === "execution_targets" && (
        APP_EXECUTION_TARGET_COLUMN_GRANTS.includes(
          row.column_name as (typeof APP_EXECUTION_TARGET_COLUMN_GRANTS)[number]
        ) || APP_ENROLLMENT_TARGET_SELECT_COLUMNS.includes(
          row.column_name as (typeof APP_ENROLLMENT_TARGET_SELECT_COLUMNS)[number]
        ) || APP_JOB_PLACEMENT_TARGET_SELECT_COLUMNS.includes(
          row.column_name as (typeof APP_JOB_PLACEMENT_TARGET_SELECT_COLUMNS)[number]
        )
      )) ||
      (row.table_name === "mcp_api_keys" &&
        APP_MCP_API_KEY_COLUMN_GRANTS.includes(
          row.column_name as (typeof APP_MCP_API_KEY_COLUMN_GRANTS)[number],
        ))
    );
    const expectedSelect = role === "aoa_app"
      ? appExpected.has("SELECT") || appColumnSelect
      : row.schema_name === "public" && (appExpected.has("SELECT") || operatorColumns.has(row.column_name));
    const expectedInsert = appExpected.has("INSERT");
    const expectedUpdate = appExpected.has("UPDATE") || (
      row.schema_name === "public" && row.table_name === "execution_targets" && (
        role === "aoa_app"
          ? APP_ENROLLMENT_TARGET_UPDATE_COLUMNS.includes(
              row.column_name as (typeof APP_ENROLLMENT_TARGET_UPDATE_COLUMNS)[number]
            ) || APP_JOB_PLACEMENT_TARGET_UPDATE_COLUMNS.includes(
              row.column_name as (typeof APP_JOB_PLACEMENT_TARGET_UPDATE_COLUMNS)[number]
            )
          : OPERATOR_ENROLLMENT_TARGET_UPDATE_COLUMNS.includes(
              row.column_name as (typeof OPERATOR_ENROLLMENT_TARGET_UPDATE_COLUMNS)[number]
            ) || OPERATOR_JOB_PLACEMENT_TARGET_UPDATE_COLUMNS.includes(
              row.column_name as (typeof OPERATOR_JOB_PLACEMENT_TARGET_UPDATE_COLUMNS)[number]
            )
      )
    );
    for (const [operation, actual, expected] of [
      ["SELECT", row.select_allowed, expectedSelect],
      ["INSERT", row.insert_allowed, expectedInsert],
      ["UPDATE", row.update_allowed, expectedUpdate],
      ["REFERENCES", row.references_allowed, false],
    ] as const) {
      if (actual !== expected) {
        throw new Error(
          `${role} effective column authority drift: ${row.schema_name}.${row.table_name}.${row.column_name} ` +
            `${operation}=${actual} expected ${expected}`,
        );
      }
    }
  }

  const sequenceRows = rowsOf<{
    schema_name: string;
    sequence_name: string;
    usage_allowed: boolean;
    select_allowed: boolean;
    update_allowed: boolean;
  }>(await db.execute(sql`
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS sequence_name,
      has_sequence_privilege(current_user, relation.oid, 'USAGE') AS usage_allowed,
      has_sequence_privilege(current_user, relation.oid, 'SELECT') AS select_allowed,
      has_sequence_privilege(current_user, relation.oid, 'UPDATE') AS update_allowed
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname <> 'information_schema'
      AND namespace.nspname NOT LIKE 'pg_%'
      AND relation.relkind = 'S'
    ORDER BY relation.relname
  `));
  const sequenceDrift = sequenceRows.find(
    (row) => row.usage_allowed || row.select_allowed || row.update_allowed,
  );
  if (sequenceDrift) {
    throw new Error(
      `${role} effective sequence authority drift: ` +
        `${sequenceDrift.schema_name}.${sequenceDrift.sequence_name}`,
    );
  }
}

type ActualAclTuple = {
  grantor: string;
  grantee: string;
  privilegeType: string;
  isGrantable: boolean;
};

function sortedStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function aclTupleKey(tuple: ActualAclTuple): string {
  return [tuple.grantor, tuple.grantee, tuple.privilegeType, String(tuple.isGrantable)].join(":");
}

function exactJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertExactJson(actual: unknown, expected: unknown, certificate: string): void {
  if (!exactJson(actual, expected)) throw new Error(`catalog certificate drift: ${certificate}`);
}

const SERVING_RELATIONS = Object.freeze(Object.keys(RELATION_ACL_MANIFEST).sort());
const SERVING_RELATION_SQL = sql.join(SERVING_RELATIONS.map((relation) => sql`${relation}`), sql`, `);

/**
 * Assert physical relation shape plus owner-authored RLS, policy, relacl and attacl posture.
 * These are raw catalog checks, deliberately separate from the effective-privilege scan.
 */
async function assertExactCatalogCertificate(db: Db): Promise<void> {
  const relationRows = rowsOf<{
    relation: string;
    relkind: string;
    rls: boolean;
    force_rls: boolean;
  }>(await db.execute(sql`
    SELECT relation.relname AS relation, relation.relkind,
      relation.relrowsecurity AS rls, relation.relforcerowsecurity AS force_rls
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (${SERVING_RELATION_SQL})
    ORDER BY relation.relname
  `));
  assertExactJson(
    relationRows.map((row) => row.relation),
    SERVING_RELATIONS,
    "relation inventory",
  );
  if (relationRows.some((row) => row.relkind !== "r")) {
    throw new Error("catalog certificate drift: relation kind");
  }

  const rlsRows = rowsOf<{
    relation: string;
    force_rls: boolean;
  }>(await db.execute(sql`
    SELECT relation.relname AS relation, relation.relforcerowsecurity AS force_rls
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relrowsecurity
    ORDER BY relation.relname
  `));
  assertExactJson(
    rlsRows.map((row) => row.relation),
    sortedStrings(RLS_RELATIONS),
    "RLS inventory",
  );
  assertExactJson(
    rlsRows.filter((row) => row.force_rls).map((row) => row.relation),
    sortedStrings(FORCE_RLS_RELATIONS),
    "FORCE RLS inventory",
  );
  assertExactJson(
    rlsRows.filter((row) => !row.force_rls).map((row) => row.relation),
    sortedStrings(NON_FORCE_RLS_RELATIONS),
    "non-FORCE RLS inventory",
  );

  const policyRows = rowsOf<{
    relation: string;
    name: string;
    command: "ALL" | "SELECT" | "UPDATE" | "INSERT" | "DELETE";
    role: string;
    permissive: boolean;
    role_count: number;
    qual: string | null;
    check: string | null;
  }>(await db.execute(sql`
    SELECT relation.relname AS relation, policy.polname AS name,
      CASE policy.polcmd
        WHEN '*' THEN 'ALL'
        WHEN 'r' THEN 'SELECT'
        WHEN 'a' THEN 'INSERT'
        WHEN 'w' THEN 'UPDATE'
        WHEN 'd' THEN 'DELETE'
      END AS command,
      CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC' ELSE role.rolname END AS role,
      policy.polpermissive AS permissive,
      cardinality(policy.polroles)::int AS role_count,
      pg_get_expr(policy.polqual, policy.polrelid) AS qual,
      pg_get_expr(policy.polwithcheck, policy.polrelid) AS check
    FROM pg_policy policy
    JOIN pg_class relation ON relation.oid = policy.polrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL unnest(policy.polroles) AS policy_role(role_oid)
    LEFT JOIN pg_roles role ON role.oid = policy_role.role_oid
    WHERE namespace.nspname = 'public'
    ORDER BY relation.relname, policy.polname, role
  `));
  if (policyRows.some((row) => row.role_count !== 1 || !row.role)) {
    throw new Error("catalog certificate drift: policy role cardinality");
  }
  const actualPolicies = policyRows.map(({ role_count: _roleCount, ...row }) => row)
    .sort((left, right) => `${left.relation}:${left.name}:${left.role}`
      .localeCompare(`${right.relation}:${right.name}:${right.role}`));
  const expectedPolicies = [...RLS_POLICY_MANIFEST]
    .sort((left, right) => `${left.relation}:${left.name}:${left.role}`
      .localeCompare(`${right.relation}:${right.name}:${right.role}`));
  assertExactJson(actualPolicies, expectedPolicies, "policy rows");
  const actualPolicyCounts = Object.fromEntries(RLS_RELATIONS.map((relation) => [
    relation,
    actualPolicies.filter((policy) => policy.relation === relation).length,
  ]));
  assertExactJson(actualPolicyCounts, POLICY_COUNTS, "policy counts");

  const relationAclRows = rowsOf<{
    relation: string;
    acl_is_null: boolean;
    grantor: string | null;
    grantee: string | null;
    privilege_type: string | null;
    is_grantable: boolean | null;
  }>(await db.execute(sql`
    SELECT relation.relname AS relation, relation.relacl IS NULL AS acl_is_null,
      CASE
        WHEN acl.grantor = relation.relowner THEN 'RELATION_OWNER'
        ELSE COALESCE(grantor.rolname, acl.grantor::text)
      END AS grantor,
      CASE
        WHEN acl.grantee = 0 THEN 'PUBLIC'
        WHEN acl.grantee = relation.relowner THEN 'RELATION_OWNER'
        ELSE COALESCE(grantee.rolname, acl.grantee::text)
      END AS grantee,
      acl.privilege_type, acl.is_grantable
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    LEFT JOIN LATERAL aclexplode(relation.relacl) acl ON TRUE
    LEFT JOIN pg_roles grantor ON grantor.oid = acl.grantor
    LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (${SERVING_RELATION_SQL})
    ORDER BY relation.relname, grantor, grantee, acl.privilege_type, acl.is_grantable
  `));
  const actualRelationAcl: Record<string, { aclIsNull: boolean; tuples: ActualAclTuple[] }> = {};
  for (const row of relationAclRows) {
    const entry = actualRelationAcl[row.relation] ??= { aclIsNull: row.acl_is_null, tuples: [] };
    if (row.grantor !== null && row.grantee !== null && row.privilege_type !== null &&
      row.is_grantable !== null) {
      entry.tuples.push({
        grantor: row.grantor,
        grantee: row.grantee,
        privilegeType: row.privilege_type,
        isGrantable: row.is_grantable,
      });
    }
  }
  for (const entry of Object.values(actualRelationAcl)) {
    entry.tuples.sort((left, right) => aclTupleKey(left).localeCompare(aclTupleKey(right)));
  }
  assertExactJson(actualRelationAcl, RELATION_ACL_MANIFEST, "relation ACL");

  const columnAclRows = rowsOf<{
    relation: string;
    column_name: string;
    acl_is_null: boolean;
    grantor: string | null;
    grantee: string | null;
    privilege_type: string | null;
    is_grantable: boolean | null;
  }>(await db.execute(sql`
    SELECT relation.relname AS relation, attribute.attname AS column_name,
      attribute.attacl IS NULL AS acl_is_null,
      CASE
        WHEN acl.grantor = relation.relowner THEN 'RELATION_OWNER'
        ELSE COALESCE(grantor.rolname, acl.grantor::text)
      END AS grantor,
      CASE
        WHEN acl.grantee = 0 THEN 'PUBLIC'
        WHEN acl.grantee = relation.relowner THEN 'RELATION_OWNER'
        ELSE COALESCE(grantee.rolname, acl.grantee::text)
      END AS grantee,
      acl.privilege_type, acl.is_grantable
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
    LEFT JOIN LATERAL aclexplode(attribute.attacl) acl ON TRUE
    LEFT JOIN pg_roles grantor ON grantor.oid = acl.grantor
    LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (${SERVING_RELATION_SQL})
    ORDER BY relation.relname, attribute.attnum, grantor, grantee,
      acl.privilege_type, acl.is_grantable
  `));
  const actualColumnAcl: Record<
    string,
    Record<string, { aclIsNull: boolean; tuples: ActualAclTuple[] }>
  > = Object.fromEntries(SERVING_RELATIONS.map((relation) => [relation, {}]));
  for (const row of columnAclRows) {
    const columns = actualColumnAcl[row.relation];
    if (!columns) throw new Error("catalog certificate drift: unexpected ACL relation");
    const entry = columns[row.column_name] ??= { aclIsNull: row.acl_is_null, tuples: [] };
    if (row.grantor !== null && row.grantee !== null && row.privilege_type !== null &&
      row.is_grantable !== null) {
      entry.tuples.push({
        grantor: row.grantor,
        grantee: row.grantee,
        privilegeType: row.privilege_type,
        isGrantable: row.is_grantable,
      });
    }
  }
  for (const columns of Object.values(actualColumnAcl)) {
    for (const entry of Object.values(columns)) {
      entry.tuples.sort((left, right) => aclTupleKey(left).localeCompare(aclTupleKey(right)));
    }
  }
  const orderedActualColumnAcl = Object.fromEntries(SERVING_RELATIONS.map((relation) => [
    relation,
    Object.fromEntries(Object.entries(actualColumnAcl[relation] ?? {})
      .sort(([left], [right]) => left.localeCompare(right))),
  ]));
  assertExactJson(orderedActualColumnAcl, COLUMN_ACL_MANIFEST, "column ACL");
}

async function assertRequiredMigrationIdentity(
  ownerDb: Db,
  required: RequiredMigrationIdentity,
): Promise<void> {
  const suppliedHashes = [...required.orderedHashes];
  if (suppliedHashes.length === 0 || new Set(suppliedHashes).size !== suppliedHashes.length ||
    suppliedHashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash))) {
    throw new Error("invalid required migration identity");
  }
  const suppliedLedger = createHash("sha256")
    .update(JSON.stringify(suppliedHashes))
    .digest("hex");
  if (required.ledgerSha256 !== suppliedLedger) {
    throw new Error("invalid required migration ledger digest");
  }
  const databaseRows = rowsOf<{ id: number; hash: string }>(await ownerDb.execute(sql`
    SELECT id, hash
    FROM drizzle.__drizzle_migrations
    WHERE hash IS NOT NULL
  `));
  const databaseHashes = databaseRows.map((row) => row.hash);
  if (new Set(databaseHashes).size !== databaseHashes.length ||
    databaseHashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash)) ||
    !exactJson(sortedStrings(databaseHashes), sortedStrings(suppliedHashes))) {
    throw new Error("database migration identity does not match checked-in migrations");
  }
}

export async function closeBoundedDatabaseConnections(
  connections: readonly Pick<NonOwnerDbConnection, "close">[],
): Promise<void> {
  const results = await Promise.allSettled(
    connections.map((connection) => connection.close({ timeoutSeconds: 5 })),
  );
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, "Failed to close bounded distributed database pools");
  }
}

const STARTUP_HANDSHAKE_TIMEOUT_MS = 5_000;
const STARTUP_CLOSE_TIMEOUT_MS = 5_000;
const statement_timeout = 5_000;
const lock_timeout = 750;
const idle_in_transaction_session_timeout = 5_000;
const STARTUP_POOL_OPTIONS = Object.freeze({
  max: 4,
  connectTimeoutMs: 5_000,
  statementTimeoutMs: statement_timeout,
  lockTimeoutMs: lock_timeout,
  idleInTransactionSessionTimeoutMs: idle_in_transaction_session_timeout,
  idleTimeoutMs: 30_000,
});

type StartupErrorCode =
  | "distributed_execution_configuration"
  | "distributed_execution_migration_identity"
  | "distributed_execution_app_authority"
  | "distributed_execution_operator_authority"
  | "distributed_execution_advisory_domain"
  | "distributed_execution_timeout"
  | "distributed_execution_close";

class DistributedExecutionStartupError extends Error {
  constructor(code: StartupErrorCode, role?: ServingRole) {
    super(code);
    if (role) this.name = role;
  }
}

class RejectableBarrier {
  private readonly promise: Promise<void>;
  private resolvePromise!: () => void;
  private rejectPromise!: (error: Error) => void;
  private settled = false;

  constructor() {
    this.promise = new Promise<void>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
    void this.promise.catch(() => {});
  }

  wait(): Promise<void> {
    return this.promise;
  }

  resolve(): void {
    if (this.settled) return;
    this.settled = true;
    this.resolvePromise();
  }

  reject(): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectPromise(new Error("startup barrier cancelled"));
  }
}

class TwoRoleBarrier {
  private readonly gate = new RejectableBarrier();
  private readonly arrived = new Set<ServingRole>();

  async wait(role: ServingRole): Promise<void> {
    this.arrived.add(role);
    if (this.arrived.size === 2) this.gate.resolve();
    await this.gate.wait();
  }

  reject(): void {
    this.gate.reject();
  }
}

class RolePairSequence {
  private readonly gates: RejectableBarrier[];
  private readonly arrived: Array<Set<ServingRole>>;

  constructor(size: number) {
    this.gates = Array.from({ length: size }, () => new RejectableBarrier());
    this.arrived = Array.from({ length: size }, () => new Set<ServingRole>());
    this.gates[0]?.resolve();
  }

  wait(index: number): Promise<void> {
    const gate = this.gates[index];
    if (!gate) return Promise.reject(new Error("invalid advisory pair index"));
    return gate.wait();
  }

  complete(index: number, role: ServingRole): void {
    const arrived = this.arrived[index];
    if (!arrived) throw new Error("invalid advisory pair index");
    arrived.add(role);
    if (arrived.size === 2) this.gates[index + 1]?.resolve();
  }

  reject(): void {
    for (const gate of this.gates) gate.reject();
  }
}

function firstRowBoolean(result: unknown): boolean | undefined {
  for (const row of rowsOf<Record<string, unknown>>(result)) {
    for (const value of Object.values(row)) if (typeof value === "boolean") return value;
  }
  return undefined;
}

function firstRowPid(result: unknown): number | undefined {
  for (const row of rowsOf<Record<string, unknown>>(result)) {
    for (const value of Object.values(row)) if (Number.isSafeInteger(value)) return value as number;
  }
  return undefined;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function isTimeoutOrDisconnect(error: unknown): boolean {
  const code = errorCode(error);
  return code === "57014" || code === "55P03" || code === "25P03" ||
    code === "57P01" || code === "57P02" || code === "57P03" ||
    code?.startsWith("08") === true || code === "CONNECTION_DESTROYED" ||
    code === "CONNECTION_CLOSED";
}

async function setStartupTransactionTimeouts(db: SqlExecutor): Promise<void> {
  await db.execute(sql`
    SELECT set_config('statement_timeout', ${`${statement_timeout}ms`}, true),
      set_config('lock_timeout', ${`${lock_timeout}ms`}, true),
      set_config(
        'idle_in_transaction_session_timeout',
        ${`${idle_in_transaction_session_timeout}ms`},
        true
      )
  `);
}

async function cancelTrackedParticipantQueries(
  ownerDb: SqlExecutor,
  participantPids: ReadonlyMap<number, ServingRole>,
): Promise<void> {
  const participants = [...participantPids.entries()];
  if (participants.length === 0) return;
  const exactParticipants = sql.join(
    participants.map(([pid, role]) => sql`(activity.pid = ${pid} AND activity.usename = ${role})`),
    sql` OR `,
  );
  await ownerDb.execute(sql`
    SELECT pg_cancel_backend(activity.pid)
    FROM pg_stat_activity activity
    WHERE activity.datname = current_database()
      AND activity.state = 'active'
      AND (${exactParticipants})
  `);
}

async function assertTrackedParticipantsClosed(
  ownerDb: Db,
  participantPids: ReadonlyMap<number, ServingRole>,
  ownerPid: number | undefined,
): Promise<void> {
  const participantPidList = [...participantPids.keys()];
  const advisoryPidList = ownerPid === undefined
    ? participantPidList
    : [...participantPidList, ownerPid];
  const participantPidsSql = sql.join(
    (participantPidList.length > 0 ? participantPidList : [-1]).map((pid) => sql`${pid}`),
    sql`, `,
  );
  const advisoryPidsSql = sql.join(
    (advisoryPidList.length > 0 ? advisoryPidList : [-1]).map((pid) => sql`${pid}`),
    sql`, `,
  );
  const cleanupStartedAt = performance.now();
  do {
    const [receipt] = rowsOf<{
      participant_pids_gone: boolean;
      owner_out_of_transaction: boolean;
      advisory_locks_gone: boolean;
    }>(await ownerDb.execute(sql`
      SELECT
        NOT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE pid IN (${participantPidsSql})
        ) AS participant_pids_gone,
        NOT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE pid = ${ownerPid ?? -1}
            AND pid <> pg_backend_pid()
            AND (state <> 'idle' OR xact_start IS NOT NULL)
        ) AS owner_out_of_transaction,
        NOT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory' AND pid IN (${advisoryPidsSql})
        ) AS advisory_locks_gone
    `));
    if (receipt?.participant_pids_gone && receipt.owner_out_of_transaction &&
      receipt.advisory_locks_gone) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (performance.now() - cleanupStartedAt < STARTUP_CLOSE_TIMEOUT_MS);
  throw new Error("distributed execution participant cleanup did not settle");
}

/**
 * Opens both bounded serving pools as one startup gate. The flag-off branch does
 * not inspect credentials or allocate a pool. The flag-on branch requires both
 * exact roles; any open/identity failure closes what was opened and aborts boot.
 */
export async function openDistributedExecutionDatabases(input: {
  enabled: boolean;
  ownerDb?: Db;
  requiredMigrationIdentity?: RequiredMigrationIdentity;
  appDatabaseUrl: string | undefined;
  operatorDatabaseUrl: string | undefined;
}): Promise<DistributedExecutionDatabases | null> {
  if (!input.enabled) return null;

  const advisoryKey = randomBytes(8).readBigInt64BE();
  const startupAbort = new AbortController();
  const startupDeadline = performance.now() + STARTUP_HANDSHAKE_TIMEOUT_MS;
  const participants: Promise<unknown>[] = [];
  const participantPids = new Map<number, ServingRole>();
  const ownerBarrier = new RejectableBarrier();
  const ownerLockedBarrier = new RejectableBarrier();
  const negativePairSequence = new RolePairSequence(STARTUP_POOL_OPTIONS.max);
  const positiveBarrier = new TwoRoleBarrier();
  const positivePairSequence = new RolePairSequence(STARTUP_POOL_OPTIONS.max);
  let phase = "configuration";
  let app: NonOwnerDbConnection | null = null;
  let operator: NonOwnerDbConnection | null = null;
  let ownerPid: number | undefined;

  const runPhase = async <T>(_phase: string, work: () => Promise<T>): Promise<T> => {
    if (startupAbort.signal.aborted || performance.now() >= startupDeadline) {
      if (!startupAbort.signal.aborted) startupAbort.abort();
      throw new DistributedExecutionStartupError("distributed_execution_timeout");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancellation = new Promise<never>((_resolve, reject) => {
      startupAbort.signal.addEventListener(
        "abort",
        () => reject(new Error("startup deadline expired")),
        { once: true },
      );
      timer = setTimeout(
        () => {
          if (!startupAbort.signal.aborted) startupAbort.abort();
        },
        Math.max(0, startupDeadline - performance.now()),
      );
    });
    try {
      return await Promise.race([work(), cancellation]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  const track = <T>(participant: Promise<T>): Promise<T> => {
    participants.push(participant);
    return participant;
  };

  const runSharedTransactions = async (
    connection: NonOwnerDbConnection,
    role: ServingRole,
    expected: boolean,
    onAcquired?: () => Promise<void>,
    beforeLock?: (index: number) => Promise<void>,
    afterLock?: (index: number) => void,
  ): Promise<void> => {
    const transactions = Array.from({ length: STARTUP_POOL_OPTIONS.max }, (_, index) => track(
      connection.db.transaction(async (transaction) => {
        await setStartupTransactionTimeouts(transaction);
        const pidResult = await transaction.execute(sql`SELECT pg_backend_pid() AS pid`);
        const pid = firstRowPid(pidResult);
        if (pid === undefined) throw new Error("advisory participant PID unavailable");
        participantPids.set(pid, role);
        if (beforeLock) await beforeLock(index);
        const lockResult = await transaction.execute(sql`
          SELECT pg_try_advisory_xact_lock_shared(${advisoryKey}) AS acquired
        `);
        if (firstRowBoolean(lockResult) !== expected) {
          throw new Error("unexpected advisory domain result");
        }
        if (onAcquired) await onAcquired();
        if (afterLock) afterLock(index);
      }),
    ));
    await Promise.all(transactions);
  };

  try {
    if (!input.ownerDb || !input.requiredMigrationIdentity) {
      throw new DistributedExecutionStartupError("distributed_execution_configuration");
    }
    if (typeof input.appDatabaseUrl !== "string" || input.appDatabaseUrl.trim() === "") {
      throw new DistributedExecutionStartupError("distributed_execution_configuration", "aoa_app");
    }
    if (typeof input.operatorDatabaseUrl !== "string" || input.operatorDatabaseUrl.trim() === "") {
      throw new DistributedExecutionStartupError(
        "distributed_execution_configuration",
        "aoa_operator",
      );
    }

    phase = "migration-identity";
    try {
      await assertRequiredMigrationIdentity(input.ownerDb, input.requiredMigrationIdentity);
    } catch {
      throw new DistributedExecutionStartupError("distributed_execution_migration_identity");
    }

    phase = "app-authority";
    try {
      app = createTenantAppDbConnection(input.appDatabaseUrl, STARTUP_POOL_OPTIONS);
      await assertNonOwnerConnection(app.db, "aoa_app");
      await assertExactServingRoleAuthority(app.db, "aoa_app");
      await assertExactCatalogCertificate(app.db);
    } catch {
      throw new DistributedExecutionStartupError(
        "distributed_execution_app_authority",
        "aoa_app",
      );
    }

    phase = "operator-authority";
    try {
      operator = createOperatorDbConnection(input.operatorDatabaseUrl, STARTUP_POOL_OPTIONS);
      await assertNonOwnerConnection(operator.db, "aoa_operator");
      await assertExactServingRoleAuthority(operator.db, "aoa_operator");
    } catch {
      throw new DistributedExecutionStartupError(
        "distributed_execution_operator_authority",
        "aoa_operator",
      );
    }

    phase = "owner-exclusive";
    const ownerPhase = runPhase("owner-exclusive", async () => {
      const ownerTransaction = track(input.ownerDb!.transaction(async (transaction) => {
        await setStartupTransactionTimeouts(transaction);
        const pidResult = await transaction.execute(sql`SELECT pg_backend_pid() AS pid`);
        const pid = firstRowPid(pidResult);
        if (pid === undefined) throw new Error("owner participant PID unavailable");
        ownerPid = pid;
        await transaction.execute(sql`SELECT pg_advisory_xact_lock(${advisoryKey})`);
        ownerLockedBarrier.resolve();
        try {
          await ownerBarrier.wait();
        } catch (error) {
          await cancelTrackedParticipantQueries(transaction, participantPids).catch(() => {});
          throw error;
        }
      }));
      await ownerTransaction;
    });
    await Promise.race([
      ownerLockedBarrier.wait(),
      ownerPhase.then(() => { throw new Error("owner lock phase ended before peer probes"); }),
    ]);

    phase = "negative-peers";
    await Promise.all([
      runPhase("app-negative", async () => {
        await runSharedTransactions(
          app!,
          "aoa_app",
          false,
          undefined,
          async (index) => negativePairSequence.wait(index),
          (index) => negativePairSequence.complete(index, "aoa_app"),
        );
      }),
      runPhase("operator-negative", async () => {
        await runSharedTransactions(
          operator!,
          "aoa_operator",
          false,
          undefined,
          async (index) => negativePairSequence.wait(index),
          (index) => negativePairSequence.complete(index, "aoa_operator"),
        );
      }),
    ]);
    ownerBarrier.resolve();
    await ownerPhase;

    phase = "positive-peers";
    await Promise.all([
      runPhase("app-positive", async () => {
        await runSharedTransactions(app!, "aoa_app", true, async () => {
          await positiveBarrier.wait("aoa_app");
        }, async (index) => positivePairSequence.wait(index),
        (index) => positivePairSequence.complete(index, "aoa_app"));
      }),
      runPhase("operator-positive", async () => {
        await runSharedTransactions(operator!, "aoa_operator", true, async () => {
          await positiveBarrier.wait("aoa_operator");
        }, async (index) => positivePairSequence.wait(index),
        (index) => positivePairSequence.complete(index, "aoa_operator"));
      }),
    ]);
    const settlements = await Promise.allSettled(participants);
    if (settlements.some((settlement) => settlement.status === "rejected")) {
      throw new Error("advisory participant did not settle successfully");
    }

    return {
      appDb: app.db,
      operatorDb: operator.db,
      close: async () => {
        try {
          await closeBoundedDatabaseConnections([operator!, app!]);
          await assertTrackedParticipantsClosed(input.ownerDb!, participantPids, ownerPid);
        } catch {
          throw new DistributedExecutionStartupError("distributed_execution_close");
        }
      },
    };
  } catch (error) {
    if (!startupAbort.signal.aborted) startupAbort.abort();
    ownerBarrier.reject();
    ownerLockedBarrier.reject();
    negativePairSequence.reject();
    positiveBarrier.reject();
    positivePairSequence.reject();
    await Promise.allSettled(participants);

    let closeFailed = false;
    if (operator || app) {
      try {
        await closeBoundedDatabaseConnections([
          ...(operator ? [operator] : []),
          ...(app ? [app] : []),
        ]);
      } catch {
        closeFailed = true;
      }
    }
    try {
      await assertTrackedParticipantsClosed(input.ownerDb!, participantPids, ownerPid);
    } catch {
      closeFailed = true;
    }

    const stable = closeFailed
      ? new DistributedExecutionStartupError("distributed_execution_close")
      : error instanceof DistributedExecutionStartupError
        ? error
        : startupAbort.signal.aborted && (performance.now() >= startupDeadline || isTimeoutOrDisconnect(error))
          ? new DistributedExecutionStartupError("distributed_execution_timeout")
          : new DistributedExecutionStartupError("distributed_execution_advisory_domain");
    logger.error({ code: stable.message, phase }, "distributed execution startup rejected");
    throw stable;
  }
}
