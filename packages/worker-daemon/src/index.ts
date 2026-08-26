/**
 * @armyofagents/worker-daemon — public barrel (composition-root exports).
 *
 * The separately deployable worker daemon: a genuinely isolated leaf package
 * that imports no server/database/shared/drizzle code (statically enforced by
 * `scripts/check-worker-daemon-boundary.mjs`). WRK-001 ships config, logging,
 * shutdown, and a loopback-only health/metrics surface; later tickets add
 * identity/enrollment (WRK-002), poll/ACK (WRK-003), and the sandbox supervisor
 * (WRK-004).
 */

export {
  loadWorkerConfig,
  isLoopbackHost,
  WORKER_VERSION,
  KEY_STORE_MODES,
  TARGET_SCOPES,
  ENV,
} from "./config/config.js";
export type {
  WorkerConfig,
  KeyStoreMode,
  TargetScope,
  EnrollmentCodeSource,
} from "./config/config.js";

export {
  parseBooleanEnv,
  parseEnumEnv,
  parseIntEnv,
  parseUnitFloatEnv,
} from "./config/env.js";
export type { Env } from "./config/env.js";

export { createWorkerLogger } from "./logging/logger.js";
export type { Logger, WorkerLoggerOptions } from "./logging/logger.js";

export {
  createShutdownHandler,
  createLeaseLifecycleSteps,
  createEventOutboxShutdownSteps,
} from "./lifecycle/shutdown.js";
export type {
  ShutdownStep,
  ShutdownOptions,
  ShutdownSignal,
  ShutdownLogger,
  LeasingLifecycle,
  RenewalLifecycle,
  EventOutboxLifecycle,
} from "./lifecycle/shutdown.js";

// DSK-004 Lane D — stop leasing, drain, then swap. Composed from the shutdown steps
// above, under the opposite failure policy: a failed drain refuses the swap rather than
// being swallowed, because an update is not exiting and the pointer must not move over
// work that is still running.
export { createUpdateDrainSteps, runDrainBeforeSwap } from "./update/drain-before-swap.js";
export type {
  DrainBeforeSwapOptions,
  UpdateDrainDeps,
  UpdateDrainResult,
  UpdateRefusalReason,
} from "./update/drain-before-swap.js";

export { startHealthServer, assertLoopbackHost } from "./health/health-server.js";
export type { HealthServerHandle, HealthServerConfig } from "./health/health-server.js";

export { createMetrics, ALLOWED_LABEL_KEYS, CLOSED_LABEL_VALUES } from "./metrics/metrics.js";
export type { Metrics } from "./metrics/metrics.js";

export { bootstrapWorkerDaemon } from "./bin/worker-daemon.js";
export type { BootstrapDeps, BootstrapResult, ProcessLike } from "./bin/worker-daemon.js";

// --- WRK-002: device identity, transport, enrollment, and session ------------

export { WORKER_CONTROL_HEADERS } from "./transport/headers.js";
export type { WorkerControlHeaderKey, WorkerControlHeaderName } from "./transport/headers.js";

export {
  generateDeviceKey,
  deviceKeyFromPkcs8Der,
  exportDevicePrivateKeyPkcs8Der,
  signWithDeviceKey,
} from "./identity/device-key.js";
export type { DeviceKey } from "./identity/device-key.js";

export {
  DEVICE_PROOF_PREFIX,
  DEVICE_PROOF_VERSION,
  DeviceProofError,
  normalizeDeviceProofPath,
  buildDeviceProofCanonical,
  sha256Hex,
  signDeviceProof,
} from "./identity/device-proof.js";
export type {
  DeviceProofCanonicalInput,
  SignDeviceProofInput,
  SignedDeviceProof,
} from "./identity/device-proof.js";

export {
  DeviceKeyStoreError,
  MountedSecretKeyStore,
  InMemoryKeyStore,
} from "./identity/key-store.js";
export type { DeviceKeyStore, OsKeychainKeyStore } from "./identity/key-store.js";

export { buildEnrollmentRequest } from "./transport/envelope.js";
export type { BuildEnrollmentRequestInput, EnrollmentRequestEnvelope } from "./transport/envelope.js";

export { ENROLL_PATH, ControlPlaneTransportError, createControlPlaneClient } from "./transport/client.js";
export type {
  ControlPlaneClient,
  ControlPlaneClientOptions,
  ControlPlaneTransportErrorKind,
  EnrollHttpRequest,
  EnrollHttpResponse,
} from "./transport/client.js";
export { EXECUTION_SECRET_RESOLVE_PATH, EXECUTION_SECRET_RESOLVE_DESCRIPTOR } from "./transport/client.js";

// DAT-008 slice 5 — worker-side secret redemption (used by the composed dispatch runtime and by
// the server-side integration proof of the real resolve round-trip).
export {
  PROVIDER_AUTH_ENV_TARGETS,
  SecretMaterializationError,
  UnknownSecretTargetError,
  classifyResolveResponse,
  createRedeemer,
  synthesiseRunSecrets,
} from "./lease/secret-redemption.js";
export type { RedeemFn, ResolveClassification, RunFenceContext } from "./lease/secret-redemption.js";

export { createEnroller, EnrollmentError, mapErrorStatus, DEFAULT_SESSION_TTL_MS } from "./enrollment/enroll.js";
export type {
  Enroller,
  EnrollerDeps,
  EnrollInput,
  RenewInput,
  EnrollResult,
  EnrollmentFailureKind,
  WorkerSession,
} from "./enrollment/enroll.js";

// --- DSK-001 (D6): desktop enrollment ----------------------------------------
//
// These exist so a host OUTSIDE this package can compose device custody in.
// `scripts/check-worker-daemon-boundary.mjs` walks `packages/worker-daemon/src`
// and rejects a bare specifier the moment a file here names anything outside the
// two-dependency pin, so this package can never import `@armyofagents/worker-
// keystore`. It declares the SHAPE and the keystore supplies an implementation;
// the dependency arrow points keystore -> daemon and never back. The TYPE exports
// are what let the keystore side prove assignability at compile time rather than
// by a cast.

export { resolveCustody, frozenDeviceKeyView } from "./identity/device-identity-store.js";
export type {
  CustodyVerdict,
  DeviceIdentityRecord,
  DeviceEnrollmentReceipt,
  DeviceRecordStore,
  DeviceIdentityStore,
  DeviceReceiptStore,
} from "./identity/device-identity-store.js";

// DSK-003 Lane A — owner-only file custody (one copy) + the local control token that
// gates every MUTATING desktop control.
export { GROUP_OTHER_MASK, STRICT_FILE_MODE, isOwnerOnlyMode, ownerOnlyViolation } from "./identity/file-custody.js";
export type { OwnerOnlyViolation, OwnerOnlyDeps } from "./identity/file-custody.js";
export {
  CONTROL_TOKEN_BYTES,
  CONTROL_TOKEN_REJECTIONS,
  MIN_STORED_TOKEN_LENGTH,
  generateControlToken,
  verifyControlToken,
} from "./identity/control-token.js";
export type { ControlTokenRejection, ControlTokenResult } from "./identity/control-token.js";

// DSK-003 Lane A — the desktop control surface (default-deny authorization).
export {
  CONTROL_COMMANDS,
  READ_ONLY_COMMANDS,
  authorizeControlCommand,
  parseControlCommand,
  requiresControlToken,
} from "./control/commands.js";
export type {
  ControlAuthzDeps,
  ControlAuthzRejection,
  ControlAuthzResult,
  ControlCommand,
  ParsedControlCommand,
  ReadOnlyCommand,
} from "./control/commands.js";

// DSK-003 Lane B — the uninstall plan (explicit identity disposition, no default).
export {
  UNINSTALL_IDENTITY_POLICIES,
  UNINSTALL_REFUSALS,
  planUninstall,
} from "./control/uninstall-plan.js";
export type {
  UninstallIdentityPolicy,
  UninstallPlan,
  UninstallRefusal,
  UninstallStep,
  UninstallStepName,
} from "./control/uninstall-plan.js";

// DSK-003 Lane A — the host state record + the stale-pid defence.
export {
  HOST_STATE_KEYS,
  HOST_STATE_REJECTIONS,
  TARGET_PROCESS_REJECTIONS,
  buildHostStateRecord,
  hostStateLeakKeys,
  readHostState,
  resolveTargetProcess,
} from "./control/host-state.js";
export type {
  HostStateKey,
  HostStateRecord,
  HostStateRejection,
  HostStateResult,
  TargetProcessDeps,
  TargetProcessRejection,
  TargetProcessResult,
} from "./control/host-state.js";

// DSK-003 Lane A — the control-command effect layer.
export { RESET_ACKNOWLEDGEMENT_FLAG, executeControlCommand } from "./control/execute.js";
export type {
  ControlExecuteDeps,
  ControlExecuteInput,
  ControlExecuteRejection,
  ControlExecuteResult,
} from "./control/execute.js";

export { enrollOnce, EnrollOnceError, EnrollmentAuthorityError } from "./enrollment/enroll-once.js";
export type { EnrollOnceDeps, EnrollmentOutcome } from "./enrollment/enroll-once.js";

export { readEnrollmentInput } from "./enrollment/enrollment-input.js";
export type { EnrollmentInput } from "./enrollment/enrollment-input.js";

export {
  buildDesktopHello,
  UNPROVISIONED_POLICY_HASH,
  DESKTOP_RUNTIME_LABEL,
  FIRST_ENROLLMENT_DEVICE_GENERATION,
} from "./enrollment/desktop-hello.js";
export type { HelloProvisioning } from "./enrollment/desktop-hello.js";

// WRK-011 — fold a self-model read response into the provisioning a matchable hello reports.
export { deriveHelloProvisioning, SUPERVISABLE_WORKLOAD_CAPABILITIES } from "./enrollment/hello-provisioning.js";

// DSK-002 Lane B — isolation capability detection + the frozen-vocabulary mapping.
export {
  ISOLATION_MECHANISMS,
  capabilitiesForIsolation,
  detectIsolationMechanism,
} from "./enrollment/isolation-capabilities.js";
export type { IsolationMechanism, IsolationProbe, IsolationProbes } from "./enrollment/isolation-capabilities.js";

export {
  encodeEnrollmentTicket,
  decodeEnrollmentTicket,
  EnrollmentTicketError,
  ENROLLMENT_TICKET_PREFIX,
  ENROLLMENT_TICKET_VERSION,
} from "./enrollment/ticket.js";
export type { EnrollmentTicket } from "./enrollment/ticket.js";

export { deriveEnrollmentIdempotencyKey } from "./enrollment/idempotency.js";

export { SessionStore, SessionStoppedError, REENROLLMENT_REQUIRED_METRIC, RENEWAL_HEADROOM_MS } from "./identity/session.js";
export type { SessionStoreDeps } from "./identity/session.js";

// WRK-010 slice 2 — the worker-side device-proof session renewal client + lifecycle.
export { createSessionRenewer } from "./identity/session-renewal.js";
export type { SessionRenewerDeps } from "./identity/session-renewal.js";
export { createWorkerSessionLifecycle } from "./identity/worker-session-lifecycle.js";
export type { WorkerSessionLifecycleDeps, WorkerSessionLifecycle } from "./identity/worker-session-lifecycle.js";

export {
  POLL_PATH,
  LEASE_ACK_BASE_PATH,
  QUARANTINE_GRANT_PATH,
  QUARANTINE_FINALIZE_PATH,
  SESSION_RENEW_PATH,
  SESSION_RENEW_DESCRIPTOR,
  SELF_HELLO_PATH,
  SELF_HELLO_DESCRIPTOR,
  leaseAckPath,
  leaseRenewPath,
} from "./transport/client.js";
export type { WorkerOperationHttpRequest, WorkerOperationHttpResponse, SessionRenewHttpResponse } from "./transport/client.js";

// --- WRK-003: poll, ACK, and capability advertisement ------------------------

export { ConcurrencyLimiter, WORKLOAD_CLASSES } from "./poll/concurrency.js";
export type { ConcurrencyLimits, WorkloadClass, WorkloadSlotSnapshot } from "./poll/concurrency.js";

export {
  INITIAL_BACKOFF_STATE,
  BACKOFF_BUCKETS,
  nextBackoff,
  backoffBucket,
} from "./poll/backoff.js";
export type { BackoffConfig, BackoffState, BackoffResult, NextBackoffOptions } from "./poll/backoff.js";

export {
  measureCapacity,
  sumReservations,
  offerSatisfiesWorker,
  deriveJobRequirements,
} from "./poll/capacity.js";
export type {
  CapacityReservation,
  CapacityProbes,
  ResourceCeiling,
  MeasureCapacityInput,
  WorkerSelfModel,
} from "./poll/capacity.js";

export {
  buildPollRequest,
  buildLeaseAckRequest,
  pollOnce,
  ackLease,
  createPollLoop,
  createSessionProvider,
  SessionTerminalError,
  POLL_OUTCOME_METRIC,
  LEASE_ACK_METRIC,
  ACTIVE_LEASES_METRIC,
  BACKOFF_SLEEP_METRIC,
  CAPACITY_FREE_SLOTS_METRIC,
} from "./poll/poll-loop.js";
export type {
  PollRequestEnvelope,
  BuildPollRequestInput,
  LeaseAckRequestEnvelope,
  BuildLeaseAckRequestInput,
  PollAttempt,
  AckAttempt,
  TransientLabel,
  OperationRandomness,
  PollOnceDeps,
  AckLeaseDeps,
  SessionProvider,
  LeaseHandoff,
  SupervisorSeam,
  PollLoopStopReason,
  PollLoopController,
  PollLoopDeps,
} from "./poll/poll-loop.js";

// --- WRK-004: sandbox supervisor + monotonic cleanup authority ---------------

export {
  SANDBOX_OP_METRIC,
  CLEANUP_OUTCOME_METRIC,
  CLEANUP_ESCALATION_METRIC,
  RECONCILE_ORPHANS_METRIC,
} from "./metrics/metrics.js";

// E4-F003: the SandboxProvider PORT type + its result/label types are exported
// from the public API so a future `@armyofagents/sandbox-fake-provider` (DEP-000)
// can `implements SandboxProvider` without copying the shape. The port stays
// authoritative here in worker-daemon.
export {
  SANDBOX_STATES,
  PROVIDER_OPERATIONS,
  UnsupportedProviderOperation,
  SandboxNotFoundError,
  labelsEqual,
  labelsMatchSelector,
  hashResourceLabels,
} from "./supervisor/provider.js";
export type {
  SandboxProvider,
  ProviderOperation,
  ProviderOpContext,
  CheckpointMode,
  HealthMode,
  // DAT-009 slice 1 — the provider-side artifact export capability.
  ArtifactExportMode,
  ArtifactDigestResult,
  ArtifactExportResult,
  DeclinableOperation,
  SandboxState,
  CleanupStatus,
  StopOutcome,
  ResourceLabels,
  OwnershipSelector,
  CreateSandboxSpec,
  CreateResult,
  ExecuteInput,
  ExecuteResult,
  StopResult,
  CleanupResult,
  ResourceSummary,
  ListInput,
  ListResult,
  InspectResult,
  CheckpointResult,
  RestoreResult,
  HealthResult,
  RedactedResourceProjection,
} from "./supervisor/provider.js";

// WRK-009 — the in-process fake provider is NO LONGER exported and no longer lives in
// the production source tree. It fabricates success (exit 0 -> terminal "succeeded"),
// it shipped in the worker image, and it was the only SandboxProvider the daemon could
// import. It now sits with every other double in src/__tests__/support/.

export { EffectAuthority, EffectAuthorityWithdrawnError } from "./supervisor/effect-authority.js";
export type { EffectFence } from "./supervisor/effect-authority.js";

export {
  CleanupAuthority,
  CleanupAuthorityDeniedError,
  ResourceNotAvailableError,
  CLEANUP_STAGES,
} from "./supervisor/cleanup-authority.js";
export type { CleanupAuthorityConfig, CleanupStage } from "./supervisor/cleanup-authority.js";

export { EventSequencer } from "./supervisor/events.js";
export type {
  EventDeliveryIdentity,
  EventSequencerDeps,
  WorkerEventSink,
} from "./supervisor/events.js";

export { reconcile, RECONCILE_PROVIDER_OUTAGE_EVENT } from "./supervisor/reconcile.js";
export type {
  ReconcileDeps,
  ReconcileResult,
  ReconcileOutcomeRecord,
} from "./supervisor/reconcile.js";

export { createSupervisor } from "./supervisor/supervisor.js";
export type {
  Supervisor,
  SupervisorDeps,
  WorkerSupervisionIdentity,
  SupervisorRunStatus,
  RunObservation,
  RunObservationLogEntry,
  RunObservationProgressEntry,
} from "./supervisor/supervisor.js";

export type { NetworkDenialClass } from "./supervisor/events.js";

// --- WRK-005: lease renewal, fence-close proxy, and orphan-output quarantine --

export {
  LEASE_RENEW_METRIC,
  LEASE_LOSS_METRIC,
  FENCE_CLOSE_METRIC,
  GOVERNED_EFFECT_DENIED_METRIC,
  QUARANTINE_METRIC,
} from "./metrics/metrics.js";

export {
  createLeaseRenewalDriver,
  createRealRenewalSchedule,
  renewLeaseOnce,
  buildLeaseRenewRequest,
} from "./lease/lease-renewal.js";
export type {
  LeaseRenewalDriver,
  LeaseRenewalDriverDeps,
  RenewAttempt,
  RenewalSchedule,
  RenewalTimer,
  RenewalSupervisor,
  RenewalIdentity,
  RenewalTuning,
  RenewLeaseOnceDeps,
  BuildLeaseRenewRequestInput,
  LeaseRenewRequestEnvelope,
} from "./lease/lease-renewal.js";

export { FenceCloseProxy, FenceClosedError, GOVERNED_EFFECTS } from "./lease/fence-close-proxy.js";
export type {
  GovernedEffect,
  GovernedEffectAuthority,
  FenceCloseReason,
  FenceCloseProxyDeps,
  EgressAttempt,
} from "./lease/fence-close-proxy.js";

export {
  classifyOrphanOutput,
  buildQuarantineGrantRequest,
  buildQuarantineFinalizeRequest,
  quarantineObjectKey,
  runOrphanQuarantine,
} from "./lease/quarantine.js";
export type {
  OrphanOutputCondition,
  QuarantineIdentity,
  QuarantineArtifact,
  QuarantineOutcome,
  RunOrphanQuarantineDeps,
  BuildQuarantineGrantInput,
  BuildQuarantineFinalizeInput,
  QuarantineGrantRequestEnvelope,
  QuarantineFinalizeRequestEnvelope,
} from "./lease/quarantine.js";

// --- WRK-006: durable, encrypted event outbox + event_upload wiring ----------

export { EVENT_UPLOAD_PATH, ARTIFACT_COMMIT_PATH, ARTIFACT_TRANSFER_GRANT_PATH } from "./transport/client.js";

export { KEK_BYTES, RowDecryptError, encryptEventRow, decryptEventRow } from "./events/event-row-codec.js";
export type { EncryptedEventRow } from "./events/event-row-codec.js";

export {
  EventOutboxKekError,
  MountedSecretKekStore,
  StaticKek,
  deriveKekFromDeviceKey,
} from "./events/event-outbox-kek.js";
export type { EventOutboxKekStore } from "./events/event-outbox-kek.js";

export {
  SeqCollisionError,
  OutboxFullError,
  SqliteEventOutboxStore,
  deriveStreamKey,
  loadDatabaseSync,
  openEventOutboxStore,
} from "./events/event-outbox-store.js";
export type {
  DurableEventStore,
  EventStreamIdentity,
  EventRowStatus,
  StoredEventRow,
  StreamCursor,
  AppendEventInput,
  EventOutboxLimits,
  SqliteEventOutboxStoreOptions,
} from "./events/event-outbox-store.js";

export { DurableWorkerEventSink, toStreamKey } from "./events/durable-event-sink.js";
export type { DurableWorkerEventSinkDeps } from "./events/durable-event-sink.js";

export {
  buildEventUploadRequest,
  uploadEventBatchOnce,
  classifyEventUploadResponse,
} from "./events/event-upload.js";
export type {
  EventUploadAttempt,
  EventUploadRequestEnvelope,
  BuildEventUploadRequestInput,
  UploadEventBatchOnceDeps,
} from "./events/event-upload.js";

export { createEventOutboxDrain } from "./events/event-outbox-drain.js";
export type {
  EventOutboxDrain,
  EventOutboxDrainDeps,
  EventOutboxDrainTuning,
  DrainTickSummary,
} from "./events/event-outbox-drain.js";

// --- WRK-007: restart recovery + orphan reconciliation -----------------------

export {
  probeLeaseAuthority,
  buildControlPlaneIsOrphan,
  createStartupReconciler,
} from "./supervisor/startup-reconcile.js";
export type {
  LeaseLiveness,
  LeaseAuthorityEntry,
  LeaseAuthorityMap,
  ProbeLeaseAuthorityDeps,
  SandboxDisposition,
  SandboxOutcomeRecord,
  StreamOutcomeRecord,
  QuarantineOutcomeRecord,
  StartupReconcileResult,
  StartupReconcilerDeps,
  StartupOutboxDeps,
  StartupQuarantineCandidate,
  StartupReconcilePass,
} from "./supervisor/startup-reconcile.js";

export { createStartupSteps, runStartupSteps } from "./lifecycle/startup-steps.js";
export type { StartupStep, StartupReconciler, StartupLogger } from "./lifecycle/startup-steps.js";

// WRK-008 slice 2 / DEP-010 (Sprint 2) — the dispatch-composition decision.
//
// PUBLIC on purpose. The composition root that supplies the `provider` input lives OUTSIDE
// this package (`packages/worker-keystore/src/bin/desktop-host.ts`): the daemon DEFINES the
// `SandboxProvider` port and cannot import an implementation of it (E4-D01), so the root that
// injects one is a separate package. That root must be able to assert the shipped default
// resolves to `no_provider` — which requires importing the decision and its frozen refusal
// map from the barrel rather than a private lifecycle module. WRK-008 slice 2b narrows this
// surface (DEP-010 design §10.3).
export { decideDispatchComposition, DISPATCH_REFUSAL_MESSAGES } from "./lifecycle/compose-dispatch.js";
export type {
  DispatchRefusalReason,
  DispatchCompositionDecision,
  DispatchCompositionInput,
  SelfModelReadResult,
  SelfModelReadRefusal,
} from "./lifecycle/compose-dispatch.js";

// --- DAT-001: immutable workspace snapshot producer --------------------------

export {
  buildWorkspaceManifest,
  parseManifestFailClosed,
  assertRepresentable,
  assertNoCollisions,
  normalizeRelPath,
  WorkspaceSnapshotError,
  DEFAULT_SNAPSHOT_LIMITS,
  SCHEMA_MAX_ENTRIES,
  compareUtf8,
  sortSnapshotEntries,
  computeContentRevision,
  computeManifestHash,
  AOA_BUILTIN_IGNORE_RULES,
  classifyExplicitRule,
  isIgnoredByExplicit,
  computeExplicitIgnoreDigest,
  resolveEffectiveExplicitRules,
  computeGitignoreDigest,
  createGitRunner,
  GitRunnerError,
  GIT_HARDENING_FLAGS,
  captureGitBase,
} from "./snapshot/index.js";
export type {
  BuildWorkspaceManifestInput,
  BuildWorkspaceManifestResult,
  SnapshotBudget,
  SnapshotLimits,
  Sha256Fn,
  SnapshotEntry,
  IgnorePolicyRecord,
  InclusionRecord,
  IgnorePolicyInput,
  GitignoreSource,
  GitRunner,
  GitRunResult,
  CaptureGitBaseInput,
  CapturedGitBase,
} from "./snapshot/index.js";

// --- DAT-003: workspace patch (base→result set-diff) producer ----------------

export { buildWorkspacePatch, WorkspacePatchError } from "./patch/index.js";
export type { BuildWorkspacePatchInput, BuildWorkspacePatchResult } from "./patch/index.js";
