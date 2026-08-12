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
  type ProviderOpContext,
  type ResourceLabels,
  type SandboxProvider,
} from "./provider.js";

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

  async function withCreateDeadline<T>(op: Promise<T>): Promise<T | typeof TIMEOUT> {
    let handle: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<typeof TIMEOUT>((resolve) => {
      handle = schedule(() => resolve(TIMEOUT), createDeadlineMs);
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
    });
    const spec = createSpecFor(handoff, run.labels);

    // 1. create — raced against its deadline (a hung create escalates cleanup).
    let created;
    try {
      created = await withCreateDeadline(run.effect.create(spec, ctx()));
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
      await escalateCleanup(run, "cancelled_during_create");
      return;
    }

    // 2. attempt_started — the tenant command is running INSIDE the sandbox.
    await events.attemptStarted(created.sandboxId);

    // 3. execute (in sandbox).
    let exec;
    try {
      exec = await run.effect.execute(
        { sandboxId: created.sandboxId, command: spec.command, args: spec.args, env: spec.env },
        ctx(),
      );
    } catch (err) {
      emitOp("execute", "failed");
      await escalateCleanup(run, "execute_error");
      return;
    }
    emitOp("execute", "success");

    if (run.cancelled) {
      // Cancelled while executing — cleanup already ran (or runs now); no terminal
      // success, no double destroy.
      await escalateCleanup(run, "cancelled_during_execute");
      return;
    }

    // 4. terminal event.
    const status = exec.exitCode === 0 ? "succeeded" : "failed";
    await events.terminal({ status, exitCode: exec.exitCode, errorCode: null, errorMessage: null });

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
