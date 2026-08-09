import {
  assertNonOwnerConnection,
  createOperatorDbConnection,
  createTenantAppDbConnection,
  type Db,
  type NonOwnerDbConnection,
} from "@armyofagents/db";

export interface DistributedExecutionDatabases {
  appDb: Db;
  operatorDb: Db;
  close(): Promise<void>;
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
    } catch (error) {
      throw new Error("aoa_app serving pool failed its non-owner startup check", { cause: error });
    }

    operator = createOperatorDbConnection(input.operatorDatabaseUrl ?? "");
    try {
      await assertNonOwnerConnection(operator.db, "aoa_operator");
    } catch (error) {
      throw new Error("aoa_operator serving pool failed its non-owner startup check", { cause: error });
    }

    return {
      appDb: app.db,
      operatorDb: operator.db,
      close: async () => {
        await Promise.allSettled([operator!.close(), app!.close()]);
      },
    };
  } catch (error) {
    await Promise.allSettled([
      ...(operator ? [operator.close()] : []),
      ...(app ? [app.close()] : []),
    ]);
    throw error;
  }
}
