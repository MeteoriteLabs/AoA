export {
  createDb,
  createTenantAppDb,
  createTenantAppDbConnection,
  createOperatorDbConnection,
  assertNonOwnerConnection,
  type NonOwnerDbConnection,
  type NonOwnerDbConnectionOptions,
  loadRequiredMigrationIdentity,
  type RequiredMigrationIdentity,
  loadAppliedMigrationIdentity,
  type AppliedMigrationIdentity,
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
export type {
  LeaseWorkerAuthority,
  PlacementCandidateSnapshot,
  TerminalCompletionStatus,
  ServiceHealthStatus,
  GuardedFenceResult,
  AcceptEventInput,
  AcceptEventBatchInput,
  EventIngestOutcome,
  ProjectionInput,
  ProjectionTransition,
  JobControlCommandKind,
  ControlCommandAckStatus,
  QueuedControlCommand,
  ControlCommandAckInput,
  ControlCommandAckOutcome,
  RequestCancellationInput,
  CancellationStatus,
  CancellationOutcome,
  RetryAllocationInput,
  RetryAllocationStatus,
  RetryAllocationResult,
  ReapExpiredLeasesInput,
  ReapExpiredLeasesResult,
} from "./repositories/tenant/job-control.js";
export { computeRetryBackoffMs } from "./repositories/tenant/job-control.js";
// JOB-004: the ONE common active-fence predicate + the CLOSED governed-mutator
// surface. Re-exported from the barrel so `server/src/services/job-fencing.ts`
// shares the exact same seam the tenant repository's guarded mutators gate on.
export {
  isActiveFence,
  classifyFence,
  JobFenceError,
  GUARDED_JOB_MUTATORS,
  TERMINAL_ATTEMPT_STATUSES,
  type ActiveFenceRequest,
  type ActiveFenceSnapshot,
  type GuardedJobMutator,
  type JobFenceErrorCode,
} from "./repositories/tenant/job-fence.js";
export { operatorWorkerEnrollmentRepository } from "./repositories/operator/worker-enrollment.js";
export { listPlatformPlacementCandidateSnapshots } from "./repositories/operator/job-placement.js";
export {
  configurePlatformTargetAuthorityLockTimeout,
  acquirePlatformTargetAuthorityShared,
  acquirePlatformTargetAuthorityExclusive,
} from "./platform-target-authority-lock.js";
export {
  operatorJobLeasingRepository,
  type PlatformPhysicalLeaseAuthority,
} from "./repositories/operator/job-leasing.js";
