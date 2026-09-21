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
//     ONE Inbox item is raised per stuck receipt and retries stop.
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
// Amendment 3 — re-drive.

export type RedriveOutcome =
  | { status: "redriven"; costEventId: string }
  | { status: "not_pending" };

/**
 * Re-drive ONE `pending` `authoritative_cost` receipt. The attempt may be terminal, so there is
 * no fence: the receipt row, locked FOR UPDATE, stands in for it (a concurrent re-drive of the
 * same receipt blocks, then sees it `applied` and returns `not_pending`). The units come from
 * the stored `job_events` row the identity names; the charge runs through the SAME core as the
 * ingest. Any failure throws and rolls the whole transaction back — the receipt stays `pending`.
 */
export async function redrivePendingAuthoritativeCost(
  appDb: Db,
  input: { organizationId: string; receiptId: string },
): Promise<RedriveOutcome> {
  let owed: DeferredBudgetSignals = NO_DEFERRED_BUDGET_SIGNALS;
  const outcome = await runInTenant(appDb, input.organizationId, async (repos, tx): Promise<RedriveOutcome> => {
    const receipt = await repos.jobControl.lockPendingProjectionReceipt(input);
    if (!receipt || receipt.projectionKind !== "authoritative_cost") return { status: "not_pending" as const };
    const prefix = `cost:${receipt.companyId}:`;
    if (!receipt.sourceIdentity.startsWith(prefix)) throw new AcceptedUsagePricingError("identity_mismatch");
    const eventId = receipt.sourceIdentity.slice(prefix.length);
    const stored = await repos.jobControl.readAcceptedEvent({
      organizationId: receipt.organizationId,
      attemptId: receipt.attemptId,
      eventId,
    });
    if (!stored || stored.eventType !== "usage") throw new AcceptedUsagePricingError("not_usage");
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
    const resolved = await repos.jobControl.resolvePendingProjectionReceipt({
      organizationId: receipt.organizationId,
      receiptId: receipt.id,
      targetAggregateId: priced.costEventId,
      aggregateKind: "cost_events",
    });
    if (!resolved.applied) throw new Error("pending receipt changed under its own lock");
    owed = priced;
    return { status: "redriven" as const, costEventId: priced.costEventId };
  });
  flushDeferredBudgetSignals(owed); // after commit only
  return outcome;
}

/** The Inbox side of Amendment 3, injectable so the sweep is testable without a hub. */
export interface StuckChargeNotifier {
  /** Whether this receipt's stuck-charge item already exists (the DURABLE stop condition). */
  isNotified(receipt: PendingProjectionReceipt): Promise<boolean>;
  /** Raise ONE item for this receipt. Idempotent on (company, sourceType, receipt id). */
  notify(receipt: PendingProjectionReceipt, attempts: number): Promise<void>;
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
      await hubItemsService(db).emit({
        companyId: receipt.companyId,
        semanticType: "budget_alert",
        sourceType: STUCK_CHARGE_HUB_SOURCE_TYPE,
        sourceId: receipt.id,
        title: "A distributed run's usage could not be charged",
        summary:
          `The usage of a distributed job could not be priced after ${attempts} attempts. ` +
          "The charge is still owed, and this Organization's rollback drain stays blocked " +
          "until it is resolved.",
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
 * for an `authoritative_cost` receipt it then re-drives, at most `maxAttempts` times per receipt
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
  redrive?: typeof redrivePendingAuthoritativeCost;
}): AuthoritativeCostRedriveSweep {
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? AUTHORITATIVE_COST_REDRIVE_MAX_ATTEMPTS));
  const staleAfterMs = Math.max(0, Math.floor(input.staleAfterMs ?? STALE_PENDING_RECEIPT_THRESHOLD_MS));
  // Generous by default: a receipt already escalated to the Inbox still matches the stale query, so
  // a small page could fill with escalated receipts and starve a newer one of its re-drive.
  const batchLimit = Math.max(1, Math.min(500, Math.floor(input.batchLimit ?? 200)));
  const now = input.now ?? (() => new Date());
  const telemetry = input.telemetry ?? NOOP_ACCEPTED_USAGE_TELEMETRY;
  const redrive = input.redrive ?? redrivePendingAuthoritativeCost;
  const attempts = new Map<string, number>();

  return {
    async sweepOrganization(organizationId) {
      const result: RedriveSweepResult = { stale: 0, redriven: 0, failed: 0, notified: 0 };
      const olderThan = new Date(now().getTime() - staleAfterMs);
      const stale = await runInTenant(input.appDb, organizationId, (repos) =>
        repos.jobControl.listStalePendingProjectionReceipts({ organizationId, olderThan, limit: batchLimit }));
      for (const receipt of stale) {
        const isCost = receipt.projectionKind === "authoritative_cost";
        // An escalated cost receipt is already visible in the Inbox; re-logging it every tick
        // would only bury the new ones. The durable stop: never retried again.
        if (isCost && await input.notifier.isNotified(receipt)) continue;
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
        if (!isCost) continue;

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
            }, "authoritative-cost re-drive failed");
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
