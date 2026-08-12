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

export { createShutdownHandler } from "./lifecycle/shutdown.js";
export type {
  ShutdownStep,
  ShutdownOptions,
  ShutdownSignal,
  ShutdownLogger,
} from "./lifecycle/shutdown.js";

export { startHealthServer, assertLoopbackHost } from "./health/health-server.js";
export type { HealthServerHandle, HealthServerConfig } from "./health/health-server.js";

export { createMetrics, ALLOWED_LABEL_KEYS } from "./metrics/metrics.js";
export type { Metrics } from "./metrics/metrics.js";

export { bootstrapWorkerDaemon } from "./bin/worker-daemon.js";
export type { BootstrapDeps, BootstrapResult, ProcessLike } from "./bin/worker-daemon.js";
