/**
 * `Supervisor` — the sandbox lifecycle orchestrator (WRK-004).
 *
 * It is the real implementation behind the WRK-003 `SupervisorSeam`: the poll
 * loop hands it an ACKed lease (`accept`) and it drives the whole run INSIDE a
 * provider sandbox — never in the worker process:
 *
 *   create → attempt_started → execute (in sandbox) → terminal → destroy
 *
 * under the EFFECT authority (the happy path). Abnormal paths — a hung create, a
 * cancel, a lease loss, or shutdown — WITHDRAW effect authority and route through
 * the DISTINCT, monotonic CleanupAuthority, which can only cancel → kill →
 * destroy (escalating on non-compliance) and read a redacted projection. The
 * escalation reclaims the whole process tree.
 *
 * Every sandbox identity + provider op id is attached to the emitted events, the
 * structured logs, and the cleanup records; resource labels are HASHED before
 * they enter any log or metric.
 *
 * Runtime imports: relative modules + the frozen protocol type carried on the
 * handoff — the E4-D01 boundary.
 */

import { randomUUID } from "node:crypto";

import type { LogPayloadV1, ProgressPayloadV1, UsagePayloadV1 } from "@armyofagents/worker-protocol";

import type { LeaseHandoff, SupervisorSeam } from "../poll/poll-loop.js";
import type { Logger } from "../logging/logger.js";
import {
  CLEANUP_ESCALATION_METRIC,
  CLEANUP_OUTCOME_METRIC,
  SANDBOX_OP_METRIC,
  type Metrics,
} from "../metrics/metrics.js";
import { CleanupAuthority } from "./cleanup-authority.js";
import { EffectAuthority, type EffectFence } from "./effect-authority.js";
import { EventSequencer, type EventDeliveryIdentity, type WorkerEventSink } from "./events.js";
import {
  hashResourceLabels,
  type CreateSandboxSpec,
  type ExecuteResult,
  type ProviderOpContext,
  type ResourceLabels,
  type SandboxProvider,
} from "./provider.js";

/** CLI-003/D3 — a captured stdout/stderr/system log line to turn into a `log` event. */
export interface RunObservationLogEntry {
  readonly stream: LogPayloadV1["stream"];
  readonly level?: LogPayloadV1["level"];
  readonly message: string;
}

/** CLI-003/D3 — a progress tick to turn into a `progress` event. */
export interface RunObservationProgressEntry {
  readonly message: string;
  readonly percent: ProgressPayloadV1["percent"];
}

/**
 * CLI-003/D3+D5 — the bounded observation captured from a completed sandbox run:
 * log output (stdout/stderr/system), progress ticks, and EVIDENTIARY-ONLY usage.
 * In the wired world this is populated from the D1 transport streaming callbacks +
 * the adapter's token/runtime accounting; the live population channel is the inert
 * E4-D12 seam, so CLI-003 wires the seam + unit-tests it. Usage never carries a
 * price — JOB-012 prices server-side.
 */
export interface RunObservation {
  readonly logs?: readonly RunObservationLogEntry[];
  readonly progress?: readonly RunObservationProgressEntry[];
  readonly usage?: UsagePayloadV1 | null;
}

/** The max number of captured `log` events a single run may emit, leaving headroom
 * under the frozen 500-event batch cap for attempt_started/progress/usage/terminal.
 * Envelope-level (≤500-event / ≤3.75 MiB) batching itself is the durable sink's job. */
const MAX_LOG_EVENTS = 480;

/** The worker's stable identity (targetId + deviceGeneration) — not carried on a
 * per-lease handoff, so it is bound once at supervisor construction. */
export interface WorkerSupervisionIdentity {
  readonly targetId: string;
  readonly deviceGeneration: number;
}

export interface SupervisorDeps {
  readonly provider: SandboxProvider;
  readonly identity: WorkerSupervisionIdentity;
  readonly eventSink: WorkerEventSink;
  readonly metrics?: Metrics;
  readonly logger?: Logger;
  /** ms clock (default `Date.now`). */
  readonly now?: () => number;
  /** ISO clock for event `occurredAt` (default real time). */
  readonly nowIso?: () => string;
  readonly newEventId?: () => string;
  readonly newIdempotencyKey?: () => string;
  /** Wall-clock budget for a `create` before the deadline fires (default 30s). */
  readonly createDeadlineMs?: number;
  /** Generic per-op deadline stamped on the op context (default 60s). */
  readonly opDeadlineMs?: number;
  /** ms after acceptance the cleanup authority's escalation becomes mandatory. */
  readonly cleanupDeadlineMs?: number;
  /** Injectable timer for the create-deadline race (default node timers). */
  readonly setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
  /** DAT-005 D4 — per-run secret canaries scrubbed from EVERY event this supervisor's
   * lifecycle sequencer emits (attempt_started / terminal / op stream), BEFORE the
   * digest + durable outbox. The canary-seeding channel that populates this is the
   * inert E4-D12 seam; until then it is `[]` (verbatim emit, no secret-bearing
   * supervisor string exists yet — every terminal errorMessage is hardcoded null). */
  /**
   * ★ REQUIRED, deliberately. This was `redactionCanaries?:` with a `?? []` fallback — an
   * OMISSION-BY-DEFAULT in a REDACTION mechanism: a caller that simply forgot got no
   * redaction at all, silently, and nothing anywhere would say so.
   *
   * A fail-open default in a security control is the worst kind of default, because the
   * failure is invisible in exactly the case it matters. Passing `[]` is still allowed —
   * but it now has to be TYPED OUT, which makes "this run has no canaries" a decision
   * someone made rather than one they omitted.
   */
  readonly redactionCanaries: readonly string[];
  /**
   * CLI-003/D3 — an OPTIONAL run-observation source. When present, the supervisor
   * resolves it AFTER `execute` (with the exec result) and emits the captured
   * log/progress/usage producer events between `attempt_started` and `terminal`.
   * Absent (the default) leaves the lifecycle event stream unchanged. Best-effort:
   * a throw is logged and never fails the run.
   */
  readonly observeRun?: (input: { handoff: LeaseHandoff; exec: ExecuteResult }) => RunObservation | Promise<RunObservation>;
}

export type SupervisorRunStatus = "succeeded" | "failed" | "cancelled" | "create_timeout";

export interface Supervisor extends SupervisorSeam {
  accept(handoff: LeaseHandoff): Promise<void>;
  /** Cancel a live run: withdraw effect authority and escalate cleanup on its
   * process tree (cancel → kill → destroy). Idempotent; a no-op if unknown. */
  cancel(leaseId: string, reason?: string): Promise<void>;
  /** Handle a lost/replaced lease exactly like a cancel (effect withdrawn). */
  onLeaseLost(leaseId: string): Promise<void>;
  /** Cancel every live run and let cleanup converge (shutdown). */
  shutdown(): Promise<void>;
  activeRunCount(): number;
}

interface ActiveRun {
  readonly leaseId: string;
  readonly labels: ResourceLabels;
  readonly effect: EffectAuthority;
  readonly cleanup: CleanupAuthority;
  readonly makeCtx: () => ProviderOpContext;
  sandboxId: string | null;
  cancelled: boolean;
  cleanedUp: boolean;
}

const TIMEOUT = Symbol("create-deadline");

export function createSupervisor(deps: SupervisorDeps): Supervisor {
  const now = deps.now ?? (() => Date.now());
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const newEventId = deps.newEventId ?? randomUUID;
  const newKey = deps.newIdempotencyKey ?? randomUUID;
  const createDeadlineMs = deps.createDeadlineMs ?? 30_000;
  const opDeadlineMs = deps.opDeadlineMs ?? 60_000;
  const cleanupDeadlineMs = deps.cleanupDeadlineMs ?? 30_000;
  const schedule = deps.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const cancelTimer = deps.clearTimeoutFn ?? ((h) => clearTimeout(h));

  const runs = new Map<string, ActiveRun>();

  const emitOp = (operation: string, outcome: string): void =>
    deps.metrics?.inc(SANDBOX_OP_METRIC, { operation, outcome });

  function ctx(): ProviderOpContext {
    return { deadlineMs: opDeadlineMs, idempotencyKey: newKey() };
  }

  function labelsFor(handoff: LeaseHandoff): ResourceLabels {
    return {
      organizationId: String(handoff.offer.job.organizationId),
      targetId: deps.identity.targetId,
      workerId: String(handoff.offer.workerId),
      jobId: String(handoff.offer.job.jobId),
      attempt: handoff.offer.job.attempt,
      leaseId: handoff.leaseId,
      deviceGeneration: deps.identity.deviceGeneration,
    };
  }

  function deliveryIdentity(handoff: LeaseHandoff): EventDeliveryIdentity {
    return {
      organizationId: String(handoff.offer.job.organizationId),
      companyId: String(handoff.offer.job.companyId),
      workerId: String(handoff.offer.workerId),
      jobId: String(handoff.offer.job.jobId),
      attempt: handoff.offer.job.attempt,
      leaseId: handoff.leaseId,
      fenceToken: String(handoff.fenceToken),
    };
  }

  function createSpecFor(handoff: LeaseHandoff, labels: ResourceLabels): CreateSandboxSpec {
    const workload = handoff.offer.job.workload as Record<string, unknown>;
    const command = typeof workload.command === "string" ? workload.command : handoff.offer.job.workloadType;
    const args = Array.isArray(workload.args) ? (workload.args as unknown[]).map(String) : [];
    return { resourceLabels: labels, command, args, env: {}, workloadType: handoff.offer.job.workloadType };
  }

  async function withDeadline<T>(op: Promise<T>, deadlineMs: number): Promise<T | typeof TIMEOUT> {
    let handle: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<typeof TIMEOUT>((resolve) => {
      handle = schedule(() => resolve(TIMEOUT), deadlineMs);
    });
    try {
      return await Promise.race([op, timeout]);
    } finally {
      if (handle !== null) cancelTimer(handle);
    }
  }

  /** Withdraw effect authority and escalate cleanup on the run's labeled
   * resource(s). Idempotent per run. */
  async function escalateCleanup(run: ActiveRun, reason: string): Promise<void> {
    run.effect.withdraw();
    if (run.cleanedUp) return;

    // Discover the labeled resource(s) even when `create` hung or is still
    // in-flight (no sandboxId yet).
    let targets: string[];
    if (run.sandboxId !== null) {
      targets = [run.sandboxId];
    } else {
      const listed = await run.cleanup.list(ctx());
      // A concurrent pass may have latched, or `create` may have resolved, while
      // we awaited the list — re-check and prefer a now-known sandboxId.
      if (run.cleanedUp) return;
      targets = run.sandboxId !== null ? [run.sandboxId] : listed.map((r) => r.sandboxId);
    }

    // CONTAINMENT MUST NOT FAIL OPEN. An empty pass reclaimed NOTHING: a provider
    // that only registers the sandbox on `create` resolve (the real E2B runtime)
    // is not listable while create is in-flight, so `list()` returns []. Do NOT
    // consume the terminal `cleanedUp` latch on an empty/ineffective pass — leave
    // the run retryable so the post-create `if (run.cancelled)` pass reclaims the
    // now-known live sandbox. Latching here would strand a tenant sandbox past
    // lease loss with zero worker-side teardown — the exact leak WRK-004 prevents.
    if (targets.length === 0) {
      deps.logger?.info(
        {
          leaseId: run.leaseId,
          resourceLabelsHash: hashResourceLabels(run.labels),
          deviceGeneration: run.labels.deviceGeneration,
          reason,
        },
        "supervisor: cleanup pass found no reclaimable resource (create in-flight) — staying retryable",
      );
      return;
    }

    // Only NOW — with a real target to reclaim — consume the terminal latch, so a
    // genuine convergence is never double-run (idempotent-destroy purpose intact).
    run.cleanedUp = true;

    const status = await run.cleanup.converge(targets, () => ctx());
    const stage = run.cleanup.escalationStage();
    deps.metrics?.inc(CLEANUP_ESCALATION_METRIC, { escalation_stage: stage });
    deps.metrics?.inc(CLEANUP_OUTCOME_METRIC, { outcome: status });
    deps.logger?.info(
      {
        leaseId: run.leaseId,
        resourceLabelsHash: hashResourceLabels(run.labels),
        deviceGeneration: run.labels.deviceGeneration,
        cleanupEpoch: run.cleanup.cleanupEpoch(),
        escalationStage: stage,
        cleanupStatus: status,
        reason,
      },
      "supervisor: cleanup converged",
    );
  }

  async function runLifecycle(handoff: LeaseHandoff, run: ActiveRun): Promise<void> {
    const events = new EventSequencer({
      identity: deliveryIdentity(handoff),
      sink: deps.eventSink,
      newEventId,
      now: nowIso,
      // Scrub per-run secret canaries from the PRIMARY lifecycle stream too — not
      // only the fence-close denial stream — so redaction is uniform across every
      // sink that feeds the durable outbox (E4-D12 seeds the canaries; [] until then).
      redactionCanaries: deps.redactionCanaries,
    });
    const spec = createSpecFor(handoff, run.labels);

    // 1. create — raced against its deadline (a hung create escalates cleanup).
    let created;
    try {
      created = await withDeadline(run.effect.create(spec, ctx()), createDeadlineMs);
    } catch (err) {
      emitOp("create", "failed");
      await events.terminal({ status: "failed", exitCode: null, errorCode: "create_failed", errorMessage: null });
      await escalateCleanup(run, "create_error");
      return;
    }
    if (created === TIMEOUT) {
      emitOp("create", "timed_out");
      deps.logger?.warn(
        { leaseId: run.leaseId, resourceLabelsHash: hashResourceLabels(run.labels) },
        "supervisor: create deadline exceeded",
      );
      await events.terminal({ status: "failed", exitCode: null, errorCode: "create_timeout", errorMessage: null });
      await escalateCleanup(run, "create_timeout");
      return;
    }
    run.sandboxId = created.sandboxId;
    emitOp("create", "success");

    if (run.cancelled) {
      // CLI-003/D3 — a cancel that arrives after create but before the tenant command
      // still reaches a durable cancelled terminal, then escalates cleanup.
      await events.terminal({ status: "cancelled", exitCode: null, errorCode: "cancelled", errorMessage: null });
      await escalateCleanup(run, "cancelled_during_create");
      return;
    }

    // 2. attempt_started — the tenant command is running INSIDE the sandbox.
    await events.attemptStarted(created.sandboxId);

    // 3. execute (in sandbox) — raced against a supervisor-side op deadline so a
    // provider that hangs (ignoring the opDeadlineMs it also carries on ctx) still
    // reaches a durable terminal within a bound (§2.1 within-policy). A well-behaved
    // provider returns before the race fires (with its own timedOut verdict), so the
    // op wins; the backstop only bites a hung/misbehaving provider.
    let exec;
    try {
      const raced = await withDeadline(
        run.effect.execute(
          { sandboxId: created.sandboxId, command: spec.command, args: spec.args, env: spec.env },
          ctx(),
        ),
        opDeadlineMs,
      );
      if (raced === TIMEOUT) {
        emitOp("execute", "timed_out");
        const cancelled = run.cancelled;
        await events.terminal({
          status: cancelled ? "cancelled" : "failed",
          exitCode: null,
          errorCode: cancelled ? "cancelled" : "execute_timeout",
          errorMessage: null,
        });
        await escalateCleanup(run, "execute_deadline");
        return;
      }
      exec = raced;
    } catch (err) {
      emitOp("execute", "failed");
      // §2.1 — this is the ONLY lifecycle exit and it MUST still reach a durable
      // terminal. The common cancel/lease-loss path tears down the sandbox
      // (escalateCleanup) which makes the in-flight execute REJECT here; without a
      // terminal the attempt is stranded non-terminal until the JOB-006 reaper. A
      // cancelled run reaches `cancelled`; a genuine execute failure reaches `failed`.
      const cancelled = run.cancelled;
      await events.terminal({
        status: cancelled ? "cancelled" : "failed",
        exitCode: null,
        errorCode: cancelled ? "cancelled" : "execute_failed",
        errorMessage: null,
      });
      await escalateCleanup(run, "execute_error");
      return;
    }
    emitOp("execute", "success");

    if (run.cancelled) {
      // Cancelled while executing — emit a durable cancelled terminal (CLI-003/D3),
      // then escalate; no terminal success, no double destroy.
      await events.terminal({ status: "cancelled", exitCode: null, errorCode: "cancelled", errorMessage: null });
      await escalateCleanup(run, "cancelled_during_execute");
      return;
    }

    // 3b. Producers (CLI-003/D3+D5): best-effort log/progress/usage captured from
    // the run, emitted between attempt_started and terminal. Instrumentation must
    // NEVER fail the run — a throw is logged and swallowed. Usage is evidentiary-only
    // (the frozen `.strict()` schema rejects any price field — JOB-012 prices).
    if (deps.observeRun) {
      try {
        const obs = await deps.observeRun({ handoff, exec });
        for (const entry of (obs.logs ?? []).slice(0, MAX_LOG_EVENTS)) {
          await events.log({ stream: entry.stream, level: entry.level ?? "info", message: entry.message });
        }
        for (const tick of obs.progress ?? []) {
          await events.progress({ message: tick.message, percent: tick.percent });
        }
        if (obs.usage) await events.usage(obs.usage);
      } catch (err) {
        deps.logger?.warn({ leaseId: run.leaseId, err }, "supervisor: run observation failed (best-effort)");
      }
    }

    // 4. terminal event — ENRICHED with exec.signal/timedOut (CLI-003/D3). The frozen
    // terminal payload has no signal/timedOut field, so they fold into the free
    // errorCode/errorMessage strings; a timed-out or signalled exec is `failed`.
    const status = exec.exitCode === 0 && !exec.timedOut ? "succeeded" : "failed";
    const errorCode = exec.timedOut ? "exec_timeout" : exec.signal !== null ? "exec_signalled" : null;
    const errorMessage = exec.signal !== null ? `signal:${exec.signal}` : null;
    await events.terminal({ status, exitCode: exec.exitCode, errorCode, errorMessage });

    // 5. destroy UNDER EFFECT AUTHORITY (happy-path reclaim).
    try {
      const destroyed = await run.effect.destroy(created.sandboxId, ctx());
      emitOp("destroy", destroyed.cleanupStatus === "success" ? "success" : "failed");
      deps.metrics?.inc(CLEANUP_OUTCOME_METRIC, { outcome: destroyed.cleanupStatus });
      if (destroyed.cleanupStatus === "failed") {
        // A failed happy-path destroy falls back to cleanup escalation.
        await escalateCleanup(run, "happy_destroy_failed");
      }
      deps.logger?.info(
        {
          leaseId: run.leaseId,
          sandboxId: created.sandboxId,
          providerOpId: destroyed.providerOpId,
          resourceLabelsHash: hashResourceLabels(run.labels),
          cleanupStatus: destroyed.cleanupStatus,
        },
        "supervisor: run complete",
      );
    } catch {
      await escalateCleanup(run, "happy_destroy_error");
    }
  }

  function buildRun(handoff: LeaseHandoff): ActiveRun {
    const labels = labelsFor(handoff);
    const fence: EffectFence = {
      jobId: labels.jobId,
      attempt: labels.attempt,
      leaseId: labels.leaseId,
      fenceToken: String(handoff.fenceToken),
      deviceGeneration: labels.deviceGeneration,
      observedSeq: 0,
    };
    return {
      leaseId: handoff.leaseId,
      labels,
      effect: new EffectAuthority(deps.provider, fence),
      cleanup: new CleanupAuthority({
        provider: deps.provider,
        resourceLabels: labels,
        targetGeneration: labels.deviceGeneration,
        fence,
        deadline: now() + cleanupDeadlineMs,
        epoch: 0,
        now,
      }),
      makeCtx: ctx,
      sandboxId: null,
      cancelled: false,
      cleanedUp: false,
    };
  }

  const supervisor: Supervisor = {
    async accept(handoff: LeaseHandoff): Promise<void> {
      const run = buildRun(handoff);
      runs.set(run.leaseId, run);
      try {
        await runLifecycle(handoff, run);
      } catch (err) {
        // The lifecycle is best-effort: never reject out of `accept` (the loop
        // treats settle as the in-flight lifetime). Last-resort cleanup.
        deps.logger?.error({ leaseId: run.leaseId, err }, "supervisor: run lifecycle error");
        try {
          await escalateCleanup(run, "lifecycle_error");
        } catch {
          // swallow — never fail the run
        }
      } finally {
        run.effect.withdraw();
        runs.delete(run.leaseId);
      }
    },

    async cancel(leaseId: string, reason = "cancel"): Promise<void> {
      const run = runs.get(leaseId);
      if (run === undefined) return;
      run.cancelled = true;
      await escalateCleanup(run, reason);
    },

    onLeaseLost(leaseId: string): Promise<void> {
      return supervisor.cancel(leaseId, "lease_lost");
    },

    async shutdown(): Promise<void> {
      const live = [...runs.values()];
      for (const run of live) {
        run.cancelled = true;
        try {
          await escalateCleanup(run, "shutdown");
        } catch {
          // best-effort per run
        }
      }
    },

    activeRunCount(): number {
      return runs.size;
    },
  };

  return supervisor;
}
