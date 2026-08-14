/**
 * Per-lease renewal driver + local fence-close wiring (WRK-005).
 *
 * The driver DECORATES the WRK-004 supervisor seam: the poll loop hands each ACKed
 * lease to the driver (`accept`), which captures `offer.expiresAt` at handoff
 * (currently discarded after ACK), schedules a renewal at `expiresAt − leadMs`, and
 * delegates to the real supervisor. `poll-loop.ts` is UNTOUCHED — the driver IS a
 * `SupervisorSeam`, so it is composed in place of the bare supervisor and WRK-003/
 * WRK-004 stay green.
 *
 * Each real renewal builds a frozen `lease_renew` operation under a FRESH
 * `idempotencyKey`, signs a device proof over `client.leaseRenewPath(leaseId)`, and
 * POSTs it (audience `worker_run`). A transient timeout retries with the SAME key
 * (idempotent_retry) and never busy-spins; a `401` recovers via `session.recover()`
 * under `MAX_CONSECUTIVE_RECOVERIES`; a `rejected`/`stale_fence`/`target_revoked`/
 * `attempt_terminal`, a renew whose deadline lapses past `expiresAt`, or a
 * clock-skewed `expiresAt` already in the past is a LEASE LOSS. A `renewed` with
 * `cancelRequested` is a server-initiated cooperative cancel.
 *
 * On loss the driver CLOSES the fence-close proxy FIRST (defense-in-depth: every
 * governed effect is then denied locally), then escalates through the existing
 * `Supervisor.onLeaseLost` so cleanup converges through the distinct monotonic
 * `CleanupAuthority`. The worker holds no authority — the server `isActiveFence` is
 * the real gate; renewal only re-asserts a revocable grant and never resurrects a
 * lost one.
 *
 * **Bounded by session (E4-F007):** a lease cannot outlive its session today
 * (10-min code route < 15-min session; poll/ack don't slide it). WRK-005 renewal is
 * therefore session-bounded — a session-terminal condition forces loss (→
 * re-enrollment + orphan-output quarantine), never a session extension. The
 * sustained/long-job fix is E3/JOB-002 (E4-F007).
 *
 * Runtime imports: relative modules + the frozen protocol on the wire — the E4-D01
 * boundary.
 */

import { randomUUID } from "node:crypto";

import {
  leaseRenewOperationRequestV1Schema,
  leaseRenewOperationResponseV1Schema,
  protocolErrorV1Schema,
  type LeaseOfferV1,
  type LeaseRenewOperationRequestV1,
} from "@armyofagents/worker-protocol";

import type { DeviceKey } from "../identity/device-key.js";
import { signDeviceProof } from "../identity/device-proof.js";
import type { WorkerSession } from "../enrollment/enroll.js";
import type { Logger } from "../logging/logger.js";
import {
  FENCE_CLOSE_METRIC,
  LEASE_LOSS_METRIC,
  LEASE_RENEW_METRIC,
  type Metrics,
} from "../metrics/metrics.js";
import {
  ControlPlaneTransportError,
  type ControlPlaneClient,
  type WorkerOperationHttpResponse,
} from "../transport/client.js";
import {
  SessionTerminalError,
  type LeaseHandoff,
  type OperationRandomness,
  type SessionProvider,
  type SupervisorSeam,
  type TransientLabel,
} from "../poll/poll-loop.js";
import type { EffectFence } from "../supervisor/effect-authority.js";
import type { EventDeliveryIdentity, WorkerEventSink } from "../supervisor/events.js";
import {
  FenceCloseProxy,
  type FenceCloseReason,
  type GovernedEffectAuthority,
} from "./fence-close-proxy.js";

// --- Single-operation renewal ------------------------------------------------

/** The classification of ONE renew round-trip (mirrors `AckAttempt`). */
export type RenewAttempt =
  | { readonly kind: "renewed"; readonly expiresAt: string; readonly cancelRequested: boolean; readonly cancelReason: string | null }
  | { readonly kind: "rejected"; readonly code: string }
  | { readonly kind: "terminal"; readonly reason: "unauthorized" | "target_revoked" }
  | { readonly kind: "transient"; readonly label: TransientLabel; readonly retryAfterMs: number | null }
  | { readonly kind: "protocol"; readonly label: "malformed"; readonly code: string };

export interface LeaseRenewRequestEnvelope {
  readonly request: LeaseRenewOperationRequestV1;
  readonly bytes: Buffer;
}

export interface BuildLeaseRenewRequestInput {
  readonly offer: LeaseOfferV1;
  readonly correlationId: string;
  readonly issuedAt: string;
  readonly nonce: string;
  readonly idempotencyKey: string;
  readonly observedAt: string;
}

/** Assemble + validate the lease-renew operation (audience `worker_run`); the body
 * echoes the leased identity and a fresh worker `observedAt`. The `leaseId` MUST
 * equal the URL param (by construction). */
export function buildLeaseRenewRequest(input: BuildLeaseRenewRequestInput): LeaseRenewRequestEnvelope {
  const request = leaseRenewOperationRequestV1Schema.parse({
    protocolVersion: 1,
    correlationId: input.correlationId,
    issuedAt: input.issuedAt,
    nonce: input.nonce,
    audience: "worker_run",
    idempotencyKey: input.idempotencyKey,
    body: {
      protocolVersion: 1,
      workerId: input.offer.workerId,
      jobId: input.offer.job.jobId,
      attempt: input.offer.job.attempt,
      leaseId: input.offer.leaseId,
      fenceToken: input.offer.fenceToken,
      observedAt: input.observedAt,
    },
  });
  return { request, bytes: Buffer.from(JSON.stringify(request), "utf8") };
}

function defaultProofId(): string {
  return `prf_${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}
function defaultNonce(): string {
  return randomUUID();
}

export interface RenewLeaseOnceDeps {
  readonly client: ControlPlaneClient;
  readonly session: WorkerSession;
  readonly offer: LeaseOfferV1;
  readonly key: DeviceKey;
  /** The idempotency key — CONTROLLED by the caller so a transient retry replays
   * the SAME key (idempotent_retry) and a new interval mints a fresh one. */
  readonly idempotencyKey: string;
  readonly now?: () => number;
  readonly newCorrelationId?: () => string;
  readonly newProofId?: () => string;
  readonly newNonce?: () => string;
}

/**
 * Perform ONE renew: build + sign (over `leaseRenewPath(leaseId)` + exact bytes) +
 * POST, then classify. A transport failure maps to a transient outcome (never
 * throws), exactly like `ackLease`.
 */
export async function renewLeaseOnce(deps: RenewLeaseOnceDeps): Promise<RenewAttempt> {
  const now = deps.now ?? (() => Date.now());
  const leaseId = deps.offer.leaseId;
  const correlationId = (deps.newCorrelationId ?? randomUUID)();
  const nonce = (deps.newNonce ?? defaultNonce)();
  const envelope = buildLeaseRenewRequest({
    offer: deps.offer,
    correlationId,
    issuedAt: new Date(now()).toISOString(),
    nonce,
    idempotencyKey: deps.idempotencyKey,
    observedAt: new Date(now()).toISOString(),
  });
  const proof = signDeviceProof({
    method: "POST",
    path: deps.client.leaseRenewPath(leaseId),
    rawBody: envelope.bytes,
    correlationId,
    issuedAt: new Date(now()).toISOString(),
    proofId: (deps.newProofId ?? defaultProofId)(),
    key: deps.key,
  });

  let response: WorkerOperationHttpResponse;
  try {
    response = await deps.client.leaseRenew(leaseId, {
      bytes: envelope.bytes,
      sessionToken: deps.session.token,
      proofHeaders: proof.headers,
      requestId: correlationId,
    });
  } catch (err) {
    if (err instanceof ControlPlaneTransportError) {
      if (err.kind === "timeout") return { kind: "transient", label: "timeout", retryAfterMs: null };
      if (err.kind === "network") return { kind: "transient", label: "socket_error", retryAfterMs: null };
      return { kind: "protocol", label: "malformed", code: "request_too_large" };
    }
    throw err;
  }
  return classifyRenewResponse(response);
}

function classifyRenewResponse(response: WorkerOperationHttpResponse): RenewAttempt {
  if (response.status === 200) {
    const parsed = leaseRenewOperationResponseV1Schema.safeParse(response.body);
    if (!parsed.success) return { kind: "protocol", label: "malformed", code: "malformed" };
    if (parsed.data.outcome === "renewed") {
      return {
        kind: "renewed",
        expiresAt: parsed.data.body.expiresAt,
        cancelRequested: parsed.data.body.cancelRequested,
        cancelReason: parsed.data.body.cancelReason,
      };
    }
    return { kind: "rejected", code: parsed.data.reason };
  }
  const err = protocolErrorV1Schema.safeParse(response.body);
  const code = err.success ? err.data.code : null;
  const retryAfterMs = err.success ? err.data.retryAfterMs : null;

  if (response.status === 401) return { kind: "terminal", reason: "unauthorized" };
  if (code === "target_revoked") return { kind: "terminal", reason: "target_revoked" };
  if (code === "throttled" || response.status === 429) return { kind: "transient", label: "throttled", retryAfterMs };
  if (code === "internal_unavailable" || response.status === 503) {
    return { kind: "transient", label: "internal_unavailable", retryAfterMs };
  }
  // malformed / stale_fence / attempt_terminal / other: a terminal lease loss.
  return { kind: "protocol", label: "malformed", code: code ?? `http_${response.status}` };
}

// --- Injectable timer schedule -----------------------------------------------

export interface RenewalTimer {
  readonly id: number;
}

/** The injectable timer surface the driver drives (tests substitute a fake clock).
 * `sleep` is the transient-retry wait; `setTimer`/`clearTimer` schedule renewals. */
export interface RenewalSchedule {
  now(): number;
  setTimer(fn: () => void | Promise<void>, delayMs: number): RenewalTimer;
  clearTimer(timer: RenewalTimer): void;
  sleep(ms: number): Promise<void>;
}

/** The default real-time schedule (node timers + `Date.now`). */
export function createRealRenewalSchedule(): RenewalSchedule {
  let seq = 0;
  const handles = new Map<number, ReturnType<typeof setTimeout>>();
  return {
    now: () => Date.now(),
    setTimer(fn, delayMs): RenewalTimer {
      const id = (seq += 1);
      handles.set(
        id,
        setTimeout(() => {
          handles.delete(id);
          void fn();
        }, Math.max(0, delayMs)),
      );
      return { id };
    },
    clearTimer(timer): void {
      const h = handles.get(timer.id);
      if (h !== undefined) {
        clearTimeout(h);
        handles.delete(timer.id);
      }
    },
    sleep(ms): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
    },
  };
}

// --- The renewal driver ------------------------------------------------------

/** The supervisor the driver decorates — the real WRK-004 `Supervisor` satisfies
 * this (it extends `SupervisorSeam` and exposes `cancel`/`onLeaseLost`). */
export interface RenewalSupervisor extends SupervisorSeam {
  cancel(leaseId: string, reason?: string): Promise<void> | void;
  onLeaseLost(leaseId: string): Promise<void> | void;
}

/** The worker's stable identity (bound once — not carried per handoff). */
export interface RenewalIdentity {
  readonly targetId: string;
  readonly deviceGeneration: number;
}

/** Renewal-timing tuning. `leadMs` is derived from the offered window unless
 * overridden; the timer fires `leadMs` BEFORE expiry, clamped so the delay stays
 * inside `[skewMargin, window]`. */
export interface RenewalTuning {
  readonly leadMs?: number;
  readonly leadFraction?: number;
  readonly leadMinMs?: number;
  readonly leadMaxMs?: number;
  readonly skewMarginMs?: number;
  readonly retryFloorMs?: number;
}

export interface LeaseRenewalDriverDeps extends OperationRandomness {
  readonly client: ControlPlaneClient;
  readonly session: SessionProvider;
  readonly key: DeviceKey;
  readonly identity: RenewalIdentity;
  readonly supervisor: RenewalSupervisor;
  readonly schedule: RenewalSchedule;
  readonly tuning?: RenewalTuning;
  readonly metrics?: Metrics;
  readonly logger?: Logger;
  readonly maxConsecutiveRecoveries?: number;
  /** The sink a post-close governed-egress denial emits `network_denied` into. */
  readonly eventSink?: WorkerEventSink;
  /** Factory for the per-lease fence-close proxy (tests inject a spy). */
  readonly makeFenceProxy?: (fence: EffectFence, identity: EventDeliveryIdentity) => GovernedEffectAuthority;
}

export interface LeaseRenewalDriver extends SupervisorSeam {
  accept(handoff: LeaseHandoff): Promise<void>;
  /** Stop all renewal timers (idempotent). Shutdown step `renewal-stop`. */
  stop(): void;
  /** Leases with a live (non-terminated) renewal. */
  activeRenewalCount(): number;
  /** The fence-close proxy bound to `leaseId` (governed effects route through it). */
  proxyFor(leaseId: string): GovernedEffectAuthority | undefined;
}

/** How the driver observed the lease liveness (drives both metrics). */
interface LossClassification {
  readonly loss: string; // `lease_loss{reason}` token
  readonly fence: FenceCloseReason; // `fence_close{reason}` on the proxy
}

interface LeaseState {
  readonly leaseId: string;
  readonly offer: LeaseOfferV1;
  readonly proxy: GovernedEffectAuthority;
  expiresAtMs: number;
  leadMs: number;
  timer: RenewalTimer | null;
  terminated: boolean;
  // The consecutive-401-recovery bound is PER-LEASE: the driver fans out into N
  // concurrent per-lease renewal loops sharing ONE SessionProvider, so a driver-global
  // counter would let a token rotation that 401s several leases at once corrupt each
  // other's cap (a healthy lease prematurely declared lost, or a stuck lease never capped).
  recoveries: number;
}

const NOOP_SINK: WorkerEventSink = { emit: () => {} };

export function createLeaseRenewalDriver(deps: LeaseRenewalDriverDeps): LeaseRenewalDriver {
  const schedule = deps.schedule;
  const tuning = deps.tuning ?? {};
  const leadFraction = tuning.leadFraction ?? 0.5;
  const leadMinMs = tuning.leadMinMs ?? 1_000;
  const leadMaxMs = tuning.leadMaxMs ?? 300_000;
  const skewMarginMs = tuning.skewMarginMs ?? 1_000;
  const retryFloorMs = tuning.retryFloorMs ?? 1_000;
  const maxConsecutiveRecoveries = deps.maxConsecutiveRecoveries ?? 3;
  const newIdempotencyKey = deps.newIdempotencyKey ?? randomUUID;

  const makeProxy =
    deps.makeFenceProxy ??
    ((fence: EffectFence, identity: EventDeliveryIdentity): GovernedEffectAuthority =>
      new FenceCloseProxy({
        fence,
        identity,
        eventSink: deps.eventSink ?? NOOP_SINK,
        metrics: deps.metrics,
      }));

  const leases = new Map<string, LeaseState>();
  let stopped = false;

  const emitRenew = (outcome: string): void => deps.metrics?.inc(LEASE_RENEW_METRIC, { outcome });
  const emitLoss = (reason: string): void => deps.metrics?.inc(LEASE_LOSS_METRIC, { reason });

  function computeLeadMs(expiresAtMs: number, nowMs: number): number {
    const window = Math.max(0, expiresAtMs - nowMs);
    let lead = tuning.leadMs ?? Math.round(window * leadFraction);
    // Keep the delay non-negative and at least the skew margin below expiry.
    const maxLead = Math.max(0, window - skewMarginMs);
    if (lead > maxLead) lead = maxLead;
    if (lead > leadMaxMs) lead = leadMaxMs;
    if (lead < leadMinMs && leadMinMs <= maxLead) lead = leadMinMs;
    if (lead < 0) lead = 0;
    return lead;
  }

  function reschedule(state: LeaseState): void {
    if (stopped || state.terminated) return;
    if (state.timer !== null) {
      schedule.clearTimer(state.timer);
      state.timer = null;
    }
    const fireAt = state.expiresAtMs - state.leadMs;
    const delay = Math.max(0, fireAt - schedule.now());
    state.timer = schedule.setTimer(() => driveRenewal(state), delay);
  }

  function clearTimer(state: LeaseState): void {
    if (state.timer !== null) {
      schedule.clearTimer(state.timer);
      state.timer = null;
    }
  }

  async function declareLoss(state: LeaseState, cls: LossClassification): Promise<void> {
    if (state.terminated) return;
    state.terminated = true;
    clearTimer(state);
    // Close the fence FIRST (defense in depth), THEN escalate cleanup.
    state.proxy.close(cls.fence);
    emitLoss(cls.loss);
    deps.logger?.info({ leaseId: state.leaseId, reason: cls.loss }, "lease-renewal: lease loss");
    await Promise.resolve(deps.supervisor.onLeaseLost(state.leaseId));
  }

  async function cooperativeCancel(state: LeaseState, reason: string): Promise<void> {
    if (state.terminated) return;
    state.terminated = true;
    clearTimer(state);
    state.proxy.close("cancel_requested");
    deps.logger?.info({ leaseId: state.leaseId, reason: "cancel_requested" }, "lease-renewal: server-ordered cancel");
    await Promise.resolve(deps.supervisor.cancel(state.leaseId, reason));
  }

  function completeLease(state: LeaseState): void {
    if (!state.terminated) {
      state.terminated = true;
      clearTimer(state);
      // Normal completion: the fence is done — close it terminally.
      state.proxy.close("completed");
    }
    leases.delete(state.leaseId);
  }

  /** Recover the session after a renew 401. Returns `ok` to retry the SAME key,
   * `capped` when the recover spin bound trips, or `terminal` when re-enrollment
   * is required (or recovery is otherwise impossible). */
  async function tryRecover(state: LeaseState): Promise<"ok" | "capped" | "terminal"> {
    try {
      await deps.session.recover();
    } catch (err) {
      if (err instanceof SessionTerminalError) return "terminal";
      return "terminal"; // an unrecoverable renew — fail closed to loss
    }
    state.recoveries += 1;
    if (state.recoveries >= maxConsecutiveRecoveries) return "capped";
    return "ok";
  }

  async function driveRenewal(state: LeaseState): Promise<void> {
    // The renewal timer is fire-and-forget (`void fn()`), so an UNEXPECTED throw from the
    // renew flow (e.g. a mid-body-stream network error surfaced by `response.text()`, a
    // device-proof signing failure, or a schema parse error) would otherwise become an
    // unhandled rejection: the lease would be neither renewed nor declared lost, leaving the
    // fence-close proxy OPEN (defense-in-depth defeated) and the supervisor un-escalated.
    // Fail closed — any unclassified failure is treated as lease loss.
    try {
      await driveRenewalInner(state);
    } catch (err) {
      deps.logger?.error(
        { leaseId: state.leaseId, err },
        "lease-renewal: unexpected renewal failure; declaring lease loss",
      );
      if (!state.terminated) {
        await declareLoss(state, { loss: "reenrollment_required", fence: "lease_lost" }).catch(
          (lossErr) =>
            deps.logger?.error(
              { leaseId: state.leaseId, err: lossErr },
              "lease-renewal: declareLoss failed after unexpected renewal failure",
            ),
        );
      }
    }
  }

  async function driveRenewalInner(state: LeaseState): Promise<void> {
    if (stopped || state.terminated) return;
    // Pre-POST monotonic expiry check: a late timer (sleep/resume) never trusts a
    // later renew — the worker's `observedAt` cannot authorize expiry.
    if (schedule.now() >= state.expiresAtMs) {
      await declareLoss(state, { loss: "deadline_lapse", fence: "deadline_lapse" });
      return;
    }
    // ONE fresh idempotency key per REAL renewal interval; transient retries reuse
    // it so a replay never double-extends.
    const idempotencyKey = newIdempotencyKey();

    while (!stopped && !state.terminated) {
      let session: WorkerSession;
      try {
        session = await deps.session.get();
      } catch (err) {
        if (err instanceof SessionTerminalError) {
          await declareLoss(state, { loss: "reenrollment_required", fence: "lease_lost" });
          return;
        }
        // A transient session error → fail closed to loss (a lease we cannot
        // renew is lost; the supervisor cleanup path reclaims it).
        await declareLoss(state, { loss: "reenrollment_required", fence: "lease_lost" });
        return;
      }
      if (state.terminated) return;

      const attempt = await renewLeaseOnce({
        client: deps.client,
        session,
        offer: state.offer,
        key: deps.key,
        idempotencyKey,
        now: deps.now,
        newCorrelationId: deps.newCorrelationId,
        newProofId: deps.newProofId,
        newNonce: deps.newNonce,
      });
      if (state.terminated) return;

      if (attempt.kind === "renewed") {
        emitRenew("renewed");
        const newExpiryMs = Date.parse(attempt.expiresAt);
        if (!Number.isFinite(newExpiryMs) || newExpiryMs <= schedule.now()) {
          // Clock skew: the server's fresh expiry is already in the past.
          await declareLoss(state, { loss: "clock_skew", fence: "clock_skew" });
          return;
        }
        state.expiresAtMs = newExpiryMs;
        state.leadMs = computeLeadMs(state.expiresAtMs, schedule.now());
        state.recoveries = 0;
        if (attempt.cancelRequested) {
          emitRenew("cancel_requested");
          await cooperativeCancel(state, attempt.cancelReason ?? "cancel_requested");
          return;
        }
        reschedule(state);
        return;
      }
      if (attempt.kind === "rejected" || attempt.kind === "protocol") {
        emitRenew("rejected");
        await declareLoss(state, { loss: "rejected", fence: "lease_lost" });
        return;
      }
      if (attempt.kind === "terminal") {
        if (attempt.reason === "target_revoked") {
          emitRenew("target_revoked");
          await declareLoss(state, { loss: "target_revoked", fence: "lease_lost" });
          return;
        }
        // unauthorized → recover under the cap; retry the SAME key on success.
        emitRenew("unauthorized");
        const recovery = await tryRecover(state);
        if (recovery === "ok") continue;
        await declareLoss(state, { loss: "reenrollment_required", fence: "lease_lost" });
        return;
      }
      // transient — retry the SAME key after a bounded wait; the lease deadline
      // caps the retries (a renew that keeps timing out past expiry is a loss).
      emitRenew(attempt.label);
      if (schedule.now() >= state.expiresAtMs) {
        await declareLoss(state, { loss: "deadline_lapse", fence: "deadline_lapse" });
        return;
      }
      const wait = Math.max(retryFloorMs, attempt.retryAfterMs ?? retryFloorMs);
      await schedule.sleep(wait);
      if (stopped || state.terminated) return;
      if (schedule.now() >= state.expiresAtMs) {
        await declareLoss(state, { loss: "deadline_lapse", fence: "deadline_lapse" });
        return;
      }
    }
  }

  function registerLease(handoff: LeaseHandoff): LeaseState {
    const fence: EffectFence = {
      jobId: String(handoff.offer.job.jobId),
      attempt: handoff.offer.job.attempt,
      leaseId: handoff.leaseId,
      fenceToken: String(handoff.fenceToken),
      deviceGeneration: deps.identity.deviceGeneration,
      observedSeq: 0,
    };
    const eventIdentity: EventDeliveryIdentity = {
      organizationId: String(handoff.offer.job.organizationId),
      companyId: String(handoff.offer.job.companyId),
      workerId: String(handoff.offer.workerId),
      jobId: String(handoff.offer.job.jobId),
      attempt: handoff.offer.job.attempt,
      leaseId: handoff.leaseId,
      fenceToken: String(handoff.fenceToken),
    };
    const proxy = makeProxy(fence, eventIdentity);
    const expiresAtMs = Date.parse(handoff.offer.expiresAt);
    const state: LeaseState = {
      leaseId: handoff.leaseId,
      offer: handoff.offer,
      proxy,
      expiresAtMs,
      leadMs: computeLeadMs(expiresAtMs, schedule.now()),
      timer: null,
      terminated: false,
      recoveries: 0,
    };
    leases.set(handoff.leaseId, state);
    reschedule(state);
    return state;
  }

  return {
    accept(handoff: LeaseHandoff): Promise<void> {
      const state = registerLease(handoff);
      const settle = Promise.resolve<void>(deps.supervisor.accept(handoff) as void | Promise<void>);
      // Stop this lease's renewal when the run settles (success OR failure). A
      // swallowed copy runs the finally regardless; the delegate promise is what
      // the loop treats as the in-flight lifetime.
      void settle.then(
        () => {},
        () => {},
      ).finally(() => completeLease(state));
      return settle;
    },
    stop(): void {
      stopped = true;
      for (const state of leases.values()) clearTimer(state);
    },
    activeRenewalCount(): number {
      // Leases with a LIVE renewal timer (not terminated, not stopped).
      let count = 0;
      for (const state of leases.values()) if (!state.terminated && state.timer !== null) count += 1;
      return count;
    },
    proxyFor(leaseId: string): GovernedEffectAuthority | undefined {
      return leases.get(leaseId)?.proxy;
    },
  };
}
