// server/src/services/distributed-cancellation-port.ts
//
// CLI-006 (Task 4) — the cancel routing decision, and the port that carries the
// fence-revoking call to a distributed-owned run's attempt.
//
// **Why the port is module-level and not constructor-injected.**
//
// `heartbeat.cancelRun` has exactly three non-test callers, and none of them
// holds a service instance built with options:
//
//   routes/agents.ts:2161  -> heartbeatService(db) at agents.ts:198
//   routes/issues.ts:386   -> heartbeatService(db) at issues.ts:99
//   index.ts:1835          -> heartbeatService(db) at index.ts:1828
//
// Only the scheduler instance (index.ts:1205) receives `distributedRollout`. A
// `requestCancellation` port added to `heartbeatService`'s options would
// therefore be `undefined` at every real cancel: the code would look wired,
// typecheck, and never fire. That is the same failure shape as the Task 2a
// bivariance defect — a composition that reads correct and is inert.
//
// Module-level registration is instance-independent by construction, which is
// exactly the property that fails above, and it is an idiom heartbeat.ts already
// uses twice (`setSecretResolver`, `registerRuntimeHook`).
//
// The port itself is needed because `requestCancellation` lives on
// `createJobReconciliationService({ appDb })` and runs under `runInTenant` over
// the `aoa_app` pool, which heartbeat's owner-pool `db` cannot reach.

/**
 * The fence-revoking cancel. Idempotent; `graceful` selects graceful vs hard.
 * Implemented in the composition root over JOB-006's reconciliation service.
 */
export interface DistributedCancellationPort {
  requestCancellation(input: {
    jobId: string;
    companyId: string;
    organizationId: string;
    reason: string;
    graceful: boolean;
  }): Promise<void>;
}

let registeredPort: DistributedCancellationPort | undefined;

/**
 * Register (or clear, with `undefined`) the process-wide port. Called once from
 * the `index.ts` distributed block. Clearing exists so a test — or a config
 * reload — cannot leak one deployment's port into another.
 */
export function setDistributedCancellationPort(port: DistributedCancellationPort | undefined): void {
  registeredPort = port;
}

export function getDistributedCancellationPort(): DistributedCancellationPort | undefined {
  return registeredPort;
}

/** Why a marked run is nonetheless being cancelled the legacy way. */
export type CancelRouteDegradation =
  | "no_distributed_cancellation_port"
  | "missing_distributed_job_id";

export type CancelRoute =
  | { readonly route: "distributed"; readonly jobId: string }
  | { readonly route: "legacy"; readonly degraded?: CancelRouteDegradation };

/**
 * Decide how to cancel one run.
 *
 * **The fail-safe direction here is the OPPOSITE of the seam's, deliberately.**
 * Suppression must never strand a run, so absence of a decision reads as legacy
 * *executes*. Cancel must never leave a run unkillable, so absence of a port
 * reads as legacy *terminalizes*. Both defaults point away from the outcome that
 * cannot be recovered by an operator.
 *
 * Concretely: a control-plane restart with the distributed flag off leaves marked
 * runs behind and no port. Refusing to terminalize them would strand them
 * forever — with the subsystem disabled, no worker will ever terminalize that
 * attempt. So the legacy write is the only convergent outcome, and the caller
 * logs the degradation rather than swallowing it. The cost is losing distributed
 * evidence for a run whose subsystem the operator has already turned off.
 *
 * An unrecognised `executionOwner` reads as legacy: a future owner kind this
 * build does not understand must not be treated as distributed.
 */
export function resolveCancelRoute(
  run: { executionOwner: string | null; distributedJobId: string | null },
  port: DistributedCancellationPort | undefined,
): CancelRoute {
  if (run.executionOwner !== "distributed") return { route: "legacy" };
  if (!port) return { route: "legacy", degraded: "no_distributed_cancellation_port" };
  // A half-written marker must not make a run unkillable — there is no fence to
  // revoke without a job id.
  if (!run.distributedJobId) return { route: "legacy", degraded: "missing_distributed_job_id" };
  return { route: "distributed", jobId: run.distributedJobId };
}
