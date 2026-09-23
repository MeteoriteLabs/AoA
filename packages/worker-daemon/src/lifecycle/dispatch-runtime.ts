// WRK-008 slice 2b — the dispatch runtime: compose the poll loop, supervisor, lease-renewal
// driver and durable event outbox from a provisioned self-model + a live session lifecycle.
//
// This is the FIRST production caller of `createPollLoop` and `createSupervisor` in the
// programme's history. It runs ONLY inside the `compose: true` branch of the boot (Step 7),
// i.e. behind the default-OFF flag with a provider injected, a device identity, an outbox
// path, a live session and an admin-set placement profile.
//
// ★ ORDER IS LOAD-BEARING, and four edges are not obvious:
//   1. The outbox store opens FIRST and is RECOVERED (uploading→pending) before anything can
//      emit into it. Recovering after the supervisor exists would race a fresh run's rows.
//   2. The poll loop's `supervisor` seam is the RENEWAL DRIVER, not the supervisor. The driver
//      decorates the real supervisor; wiring the raw supervisor typechecks and silently never
//      renews a lease.
//   3. The SAME `DurableWorkerEventSink` goes to BOTH the supervisor AND the driver. The
//      driver's `eventSink` is optional and defaults to NOOP_SINK, so omitting it silently
//      drops the post-close `network_denied` evidence stream — a fail-open (§4.1.1).
//   4. The KEK derives from the DEVICE KEY, so a re-enrolled device cannot open a prior
//      device's rows (they quarantine, fail closed).
//   5. WRK-013 — `start()` runs the STARTUP RECONCILE to completion BEFORE the drain loop or
//      the poll loop starts. The reconcile probes every lease the durable lease-candidate store
//      says this daemon held when it last stopped, FENCES the live ones (F5: the probe's
//      renewal is their last), and only then may the poll loop lease anything new.

import { randomUUID } from "node:crypto";

import type { LeaseOfferV1 } from "@armyofagents/worker-protocol";

import {
  measureCapacity,
  type CapacityProbes,
  type CapacityReservation,
  type WorkerSelfModel,
} from "../poll/capacity.js";
import {
  createPollLoop,
  createSessionProvider,
  type LeaseHandoff,
  type PollLoopController,
  type SessionProvider,
  type SupervisorSeam,
} from "../poll/poll-loop.js";
import { ConcurrencyLimiter } from "../poll/concurrency.js";
import { createHostCapacityProbes, defaultHostProbeReaders } from "../poll/host-probes.js";
import { createSupervisor } from "../supervisor/supervisor.js";
import { createRunCanaryCoordinator } from "../supervisor/run-canaries.js";
import { createUsageObserver } from "../supervisor/usage-observer.js";
import { resolveRunOpDeadlineMs } from "./run-op-deadline.js";
import { createRedeemer, synthesiseRunSecrets } from "../lease/secret-redemption.js";
import { createStagedInputResolver } from "../lease/staged-input.js";
import { createArtifactExportSequencer } from "../lease/artifact-export.js";
import { createExportRequestProducer } from "../lease/export-request-producer.js";
import { createLeaseRenewalDriver, createRealRenewalSchedule } from "../lease/lease-renewal.js";
import { openEventOutboxStore, type DurableEventStore } from "../events/event-outbox-store.js";
import { DurableWorkerEventSink } from "../events/durable-event-sink.js";
import { createEventOutboxDrain } from "../events/event-outbox-drain.js";
import { deriveKekFromDeviceKey } from "../events/event-outbox-kek.js";
import type { SandboxProvider } from "../supervisor/provider.js";
import type { OwnedLabelsCapabilityLike } from "../lease/owned-labels-capability.js";
import type { DeviceKey } from "../identity/device-key.js";
import type { SessionStore } from "../identity/session.js";
import type { ControlPlaneClient } from "../transport/client.js";
import type { BackoffConfig } from "../poll/backoff.js";
import type { Logger } from "../logging/logger.js";
import type { Metrics } from "../metrics/metrics.js";
import {
  LEASE_CANDIDATE_REASONS,
  openLeaseCandidateStore,
  openLeaseCandidateStoreFailClosed,
  type LeaseCandidateStore,
  type LeaseCandidateWriter,
} from "../lease/lease-candidate-store.js";
import {
  createStartupReconciler,
  SANDBOX_PASS_SKIP_REASONS,
  type StartupReconcilePass,
  type StartupReconcilerDeps,
} from "../supervisor/startup-reconcile.js";
import type { OwnershipSelector, ProviderOpContext } from "../supervisor/provider.js";
import { createStartupSteps, runStartupSteps, type StartupLogger } from "./startup-steps.js";
import type {
  EventOutboxLifecycle,
  LeasingLifecycle,
  RenewalLifecycle,
} from "./shutdown.js";

const NO_RESERVATION: CapacityReservation = { cpuMillis: 0, memoryMiB: 0, diskMiB: 0 };

/** The per-op deadline the startup SANDBOX pass hands the provider in its op context (list /
 * cleanup). A duration, like the supervisor's `opDeadlineMs`; the provider enforces it. */
const STARTUP_RECONCILE_OP_DEADLINE_MS = 30_000;

const NOOP_STARTUP_LOGGER: StartupLogger = { info: () => {}, error: () => {} };

/** WRK-013 — the writer a configured-but-unopenable store degrades to: every write FAILS, so the
 * poll loop never ACKs a lease it could not record (write-before-ACK stays closed). */
const UNAVAILABLE_CANDIDATE_WRITER: LeaseCandidateWriter = {
  put: () => {
    throw new Error(`${LEASE_CANDIDATE_REASONS.unavailable}: no lease-candidate store could be opened`);
  },
  remove: () => {},
};

export interface ComposeDispatchRuntimeDeps {
  /**
   * The DESKTOP/in-process provider. OPTIONAL since DEP-011 Slice 2a: a CONTAINER worker instead
   * injects `makeRunProvider` (a per-run networked driver factory). EXACTLY one of
   * `provider`/`makeRunProvider` is set — the supervisor fail-fasts on both, and the boot's
   * `decideDispatchComposition`/`shouldComposeSession` gate `!provider && !makeRunProvider ⇒
   * no_provider`.
   */
  readonly provider?: SandboxProvider;
  /** DEP-011 Slice 2a — the per-run networked provider FACTORY (a TYPE here; the impl comes from the
   * outside composition root, Slice 2b). Passed through to the supervisor, which builds a per-run
   * driver over the run's minted capability AFTER redemption. */
  readonly makeRunProvider?: (input: { handoff: LeaseHandoff; capability?: OwnedLabelsCapabilityLike }) => SandboxProvider;
  /** The PROVISIONED self-model (matchable): its `report` is the provisioned hello. */
  readonly self: WorkerSelfModel;
  readonly key: DeviceKey;
  /** Sprint 2.5's session store (this slice threads it in; it does NOT construct one). */
  readonly store: SessionStore;
  readonly client: ControlPlaneClient;
  readonly eventOutboxPath: string;
  /**
   * WRK-013 — the durable lease-candidate store (`AOA_WORKER_LEASE_CANDIDATE_PATH`, defaulted
   * beside the event outbox by the config). ABSENT = this daemon records no candidates, and the
   * startup reconcile says so by name (`lease_candidate_store_not_configured`) — never a silent `[]`.
   */
  readonly leaseCandidatePath?: string;
  readonly concurrency: { readonly batch: number; readonly browser: number; readonly service: number };
  readonly backoff: BackoffConfig;
  /** Directory the disk-free probe reads (the worker's working area). */
  readonly workDir: string;
  readonly logger?: Logger;
  readonly metrics?: Metrics;
  /** DEP-017 — `AOA_WORKER_ENV_PROBE=1`: compose the live env-absence probe into the supervisor.
   * Default off; only the DEP-015 shipped-boot overlay sets it. */
  readonly envProbe?: boolean;
  // --- test seams: default to the real factories -------------------------------------------
  /** The host capacity probes; defaults to the real node:os/node:fs readers over `workDir`. */
  readonly probes?: CapacityProbes;
  readonly openStore?: typeof openEventOutboxStore;
  readonly makeSink?: (deps: { store: DurableEventStore; kek: Buffer }) => DurableWorkerEventSink;
  readonly makeDrain?: typeof createEventOutboxDrain;
  readonly makeSupervisor?: typeof createSupervisor;
  readonly makeDriver?: typeof createLeaseRenewalDriver;
  readonly makePollLoop?: typeof createPollLoop;
  readonly makeSchedule?: typeof createRealRenewalSchedule;
  readonly openLeaseCandidates?: typeof openLeaseCandidateStore;
  readonly makeStartupReconciler?: (deps: StartupReconcilerDeps) => StartupReconcilePass;
}

export interface DispatchRuntime {
  readonly leasing: LeasingLifecycle;
  readonly renewal: RenewalLifecycle;
  readonly eventOutbox: EventOutboxLifecycle;
  readonly self: WorkerSelfModel;
  /** The measured capacity closure — reads the limiter LIVE and clamps to the provider ceiling. */
  readonly measure: () => ReturnType<typeof measureCapacity>;
  /** The seam the poll loop leases through — the renewal DRIVER (a SupervisorSeam), not the raw supervisor. */
  readonly loopSupervisorSeam: SupervisorSeam;
  /** The concurrency limiter (backpressure); exposed so `measure()`'s LIVE read is observable. */
  readonly limiter: ConcurrencyLimiter;
  /**
   * WRK-013 — run the startup reconcile to COMPLETION, then start the durable drain loop and the
   * poll loop (fire-and-forget: a terminal stop does not exit). Resolves once polling is armed —
   * or without arming it if a shutdown began during the reconcile. Never rejects.
   */
  start(): Promise<void>;
  readonly pollLoop: PollLoopController;
}

export async function composeDispatchRuntime(deps: ComposeDispatchRuntimeDeps): Promise<DispatchRuntime> {
  const openStore = deps.openStore ?? openEventOutboxStore;
  const makeSink = deps.makeSink ?? ((d) => new DurableWorkerEventSink(d));
  const makeDrain = deps.makeDrain ?? createEventOutboxDrain;
  const makeSupervisor = deps.makeSupervisor ?? createSupervisor;
  const makeDriver = deps.makeDriver ?? createLeaseRenewalDriver;
  const makePollLoop = deps.makePollLoop ?? createPollLoop;
  const makeSchedule = deps.makeSchedule ?? createRealRenewalSchedule;

  const session: SessionProvider = createSessionProvider(deps.store);
  const identity = {
    targetId: deps.self.report.targetId,
    deviceGeneration: deps.self.report.deviceGeneration,
  };

  // (1) Store opens FIRST. (4) KEK from the DEVICE KEY. (3) ONE sink instance for both consumers.
  const store = await openStore({ path: deps.eventOutboxPath });
  const kek = deriveKekFromDeviceKey(deps.key);
  const eventSink = makeSink({ store, kek });
  const drain = makeDrain({ store, client: deps.client, session, key: deps.key, kek, logger: deps.logger });

  // (1) RECOVER before the supervisor can emit into the store.
  drain.recover();

  // WRK-013 — the durable lease-candidate store. An unreadable file FAILS CLOSED without
  // blocking boot: it is set aside, a fresh store records this lifetime's ACKs, and the fault
  // is carried to `start()`, whose reconcile then probes (and so renews) NOTHING.
  let candidateStore: LeaseCandidateStore | null = null;
  let candidateFault: unknown = null;
  let candidateSetAside: string | null = null;
  if (deps.leaseCandidatePath !== undefined) {
    const opened = await openLeaseCandidateStoreFailClosed({
      path: deps.leaseCandidatePath,
      open: deps.openLeaseCandidates ?? openLeaseCandidateStore,
    });
    candidateStore = opened.store;
    candidateFault = opened.unreadable;
    candidateSetAside = opened.setAsidePath;
    if (candidateStore === null) {
      deps.logger?.error(
        { reason: LEASE_CANDIDATE_REASONS.unavailable, setAsidePath: candidateSetAside },
        "worker: no lease-candidate store could be opened; this daemon will poll but ACK NO lease until it can record one",
      );
    }
  }

  // DAT-008 slice 5 — the per-lease canary coordinator, shared by the supervisor and the driver's
  // fence-close proxy so ONE redemption seeds BOTH event streams (per-run, before create).
  const canaryCoordinator = createRunCanaryCoordinator();

  // DAT-008 slice 5 — per-run secret materialisation: redeem the envelope's `env`/`sandbox_local_only`
  // handles via the LOCAL resolve route (device proof + the live session), synthesise the sandbox
  // env, and return the redeemed values to seed as canaries. Fails CLOSED inside the supervisor.
  const materializeRunSecrets = async (
    handoff: LeaseHandoff,
  ): Promise<{ env: Record<string, string>; canaries: readonly string[]; capability?: OwnedLabelsCapabilityLike }> => {
    const workerSession = await session.get();
    const redeem = createRedeemer({
      client: deps.client,
      key: deps.key,
      session: workerSession,
      fence: {
        workerId: String(handoff.offer.workerId),
        jobId: String(handoff.offer.job.jobId),
        attempt: handoff.offer.job.attempt,
        leaseId: handoff.leaseId,
        fenceToken: String(handoff.fenceToken),
      },
    });
    return synthesiseRunSecrets(handoff.offer.job.secretHandles ?? [], redeem);
  };

  // CLI-008 Unit B — per-run staged input: read the control plane's pointer off the frozen
  // envelope and mint ONE short-lived download grant per file. Grants out, never bytes; the
  // provider redeems them. A run whose envelope carries no pointer resolves to `[]` and the
  // lifecycle is byte-identical to before, which is what keeps staging optional. Fails CLOSED
  // inside the supervisor.
  const resolveStagedFiles = createStagedInputResolver({
    client: deps.client,
    key: deps.key,
    session: () => session.get(),
  });

  // DAT-009-3d (E5-D07) — the artifact-export SEQUENCER: digest → upload grant → export → commit,
  // from the same client, device key and live session as the staged-input resolver above. It is
  // bound to no run here: the supervisor hands it THIS run's handoff and a per-run exporter over
  // THIS run's sandbox, so every tenant identity it writes comes from the lease (F10).
  //
  // ★ CLI-012 — THE PRODUCER IS NOW COMPOSED, and this one line is what makes the whole export
  // sequence reachable in production. (Superseded text: "★ NO PRODUCER is composed
  // (`resolveExportArtifacts` is CLI-012's). The supervisor opens an export window only when
  // both are present, so until CLI-012 this sequencer is built at boot and run by nothing —
  // which is why `E5-2` stays `unwired` (E5-D07 ruling 4). A `[]` stub producer here would be
  // the vacuous clause E5-D03 forbids.") The supervisor opens the window only when BOTH are
  // present, so this is the commit that promotes `E5-2-fenced-object-commit-worker-half` to
  // `wired`.
  //
  // ★ IT HOLDS NO SANDBOX. `enumerate` is supplied PER RUN on `resolveExportArtifacts`'s input,
  // bound to that run's sandbox and its `EffectAuthority`; the `enumerate` below is the
  // construction-time fallback and is never the one production uses. It refuses rather than
  // returning `[]`, because a producer that answered "no output" when it had no way to look
  // would be a check that evaluates nothing (`E5-D03`).
  const exportArtifacts = createArtifactExportSequencer({
    client: deps.client,
    key: deps.key,
    session: () => session.get(),
  });
  const resolveExportArtifacts = createExportRequestProducer({
    enumerate: () => Promise.reject(new Error("export producer: no per-run sandbox view was supplied")),
    // ★ `E7-D08` — `other`, decided by CLI-012 and recorded in the epic's `decisions.md`. It is
    // deliberately NOT `workspace_patch`: that kind is what `countProducedOutputs` arm 1 filters
    // on, and an agent-written file under the output root is not a workspace patch. Declaring it
    // one would move a capability counter this ticket did not earn.
    kind: "other",
    retention: "run",
    // ★ REFUSALS ARE VISIBLE, and PATH-FREE. Without this, a run whose only deliverable was a
    // symlink or an oversized file would export nothing and say nothing — indistinguishable from a
    // run that wrote nothing at all, which is the exact ambiguity `E5-D07`'s per-file
    // classification exists to remove. `OutputRefusal` carries ONE closed snake_case token and no
    // path, so this line cannot carry a tenant-authored string; the port's own observability rule
    // ("no path, byte, grant URL or file content in any log line or metric label") is satisfied by
    // the TYPE, not by discipline at the call site. No new `emitOp` label is minted — that
    // vocabulary stays closed to `digest_artifact` / `export_artifact`.
    onRefused: (refusal) => {
      deps.logger?.warn({ reason: refusal.reason }, "worker: output file refused before export");
    },
  });

  // `redactionCanaries: []` is the construction-time PREFIX; the run's real canaries are seeded
  // PER-RUN into the coordinator's per-lease array (below), never at construction — so no
  // construction-time secret exists and a forgotten seeding cannot fail open. The redeemed
  // provider key transits the supervisor transiently, which is exactly what the per-run canaries
  // scrub.
  //
  // WRK-018 — `observeRun` is COMPOSED: the usage producer. (Superseded text: "observeRun stays
  // absent (no sandbox stdout/stderr rides the stream yet)".) Its presence is what opens the
  // optional stdout stream channel on `execute`; the supervisor scrubs every byte with the run's
  // own canaries before the observer sees it (H-04), and the observer emits usage ONLY — four
  // integers, never text. Rollback = drop this one line: the channel is inert without a consumer.
  // DEP-011 Slice 2a — pass EXACTLY the injected provider path through to the supervisor: the
  // DESKTOP `provider` OR the container `makeRunProvider` (the supervisor fail-fasts if both, and
  // the boot gate refuses if neither). `materializeRunSecrets` is always present here, so the
  // makeRunProvider⟹materializeRunSecrets pairing (supervisor fail-fast F5) is satisfied.
  const supervisor = makeSupervisor({
    provider: deps.provider,
    makeRunProvider: deps.makeRunProvider,
    identity,
    eventSink,
    redactionCanaries: [],
    materializeRunSecrets,
    resolveStagedFiles,
    exportArtifacts,
    resolveExportArtifacts,
    canaryCoordinator,
    observeRun: createUsageObserver({ metrics: deps.metrics }),
    // ★ H1 — the run's OWN budget, from `workload.maxRuntimeSeconds`. Before this the
    // supervisor's 60 s default stood for every run, and that one number is simultaneously
    // the execute race, the E2B sandbox TTL, and the E2B command timeout — so every task
    // needing more than a minute was killed and terminalized `failed` while its declared
    // budget was ignored. `resolveRunOpDeadlineMs` keeps the value inside the owned-labels
    // capability window (which is never re-minted on renewal): running past it would leave a
    // BILLABLE sandbox the worker can no longer tear down, recorded `orphaned`.
    opDeadlineMs: resolveRunOpDeadlineMs,
    // DEP-017 — the live env-absence probe, composed ONLY when the worker was booted with it.
    // Absent, the supervisor is byte-identical (no probe execute, no extra event).
    ...(deps.envProbe ? { envProbe: {} } : {}),
    logger: deps.logger,
    metrics: deps.metrics,
  });

  // (3) SAME eventSink. `schedule` is REQUIRED and has no default.
  const driver = makeDriver({
    client: deps.client,
    session,
    key: deps.key,
    identity,
    supervisor,
    schedule: makeSchedule(),
    eventSink,
    canaryCoordinator,
    logger: deps.logger,
    metrics: deps.metrics,
    // JOB-015 slice (f) — `drain` becomes a DELIVERED command here, and this is the
    // line that makes it one. Being in the renew payload is not delivery; a worker-side
    // handler applying it is.
    //
    // ★ A THUNK, and it has to be. `pollLoop` is composed BELOW this call (the driver IS
    // its supervisor seam), so `stopLeasing` does not exist yet. Passing a value would
    // capture `undefined` and every delivered drain would be a silent no-op — a
    // composition-root port that is a NO-OP for everything built earlier. The thunk is
    // only ever invoked while a lease is being renewed, which is necessarily after
    // `pollLoop` is assigned.
    //
    // ★★ `stopLeasing()` is the EXISTING drain semantic, not a second copy of it: the
    // poll loop stops taking offers and `drainInFlight()` at exit finishes the attempt
    // already running. A `drain` command therefore does exactly what an operator drain
    // and a rolling shutdown do, through the same code.
    //
    // `result` is deliberately ABSENT. Nothing in the daemon applies a
    // `product_approval_result` / `runtime_decision_result` yet — E8/BRW-004 owns the
    // browser-side applier — so those kinds are counted `control_command{outcome=
    // "unhandled"}` and stay pending for redelivery. That is the honest state; a stub
    // that ACKed them would clear the queue and hide the gap.
    controlHandlers: () => ({
      drain: () => {
        deps.logger?.info({ reason: "control_command" }, "worker: drain requested by the control plane");
        pollLoop.stopLeasing();
      },
    }),
  });

  const limiter = new ConcurrencyLimiter({
    batch: deps.concurrency.batch,
    // config uses `browser`; the limiter's workload class is `browser_session`.
    browser_session: deps.concurrency.browser,
    service: deps.concurrency.service,
  });
  const probes = deps.probes ?? createHostCapacityProbes(defaultHostProbeReaders(deps.workDir));
  const rc = deps.self.verifiedProviderConstraints.resourceCeiling;
  // Clamp to the SERVER-owned provider ceiling: a worker advertising above it is rejected by the
  // frozen matcher, so composing without the clamp produces a worker that polls forever unmatched.
  const measure = (): ReturnType<typeof measureCapacity> =>
    measureCapacity({
      probes,
      reserved: NO_RESERVATION,
      slots: limiter.snapshot(), // LIVE per call — the limiter's slot counts are the backpressure
      ceiling: { cpuMillis: rc.cpuMillis, memoryMiB: rc.memoryMiB, diskMiB: rc.diskMiB },
    });

  // (2) The poll loop leases through the DRIVER, not the raw supervisor.
  const pollLoop = makePollLoop({
    client: deps.client,
    self: deps.self,
    key: deps.key,
    session,
    limiter,
    measure,
    supervisor: driver,
    backoff: deps.backoff,
    metrics: deps.metrics,
    logger: deps.logger,
    // WRK-013 — write before the ACK, withdraw if it fails, prune when the handoff settles. ★ A
    // CONFIGURED path whose store could not be opened gets a writer that always fails, so every
    // ACK is refused (Codex P2, PR #553) rather than silently recording nothing.
    leaseCandidates:
      candidateStore ?? (deps.leaseCandidatePath !== undefined ? UNAVAILABLE_CANDIDATE_WRITER : undefined),
  });

  /**
   * WRK-013 — read the candidates this daemon must account for. NEVER throws and never returns a
   * silent `[]`: every empty answer carries a named reason. What an unreadable store closes is
   * RENEWAL — it yields no candidates, so the probe renews nothing it cannot account for.
   */
  /** Leases a PREVIOUS boot claimed and never pruned: accounted for, never probed again. */
  let carriedClaims: LeaseOfferV1[] = [];

  function readCandidates(): LeaseOfferV1[] {
    if (deps.leaseCandidatePath === undefined) {
      deps.logger?.warn(
        { reason: LEASE_CANDIDATE_REASONS.notConfigured },
        "startup-reconcile: no lease-candidate store is configured; no held lease can be accounted for at restart",
      );
      return [];
    }
    if (candidateFault !== null || candidateStore === null) {
      deps.logger?.error(
        { reason: LEASE_CANDIDATE_REASONS.unreadable, err: candidateFault, setAsidePath: candidateSetAside, storeAvailable: candidateStore !== null },
        "startup-reconcile: the lease-candidate store is unreadable; NO lease it held is renewed — the control-plane reaper ends those attempts",
      );
      return [];
    }
    let entries: ReturnType<LeaseCandidateStore["listEntries"]>;
    try {
      entries = candidateStore.listEntries();
    } catch (err) {
      deps.logger?.error(
        { reason: LEASE_CANDIDATE_REASONS.unreadable, err },
        "startup-reconcile: a lease-candidate row is unreadable; NO lease the store held is renewed — the control-plane reaper ends those attempts",
      );
      try {
        // Report once: the same unaccountable rows are not re-read on every later boot.
        candidateStore.clear();
      } catch (clearErr) {
        deps.logger?.error({ err: clearErr }, "startup-reconcile: could not clear the unreadable lease-candidate rows");
      }
      return [];
    }
    // A row a PREVIOUS boot claimed and never pruned: that boot died between its claim and its
    // prune, and whether its probe was sent is unknowable. F5 allows the lease ONE renewal, so it is
    // NOT probed again — it is named, and pruned with this pass's candidates.
    carriedClaims = entries.filter((entry) => entry.claimed).map((entry) => entry.offer);
    for (const offer of carriedClaims) {
      deps.logger?.warn(
        {
          reason: LEASE_CANDIDATE_REASONS.claimedUnprobed,
          leaseId: String(offer.leaseId),
          jobId: String(offer.job.jobId),
          attempt: offer.job.attempt,
          organizationId: String(offer.job.organizationId),
        },
        "startup-reconcile: a previous boot claimed this lease and stopped before finishing; it is NOT probed again — the control-plane reaper ends the attempt",
      );
    }
    const candidates = entries.filter((entry) => !entry.claimed).map((entry) => entry.offer);
    if (candidates.length === 0) {
      if (carriedClaims.length === 0) {
        deps.logger?.info(
          { reason: LEASE_CANDIDATE_REASONS.empty },
          "startup-reconcile: the lease-candidate store is empty; this daemon held no lease when it last stopped",
        );
      }
      return [];
    }
    return candidates;
  }

  /**
   * WRK-013 — claim ONE candidate, immediately before its own probe (`beforeProbe`).
   *
   * ★ Not a batch, and that is the point (Codex P1, PR #553): claiming every candidate up front
   * means a crash while probing the FIRST one leaves the rest durably claimed though no request was
   * ever sent for them, and the next boot would skip their probes. Claimed one at a time, a crash
   * leaves every later candidate unclaimed, so the next boot probes it normally.
   *
   * The claim is durable BEFORE the request, so the probe's renewal is still the last this daemon
   * can issue for that lease (F5) even across a crash loop. A claim that fails means the lease
   * cannot be accounted for, so it is NOT probed and NOT renewed.
   */
  function claimForProbe(offer: LeaseOfferV1): boolean {
    if (candidateStore === null) return false;
    try {
      candidateStore.claim(String(offer.leaseId));
      return true;
    } catch (err) {
      deps.logger?.warn(
        { reason: LEASE_CANDIDATE_REASONS.writeFailed, leaseId: String(offer.leaseId), err },
        "startup-reconcile: could not claim a lease candidate; it is NOT probed and is left to the control-plane reaper",
      );
      return false;
    }
  }

  /** WRK-013 — the sandbox pass needs a PROCESS-level provider and an Organization-scoped
   * selector. Otherwise it is skipped under a named reason (F4 / platform-scoped target). */
  function sandboxPassDeps(): Pick<StartupReconcilerDeps, "provider" | "ownershipSelector" | "makeCtx" | "sandboxPassSkipReason"> {
    if (deps.provider === undefined) {
      // The container path: only a per-run factory exists, built from a capability that lapsed
      // with the previous process. No enumeration is possible here (F4, a named narrowing).
      return { sandboxPassSkipReason: SANDBOX_PASS_SKIP_REASONS.containerPathNoEnumeration };
    }
    const organizationId = deps.self.registeredTargetProfile.organizationId;
    if (organizationId === null) {
      return { sandboxPassSkipReason: SANDBOX_PASS_SKIP_REASONS.platformScopedTarget };
    }
    const ownershipSelector: OwnershipSelector = {
      organizationId: String(organizationId),
      targetId: String(identity.targetId),
      workerId: String(deps.self.report.workerId),
    };
    const makeCtx = (): ProviderOpContext => ({ deadlineMs: STARTUP_RECONCILE_OP_DEADLINE_MS, idempotencyKey: randomUUID() });
    return { provider: deps.provider, ownershipSelector, makeCtx };
  }

  async function reconcileAtStartup(): Promise<void> {
    const candidates = readCandidates();
    const reconciler = (deps.makeStartupReconciler ?? createStartupReconciler)({
      ...sandboxPassDeps(),
      client: deps.client,
      session,
      key: deps.key,
      identity,
      leaseCandidates: candidates,
      beforeProbe: claimForProbe,
      // F5 — every candidate this pass probes is FENCED by construction (nothing renews it again),
      // so a live-probed sandbox has no supervisor and no later pass: tear it down (Codex P1).
      fencedLeasesAreStale: true,
      outbox: { store, drain },
      metrics: deps.metrics,
      logger: deps.logger,
    });
    const result = await reconciler.run();
    // The reconcile COMPLETED. Prune every row it accounted for: the candidates whose probe was
    // actually ATTEMPTED, and any a previous boot left claimed. A candidate that was never probed is
    // left in the store for the next boot — either because its claim failed, or because the pass
    // could not obtain a session at all. A prune failure leaves a claimed row, which a later boot
    // names and prunes without probing.
    //
    // ★ A map ENTRY is not proof of a probe (Codex P2, PR #553). When `session.get()` throws,
    // `probeLeaseAuthority` marks EVERY candidate `unreachable` with `probeKind: "unprobed"` without
    // calling `beforeProbe` and without sending a request, so a presence-only filter would delete
    // rows this daemon never probed, never claimed and never renewed — a transient session failure
    // at boot would permanently lose exactly the state WRK-013 exists to keep. `"unprobed"` is
    // written at ONE site (`startup-reconcile.ts`, the no-session arm); every other entry carries
    // the renew attempt's own kind, so it is an exact discriminator.
    const probed = candidates.filter((offer) => {
      const entry = result.leaseProbes.get(String(offer.leaseId));
      return entry !== undefined && entry.probeKind !== "unprobed";
    });
    for (const offer of [...probed, ...carriedClaims]) {
      try {
        candidateStore?.remove(String(offer.leaseId));
      } catch (err) {
        deps.logger?.warn(
          { reason: LEASE_CANDIDATE_REASONS.writeFailed, leaseId: String(offer.leaseId), err },
          "startup-reconcile: could not prune a reconciled lease candidate; a later boot accounts for it without probing",
        );
      }
    }
    // Name every candidate's verdict, with the lease, attempt and Organization it belongs to.
    const byLease = new Map(candidates.map((offer) => [String(offer.leaseId), offer]));
    for (const [leaseId, probe] of result.leaseProbes) {
      const offer = byLease.get(leaseId);
      const fields = {
        leaseId,
        jobId: offer ? String(offer.job.jobId) : null,
        attempt: offer ? offer.job.attempt : null,
        organizationId: offer ? String(offer.job.organizationId) : null,
        probeKind: probe.probeKind,
      };
      if (probe.state === "live") {
        deps.logger?.info(
          { ...fields, reason: LEASE_CANDIDATE_REASONS.fenced },
          "startup-reconcile: lease FENCED (F5) — the probe's renewal was its last; the control-plane reaper ends the attempt",
        );
      } else if (probe.state === "dead") {
        deps.logger?.info(
          { ...fields, reason: LEASE_CANDIDATE_REASONS.ended },
          "startup-reconcile: lease already ended at the control plane; candidate pruned",
        );
      } else {
        deps.logger?.warn(
          { ...fields, reason: LEASE_CANDIDATE_REASONS.unreachable },
          "startup-reconcile: lease probe could not complete; nothing renewed — the control-plane reaper ends the attempt",
        );
      }
    }
  }

  let startRequested = false;
  let stopRequested = false;

  return {
    leasing: {
      stopLeasing: () => {
        stopRequested = true;
        pollLoop.stopLeasing();
      },
      drain: () => pollLoop.drain(),
    },
    renewal: { stop: () => driver.stop() },
    eventOutbox: {
      stopDrain: () => {
        stopRequested = true;
        drain.stop();
      },
      flush: () => drain.flush(),
      closeStore: () => {
        // Both durable local stores close here, last in the shutdown order.
        try {
          candidateStore?.close();
        } finally {
          store.close();
        }
      },
    },
    self: deps.self,
    measure,
    loopSupervisorSeam: driver,
    limiter,
    start: async () => {
      if (startRequested) return;
      startRequested = true;
      // (5) The reconcile COMPLETES first. `runStartupSteps` awaits it and swallows + logs a
      // failure, so a broken pass never blocks the daemon from polling (the reaper is the net).
      await runStartupSteps(createStartupSteps({ run: reconcileAtStartup }), deps.logger ?? NOOP_STARTUP_LOGGER);
      // A shutdown that began during the reconcile must not start a loop it already stopped.
      if (stopRequested) return;
      drain.start();
      // Fire-and-forget: a terminal poll-loop stop keeps the daemon UP serving health.
      void pollLoop.run();
    },
    pollLoop,
  };
}
