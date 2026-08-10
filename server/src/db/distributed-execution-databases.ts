import {
  assertNonOwnerConnection,
  createOperatorDbConnection,
  createTenantAppDbConnection,
  type Db,
  type NonOwnerDbConnection,
} from "@armyofagents/db";
import { sql } from "drizzle-orm";
import {
  APP_EXECUTION_TARGET_COLUMN_GRANTS,
  APP_ENROLLMENT_TARGET_SELECT_COLUMNS,
  APP_ENROLLMENT_TARGET_UPDATE_COLUMNS,
  APP_MCP_API_KEY_COLUMN_GRANTS,
  JOB_CONTROL_LEGACY_GRANTS,
  JOB_CONTROL_NEW_PATH_GRANTS,
  JOB_SUBMISSION_LEGACY_GRANTS,
  JOB_SUBMISSION_NEW_PATH_GRANTS,
  OPERATOR_METADATA_COLUMN_GRANTS,
  OPERATOR_ENROLLMENT_TARGET_SELECT_COLUMNS,
  OPERATOR_ENROLLMENT_TARGET_UPDATE_COLUMNS,
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
    ]);
    const appColumnSelect = row.schema_name === "public" && (
      (row.table_name === "execution_targets" && (
        APP_EXECUTION_TARGET_COLUMN_GRANTS.includes(
          row.column_name as (typeof APP_EXECUTION_TARGET_COLUMN_GRANTS)[number]
        ) || APP_ENROLLMENT_TARGET_SELECT_COLUMNS.includes(
          row.column_name as (typeof APP_ENROLLMENT_TARGET_SELECT_COLUMNS)[number]
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
            )
          : OPERATOR_ENROLLMENT_TARGET_UPDATE_COLUMNS.includes(
              row.column_name as (typeof OPERATOR_ENROLLMENT_TARGET_UPDATE_COLUMNS)[number]
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

export async function closeBoundedDatabaseConnections(
  connections: readonly Pick<NonOwnerDbConnection, "close">[],
): Promise<void> {
  const results = await Promise.allSettled(connections.map((connection) => connection.close()));
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, "Failed to close bounded distributed database pools");
  }
}

/**
 * Opens both bounded serving pools as one startup gate. The flag-off branch does
 * not inspect credentials or allocate a pool. The flag-on branch requires both
 * exact roles; any open/identity failure closes what was opened and aborts boot.
 */
export async function openDistributedExecutionDatabases(input: {
  enabled: boolean;
  appDatabaseUrl: string | undefined;
  operatorDatabaseUrl: string | undefined;
}): Promise<DistributedExecutionDatabases | null> {
  if (!input.enabled) return null;

  let app: NonOwnerDbConnection | null = null;
  let operator: NonOwnerDbConnection | null = null;
  try {
    app = createTenantAppDbConnection(input.appDatabaseUrl ?? "");
    try {
      await assertNonOwnerConnection(app.db, "aoa_app");
      await assertExactServingRoleAuthority(app.db, "aoa_app");
    } catch (error) {
      throw new Error("aoa_app serving pool failed its non-owner startup check", { cause: error });
    }

    operator = createOperatorDbConnection(input.operatorDatabaseUrl ?? "");
    try {
      await assertNonOwnerConnection(operator.db, "aoa_operator");
      await assertExactServingRoleAuthority(operator.db, "aoa_operator");
    } catch (error) {
      throw new Error("aoa_operator serving pool failed its non-owner startup check", { cause: error });
    }

    return {
      appDb: app.db,
      operatorDb: operator.db,
      close: () => closeBoundedDatabaseConnections([operator!, app!]),
    };
  } catch (error) {
    await Promise.allSettled([
      ...(operator ? [operator.close()] : []),
      ...(app ? [app.close()] : []),
    ]);
    throw error;
  }
}
