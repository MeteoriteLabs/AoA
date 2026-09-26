// server/src/services/job-control-audit.ts
//
// E9-F010 (Unit) — DURABLE, ATOMIC audit for the JOB-008 operator control mutations, written
// WITHOUT a fence, on the same fenceless transactional `activity_log` path SVC-007b established
// for the service-control routes (`service-control-audit.ts`).
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────
//
// E9-F010 measured that three mutating endpoints on the distributed-execution router wrote no
// durable `activity_log` row — `POST .../jobs` (submit), `.../jobs/:jobId/drain`, and
// `.../workers/:workerId/revoke` — leaving only a `logger.info` line, which is not a record.
// The recorded reason ("the fenced `jobAuditBridge` cannot be called here") is the BRIDGE's
// admission requirement, not the TABLE's: `insertActivityLog` takes a plain `Db`/`tx`, `aoa_app`
// holds `INSERT` on `activity_log`, and a fenceless transactional write already ships on the
// distributed path (`stageJobInputFiles`). So these routes CAN be audited — the same one call
// each SVC-007b used, inside the mutation's own tenant transaction.
//
// ★ THE REPLAY GUARD IS THE TRANSACTION, exactly as in `service-control-audit.ts`: the audit
// row is written in the SAME tenant transaction as the mutation, so a commit yields exactly one
// of each and a rollback yields neither. There is no window in which one is durable and the
// other is not — a stronger guarantee than a receipt reconciling two separately-written rows.
//
// ★ `runId` AND `agentId` ARE FORCED NULL at the one place both writers pass through, for the
// reason `service-control-audit.ts` states: `activity_log.run_id` FKs `heartbeat_runs`, a
// distributed attempt id is not one, and passing it would 23503 the mutation back. WHO acted is
// carried by (`actorType`, `actorId`) — for drain the operator user (`assertOrgAdmin` guarantees
// a real board user id before any mutation), for submit the authenticated principal mapped
// through the canonical `actorTypeForPrincipalKind`.
//
// ★ WHAT IS NOT AUDITED HERE: `worker.revoked`. A worker is ORG-scoped (no `companyId` column),
// its revoke transaction is org/platform-scoped, and `activity_log_company_or_denial_check`
// (migration `0274`) REQUIRES a non-null `company_id` for a non-`security.denied.` action. A
// worker revoke has no singular company, so it cannot be written to `activity_log` as a product
// row without an org-scoped audit sink — the same org-scope/company-null problem E0-F013
// Decision 2 addressed only for the reserved denial namespace. E9-F010 therefore stays OPEN on
// revoke, attributed to that blocker rather than to "nobody wired it".

import type { Db } from "@armyofagents/db";
import type { ActivityActorType } from "@armyofagents/shared";
import { insertActivity, publishActivity, type PreparedActivityEvent } from "./activity-log.js";

/**
 * Map an authenticated principal kind to its `ActivityActorType` for an audit row.
 *
 * ★ This MIRRORS the canonical `actorTypeForPrincipalKind` (worker-admission-denial-audit.ts) and
 * MUST stay equal to it — pinned by the parity test in `job-control-audit.test.ts`. It is duplicated
 * into THIS light, logger-free module on purpose: `job-submission.ts` deliberately keeps its STATIC
 * import graph logger-free (a static import of the denial-audit chain pulls `middleware/logger.js` and
 * binds the logger to the wrong sink before `AOA_LOG_DIR` is set — see job-submission.ts's own
 * comment), so it cannot statically import the canonical copy.
 */
export function jobActorTypeForPrincipalKind(kind: string): ActivityActorType {
  if (kind === "agent") return "agent";
  if (kind === "user" || kind === "commander" || kind === "local_board") return "user";
  return "system";
}

/** The `entity_type` every job-control audit row carries. */
export const JOB_AUDIT_ENTITY_TYPE = "job";

/** The audited action for an operator drain. Reuses the drain route's structured-log `action`
 *  so the durable row and the process log read the same string and cannot drift. */
export const JOB_DRAIN_ACTION = "job.drain.requested";

/** The audited action for a job submission (the pre-JOB-008 operator/agent submit route). */
export const JOB_SUBMIT_ACTION = "job.submitted";

/** WHO performed the control action. `actorId` is NOT NULL (`activity_log.actor_id` is NOT NULL);
 *  for drain the route's `assertOrgAdmin` guarantees a real board user id before the mutation. */
export interface JobControlActor {
  actorType: ActivityActorType;
  actorId: string;
}

export interface JobDrainAuditInput {
  actor: JobControlActor;
  companyId: string;
  organizationId: string;
  jobId: string;
  /** The drain outcome that mutated — `queued` (a new drain command) or `already_requested`
   *  (an idempotent re-request of one). NEVER `no_active_lease` / `not_found` / `job_terminal`,
   *  none of which queue a command; the caller records this ONLY on a mutating outcome. */
  outcome: string;
  /** The queued drain command id, when one is present. */
  commandId: string | null;
  /** The operator's bounded reason, already length-limited by the route body schema. */
  reason: string;
}

/**
 * Record that an operator drained a job — INSIDE the tenant transaction that queued the drain
 * control command. Returns the prepared event so the caller publishes it AFTER commit (a
 * pre-commit poke would announce a drain a later rollback un-does).
 */
export async function recordJobDrainActivity(
  tx: Db,
  input: JobDrainAuditInput,
): Promise<PreparedActivityEvent> {
  return insertActivity(tx, {
    companyId: input.companyId,
    actorType: input.actor.actorType,
    actorId: input.actor.actorId,
    action: JOB_DRAIN_ACTION,
    entityType: JOB_AUDIT_ENTITY_TYPE,
    entityId: input.jobId,
    agentId: null,
    runId: null,
    details: {
      organizationId: input.organizationId,
      jobId: input.jobId,
      outcome: input.outcome,
      commandId: input.commandId,
      reason: input.reason,
    },
  });
}

export interface JobSubmitAuditInput {
  actor: JobControlActor;
  companyId: string;
  organizationId: string;
  jobId: string;
  attemptId: string;
  /** The submission source kind (e.g. `board`, `mcp`, `debrief_push`), for the audit detail. */
  sourceKind: string;
}

/**
 * Record that a NEW job was submitted — INSIDE the tenant transaction that inserted it. The
 * caller records this ONLY on a fresh submission (`replayed: false`); an idempotent replay
 * mutated nothing new and its winning transaction already wrote this row. Returns the prepared
 * event for the caller to publish AFTER commit.
 */
export async function recordJobSubmitActivity(
  tx: Db,
  input: JobSubmitAuditInput,
): Promise<PreparedActivityEvent> {
  return insertActivity(tx, {
    companyId: input.companyId,
    actorType: input.actor.actorType,
    actorId: input.actor.actorId,
    action: JOB_SUBMIT_ACTION,
    entityType: JOB_AUDIT_ENTITY_TYPE,
    entityId: input.jobId,
    agentId: null,
    runId: null,
    details: {
      organizationId: input.organizationId,
      jobId: input.jobId,
      attemptId: input.attemptId,
      sourceKind: input.sourceKind,
    },
  });
}

/**
 * Publish prepared job-control audit events AFTER their transaction has committed. BEST-EFFORT
 * per event: a live-channel poke that throws must never turn a committed control action into a
 * 500. The durable row is the invariant; the poke is the feed catching up.
 */
export function publishJobControlActivity(events: readonly PreparedActivityEvent[]): void {
  for (const event of events) {
    try {
      publishActivity(event);
    } catch {
      /* best-effort live poke — the row is already durable */
    }
  }
}
