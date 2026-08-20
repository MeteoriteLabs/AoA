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
  createEventOutboxShutdownSteps,
  createLeaseLifecycleSteps,
  createShutdownHandler,
  type EventOutboxLifecycle,
  type LeasingLifecycle,
  type RenewalLifecycle,
  type ShutdownSignal,
} from "../lifecycle/shutdown.js";
import { createStartupSteps, runStartupSteps, type StartupReconciler } from "../lifecycle/startup-steps.js";
import {
  resolveCustody,
  type DeviceEnrollmentReceipt,
  type DeviceIdentityRecord,
  type DeviceRecordStore,
} from "../identity/device-identity-store.js";

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
  /**
   * The WRK-003 poll loop as a leasing lifecycle. When present, its
   * lease-stop-before-drain steps are registered AHEAD of the health-server stop
   * so a shutdown signal stops new leasing before draining in-flight work.
   *
   * It is NOT wired at runtime yet: starting a real loop needs the worker's
   * server-assigned self-model (registered target profile + verified provider
   * constraints), which the as-built JOB-002 enroll response does not deliver
   * (only a provider ref). Until that provisioning lands, the daemon composes the
   * loop's shutdown seam but dispatches no work (rollback = omit the loop).
   */
  readonly leasing?: LeasingLifecycle;
  /**
   * The WRK-005 lease-renewal driver as a renewal lifecycle. When present (with a
   * loop), its `renewal-stop` step is registered between `lease-stop` and
   * `lease-drain` so no renew fires during drain. In the wired composition the
   * driver DECORATES the supervisor seam (it is itself a `SupervisorSeam`), so the
   * poll loop hands ACKed leases to the driver, which renews them and — on lease
   * loss — closes the local fence-close proxy before escalating cleanup. Like the
   * loop it is inert until live dispatch is wired (E4-D12; rollback = omit it).
   */
  readonly renewal?: RenewalLifecycle;
  /**
   * The WRK-006 durable event outbox as a shutdown lifecycle. When present, its
   * ordered `event-outbox-stop → event-outbox-flush → event-outbox-close` steps are
   * registered after the lease steps and before the health-server stop, so on a
   * signal the daemon stops the drain, attempts a final flush, then closes the
   * store. Like the loop + renewal driver it is INERT until live dispatch is wired
   * (E4-D12; rollback = omit it) — WRK-006 does not rewire the composition root.
   */
  readonly eventOutbox?: EventOutboxLifecycle;
  /**
   * The WRK-007 startup reconciler as a one-shot boot seam. When present it runs
   * ONCE between the health server opening and signal registration — reconciling
   * locally-known sandboxes + outbox streams against inferred control-plane lease
   * authority (kill stale, abandon dead-lease streams, quarantine unknown output).
   * Like the loop / renewal / outbox seams it is INERT until live dispatch is wired
   * (E4-D12): the current default omits it, so the startup pass runs NOTHING and the
   * daemon still dispatches no work (rollback = omit it). WRK-007 does not rewire the
   * composition root to actually run at boot.
   */
  readonly reconciler?: StartupReconciler;
  /**
   * DSK-001 — OS-custody record stores, injected by the HOST.
   *
   * Typed structurally and never imported from the keystore package:
   * `scripts/check-worker-daemon-boundary.mjs` rejects a bare specifier the
   * moment a file under this `src` names one outside the two-dependency pin, so
   * the daemon declares the shape and the host supplies something satisfying it.
   * Absent in `mounted_secret` mode, required in `os_keychain` (I11).
   */
  readonly identityStore?: DeviceRecordStore<DeviceIdentityRecord>;
  readonly receiptStore?: DeviceRecordStore<DeviceEnrollmentReceipt>;
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

  // DSK-001 (I11) — CUSTODY BEFORE THE SOCKET.
  //
  // `keyStoreMode` has been parsed since WRK-002 and read only to be logged just
  // above; nothing constructed a store from it. So a deployment configured for
  // `os_keychain` with no store injected would bind its health listener and
  // report itself UP, discovering it had no custody only when something tried to
  // enrol — by which point an operator has been told the worker is healthy.
  //
  // The decision is a pure function so it is provable without a socket, and an
  // unknown mode fails closed rather than degrading to a weaker custody model.
  const custody = resolveCustody(config.keyStoreMode, deps.identityStore, deps.receiptStore);
  if (custody.kind === "refuse") {
    logger.error({ reason: custody.reason }, "worker-daemon custody unavailable; refusing to start");
    deps.proc.exit(1);
    return { ok: false, config, logger };
  }

  const metrics = makeMetrics();
  const health = await startHealth({ host: config.health.host, port: config.health.port }, metrics);
  metrics.setWorkerUp(true);

  // WRK-007: the one-shot startup reconciliation pass runs ONCE here — after the
  // health server is up, BEFORE signal registration. Gated on presence: with no
  // reconciler wired (the current default) the step list is empty and nothing runs
  // (inert; E4-D12), exactly how the lease/renewal/outbox seams degrade to [].
  const startupSteps = deps.reconciler ? createStartupSteps(deps.reconciler) : [];
  await runStartupSteps(startupSteps, logger);

  // WRK-003 registers lease-stop AHEAD of drain, both ahead of the health-server
  // stop; WRK-005 inserts renewal-stop between them when a renewal driver is
  // composed. When no loop is wired (the current default — see `leasing` above),
  // the only stop step is the health server.
  const leaseSteps = deps.leasing ? createLeaseLifecycleSteps(deps.leasing, deps.renewal) : [];
  const outboxSteps = deps.eventOutbox ? createEventOutboxShutdownSteps(deps.eventOutbox) : [];
  const shutdown = createShutdownHandler({
    steps: [...leaseSteps, ...outboxSteps, { name: "health-server", stop: () => health.close() }],
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
