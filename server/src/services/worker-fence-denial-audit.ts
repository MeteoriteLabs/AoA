// server/src/services/worker-fence-denial-audit.ts
//
// DE-06, audit clause — the durable record ONE of `resolveWorkerFenceContext`'s
// SIX throw sites can leave behind, and the sink that carries it out of the
// tenant transaction the throw unwinds.
//
// ★ WHAT THIS IS AND, FIRST, WHAT IT IS NOT. `resolveWorkerFenceContext`
// (`worker-fence-context.ts`) refuses at SIX throw sites: `:75` (proof replay),
// `:89` (one site, two codes — `unauthorized` with no authority, `target_revoked`
// with one), `:92` (target inactive), `:97` (profile drift), `:110` (no lease
// resolved), and the post-resolution tuple-integrity branch. At FIVE of them
// there is no company in hand at all: `workers` and `execution_targets` carry
// `organization_id` only, and the lease — the one row that carries `company_id`
// — is precisely what has not resolved yet. `activity_log.company_id` is
// `NOT NULL` with a cascade FK, so those five cannot be written here and are
// NOT written here. They remain `E0-F013`'s Decision 2. This module serves the
// SIXTH, and only the sixth.
//
// ★ WHY THE SIXTH IS DIFFERENT, and why the reason is not the obvious one.
// `packages/db/src/schema/leases.ts:28` declares `companyId: uuid("company_id")`
// with NO `.notNull()`, so the TypeScript type at the tuple-integrity branch is
// `string | null` and `!context.lease.companyId` is literally the FIRST disjunct
// of the condition that throws there. The value is nevertheless present because
// `lockLeaseAckContext` (`packages/db/src/repositories/tenant/job-control.ts`)
// resolves the context through
// `innerJoin(jobAttempts, … eq(jobAttempts.companyId, leases.companyId) …)` and
// `jobAttempts.companyId` is `NOT NULL` — SQL `NULL = <anything>` is never true,
// so a null-company lease NEVER joins, `context` comes back null, and the
// refusal lands on the earlier `!context` throw instead. Every lease that
// reaches the tuple-integrity branch therefore carries a joined, FK-valid
// company. That is an argument about a JOIN, not about a column, so the caller
// side takes a RUNTIME NARROW rather than a non-null assertion: the null
// disjunct is split into its own throw above, which keeps the wire behaviour
// identical (both were `stale_fence`) and leaves the recorder reading a plain
// `string`.
//
// ★ WHY A SINK RATHER THAN A DIRECT CALL. The refusal is a THROW out of
// `runInTenant`, so writing the row where it is decided would (a) borrow a
// second pool connection while the tenant transaction still holds the first —
// the self-deadlock `artifact-denial-audit.ts` documents — and (b) be rolled
// back with the transaction that is unwinding. So the refusing branch records
// its INTENT into a caller-owned holder, the throw propagates unchanged, and the
// caller drains the holder on the POOL handle after the transaction has closed.
// The sink parameter on `resolveWorkerFenceContext` is REQUIRED, so a fifth
// caller cannot be added without deciding what it does about the record.
//
// ★ WHAT A DRAIN COSTS THE REFUSAL PATH: nothing it can observe.
// `recordSecurityDenial` never throws, and the drain runs in a `finally`, so a
// broken recorder cannot convert a fence refusal into a 500 and cannot suppress
// the `JobLeasingError` the caller is about to see.

import type { Db } from "@armyofagents/db";
import { recordSecurityDenial } from "./security-denial-audit.js";

/** The reserved `surface` slug → `security.denied.worker_fence_resolution`. */
export const WORKER_FENCE_DENIAL_SURFACE = "worker_fence_resolution";

/**
 * The reason vocabulary, closed at ONE code because exactly one of the six
 * throw sites is attributable today. A second code here would be a claim that a
 * second site had been solved.
 *
 * `fence_tuple_mismatch` — the lease row RESOLVED (organization, lease id, job,
 * attempt number, worker, target, target generation, profile hash and fence all
 * matched the lookup) but one of the residual conjuncts the lookup does not
 * cover disagreed with the CURRENT authority/target: `target_authority_key`,
 * `provider_constraint_hash`, or one of the defence-in-depth re-checks. The
 * worker still sees the coarse, non-disclosing `stale_fence`; the branch that
 * actually fired is named here, in `details.mismatched`.
 */
export const WORKER_FENCE_DENIAL_REASONS = ["fence_tuple_mismatch"] as const;

export type WorkerFenceDenialReason = (typeof WORKER_FENCE_DENIAL_REASONS)[number];

/**
 * What the refusing branch records for its caller to write once the tenant
 * transaction has unwound. `companyId` is the LOCKED LEASE's company — resolved
 * from the database under the refusing worker's own organization GUC, never a
 * caller-supplied field — so the row names the tenant that REFUSED rather than
 * any tenant the request reached for (the DE-19 non-disclosure precedent).
 */
export interface WorkerFenceDenialIntent {
  reason: WorkerFenceDenialReason;
  companyId: string;
  /** The lease row the refusal resolved and then rejected. */
  leaseId: string;
  /** The residual conjuncts that disagreed, in condition order. Never empty. */
  mismatched: string[];
  details: Record<string, unknown>;
}

/** The caller-owned holder. A one-field object rather than a bare `let`: a `let`
 * narrows from its initializer and would read back as `never` at the drain. */
export interface WorkerFenceDenialSink {
  intent: WorkerFenceDenialIntent | null;
}

export function createWorkerFenceDenialSink(): WorkerFenceDenialSink {
  return { intent: null };
}

/**
 * Write the pending intent, if any, on a POOL-level handle. Idempotent per
 * refusal because the sink is cleared as it drains, and a no-op when nothing was
 * recorded — so a caller may (and should) drain from a `finally`.
 */
export async function drainWorkerFenceDenial(
  db: Db,
  sink: WorkerFenceDenialSink,
  caller: {
    /** `path/to/file.ts:symbol` — what lets an operator go from a row to a line. */
    control: string;
    /** The refused worker. `actor_id` is plain text with no FK, which is what
     * makes a machine identity with no `agents`/`auth` row usable directly. */
    workerId: string;
    organizationId: string;
    /** The operation the worker was attempting, e.g. "artifact_commit". */
    operation: string;
  },
): Promise<string | null> {
  const pending = sink.intent;
  if (!pending) return null;
  sink.intent = null;
  return recordSecurityDenial(db, {
    companyId: pending.companyId,
    crossing: "DE-06",
    surface: WORKER_FENCE_DENIAL_SURFACE,
    reason: pending.reason,
    // A worker is a machine identity in the execution plane: it has no row in
    // `agents` and no row in `auth`, so neither the `agent` nor the `user` actor
    // kind would be truthful.
    actorType: "system",
    actorId: caller.workerId,
    // The refused RESOURCE is the lease whose fence tuple failed integrity — not
    // the artifact/patch/secret the operation was ultimately after, which the
    // control never got far enough to authorize.
    entityType: "job_lease",
    entityId: pending.leaseId,
    control: caller.control,
    details: {
      ...pending.details,
      operation: caller.operation,
      organizationId: caller.organizationId,
      workerId: caller.workerId,
      mismatched: pending.mismatched,
    },
  });
}
