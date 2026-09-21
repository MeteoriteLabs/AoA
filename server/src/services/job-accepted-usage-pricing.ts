// server/src/services/job-accepted-usage-pricing.ts
//
// JOB-016 — price accepted usage AT INGEST, on the E3-D-ACC in-transaction accepted-event seam.
// The decision is `docs/replatform/epics/E3-job-control/decisions.md`, `E3-D-ACC` (accepted with
// three amendments). This module is everything the seam needs on the SERVER side:
//
//   * `createAcceptedUsagePricingProjector` — THE registration. `acceptEvent` runs it, inside its
//     own savepoint, for each newly accepted `usage` event while the fence is live. It reads the
//     units off the stored wire event, the job's SUBMIT-TIME source off `jobs.source_intent`, and
//     calls the transaction-taking `priceAcceptedUsageCore`. It never opens a transaction, never
//     re-guards the fence and never writes the receipt (the seam does).
//   * `detectTerminalWithoutUsage` — acceptance 4's classified signal: an attempt that goes
//     terminal with no accepted `usage` event. A log line + a count, deliberately NOT a receipt.
//   * `redrivePendingAuthoritativeCost` + `createAuthoritativeCostRedriveSweep` — Amendment 3:
//     the re-drive of a `pending` `authoritative_cost` receipt, run by the JOB-006 sweeper on its
//     per-Organization rotation, bounded by `AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS`, after which
//     ONE Inbox item is raised per stuck receipt and retries stop. ★ JOB-017 generalized both
//     (the dispatcher is `redrivePendingProjection`; the JOB-016 names are kept): the same
//     bounded re-drive and single Inbox item now cover `activity_audit` and `output_projection`
//     receipts too, each through the seam registration's own mapping.
//
// Multi-tenant (F10): `cost_events` has no RLS (E2-D03). Every charge takes its Organization and
// Company from the lease the ingest guard locked (or the receipt row the re-drive locked), never
// from the worker, and `priceAcceptedUsageCore` refuses a Company its Organization does not own.

import { and, eq, sql } from "drizzle-orm";
import {
  hubItems,
  issues,
  jobEvents,
  jobs,
  type AcceptedEventProjectionOutcome,
  type AcceptedEventProjector,
  type AcceptEventInput,
  type Db,
  type PendingProjectionReceipt,
} from "@armyofagents/db";
import { submitJobSourceSchema, type SubmitJobSource } from "@armyofagents/shared";
import { usagePayloadV1Schema } from "@armyofagents/worker-protocol";
import { runInTenant, tenantRepositoriesForSavepoint } from "../db/tenant-context.js";
import {
  costSourceIdentity,
  flushDeferredBudgetSignals,
  NO_DEFERRED_BUDGET_SIGNALS,
  priceAcceptedUsageCore,
  type DeferredBudgetSignals,
} from "./job-budget-cost-bridge.js";
import type { AuthoritativeUsageUnits } from "./job-authoritative-rate.js";
import { publishActivity, type PreparedActivityEvent } from "./activity-log.js";
import { applyAcceptedEventAudit } from "./job-accepted-activity-audit.js";
import { applyAcceptedOutputEvent, loadAcceptedOutputTarget } from "./job-accepted-output-projection.js";

/** Amendment 3 — re-drive attempts per stuck receipt before ONE Inbox item is raised. */
export const AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS = 3;
/** E3-D-ACC (c) — a `pending` receipt older than this is "stale" and surfaced. */
export const STALE_PENDING_RECEIPT_THRESHOLD_MS = 15 * 60_000;
/** The hub source type of a stuck-charge Inbox item (idempotent on sourceType + receipt id). */
export const STUCK_CHARGE_HUB_SOURCE_TYPE = "job_projection_receipt";

// ---------------------------------------------------------------------------------------------
// Count-only telemetry. A CLOSED outcome union and a clamped count — never an id. Kept here, not
// on `JobControlMetrics`, because that interface is JOB-003's frozen plan contract.

export type AcceptedUsageOutcome =
  | "priced"
  | "replayed"
  | "pending"
  | "unrecorded"
  | "terminal_without_usage"
  | "stale_pending"
  | "redriven"
  | "redrive_failed"
  | "redrive_exhausted";

const ACCEPTED_USAGE_OUTCOMES: ReadonlySet<string> = new Set<AcceptedUsageOutcome>([
  "priced", "replayed", "pending", "unrecorded", "terminal_without_usage",
  "stale_pending", "redriven", "redrive_failed", "redrive_exhausted",
]);

export interface AcceptedUsageTelemetry {
  count(value: Readonly<{ outcome: AcceptedUsageOutcome; count: number }>): void;
}

export const NOOP_ACCEPTED_USAGE_TELEMETRY: AcceptedUsageTelemetry = Object.freeze({ count: () => {} });

export function createPinoAcceptedUsageTelemetry(
  log: { info: (...args: unknown[]) => void },
): AcceptedUsageTelemetry {
  return {
    count(value) {
      // Fold an out-of-union outcome to the conservative `unrecorded`; clamp the count.
      const outcome = ACCEPTED_USAGE_OUTCOMES.has(value.outcome) ? value.outcome : "unrecorded";
      const count = Number.isFinite(value.count)
        ? Math.min(Math.max(0, Math.floor(value.count)), Number.MAX_SAFE_INTEGER)
        : 0;
      try {
        log.info({ event: "job_control.accepted_usage", outcome, count });
      } catch {
        // Best-effort telemetry never changes control flow.
      }
    },
  };
}

/** Map one seam outcome onto the telemetry vocabulary. */
export function telemetryOutcomeFor(outcome: AcceptedEventProjectionOutcome): AcceptedUsageOutcome {
  switch (outcome.outcome) {
    case "applied": return "priced";
    case "replayed": return "replayed";
    case "pending": return "pending";
    default: return "unrecorded";
  }
}

// ---------------------------------------------------------------------------------------------
// The registration.

/** The job's SERVER-recorded pricing facts: its submit-time source and (for a task run) the
 * department its issue belongs to. Read in the caller's transaction, tenant-scoped. */
async function loadPricingContext(
  tx: Db,
  input: { organizationId: string; companyId: string; jobId: string },
): Promise<{ source: SubmitJobSource; projectId: string | null }> {
  const [job] = await tx
    .select({ sourceIntent: jobs.sourceIntent })
    .from(jobs)
    .where(and(
      eq(jobs.organizationId, input.organizationId),
      eq(jobs.companyId, input.companyId),
      eq(jobs.id, input.jobId),
    ))
    .limit(1);
  if (!job) throw new AcceptedUsagePricingError("job_not_found");
  const parsed = submitJobSourceSchema.safeParse(job.sourceIntent);
  if (!parsed.success) throw new AcceptedUsagePricingError("source_unparseable");
  const source = parsed.data as SubmitJobSource;
  let projectId: string | null = null;
  if (source.kind === "task_run") {
    // `issues` has no RLS (E2-D03): the charge's own Company is the filter (F10).
    const [issue] = await tx
      .select({ projectId: issues.projectId })
      .from(issues)
      .where(and(eq(issues.id, source.issueId), eq(issues.companyId, input.companyId)))
      .limit(1);
    projectId = issue?.projectId ?? null;
  }
  return { source, projectId };
}

/** Why a usage event could not be priced before the rate was even consulted. */
export class AcceptedUsagePricingError extends Error {
  readonly code: string;
  constructor(code: "job_not_found" | "source_unparseable" | "usage_unparseable" | "not_usage" | "identity_mismatch") {
    super(`accepted usage could not be priced: ${code}`);
    this.name = "AcceptedUsagePricingError";
    this.code = `ACCEPTED_USAGE_${code.toUpperCase()}`;
  }
}

/** The bounded units of a stored/accepted wire event (`event.payload` is the whole wire event). */
function usageUnitsOf(wireEvent: Record<string, unknown>): AuthoritativeUsageUnits {
  const parsed = usagePayloadV1Schema.safeParse(wireEvent.payload);
  if (!parsed.success) throw new AcceptedUsagePricingError("usage_unparseable");
  return parsed.data;
}

/**
 * THE JOB-016 registration on the E3-D-ACC seam. Applies to `usage` events only; its receipt
 * identity is the JOB-012 one, `cost:{company}:{eventId}`, so the wrapper and the seam share one
 * idempotency key and can never charge the same event twice.
 */
export function createAcceptedUsagePricingProjector(options?: {
  /**
   * Receives each charged event's owed budget side effects (`budget.exhausted` scopes and
   * `budget.incident_created` live events). The projector runs inside a savepoint of an
   * uncommitted ingest, so it must NOT perform them; the ingest flushes them after commit, and
   * only for events whose seam outcome is `applied` (a rolled-back savepoint owes nothing).
   */
  onOwedBudgetSignals?: (eventId: string, signals: DeferredBudgetSignals) => void;
}): AcceptedEventProjector {
  return {
    projectionKind: "authoritative_cost",
    aggregateKind: "cost_events",
    sourceIdentity(event: AcceptEventInput, fence) {
      return event.eventType === "usage" ? costSourceIdentity(fence.companyId, event.eventId) : null;
    },
    async apply({ tx, event, fence }) {
      const units = usageUnitsOf(event.payload);
      const context = await loadPricingContext(tx, fence);
      const priced = await priceAcceptedUsageCore(
        { tx, repos: tenantRepositoriesForSavepoint(tx) },
        {
          source: context.source,
          organizationId: fence.organizationId,
          companyId: fence.companyId,
          jobId: fence.jobId,
          acceptedEventId: event.eventId,
          units,
          projectId: context.projectId,
          // SERVER time — never the worker's occurredAt (E3-D-ACC build-shaping point).
          occurredAt: new Date(),
        },
      );
      options?.onOwedBudgetSignals?.(event.eventId, priced);
      return { targetAggregateId: priced.costEventId };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Acceptance 4 — terminal without usage.

export interface TerminalWithoutUsageSignal {
  readonly classification: "terminal_without_usage";
  readonly organizationId: string;
  readonly companyId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly terminalStatus: string;
  readonly sourceKind: string | null;
}

/**
 * Called by the ingest, inside its transaction, when THIS ingest just accepted a terminal event.
 * Runs in its own SAVEPOINT and swallows every error (returning `null`): a failure here must
 * never abort the transaction that holds the append.
 */
export async function detectTerminalWithoutUsage(
  tx: Db,
  identity: { organizationId: string; companyId: string; jobId: string; attemptId: string; terminalStatus: string },
): Promise<TerminalWithoutUsageSignal | null> {
  try {
    return await tx.transaction(async (sp) => {
      const spDb = sp as unknown as Db;
      const [usage] = await spDb
        .select({ one: sql<number>`1` })
        .from(jobEvents)
        .where(and(
          eq(jobEvents.organizationId, identity.organizationId),
          eq(jobEvents.attemptId, identity.attemptId),
          eq(jobEvents.eventType, "usage"),
        ))
        .limit(1);
      if (usage) return null;
      const [job] = await spDb
        .select({ sourceKind: jobs.sourceKind })
        .from(jobs)
        .where(and(eq(jobs.organizationId, identity.organizationId), eq(jobs.id, identity.jobId)))
        .limit(1);
      return {
        classification: "terminal_without_usage" as const,
        organizationId: identity.organizationId,
        companyId: identity.companyId,
        jobId: identity.jobId,
        attemptId: identity.attemptId,
        terminalStatus: identity.terminalStatus,
        sourceKind: job?.sourceKind ?? null,
      };
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Amendment 3 — re-drive. GENERALIZED by JOB-017 (E3-D-ACC (c) as-built note, 2026-09-21): one
// dispatcher keyed by receipt kind re-drives `authoritative_cost`, `activity_audit` and
// `output_projection`, each through the SAME mapping the seam registration uses.

/** The receipt kinds the re-drive can resolve. Any other kind is detected and logged only. */
export const REDRIVABLE_PROJECTION_KINDS: ReadonlySet<string> = new Set([
  "authoritative_cost",
  "activity_audit",
  "output_projection",
]);

export type RedriveOutcome =
  | {
    status: "redriven";
    projectionKind: string;
    targetAggregateId: string;
    /** Set for an `authoritative_cost` receipt (the JOB-016 shape, kept). */
    costEventId?: string;
  }
  | { status: "not_pending" };

/** Why a re-drive refused a receipt it could lock. */
export class ProjectionRedriveError extends Error {
  readonly code: string;
  constructor(code: "identity_mismatch" | "event_missing" | "event_type_mismatch" | "no_task" | "worker_unknown") {
    super(`pending projection could not be re-driven: ${code}`);
    this.name = "ProjectionRedriveError";
    this.code = `PROJECTION_REDRIVE_${code.toUpperCase()}`;
  }
}

/** The event id a receipt identity names, or a refusal when the identity is not this kind's. */
function eventIdOf(receipt: PendingProjectionReceipt, prefix: string): string {
  const full = `${prefix}:${receipt.companyId}:`;
  if (!receipt.sourceIdentity.startsWith(full)) throw new ProjectionRedriveError("identity_mismatch");
  return receipt.sourceIdentity.slice(full.length);
}

/**
 * Re-drive ONE `pending` projection receipt of a re-drivable kind. The attempt may be terminal, so
 * there is no fence: the receipt row, locked FOR UPDATE, stands in for it (a concurrent re-drive of
 * the same receipt blocks, then sees it `applied` and returns `not_pending`). The event comes from
 * the stored `job_events` row the identity names; the Organization and Company come from the
 * locked receipt, never from a payload. Each kind runs through the SAME core and mapping the seam
 * uses, so a re-driven row is the row the seam would have written. Any failure throws and rolls
 * the whole transaction back — the receipt stays `pending` for the sweep's next bounded attempt.
 * Owed live events (budget signals, `activity.logged`) are performed only AFTER commit.
 */
export async function redrivePendingProjection(
  appDb: Db,
  input: { organizationId: string; receiptId: string },
): Promise<RedriveOutcome> {
  let owedBudget: DeferredBudgetSignals = NO_DEFERRED_BUDGET_SIGNALS;
  let owedActivity: PreparedActivityEvent | null = null;
  const outcome = await runInTenant(appDb, input.organizationId, async (repos, tx): Promise<RedriveOutcome> => {
    const receipt = await repos.jobControl.lockPendingProjectionReceipt(input);
    if (!receipt || !REDRIVABLE_PROJECTION_KINDS.has(receipt.projectionKind)) return { status: "not_pending" as const };
    const readStored = async (eventId: string) => {
      const stored = await repos.jobControl.readAcceptedEvent({
        organizationId: receipt.organizationId,
        attemptId: receipt.attemptId,
        eventId,
      });
      if (!stored) throw new ProjectionRedriveError("event_missing");
      return stored;
    };
    const resolve = async (targetAggregateId: string, aggregateKind: string) => {
      const resolved = await repos.jobControl.resolvePendingProjectionReceipt({
        organizationId: receipt.organizationId,
        receiptId: receipt.id,
        targetAggregateId,
        aggregateKind,
      });
      if (!resolved.applied) throw new Error("pending receipt changed under its own lock");
    };

    if (receipt.projectionKind === "authoritative_cost") {
      const eventId = eventIdOf(receipt, "cost");
      const stored = await readStored(eventId);
      if (stored.eventType !== "usage") throw new AcceptedUsagePricingError("not_usage");
      const units = usageUnitsOf(stored.payload);
      const context = await loadPricingContext(tx, receipt);
      const priced = await priceAcceptedUsageCore({ tx, repos }, {
        source: context.source,
        organizationId: receipt.organizationId,
        companyId: receipt.companyId,
        jobId: receipt.jobId,
        acceptedEventId: eventId,
        units,
        projectId: context.projectId,
        occurredAt: new Date(),
      });
      await resolve(priced.costEventId, "cost_events");
      owedBudget = priced;
      return {
        status: "redriven" as const,
        projectionKind: receipt.projectionKind,
        targetAggregateId: priced.costEventId,
        costEventId: priced.costEventId,
      };
    }

    if (receipt.projectionKind === "activity_audit") {
      const eventId = eventIdOf(receipt, "activity");
      const stored = await readStored(eventId);
      if (!stored.workerId) throw new ProjectionRedriveError("worker_unknown");
      const wire = stored.payload as { payload?: { status?: unknown } };
      const recorded = await applyAcceptedEventAudit(tx, {
        organizationId: receipt.organizationId,
        companyId: receipt.companyId,
        jobId: receipt.jobId,
        attemptId: receipt.attemptId,
        attemptNumber: stored.attemptNumber,
        leaseId: stored.leaseId,
        workerId: stored.workerId,
        eventId,
        sequence: stored.sequence,
        eventType: stored.eventType,
        terminalStatus: stored.eventType === "terminal" && typeof wire.payload?.status === "string"
          ? wire.payload.status
          : null,
      });
      await resolve(recorded.activityId, "activity_log");
      owedActivity = recorded.prepared;
      return { status: "redriven" as const, projectionKind: receipt.projectionKind, targetAggregateId: recorded.activityId };
    }

    // output_projection
    const eventId = eventIdOf(receipt, "output");
    const stored = await readStored(eventId);
    if (stored.eventType !== "artifact_prepared") throw new ProjectionRedriveError("event_type_mismatch");
    const target = await loadAcceptedOutputTarget(tx, receipt);
    if (!target) throw new ProjectionRedriveError("no_task");
    const projected = await applyAcceptedOutputEvent(tx, {
      organizationId: receipt.organizationId,
      companyId: receipt.companyId,
      jobId: receipt.jobId,
      attemptId: receipt.attemptId,
      attemptNumber: stored.attemptNumber,
      eventId,
      wireEvent: stored.payload,
    }, target);
    await resolve(projected.outputId, "task_outputs");
    return { status: "redriven" as const, projectionKind: receipt.projectionKind, targetAggregateId: projected.outputId };
  });
  // AFTER COMMIT ONLY — a rolled-back re-drive threw above and owes nothing.
  flushDeferredBudgetSignals(owedBudget);
  const activity = owedActivity as PreparedActivityEvent | null;
  if (activity) {
    try { publishActivity(activity); } catch { /* best-effort live poke; the row is durable */ }
  }
  return outcome;
}

/**
 * The JOB-016 name, kept because the composition root and the Amendment 3 tests call it. Since
 * JOB-017 it IS the generalized dispatcher (`redrivePendingProjection`) — not a fork of it.
 */
export const redrivePendingAuthoritativeCost = redrivePendingProjection;

/** The Inbox side of Amendment 3, injectable so the sweep is testable without a hub. */
export interface StuckChargeNotifier {
  /** Whether this receipt's stuck-charge item already exists (the DURABLE stop condition). */
  isNotified(receipt: PendingProjectionReceipt): Promise<boolean>;
  /** Raise ONE item for this receipt. Idempotent on (company, sourceType, receipt id). */
  notify(receipt: PendingProjectionReceipt, attempts: number): Promise<void>;
}

/** The Inbox copy for a receipt whose re-drive exhausted its bound, per receipt kind. */
function stuckProjectionCopy(projectionKind: string, attempts: number): {
  semanticType: "budget_alert" | "run_failed";
  title: string;
  summary: string;
} {
  if (projectionKind === "activity_audit") {
    return {
      semanticType: "run_failed",
      title: "A distributed run's audit record could not be written",
      summary:
        `An accepted change to a distributed job could not be recorded in the activity log after ${attempts} ` +
        "attempts. The change itself is durable; its audit row is still owed.",
    };
  }
  if (projectionKind === "output_projection") {
    return {
      semanticType: "run_failed",
      title: "A distributed run's output could not be added to its task",
      summary:
        `An artifact a distributed job produced could not be added to its task after ${attempts} attempts. ` +
        "The artifact is stored; it is not yet visible on the task.",
    };
  }
  return {
    semanticType: "budget_alert",
    title: "A distributed run's usage could not be charged",
    summary:
      `The usage of a distributed job could not be priced after ${attempts} attempts. ` +
      "The charge is still owed, and this Organization's rollback drain stays blocked " +
      "until it is resolved.",
  };
}

/** The production notifier: the existing hub emit path (`hubItemsService.emit`). */
export function createHubStuckChargeNotifier(db: Db): StuckChargeNotifier {
  return {
    async isNotified(receipt) {
      const [row] = await db
        .select({ id: hubItems.id })
        .from(hubItems)
        .where(and(
          eq(hubItems.companyId, receipt.companyId),
          eq(hubItems.sourceType, STUCK_CHARGE_HUB_SOURCE_TYPE),
          eq(hubItems.sourceId, receipt.id),
        ))
        .limit(1);
      return Boolean(row);
    },
    async notify(receipt, attempts) {
      // Dynamic: keeps the hub/live-event graph out of the ingest's static import graph.
      const { hubItemsService } = await import("./hub-items.js");
      const copy = stuckProjectionCopy(receipt.projectionKind, attempts);
      await hubItemsService(db).emit({
        companyId: receipt.companyId,
        semanticType: copy.semanticType,
        sourceType: STUCK_CHARGE_HUB_SOURCE_TYPE,
        sourceId: receipt.id,
        title: copy.title,
        summary: copy.summary,
        relatedEntityType: "job",
        relatedEntityId: receipt.jobId,
        priority: "high",
      });
    },
  };
}

export interface RedriveSweepResult {
  stale: number;
  redriven: number;
  failed: number;
  notified: number;
}

export interface AuthoritativeCostRedriveSweep {
  sweepOrganization(organizationId: string): Promise<RedriveSweepResult>;
}

/**
 * The per-Organization detector + re-drive the JOB-006 sweeper runs. For every `pending` receipt
 * older than the threshold it logs the detector line (ids on the logger, never a metric label);
 * for a re-drivable receipt (`REDRIVABLE_PROJECTION_KINDS`: `authoritative_cost`, and since JOB-017
 * `activity_audit` and `output_projection`) it then re-drives, at most `maxAttempts` times per receipt
 * in this process, after which it raises ONE Inbox item and stops. The stop is DURABLE: a receipt
 * whose item exists is never retried again, so a restart cannot resume retries or raise a second
 * item. A notifier failure leaves the receipt eligible for the next tick.
 */
export function createAuthoritativeCostRedriveSweep(input: {
  appDb: Db;
  notifier: StuckChargeNotifier;
  log: { warn: (...args: unknown[]) => void; info: (...args: unknown[]) => void };
  telemetry?: AcceptedUsageTelemetry;
  maxAttempts?: number;
  staleAfterMs?: number;
  batchLimit?: number;
  now?: () => Date;
  redrive?: typeof redrivePendingProjection;
}): AuthoritativeCostRedriveSweep {
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS));
  const staleAfterMs = Math.max(0, Math.floor(input.staleAfterMs ?? STALE_PENDING_RECEIPT_THRESHOLD_MS));
  // Generous by default: a receipt already escalated to the Inbox still matches the stale query, so
  // a small page could fill with escalated receipts and starve a newer one of its re-drive.
  const batchLimit = Math.max(1, Math.min(500, Math.floor(input.batchLimit ?? 200)));
  const now = input.now ?? (() => new Date());
  const telemetry = input.telemetry ?? NOOP_ACCEPTED_USAGE_TELEMETRY;
  const redrive = input.redrive ?? redrivePendingProjection;
  const attempts = new Map<string, number>();

  return {
    async sweepOrganization(organizationId) {
      const result: RedriveSweepResult = { stale: 0, redriven: 0, failed: 0, notified: 0 };
      const olderThan = new Date(now().getTime() - staleAfterMs);
      const stale = await runInTenant(input.appDb, organizationId, (repos) =>
        repos.jobControl.listStalePendingProjectionReceipts({ organizationId, olderThan, limit: batchLimit }));
      for (const receipt of stale) {
        // JOB-017 — every re-drivable kind (cost, audit, output) goes through the same bounded
        // re-drive and the same single Inbox item; any other kind is detected and logged only.
        const isRedrivable = REDRIVABLE_PROJECTION_KINDS.has(receipt.projectionKind);
        // An escalated receipt is already visible in the Inbox; re-logging it every tick would
        // only bury the new ones. The durable stop: never retried again.
        if (isRedrivable && await input.notifier.isNotified(receipt)) continue;
        result.stale += 1;
        telemetry.count({ outcome: "stale_pending", count: 1 });
        input.log.warn({
          classification: "stale_pending_projection_receipt",
          organizationId: receipt.organizationId,
          companyId: receipt.companyId,
          projectionKind: receipt.projectionKind,
          receiptId: receipt.id,
          jobId: receipt.jobId,
          attemptId: receipt.attemptId,
          createdAt: receipt.createdAt.toISOString(),
        }, "stale pending projection receipt");
        if (!isRedrivable) continue;

        const tried = attempts.get(receipt.id) ?? 0;
        if (tried < maxAttempts) {
          try {
            const outcome = await redrive(input.appDb, { organizationId, receiptId: receipt.id });
            attempts.delete(receipt.id);
            if (outcome.status === "redriven") {
              result.redriven += 1;
              telemetry.count({ outcome: "redriven", count: 1 });
            }
            continue;
          } catch (err) {
            attempts.set(receipt.id, tried + 1);
            result.failed += 1;
            telemetry.count({ outcome: "redrive_failed", count: 1 });
            input.log.warn({
              err, organizationId, companyId: receipt.companyId, receiptId: receipt.id,
              jobId: receipt.jobId, attemptId: receipt.attemptId, attempt: tried + 1, maxAttempts,
              projectionKind: receipt.projectionKind,
            }, "pending-projection re-drive failed");
            if (tried + 1 < maxAttempts) continue;
          }
        }
        // The bound is reached: raise ONE Inbox item and stop retrying this receipt.
        try {
          await input.notifier.notify(receipt, maxAttempts);
          attempts.delete(receipt.id);
          result.notified += 1;
          telemetry.count({ outcome: "redrive_exhausted", count: 1 });
        } catch (err) {
          input.log.warn({ err, organizationId, receiptId: receipt.id }, "stuck-charge Inbox item could not be raised");
        }
      }
      return result;
    },
  };
}
