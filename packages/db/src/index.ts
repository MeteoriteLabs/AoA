export {
  createDb,
  createTenantAppDb,
  assertNonOwnerConnection,
  ensurePostgresDatabase,
  inspectMigrations,
  applyPendingMigrations,
  type ApplyPendingMigrationsOptions,
  reconcilePendingMigrationHistory,
  type MigrationState,
  type MigrationHistoryReconcileResult,
  migratePostgresIfEmpty,
  type MigrationBootstrapResult,
  type Db,
} from "./client.js";
export {
  assertMigrationSnapshotGate,
  isUndefinedTableError,
  readCompanyCountForSnapshotGate,
  readRecordedSnapshotsForSnapshotGate,
  shouldBlockForMissingSnapshot,
  SnapshotGateError,
  type AssertMigrationSnapshotGateInput,
  type MigrationGateDeploymentMode,
  type SnapshotGateInput,
} from "./migration-snapshot-gate.js";
export {
  runDatabaseBackup,
  formatDatabaseBackupResult,
  pruneOldBackups,
  type RunDatabaseBackupOptions,
  type RunDatabaseBackupResult,
} from "./backup-lib.js";
export * from "./schema/index.js";
// TEN-003: the tenant repository factory is the only sanctioned reader/writer of
// the new-path tables; re-exported from the package barrel so the server's
// `runInTenant` (server/src/db/tenant-context.ts) imports it as a bare specifier
// alongside `createTenantAppDb`/`Db`. The factory's OWN module surface is still the
// single `tenantRepositories` export (tenant-repository-surface.test.ts) — this
// re-export does not add a raw unscoped reader.
export { tenantRepositories, type TenantRepositories } from "./repositories/tenant/index.js";
