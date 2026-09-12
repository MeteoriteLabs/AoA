// server/src/services/worker-admission-denial-audit.ts
//
// DE-27, audit clause — the durable record a cross-replica WORKER-ADMISSION refusal
// leaves behind, for both of the two admission deny sites the clause names.
//
// ★ WHAT THE CLAUSE ASKS, AS AMENDED. `docs/architecture/distributed-execution-threat-controls.json`
// DE-27 asserted "cross-replica admission AND partition events are audited". The
// clause was AMENDED by E0-F013 Decision 1.2(c) (founder-ruled 2026-09-11) and is
// SPLIT:
//   (1) the "cross-replica admission" conjunct is read WEAKLY and is what this
//       module delivers — each admission REFUSAL is durably recorded. Admission is
//       already DB-serialized across replicas (`pg_advisory_xact_lock` over the
//       organization in `org-concurrency.ts`, and the shared
//       `worker_admission_rate_limits` counter both replicas increment), so the
//       clause does NOT require a record that names WHICH replica decided — the
//       system has no replica identity and this conjunct no longer implies one.
//   (2) the "partition events" conjunct is DROPPED as vacuous: there is no
//       partition detector, so no partition event exists to record.
// So the whole remaining deliverable is: durably record the TWO admission
// refusals. There are exactly two.
//
// ★ THE TWO DENY SITES, and why they need different mechanisms.
//   over_cap  — the shared per-organization worker-poll rate limiter,
//               `worker-admission-rate-limit.ts admit()`. The tenant transaction
//               that increments the shared counter has ALREADY COMMITTED and
//               returned the count by the time the over-cap branch is taken, so
//               `opts.appDb` is a pool-level handle and the record is written
//               DIRECTLY there, before the refusal is returned. No intent/drain is
//               needed: nothing is about to roll back.
//   capacity  — the shared per-organization concurrency cap,
//               `org-concurrency.ts admitAttemptCapacity()`. Its `admitted:false`
//               return is a plain `return` (Drizzle COMMITS a callback that returns
//               and only rolls back one that throws), so in isolation the row would
//               survive an in-transaction write. But that authority has NO pool
//               handle of its own — every production caller invokes it with `tx`,
//               the SAME tenant transaction opened by `submitJobWithinTenant`'s
//               `runInTenant` — and every one of those callers, on seeing
//               `admitted:false`, THROWS (`HttpError(429)` /
//               `TenantAdmissionDeniedError`), which rolls the whole submission
//               transaction back. So a row written on that transaction is DISCARDED
//               with it. The refusal must therefore be recorded on a POOL handle
//               AFTER the tenant transaction has closed — the intent-record-then-
//               drain pattern `worker-denial-audit.ts` established, for exactly the
//               reason `security-denial-audit.ts`'s header states: "db MUST be a
//               pool-level handle, never the transaction that is about to reject".
//
// ★ WHY A DRAIN AND NOT AN IN-TRANSACTION WRITE ON THE CAPACITY PATH, stated even
// though that path COMMITS in isolation. `recordSecurityDenial` is designed to run
// in its OWN transaction on a pool handle: its FK-violation retry (a replayed token
// from a torn-down organization) re-inserts with a null organization, and a retry
// inside a caller's transaction would fail with 25P02 on the aborted transaction and
// be swallowed. Writing the row inside `admitAttemptCapacity`'s transaction would
// also risk the self-deadlock the sibling recorders document (a second pool
// connection borrowed while the first is held) if it ever reached for the pool. The
// drain sidesteps both: the refusing branch records its INTENT into a caller-owned
// holder, the throw propagates unchanged, and the caller drains the holder on the
// pool handle in a `finally` after the transaction has closed.
//
// ★ ATTRIBUTION, AND WHY THE ORGANIZATION IS BOTH TENANT AND ACTOR HERE. Both deny
// sites are ORGANIZATION-SCOPED admission authorities — the rate-limit counter is
// keyed on `(organization_id, window_start)`, and the concurrency cap is
// `organizations.concurrency_cap` serialized under one advisory lock per
// organization. There is no worker, agent, or user principal at the control point:
// the poll limiter is consulted BEFORE the frozen poll authority resolves a worker,
// and the capacity claim is consulted on behalf of a job attempt, not a principal.
// So the honest WHO is the organization whose admission was refused, recorded with
// `actorType: "system"` and `actorId = organizationId`. That is the closest stable
// identity this control point holds, not an oversight — a finer principal does not
// exist here. The organization id is TOKEN-ATTESTED or DB-CONSISTENT, never off the
// wire: over_cap's org comes out of `verifyWorkerOperationProof`
// (`worker-control.ts` -> `admit(auth.organizationId)`), and capacity's org and
// company are the ids the just-inserted `job_attempts` row carries under the
// submission's own organization GUC (an insert RLS accepted moments earlier), the
// same ids that drive `runInTenant`. Actor-attribution is the ratified model
// (E0-F013 Decision 3 Q1): a cross-tenant probe files its refusal under its OWN
// tenant, never the probed one.
//
// ★ THE TWO RESOURCES DIFFER, deliberately. over_cap names the organization's
// worker-poll admission (`entityType: "worker_poll_admission"`, `entityId` = the
// organization) — a per-org bucket, with the window count and limit in `details`.
// capacity names the specific attempt refused admission (`entityType:
// "job_attempt"`, `entityId` = the attempt), with the observed usage and cap in
// `details`. A reader can tell "the org's poll burst was throttled" from "this
// attempt could not claim a slot".
//
// ★ ONE SURFACE, TWO REASONS. Both refusals write the single action
// `security.denied.worker_admission`, and the `reason` code (`over_cap` |
// `capacity`) distinguishes the branch — so "how many admission refusals did this
// organization take" is one `action` predicate and the two mechanisms are still
// told apart in the durable record. `security.denied.` is the reserved namespace
// `activity-namespace.ts` guards, so these rows are excluded from every tenant-facing
// activity feed by `notDenialNamespace()` (Decision 3): an admission refusal is not
// disclosed to the tenant that provoked it.
//
// ★ IT NEVER THROWS, inherited from `recordSecurityDenial`: a failure to record a
// refusal must not convert the refusal into a 500, hand a caller an oracle, or make
// the audit path a denial-of-service lever on the refusal path. A failed insert is
// logged at error level with the attribution the row would have carried and
// swallowed. The cost of a swallow is that a silently-broken writer looks like a
// quiet system, so `de-27-admission-audit.integration.test.ts` is written to go RED
// when either write is removed, and it was observed doing so.
//
// ★ DORMANCY / STATIC-GRAPH NOTE. This module imports `security-denial-audit.ts`,
// which imports the app logger, so it is NOT logger-free. `worker-admission-rate-limit.ts`
// (the over_cap caller) already imports the logger and loads only under the
// distributed-execution flag, so a static import there changes nothing. The capacity
// callers (`job-submission.ts`, `job-admission-bridge.ts`, `service-reconciler.ts`)
// must stay logger-free in their static graph, so they import ONLY the sink TYPE
// (erased at compile time) and load `drainAdmissionDenial` DYNAMICALLY, and only when
// an intent was actually captured.

import type { Db } from "@armyofagents/db";
import { recordSecurityDenial } from "./security-denial-audit.js";

/** The reserved `surface` slug → `security.denied.worker_admission`. */
export const WORKER_ADMISSION_DENIAL_SURFACE = "worker_admission";

/**
 * The reason vocabulary. Each code is exactly ONE admission deny BRANCH, so a reader
 * can tell a shared-rate-limit refusal from a shared-concurrency-cap refusal. The
 * worker/caller wire answer is unchanged (`throttled` / 429) in both cases — the
 * discrimination lives only in the audit row.
 *
 * `over_cap`  — the per-organization worker-poll window count exceeded its cap
 *               (`worker-admission-rate-limit.ts admit()`), fail-CLOSED shared-store
 *               errors excluded (those are `unavailable`, an infra fault the caller
 *               already logs, not the cross-replica cap refusal this clause names).
 * `capacity`  — the shared organization concurrency cap was reached
 *               (`org-concurrency.ts admitAttemptCapacity()`, the `usage >= cap`
 *               branch). The `budget` deny just above it is a DIFFERENT crossing's
 *               concern and is not recorded here, and the second `reason:"capacity"`
 *               return below the claim UPDATE (a released/terminal/gone attempt that
 *               is not a fresh cap refusal) is a distinct branch this clause does not
 *               cover — see the note in `org-concurrency.ts`.
 */
export const WORKER_ADMISSION_DENIAL_REASONS = ["over_cap", "capacity"] as const;

export type WorkerAdmissionDenialReason = (typeof WORKER_ADMISSION_DENIAL_REASONS)[number];

/** The crossing whose `audit` clause every row this module writes exists to satisfy. */
const WORKER_ADMISSION_CROSSING = "DE-27";

export interface WorkerAdmissionDenialInput {
  /** WHY, as one of the two stable branch codes. */
  reason: WorkerAdmissionDenialReason;
  /**
   * The COMPANY axis, or `null` where the refusing control holds none. `null` for
   * over_cap (the poll limiter is org-scoped and no company is in scope); the
   * submitting company for capacity. A `null` here is a claim that nothing in scope
   * resolves a company, and it is admissible because the action is in the reserved
   * `security.denied.` namespace (the `activity_log_company_or_denial_check` partial
   * CHECK).
   */
  companyId: string | null;
  /** The ORGANIZATION axis. Token-attested or DB-resolved; never off the wire. */
  organizationId: string;
  /** WHICH RESOURCE — the kind of thing refused. */
  entityType: string;
  /** WHICH RESOURCE — its id. */
  entityId: string;
  /** The refusing control, `path/to/file.ts:symbol`. */
  control: string;
  /** Anything else worth keeping; redacted by `recordSecurityDenial`. */
  details?: Record<string, unknown>;
}

/**
 * Record one worker-admission refusal durably and attributably. The shared recorder
 * BOTH deny sites funnel through — the over_cap site calls it directly on its pool
 * handle, and the capacity site reaches it through `drainAdmissionDenial`.
 *
 * `actorType`/`actorId` are `system`/`organizationId`: admission is org-scoped and
 * carries no finer principal at the control point (see the module header). Returns
 * the row id, or `null` when nothing could be written (logged at error by
 * `recordSecurityDenial`).
 */
export async function recordWorkerAdmissionDenial(
  db: Db,
  input: WorkerAdmissionDenialInput,
): Promise<string | null> {
  return recordSecurityDenial(db, {
    companyId: input.companyId,
    organizationId: input.organizationId,
    crossing: WORKER_ADMISSION_CROSSING,
    surface: WORKER_ADMISSION_DENIAL_SURFACE,
    reason: input.reason,
    // A worker-admission refusal has no worker/agent/user identity at the control
    // point (see the header): the organization whose admission was refused is the
    // stable actor. `actor_id` is plain text with no FK, so an organization id is
    // safe to record directly.
    actorType: "system",
    actorId: input.organizationId,
    entityType: input.entityType,
    entityId: input.entityId,
    control: input.control,
    details: {
      ...(input.details ?? {}),
      organizationId: input.organizationId,
    },
  });
}

/**
 * What the capacity deny branch records for its caller to write once the tenant
 * transaction has closed. A capacity refusal always holds an FK-valid company (the
 * just-inserted attempt carries it), so `companyId` is a `string`, not nullable.
 */
export interface AdmissionDenialIntent {
  reason: "capacity";
  companyId: string;
  organizationId: string;
  /** The attempt that could not claim an organization capacity slot. */
  attemptId: string;
  /**
   * The control that REFUSED — the deny site (`org-concurrency.ts:admitAttemptCapacity`),
   * captured here rather than derived from the drain site, so the row's `control` names
   * where the decision was made and not where the row happened to be written. The drain
   * site is recorded separately in `details.drainedBy`.
   */
  control: string;
  /** The observed usage/cap and workload type, for the durable row's `details`. */
  details: Record<string, unknown>;
}

/**
 * The caller-owned holder. A one-field object rather than a bare `let`: TypeScript
 * narrows a `let` from its initializer and cannot see an assignment made inside the
 * `admitAttemptCapacity` closure, so it would read back as `never` at the drain.
 */
export interface AdmissionDenialSink {
  intent: AdmissionDenialIntent | null;
}

export function createAdmissionDenialSink(): AdmissionDenialSink {
  return { intent: null };
}

/**
 * Write the pending capacity-refusal intent, if any, on a POOL-level handle. A
 * no-op when nothing was captured (so a caller may — and should — drain from a
 * `finally`, on both the success and the throw path), and idempotent per refusal
 * because the sink is cleared as it drains. Never throws.
 */
export async function drainAdmissionDenial(
  db: Db,
  sink: AdmissionDenialSink,
  caller: {
    /** `path/to/file.ts:symbol` — the drain site, what lets an operator go from a row to a line. */
    control: string;
  },
): Promise<string | null> {
  const pending = sink.intent;
  if (!pending) return null;
  sink.intent = null;
  return recordWorkerAdmissionDenial(db, {
    reason: pending.reason,
    companyId: pending.companyId,
    organizationId: pending.organizationId,
    entityType: "job_attempt",
    entityId: pending.attemptId,
    // The refusing control is the deny site (from the intent), not this drain site.
    control: pending.control,
    details: {
      ...pending.details,
      attemptId: pending.attemptId,
      // Where the row was actually written (the pool-handle drain, after the tenant
      // transaction closed), kept alongside the deny site for the operator's trail.
      drainedBy: caller.control,
    },
  });
}
