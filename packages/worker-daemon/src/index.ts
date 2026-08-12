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

export { createShutdownHandler, createLeaseLifecycleSteps } from "./lifecycle/shutdown.js";
export type {
  ShutdownStep,
  ShutdownOptions,
  ShutdownSignal,
  ShutdownLogger,
  LeasingLifecycle,
} from "./lifecycle/shutdown.js";

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

export { SessionStore, SessionStoppedError, REENROLLMENT_REQUIRED_METRIC } from "./identity/session.js";
export type { SessionStoreDeps } from "./identity/session.js";

export {
  POLL_PATH,
  LEASE_ACK_BASE_PATH,
  leaseAckPath,
} from "./transport/client.js";
export type { WorkerOperationHttpRequest, WorkerOperationHttpResponse } from "./transport/client.js";

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
