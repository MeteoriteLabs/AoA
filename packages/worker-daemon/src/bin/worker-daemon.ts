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

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION } from "@armyofagents/worker-protocol";

import { loadWorkerConfig, WORKER_VERSION, type WorkerConfig } from "../config/config.js";
import type { Env } from "../config/env.js";
import { createWorkerLogger, type Logger } from "../logging/logger.js";
import { createMetrics, type Metrics } from "../metrics/metrics.js";
import { startHealthServer, type HealthServerHandle } from "../health/health-server.js";
import type { HostStateRecord } from "../control/host-state.js";
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
import { createControlPlaneClient } from "../transport/client.js";
import {
  enrollOnce,
  EnrollmentAuthorityError,
  type EnrollmentOutcome,
} from "../enrollment/enroll-once.js";
import { readEnrollmentInput } from "../enrollment/enrollment-input.js";

/** The subset of `process` the entrypoint needs; injected for tests. */
export interface ProcessLike {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): void;
  exit(code: number): void;
}

export interface BootstrapDeps {
  readonly env: Env;
  readonly proc: ProcessLike;
  readonly createLogger?: typeof createWorkerLogger;
  /**
   * DSK-003 — write the host's log to this file instead of stdout.
   *
   * A desktop background host has nowhere for stdout to go. OPTIONAL and absent by
   * default, so every container keeps logging to stdout exactly as before.
   */
  readonly logFilePath?: string;
  /**
   * DSK-003 — publish the host state record once the health socket is listening.
   *
   * OPTIONAL, and absent by default. Every deployed compose file bootstraps without a
   * desktop host, so requiring this would be a live behaviour change to running
   * containers rather than a new capability. With no writer configured no record is
   * published, no instance nonce reaches the health server, and `/instance` stays 404 —
   * the surface is byte-identical to the pre-DSK-003 container.
   */
  readonly writeHostState?: (record: HostStateRecord) => Promise<void>;
  /** Remove the record on shutdown. Paired with `writeHostState`. */
  readonly removeHostState?: () => Promise<void>;
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

  /**
   * Seams for the enrolment block (D4, amended by A1).
   *
   * NOTE THE POLARITY BREAK from the seams above: `createLogger`/`startHealth`
   * exist so a test can OBSERVE. These exist so a test can enrol with NO network
   * and NO filesystem. `readFileText` is required because
   * `readEnrollmentInput(source, env, readFileText)` injects its reader — that is
   * what makes the `{kind:"path"}` arm testable — and the daemon must supply one.
   */
  readonly createClient?: typeof createControlPlaneClient;
  readonly readFileText?: (path: string) => string;
  readonly enrollOnceFn?: typeof enrollOnce;
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

  const logger = makeLogger({ filePath: deps.logFilePath });

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
  // DSK-003 — ONE nonce per boot, shared by the health server and the state record. If
  // the two ever disagreed, the stale-pid defence would reject the very host that wrote
  // the record — so they come from a single value here rather than being generated
  // independently at each site.
  const instanceId = deps.writeHostState ? randomUUID() : undefined;
  const health = await startHealth(
    { host: config.health.host, port: config.health.port, instanceId },
    metrics,
  );
  metrics.setWorkerUp(true);

  // AFTER the socket is listening, deliberately: the record advertises a port the
  // stale-pid defence probes, and publishing it earlier would advertise something that
  // cannot answer. `health.port` is the ACTUALLY bound port — the configured one may be
  // 0, and a record carrying 0 would send every control command nowhere.
  if (deps.writeHostState && instanceId) {
    await deps.writeHostState({
      instanceId,
      pid: process.pid,
      healthPort: health.port,
      startedAt: new Date().toISOString(),
      version: WORKER_VERSION,
    });
  }

  // DSK-001 (D4, amended by A1) — ENROL, once, here.
  //
  // AFTER the health server, deliberately: the compose healthcheck must be able
  // to answer while a device is enrolling (D14). The CONFIGURATION verdict is
  // separate and already happened above, pre-socket (I11) — splitting the two is
  // the only shape that satisfies both.
  //
  // Gated on the MODE rather than on the custody verdict, because the verdict is
  // a pure yes/no and deliberately carries neither a mode nor the stores (A1 §1).
  // `mounted_secret` therefore reaches none of this: every deployed compose file
  // uses that mode, and row 3 of the I11 truth table guarantees zero shipped-
  // container behaviour change.
  //
  // HONEST NOTE ON THIS CONDITION. Since `resolveCustody` now REFUSES
  // `mounted_secret` with any store injected (row 2, added because a mutation
  // showed nothing had ever tested that pair), the mode check here is redundant
  // by construction: this line is unreachable with `mounted_secret`. A mutation
  // removing it therefore SURVIVES, and it is recorded as a survivor rather than
  // dressed up as a proven guard. It stays because the property is guarded one
  // layer out, and if that gate is ever loosened, the absence of this line would
  // silently switch enrolment on for the mode every shipped container uses.
  if (config.keyStoreMode === "os_keychain" && deps.identityStore && deps.receiptStore) {
    const runEnrollment = deps.enrollOnceFn ?? enrollOnce;
    const makeClient = deps.createClient ?? createControlPlaneClient;
    const readFileText = deps.readFileText ?? ((path: string) => readFileSync(path, "utf8"));

    let outcome: EnrollmentOutcome;
    try {
      outcome = await runEnrollment({
        identityStore: deps.identityStore,
        receiptStore: deps.receiptStore,
        client: makeClient({ baseUrl: config.controlPlaneBaseUrl }),
        // A THUNK, not a resolved value: the credential materializes only when a
        // ticket is actually needed, so an already-enrolled device never brings
        // one into memory.
        readInput: () => readEnrollmentInput(config.enrollmentCodeSource, deps.env, readFileText),
        platform: process.platform,
        arch: process.arch,
      });
    } catch (err) {
      // The survivable branch is deliberately NARROW: only a network failure on
      // a device whose identity already existed. Widening it to "any enrolment
      // error" would silently regress I3 — a locked store would read as a
      // transient problem and the daemon would carry on without custody.
      //
      // And exiting on the narrow case would be its own bug: a device that is
      // fine would restart-loop, and a restart loop is what walks an operator
      // into `--reset-identity`, which on the same target IS the permanent
      // lockout. See amendment A1.
      if (err instanceof EnrollmentAuthorityError && !err.minted) {
        logger.error(
          { err, workerId: err.workerId, targetId: err.targetId },
          "worker-daemon could not obtain authority; running idle with the existing device identity",
        );
      } else {
        logger.error({ err }, "worker-daemon enrollment failed; refusing to start");
        // `.catch(() => {})` matters: a rejected close would otherwise escape
        // bootstrap into the entry guard's `console.error(err.stack)`, which
        // bypasses the redactor entirely (I13).
        await health.close().catch(() => {});
        deps.proc.exit(1);
        return { ok: false, config, logger, metrics };
      }
    }

    if (outcome!) {
      logger.info(
        {
          workerId: outcome.workerId,
          targetId: outcome.targetId,
          deviceGeneration: outcome.deviceGeneration,
          deviceThumbprint: outcome.deviceThumbprint,
        },
        outcome.skipped
          ? "worker-daemon already enrolled; skipping control-plane enrollment"
          : "worker-daemon enrolled",
      );
    }
  }

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
    steps: [
      ...leaseSteps,
      ...outboxSteps,
      { name: "health-server", stop: () => health.close() },
      // LAST, after health closes. While the host drains, `status` should still find the
      // record — the same reason `stop-host` is last in the uninstall plan. Once health is
      // closed a probe fails and `drain` refuses, which is the right answer for a host
      // already shutting down.
      ...(deps.removeHostState
        ? [{ name: "host-state", stop: () => deps.removeHostState!() }]
        : []),
    ],
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
