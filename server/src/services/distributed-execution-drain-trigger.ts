// server/src/services/distributed-execution-drain-trigger.ts
//
// MIG-009 (M1a) — the OPERATOR TRIGGER for the distributed-execution rollback drain.
//
//   pnpm drain:distributed-execution --operator <who>
//
// `createDistributedExecutionDrain` / `drainAll` (job-distributed-drain.ts) shipped correct and
// deliberately unwired: it had ZERO production callers, so a rollback could only be a runbook.
// Founder ruling F6 (scope-triage.md, "M1 rulings") sets the trigger grain: a whole-fleet CLI
// now, the kill-switch UI later (REL-005). This module is that trigger's testable core; the
// entrypoint (server/src/cli/drain-distributed-execution.ts) only loads config, opens the bounded
// pools and hands them here.
//
// ★ WHAT THIS MODULE ADDS TO THE SHIPPED DRAIN, AND WHY IT DOES NOT EDIT IT. The drain service
// is not modified (E10 plan §8.1: an edit there is a STOP). Everything this ticket owes is
// supplied at the ONE seam the drain already exposes — its `requestCancellation` dependency:
//
//   1. THE SILENT-CANCEL DEAD LEVER. `drainAll` wraps each per-attempt cancel in a bare
//      `catch {}` that records neither a skipped organization nor a failed attempt, and still
//      reports the org `skipped: false`. A trigger whose exit code read only
//      `skippedOrganizations` would therefore exit 0 while work is still active. This adapter
//      observes every cancel BEFORE drainAll swallows it, records the failure in a per-run
//      ledger, re-throws (so drainAll still does not count it drained), and the exit code reads
//      the ledger. Decision E10-D001.
//
//   2. THE ACTOR-ATTRIBUTED AUDIT, ATOMIC WITH EACH CANCEL. `drainAll` imports no audit module.
//      This adapter runs each attempt's `requestCancellation` and its `job.drain.requested`
//      activity_log row inside ONE tenant transaction (`withTenant` = `runInTenant` on the real
//      path), so a commit yields both and a rollback yields neither. drainAll cancels attempt by
//      attempt across Organizations, so one fleet-wide atomic write is impossible (ruling F6);
//      per-attempt atomicity is the strongest available. Decision E10-D002.
//
//   3. TENANT SCOPE PER ATTEMPT. The drain's cancel dependency carries the attempt's own
//      `organizationId`, and the adapter binds the tenant transaction to exactly that
//      organization — never a process-wide or first-seen one (M1 is multi-tenant, ruling F10).
//
//   4. A STABLE commandId, derived from the jobId at this boundary (never random): see
//      `deriveDrainCommandId`.

import { createHash } from "node:crypto";
import type { CancellationOutcome, CancellationStatus } from "@armyofagents/db";
import {
  createDistributedExecutionDrain,
  type DistributedExecutionDrainDeps,
  type DistributedExecutionDrainResult,
} from "./job-distributed-drain.js";

/** The `reason` every cancel command and audit row of an operator drain carries. A stable,
 * enum-like string — the CLI never accepts a free-text reason. */
export const OPERATOR_DRAIN_REASON = "distributed_execution_rollback";

/** Namespace for the derived cancel `commandId`. Versioned so a future change of derivation
 * cannot collide with ids already queued under this one. */
export const DRAIN_COMMAND_ID_NAMESPACE = "aoa.distributed-execution-drain.cancel.v1";

/** `--operator` values: an opaque handle, bounded, no whitespace. It is printed and stored. */
const OPERATOR_PATTERN = /^[A-Za-z0-9._@:+-]{1,128}$/;

/** Outcomes that mutated nothing, so there is nothing to audit (the repo returns these without
 * touching a row). Every other outcome — `queued`, `already_requested`, `cancelled`,
 * `no_active_lease` — is exactly the set drainAll counts as drained, and each is audited. */
const UNAUDITED_STATUSES: ReadonlySet<CancellationStatus> = new Set<CancellationStatus>([
  "not_found",
  "job_terminal",
]);

/** WHO ran the drain. `system` because the CLI cannot authenticate a board user: the declared
 * operator is a label, and the real authority is possession of the bounded-pool credentials.
 * Decision E10-D002 records this. */
export interface DrainOperatorActor {
  readonly actorType: "system";
  readonly actorId: string;
}

/** The tenant-bound unit of work one attempt's cancel and its audit row share. */
export interface DrainTenantScope {
  currentDatabaseTime(): Promise<Date>;
  requestCancellation(input: {
    organizationId: string;
    companyId: string;
    jobId: string;
    reason: string;
    graceful: boolean;
    commandId: string;
    now: Date;
  }): Promise<CancellationOutcome>;
  recordDrainAudit(input: {
    actor: DrainOperatorActor;
    organizationId: string;
    companyId: string;
    jobId: string;
    outcome: string;
    commandId: string | null;
    reason: string;
  }): Promise<void>;
}

/** Run `work` inside ONE transaction bound to `organizationId`; a throw rolls it all back. */
export type WithDrainTenantScope = <T>(
  organizationId: string,
  work: (scope: DrainTenantScope) => Promise<T>,
) => Promise<T>;

/** The drain's deps, with `requestCancellation` replaced by the tenant-transaction seam the
 * adapter composes it from. */
export interface DrainTriggerDeps extends Omit<DistributedExecutionDrainDeps, "requestCancellation"> {
  withTenant: WithDrainTenantScope;
}

export interface DrainCancellationFailure {
  readonly organizationId: string;
  readonly companyId: string;
  readonly jobId: string;
  /** Error class and SQLSTATE only (e.g. `Error:57014`) — never a message, which can carry
   * statement text. */
  readonly error: string;
}

export interface DrainTriggerReport {
  readonly reason: string;
  readonly actorId: string;
  readonly result: DistributedExecutionDrainResult;
  readonly failedCancellations: readonly DrainCancellationFailure[];
}

/**
 * The cancel `commandId` for one job, derived deterministically from its jobId (an RFC 4122
 * version-5-shaped UUID over SHA-256 of the namespace and the jobId).
 *
 * Deterministic so a re-run of the drain names the SAME command for the same job. (It is not what
 * dedups a re-run — `requestCancellation` returns `already_requested` for an existing cancel on
 * the lease before the id is used — but it keeps every id this trigger mints reproducible from the
 * job alone, which is what an operator reconciling a rehearsal needs.) Namespaced so it is never
 * equal to the budget bridge's `commandId: jobId`, keeping the two producers distinguishable in
 * `job_control_commands`.
 */
export function deriveDrainCommandId(jobId: string): string {
  const bytes = createHash("sha256").update(`${DRAIN_COMMAND_ID_NAMESPACE}:${jobId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Parse `--operator <who>` into the audit actor; null when absent or malformed. */
export function parseDrainOperator(argv: readonly string[]): DrainOperatorActor | null {
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--operator") {
      const value = rest[i + 1];
      if (typeof value !== "string" || !OPERATOR_PATTERN.test(value)) return null;
      return { actorType: "system", actorId: `operator-cli:${value}` };
    }
  }
  return null;
}

function describeError(error: unknown): string {
  const name = error instanceof Error ? error.name : "NonError";
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? `${name}:${code}` : name;
}

/**
 * The drain's `requestCancellation` dependency: ONE attempt's cancel and its audit row in ONE
 * tenant transaction bound to that attempt's own organization, with every failure recorded in the
 * returned ledger BEFORE it is re-thrown into drainAll's swallowing catch.
 */
export function createAuditedDrainCancellation(input: {
  withTenant: WithDrainTenantScope;
  actor: DrainOperatorActor;
}): {
  requestCancellation: DistributedExecutionDrainDeps["requestCancellation"];
  failures: DrainCancellationFailure[];
} {
  const failures: DrainCancellationFailure[] = [];
  return {
    failures,
    async requestCancellation(cancel) {
      try {
        return await input.withTenant(cancel.organizationId, async (scope) => {
          const now = await scope.currentDatabaseTime();
          const commandId = deriveDrainCommandId(cancel.jobId);
          const outcome = await scope.requestCancellation({
            organizationId: cancel.organizationId,
            companyId: cancel.companyId,
            jobId: cancel.jobId,
            reason: cancel.reason,
            graceful: cancel.graceful,
            commandId,
            now,
          });
          if (!UNAUDITED_STATUSES.has(outcome.status)) {
            // SAME transaction as the cancel above: if this insert fails, the cancel rolls back.
            await scope.recordDrainAudit({
              actor: input.actor,
              organizationId: cancel.organizationId,
              companyId: cancel.companyId,
              jobId: cancel.jobId,
              outcome: outcome.status,
              commandId: outcome.command?.commandId ?? null,
              reason: cancel.reason,
            });
          }
          return outcome;
        });
      } catch (error) {
        failures.push({
          organizationId: cancel.organizationId,
          companyId: cancel.companyId,
          jobId: cancel.jobId,
          error: describeError(error),
        });
        throw error;
      }
    },
  };
}

/** Compose the shipped drain over the audited adapter and run it ONCE. */
export async function runDistributedExecutionDrainTrigger(
  deps: DrainTriggerDeps,
  actor: DrainOperatorActor,
): Promise<DrainTriggerReport> {
  const cancellation = createAuditedDrainCancellation({ withTenant: deps.withTenant, actor });
  const drain = createDistributedExecutionDrain({
    listAdmittedOrganizationIds: deps.listAdmittedOrganizationIds,
    listOrganizationCompanyIds: deps.listOrganizationCompanyIds,
    listActiveAttempts: deps.listActiveAttempts,
    assertRollbackSafe: deps.assertRollbackSafe,
    requestCancellation: cancellation.requestCancellation,
  });
  // No pageSize / statementTimeoutMs: the module's own defaults ARE its ceilings, and the CLI
  // must never widen them.
  const result = await drain.drainAll({ reason: OPERATOR_DRAIN_REASON });
  return {
    reason: OPERATOR_DRAIN_REASON,
    actorId: actor.actorId,
    result,
    failedCancellations: [...cancellation.failures],
  };
}

/** 0 only for a sweep that skipped no organization AND failed no cancel. */
export function drainExitCode(report: DrainTriggerReport): 0 | 1 {
  // ★ `skippedOrganizations` alone is NOT sufficient: drainAll swallows a thrown per-attempt
  // cancel and still reports that org `skipped: false`, so the ledger is read too (E10-D001).
  return report.result.skippedOrganizations.length === 0 && report.failedCancellations.length === 0
    ? 0
    : 1;
}

/** One structured line per organization, then one summary line. Opaque ids only. */
export function formatDrainReport(report: DrainTriggerReport): string[] {
  const lines = report.result.perOrganization.map((org) =>
    JSON.stringify({
      organization: {
        organizationId: org.organizationId,
        skipped: org.skipped,
        reason: org.reason ?? null,
        cancelled: org.cancelled,
        failedJobIds: report.failedCancellations
          .filter((f) => f.organizationId === org.organizationId)
          .map((f) => f.jobId),
      },
    }),
  );
  lines.push(
    JSON.stringify({
      summary: {
        reason: report.reason,
        actorId: report.actorId,
        organizationsScanned: report.result.organizationsScanned,
        cancelled: report.result.cancelled,
        skippedCount: report.result.skippedOrganizations.length,
        skippedOrganizations: report.result.skippedOrganizations,
        failedCancellations: report.failedCancellations,
      },
    }),
  );
  return lines;
}

/**
 * The whole CLI, minus process wiring. Returns the exit code:
 *   0 — every admitted organization drained and every cancel committed with its audit row;
 *   1 — flag off, pools unavailable, the drain threw, any organization skipped, or any cancel failed;
 *   2 — usage (no valid `--operator`).
 * ★ `openPools` is called only after the flag check, so a flag-off run opens no pool.
 */
export async function runDrainDistributedExecutionCli<P extends { close(): Promise<void> }>(io: {
  argv: readonly string[];
  distributedExecutionEnabled: boolean;
  openPools(): Promise<P | null>;
  composeDeps(pools: P): DrainTriggerDeps;
  out(line: string): void;
  err(line: string): void;
}): Promise<number> {
  const actor = parseDrainOperator(io.argv);
  if (!actor) {
    io.err("usage: drain-distributed-execution --operator <who>   (1-128 chars of [A-Za-z0-9._@:+-])");
    return 2;
  }
  if (!io.distributedExecutionEnabled) {
    io.err(
      "refusing to drain: AOA_DISTRIBUTED_EXECUTION_ENABLED is not true in this process, so the " +
        "bounded aoa_app/aoa_operator pools are not opened. Run the drain BEFORE unsetting the flag " +
        "(see docs/deploy/environment-variables.md, 'Rolling distributed execution back').",
    );
    return 1;
  }
  const pools = await io.openPools();
  if (!pools) {
    io.err("refusing to drain: the bounded distributed-execution pools did not open");
    return 1;
  }
  try {
    io.out(`draining distributed execution: reason=${OPERATOR_DRAIN_REASON} actor=${actor.actorId}`);
    const report = await runDistributedExecutionDrainTrigger(io.composeDeps(pools), actor);
    for (const line of formatDrainReport(report)) io.out(line);
    return drainExitCode(report);
  } catch (error) {
    io.err(`drain-distributed-execution failed: ${describeError(error)}`);
    return 1;
  } finally {
    await pools.close();
  }
}
