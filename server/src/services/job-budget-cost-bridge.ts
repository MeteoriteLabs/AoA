// server/src/services/job-budget-cost-bridge.ts
//
// JOB-012 — Preserve budget and authoritative cost policy (parity/shadow bridge).
//
// A distributed attempt's ACCEPTED usage event must be priced by the EXISTING
// budget/cost authority EXACTLY ONCE — never a parallel ledger, never a worker-supplied
// price, never a second capacity-release engine. This bridge:
//
//   * Reads the worker event's BOUNDED USAGE UNITS only (input/output/cached tokens +
//     runtime millis). It NEVER reads a price from the worker.
//   * The SERVER resolves provider/model/biller/billing-type/rate/version/rounding via
//     the versioned, FAIL-CLOSED `resolveAuthoritativeRate` — an unknown model throws
//     BEFORE any write (0 cost_events, 0 receipts).
//   * Charges the EXISTING cost writer ONCE per accepted-event identity (agent-bearing
//     task_run → costService.createEvent w/ agent+company rollup; every other source →
//     the agent-less recordOneShotCliCost w/ company rollup), stamping
//     cost_events.project_id so DEPARTMENT policies observe the spend.
//   * Writes a JOB-005 projection RECEIPT (`authoritative_cost`) linking the cost_events
//     row to the distributed attempt, guarded by the active fence.
//   * Drives the EXISTING budget engine SYNCHRONOUSLY (not the legacy fire-and-forget):
//     warning/incident/pause/emit at agent+company+department scope, and on a NEW
//     hard-stop breach drives the EXISTING `requestCancellation` — which releases the
//     attempt's Organization capacity slot EXACTLY ONCE (JOB-007 owns admit/release; the
//     bridge never runs a second release engine of its own).
//
// THE load-bearing exactly-once invariant: `costService.createEvent` /
// `recordOneShotCliCost` have NO native dedup. On a replay the JOB-005 receipt identity
// (org, company, projection_kind, source_identity=`cost:{company}:{eventId}`) is the
// guard. So the charge moment does a receipt FAST-PATH lookup BEHIND the fence lock
// BEFORE the non-idempotent charge — exactly like JOB-011's product-approval path. The
// new `cost_events (company_id, source_idempotency_key)` partial unique is the DB
// backstop if the lock/fast-path is ever bypassed.
//
// Flag gate: when distributed execution is OFF, every entrypoint refuses fail-closed
// and touches NOTHING, so every current path stays byte-for-byte unchanged. The rollback
// gate (`assertRollbackSafe`) fails closed while an `authoritative_cost` receipt is
// pending, so disabling can never erase or skip an authoritative charge.

import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { companies, jobProjectionReceipts } from "@armyofagents/db";
import type { ActiveFenceRequest, Db, TenantRepositories } from "@armyofagents/db";
import type { SubmitJobSource } from "@armyofagents/shared";
import { runInTenant } from "../db/tenant-context.js";
import { readDistributedExecutionDeploymentFlag } from "../config/distributed-execution.js";
import { resolveCompanyOrganizationId } from "./org-concurrency.js";
import { assertAdmissibleMappedOrganization } from "./tenant-admission.js";
import { budgetService } from "./budgets.js";
import { emitBudgetExhausted, type BudgetEnforcementScope } from "./budget-hooks.js";
import { publishLiveEvent } from "./live-events.js";
import { costService } from "./costs.js";
import { recordOneShotCliCost } from "./one-shot-cli-budget.js";
import { resolveAuthoritativeRate, type AuthoritativeUsageUnits } from "./job-authoritative-rate.js";
import type { AuthenticatedJobPrincipal } from "./job-submission.js";

/** The actor a bridge caller presents — the authenticated principal plus the Company
 * scope needed to resolve the immutable Company→Organization ownership edge. */
export type BridgeActor = AuthenticatedJobPrincipal & { companyId: string };

export interface PriceAcceptedUsageInput {
  /** The submission source — decides agent-bearing vs agent-less charge + rate model. */
  source: SubmitJobSource;
  actor: BridgeActor;
  /** The LIVE distributed attempt to bind the charge to (composite FK + fence). */
  fence: ActiveFenceRequest;
  /** The accepted usage event id — the stable per-charge source identity. */
  acceptedEventId: string;
  /** The accepted event's digest (64-hex reused as the receipt digest). */
  eventDigest: string;
  /** BOUNDED UNITS ONLY. The bridge NEVER reads a price from here. */
  units: AuthoritativeUsageUnits;
  /** Department attribution → cost_events.project_id (department policies observe it). */
  projectId?: string | null;
  /** When set (defaults now) — override only for tests/backfills. */
  occurredAt?: Date;
}

export interface PriceAcceptedUsageOutcome {
  /** `pending` (E3-D-ACC): a receipt exists but its charge is still owed — never a cost row. */
  status: "charged" | "replayed" | "pending";
  costEventId: string | null;
  receiptId: string | null;
  costCents: number | null;
  incidentCreated: boolean;
  cancelled: boolean;
}

/** Thrown when any bridge entrypoint is called while distributed execution is off.
 * Fail-closed: the bridge does nothing, so the legacy path is untouched. */
export class JobBudgetCostBridgeDisabledError extends Error {
  readonly code = "JOB_BUDGET_COST_BRIDGE_DISABLED";
  constructor() {
    super("Job budget/cost bridge is disabled while distributed execution is off");
    this.name = "JobBudgetCostBridgeDisabledError";
  }
}

/** Thrown by the rollback gate while an `authoritative_cost` receipt is still pending —
 * disabling the bridge must never erase or skip an in-flight authoritative charge. */
export class JobBudgetCostBridgeRollbackPendingError extends Error {
  readonly code = "JOB_BUDGET_COST_BRIDGE_ROLLBACK_PENDING";
  constructor() {
    super("Cannot disable the budget/cost bridge while an authoritative-cost receipt is pending");
    this.name = "JobBudgetCostBridgeRollbackPendingError";
  }
}

export interface JobBudgetCostBridge {
  isEnabled(): boolean;
  priceAcceptedUsage(input: PriceAcceptedUsageInput): Promise<PriceAcceptedUsageOutcome>;
  assertRollbackSafe(companyId: string): Promise<void>;
}

const AUTHORITATIVE_COST_KIND = "authoritative_cost" as const;

/** The authoritative-cost receipt source identity — keyed on the accepted event id,
 * since the cost writers have NO native dedup and the receipt is the sole replay guard. */
export function costSourceIdentity(companyId: string, acceptedEventId: string): string {
  return `cost:${companyId}:${acceptedEventId}`;
}

/** Normalize the caller's event digest to the 64-hex the receipt CHECK requires. */
function normalizeDigest(eventDigest: string): string {
  return /^[0-9a-f]{64}$/.test(eventDigest)
    ? eventDigest
    : createHash("sha256").update(eventDigest).digest("hex");
}

/** Read the authoritative-cost receipt for this identity (the replay fast-path). */
async function findCostReceipt(
  tx: Db,
  organizationId: string,
  companyId: string,
  sourceIdentity: string,
): Promise<{ id: string; targetAggregateId: string; status: string } | null> {
  const [row] = await tx
    .select({
      id: jobProjectionReceipts.id,
      targetAggregateId: jobProjectionReceipts.targetAggregateId,
      status: jobProjectionReceipts.status,
    })
    .from(jobProjectionReceipts)
    .where(and(
      eq(jobProjectionReceipts.organizationId, organizationId),
      eq(jobProjectionReceipts.companyId, companyId),
      eq(jobProjectionReceipts.projectionKind, AUTHORITATIVE_COST_KIND),
      eq(jobProjectionReceipts.sourceIdentity, sourceIdentity),
    ))
    .limit(1);
  return row ?? null;
}

/** E3-D-ACC (JOB-016, F10) — the charge names a Company the Organization does not own. */
export class JobBudgetCostTenantError extends Error {
  readonly code = "JOB_BUDGET_COST_TENANT";
  constructor() {
    super("The charged Company does not belong to the attempt's Organization");
    this.name = "JobBudgetCostTenantError";
  }
}

/** E3-D-ACC (a) — the transaction-taking core's input. No actor: `companyId` is the only
 * actor fact pricing uses, and it comes from the lease the caller holds, never the worker. */
export interface PriceAcceptedUsageCoreInput {
  source: SubmitJobSource;
  organizationId: string;
  companyId: string;
  /** The job whose attempt produced the usage — the target of the breach cancel. */
  jobId: string;
  acceptedEventId: string;
  units: AuthoritativeUsageUnits;
  projectId?: string | null;
  /** The charge time. Callers pass SERVER time; a worker's `occurredAt` could back-date a
   * charge out of the current month's hard-stop window (E3-D-ACC). Defaults to now. */
  occurredAt?: Date;
}

export interface PriceAcceptedUsageCoreOutcome {
  costEventId: string;
  costCents: number;
  incidentCreated: boolean;
  cancelled: boolean;
  /** Queued jobs of a breached scope cancelled by this charge (E3-D-ACC Amendment 2). */
  scopeCancelled: number;
  /**
   * Newly-exhausted budget scopes whose in-process `budget.exhausted` signal is OWED. The core
   * never emits it: the listener cancels live heartbeat work on the global handle, and this charge
   * is still uncommitted. The caller emits these only AFTER its transaction commits
   * (`emitDeferredBudgetExhausted`), so a rolled-back charge cancels nothing.
   */
  exhaustedScopes: BudgetEnforcementScope[];
  /** Owed `budget.incident_created` live events, deferred for the same reason (Codex P2). */
  incidentLiveEvents: Parameters<typeof publishLiveEvent>[0][];
}

/** The side effects a charge OWES once it commits: never performed inside the transaction. */
export interface DeferredBudgetSignals {
  exhaustedScopes: readonly BudgetEnforcementScope[];
  incidentLiveEvents: readonly Parameters<typeof publishLiveEvent>[0][];
}

export const NO_DEFERRED_BUDGET_SIGNALS: DeferredBudgetSignals = Object.freeze({
  exhaustedScopes: [],
  incidentLiveEvents: [],
});

/** Perform owed budget side effects — call ONLY after the charge's transaction committed. */
export function flushDeferredBudgetSignals(signals: DeferredBudgetSignals): void {
  for (const event of signals.incidentLiveEvents) publishLiveEvent(event);
  for (const scope of signals.exhaustedScopes) emitBudgetExhausted(scope);
}

/** Charge the EXISTING cost writer ONCE. task_run rolls up its owning agent; every
 * other source is agent-less (company rollup only). Both stamp project_id + the
 * server rate/idempotency columns. Budget evaluation is deferred to the caller. */
async function chargeOnce(
  tx: Db,
  input: PriceAcceptedUsageCoreInput,
  priced: Awaited<ReturnType<typeof resolveAuthoritativeRate>>,
  sourceIdentity: string,
): Promise<{ id: string }> {
  const companyId = input.companyId;
  const occurredAt = input.occurredAt ?? new Date();
  if (input.source.kind === "task_run") {
    const event = await costService(tx).createEvent(
      companyId,
      {
        agentId: input.source.assigneeAgentId,
        provider: priced.provider,
        biller: priced.biller,
        billingType: priced.billingType,
        model: priced.model,
        inputTokens: input.units.inputTokens,
        cachedInputTokens: input.units.cachedInputTokens,
        outputTokens: input.units.outputTokens,
        costCents: priced.costCents,
        occurredAt,
        // Department attribution (department budget policies observe this). Issue-level
        // provenance is a documented follow-up — omitted here to keep the authoritative
        // charge dependent only on the department scope the ticket requires.
        projectId: input.projectId ?? null,
        sourceIdempotencyKey: sourceIdentity,
        rateId: priced.rateId,
        rateVersion: priced.rateVersion,
        roundingMode: priced.roundingMode,
      },
      { deferBudgetEvaluation: true },
    );
    return { id: event.id };
  }
  const event = await recordOneShotCliCost(tx, {
    companyId,
    provider: priced.provider,
    model: priced.model,
    inputTokens: input.units.inputTokens,
    outputTokens: input.units.outputTokens,
    cachedInputTokens: input.units.cachedInputTokens,
    costCents: priced.costCents,
    billingType: priced.billingType,
    biller: priced.biller,
    projectId: input.projectId ?? null,
    sourceIdempotencyKey: sourceIdentity,
    rateId: priced.rateId,
    rateVersion: priced.rateVersion,
    roundingMode: priced.roundingMode,
    occurredAt,
  });
  return { id: event.id };
}

/**
 * E3-D-ACC (a) — the TRANSACTION-TAKING pricing core.
 *
 * Runs on the caller's `tx`/`repos` and NEVER opens a transaction, NEVER locks or re-guards a
 * fence, NEVER reads or writes a projection receipt, and NEVER reads a flag: the caller (the
 * `priceAcceptedUsage` wrapper, the accepted-event seam, or the re-drive) owns all four. It
 * resolves the SERVER rate (fail closed), charges the existing cost writer once, drives the
 * budget engine synchronously, and on a hard-stop breach cancels this job AND the queued jobs of
 * each breached agent/company scope (Amendment 2 — legacy's cancel reaches heartbeat runs only).
 */
export async function priceAcceptedUsageCore(
  scope: { tx: Db; repos: TenantRepositories },
  input: PriceAcceptedUsageCoreInput,
): Promise<PriceAcceptedUsageCoreOutcome> {
  const { tx, repos } = scope;
  const companyId = input.companyId;
  // F10 — cost_events has no RLS (E2-D03): the Company must be the Organization's own.
  const [owner] = await tx
    .select({ organizationId: companies.organizationId })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!owner || owner.organizationId !== input.organizationId) throw new JobBudgetCostTenantError();

  const evalAgentId = input.source.kind === "task_run" ? input.source.assigneeAgentId : null;
  const projectId = input.projectId ?? null;
  const sourceIdentity = costSourceIdentity(companyId, input.acceptedEventId);

  // SERVER-SIDE resolution — FAIL CLOSED on an unknown rate BEFORE any write.
  const priced = await resolveAuthoritativeRate(tx, { source: input.source, companyId, units: input.units });
  const costEvent = await chargeOnce(tx, input, priced, sourceIdentity);

  // SYNCHRONOUS budget evaluation (not the legacy fire-and-forget), so a newly-created
  // incident — and legacy's agent pause — is visible in this committed state.
  const exhaustedScopes: BudgetEnforcementScope[] = [];
  const incidentLiveEvents: Parameters<typeof publishLiveEvent>[0][] = [];
  const evaluated = await budgetService(tx).evaluateCostEvent(evalAgentId, companyId, {
    projectId,
    deferExhaustedEmit: exhaustedScopes,
    deferLiveEvents: incidentLiveEvents,
  });

  // Exhaustion → cancel through the EXISTING engine (which releases the capacity slot EXACTLY
  // ONCE). Cancel whenever THIS charge crosses an applicable hard stop — NOT only when it won the
  // one-incident-per-window insert. commandId is the job id, so repeats dedup to ONE control.
  let cancelled = false;
  let scopeCancelled = 0;
  if (evaluated.hardStopBreached) {
    const now = new Date();
    const cancel = await repos.jobControl.requestCancellation({
      organizationId: input.organizationId,
      companyId,
      jobId: input.jobId,
      reason: "budget_exhausted",
      graceful: true,
      commandId: input.jobId,
      now,
    });
    cancelled = ["queued", "already_requested", "cancelled"].includes(cancel.status);

    // Amendment 2 — nothing more in a hard-stopped scope may be leased. Mirror legacy's
    // per-scope cancel (company: every queued run; agent: that agent's runs; department: none)
    // onto the QUEUED distributed jobs, which legacy's heartbeat-run cancel cannot reach.
    const scopedJobIds = new Set<string>();
    for (const breached of evaluated.breachedScopes ?? []) {
      if (breached.scopeType === "company" && breached.scopeId === companyId) {
        for (const id of await repos.jobControl.listQueuedJobIdsForBudgetScope({
          organizationId: input.organizationId, companyId,
        })) scopedJobIds.add(id);
      } else if (breached.scopeType === "agent") {
        for (const id of await repos.jobControl.listQueuedJobIdsForBudgetScope({
          organizationId: input.organizationId, companyId, assigneeAgentId: breached.scopeId,
        })) scopedJobIds.add(id);
      }
    }
    scopedJobIds.delete(input.jobId);
    // Job-id order: two concurrent breaching charges in one Company lock the same rows in the
    // same order, so they cannot form a wait-for cycle over them.
    for (const jobId of [...scopedJobIds].sort()) {
      const outcome = await repos.jobControl.requestCancellation({
        organizationId: input.organizationId,
        companyId,
        jobId,
        reason: "budget_exhausted",
        graceful: true,
        commandId: jobId,
        now,
      });
      if (outcome.status === "cancelled") scopeCancelled += 1;
    }
  }

  return {
    costEventId: costEvent.id,
    costCents: priced.costCents,
    incidentCreated: evaluated.hardStopIncidentCreated,
    cancelled,
    scopeCancelled,
    exhaustedScopes,
    incidentLiveEvents,
  };
}

export function jobBudgetCostBridge(
  appDb: Db,
  options?: { env?: Record<string, string | undefined> },
): JobBudgetCostBridge {
  const env = options?.env ?? process.env;

  function assertEnabled(): void {
    if (!readDistributedExecutionDeploymentFlag(env)) {
      throw new JobBudgetCostBridgeDisabledError();
    }
  }

  async function resolveAdmissibleOrganization(companyId: string): Promise<string> {
    const organizationId = await resolveCompanyOrganizationId(appDb, companyId);
    assertAdmissibleMappedOrganization(organizationId);
    return organizationId as string;
  }

  return {
    isEnabled(): boolean {
      return readDistributedExecutionDeploymentFlag(env);
    },

    async priceAcceptedUsage(input) {
      assertEnabled();
      const companyId = input.actor.companyId;
      const organizationId = await resolveAdmissibleOrganization(companyId);
      const projectId = input.projectId ?? null;

      let owed: DeferredBudgetSignals = NO_DEFERRED_BUDGET_SIGNALS;
      const outcome = await runInTenant(appDb, organizationId, async (repos, tx) => {
        // (a) TOCTOU guard — lock the lease+attempt FOR UPDATE (write nothing) so two
        // concurrent same-event charges serialize: the 2nd blocks until the 1st commits
        // its receipt, then observes it and replays. Without this the cost writers'
        // lack of native dedup would let both insert a charge.
        await repos.jobControl.lockActiveFence(input.fence);

        // (b) RECEIPT FAST-PATH — a replay returns the already-linked cost_events row
        // WITHOUT a second charge. E3-D-ACC: a `pending` receipt is an OWED charge whose
        // target is the attempt, not a cost row — report it as `pending`, never `replayed`.
        const sourceIdentity = costSourceIdentity(companyId, input.acceptedEventId);
        const existing = await findCostReceipt(tx, organizationId, companyId, sourceIdentity);
        if (existing) {
          const pending = existing.status === "pending";
          return {
            status: pending ? "pending" as const : "replayed" as const,
            costEventId: pending ? null : existing.targetAggregateId,
            receiptId: existing.id,
            costCents: null,
            incidentCreated: false,
            cancelled: false,
          };
        }

        // (c)-(h) the transaction-taking core (E3-D-ACC (a)): rate, charge, budget, cancel.
        const core = await priceAcceptedUsageCore({ tx, repos }, {
          source: input.source,
          organizationId,
          companyId,
          jobId: input.fence.jobId,
          acceptedEventId: input.acceptedEventId,
          units: input.units,
          projectId,
          occurredAt: input.occurredAt,
        });

        // RECEIPT applied in the SAME tenant transaction (fence-guarded — legitimate here,
        // because this wrapper is its own transaction and holds the fence it just locked).
        const recorded = await repos.jobControl.recordGovernedProjection({
          ...input.fence,
          projection: {
            projectionKind: AUTHORITATIVE_COST_KIND,
            aggregateKind: "cost_events",
            sourceIdentity,
            sourceDigest: normalizeDigest(input.eventDigest),
            targetAggregateId: core.costEventId,
            status: "applied",
          },
        });

        owed = core;
        return {
          status: "charged" as const,
          costEventId: core.costEventId,
          receiptId: recorded.receiptId,
          costCents: core.costCents,
          incidentCreated: core.incidentCreated,
          cancelled: core.cancelled,
        };
      });
      // AFTER COMMIT: the charge and its incident are durable, so the in-process signal may fire.
      flushDeferredBudgetSignals(owed);
      return outcome;
    },

    async assertRollbackSafe(companyId) {
      // Deliberately NOT flag-gated: the rollback gate is consulted DURING the disable
      // transition (the flag may already be off). It fails closed while any
      // authoritative-cost receipt is still pending so a charge can never be erased.
      const organizationId = await resolveAdmissibleOrganization(companyId);
      await runInTenant(appDb, organizationId, async (_repos, tx) => {
        const [row] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(jobProjectionReceipts)
          .where(and(
            eq(jobProjectionReceipts.organizationId, organizationId),
            eq(jobProjectionReceipts.companyId, companyId),
            eq(jobProjectionReceipts.projectionKind, AUTHORITATIVE_COST_KIND),
            eq(jobProjectionReceipts.status, "pending"),
          ));
        if ((row?.n ?? 0) > 0) throw new JobBudgetCostBridgeRollbackPendingError();
      });
    },
  };
}
