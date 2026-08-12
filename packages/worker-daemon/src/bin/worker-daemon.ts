/**
 * Worker-daemon container/desktop entrypoint (WRK-001, `bin` target).
 *
 * Composition root: config → logger → metrics → health server → shutdown, then
 * blocks. It dispatches NO work in CORE (the poll loop lands in WRK-003). On an
 * invalid config it exits non-zero BEFORE opening the health server or any
 * socket. `bootstrapWorkerDaemon` is factored out (injectable `env`, `proc`, and
 * subsystem factories) so the signal-wiring and fail-closed-config behavior are
 * unit-testable without spawning a process.
 */

import process from "node:process";
import { pathToFileURL } from "node:url";

import { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION } from "@armyofagents/worker-protocol";

import { loadWorkerConfig, WORKER_VERSION, type WorkerConfig } from "../config/config.js";
import type { Env } from "../config/env.js";
import { createWorkerLogger, type Logger } from "../logging/logger.js";
import { createMetrics, type Metrics } from "../metrics/metrics.js";
import { startHealthServer, type HealthServerHandle } from "../health/health-server.js";
import {
  createShutdownHandler,
  type ShutdownSignal,
} from "../lifecycle/shutdown.js";

/** The subset of `process` the entrypoint needs; injected for tests. */
export interface ProcessLike {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): void;
  exit(code: number): void;
}

export interface BootstrapDeps {
  readonly env: Env;
  readonly proc: ProcessLike;
  readonly createLogger?: typeof createWorkerLogger;
  readonly createMetricsFn?: typeof createMetrics;
  readonly startHealth?: typeof startHealthServer;
}

export interface BootstrapResult {
  readonly ok: boolean;
  readonly config?: WorkerConfig;
  readonly logger?: Logger;
  readonly metrics?: Metrics;
  readonly health?: HealthServerHandle;
  readonly shutdown?: (signal: ShutdownSignal) => Promise<void>;
}

export async function bootstrapWorkerDaemon(deps: BootstrapDeps): Promise<BootstrapResult> {
  const makeLogger = deps.createLogger ?? createWorkerLogger;
  const makeMetrics = deps.createMetricsFn ?? createMetrics;
  const startHealth = deps.startHealth ?? startHealthServer;

  const logger = makeLogger();

  // Fail-closed on invalid config: exit non-zero BEFORE any socket is opened
  // (no health server, no signal handlers).
  let config: WorkerConfig;
  try {
    config = loadWorkerConfig(deps.env);
  } catch (err) {
    logger.error({ err }, "worker-daemon config invalid; refusing to start");
    deps.proc.exit(1);
    return { ok: false, logger };
  }

  logger.info(
    {
      workerVersion: WORKER_VERSION,
      protocolMin: MIN_PROTOCOL_VERSION,
      protocolMax: PROTOCOL_VERSION,
      keyStoreMode: config.keyStoreMode,
      targetScope: config.targetScope,
    },
    "worker-daemon starting",
  );

  const metrics = makeMetrics();
  const health = await startHealth({ host: config.health.host, port: config.health.port }, metrics);
  metrics.setWorkerUp(true);

  // CORE has no leasing/drain subsystems yet (WRK-003 registers lease-stop
  // ahead of the drain step); the only stop step today is the health server.
  const shutdown = createShutdownHandler({
    steps: [{ name: "health-server", stop: () => health.close() }],
    logger,
    exit: (code) => deps.proc.exit(code),
    flush: () => logger.flush(),
  });

  deps.proc.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  deps.proc.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  return { ok: true, config, logger, metrics, health, shutdown };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  // The daemon blocks on the health server + signal handlers; it dispatches no
  // work in CORE. A rejected bootstrap (e.g. the health port is taken) exits
  // non-zero.
  bootstrapWorkerDaemon({ env: process.env, proc: process }).catch((err) => {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
