// packages/db/src/repositories/tenant/job-fence.ts
//
// JOB-004 — the ONE common active-fence predicate + the CLOSED enumerated set of
// governed job-control mutators that MUST gate on it.
//
// Every governed worker-authenticated mutation on the distributed-execution path
// (event acceptance, ordinary artifact metadata/commit authorization, secret-handle
// read, attempt/job terminal completion, service-instance health, projection-receipt
// apply, control-command ACK) may proceed ONLY while the presenting worker still
// holds the ACTIVE lease fence. A lease that has been superseded (replaced fence,
// bumped generation), expired against fresh database time, revoked, or whose attempt
// reached a terminal state MUST NOT be able to mutate any governed surface.
//
// This module owns the shared vocabulary — the predicate `isActiveFence`, the fence
// identity shape, the terminal-status set, the guarded-mutator name list, and the
// typed `JobFenceError`. The repository (`job-control.ts`) builds a `tx`-bound guard
// (`guardActiveFence`) around this predicate that EVERY guarded mutator invokes
// before touching a row; `server/src/services/job-fencing.ts` re-exports the
// predicate + surface so server-side callers share the exact same seam. The static
// contract test (`job-fence-surface.contract.test.ts`) fails closed if a future
// ticket adds a governed mutator without the guard.
//
// Runtime storage for the not-yet-built surfaces (events, projection receipts,
// control commands) is filled by JOB-005/006/011 BEHIND this already-guarded
// interface; JOB-004 lands only the predicate, the closed interface, and the
// negative contract.

/**
 * The CLOSED, enumerated set of governed job-control mutators. Every name here is
 * a method on the tenant `JobControlRepository` that MUST call the common
 * active-fence guard before mutating (or reading) a governed surface. Adding a new
 * governed mutator requires appending it here AND wiring the guard — the static
 * surface contract test enforces both.
 */
export const GUARDED_JOB_MUTATORS = [
  "acceptEvent",
  "authorizeArtifactCommit",
  // DAT-002 — the fenced verified-commit of a rich artifact manifest (fence-first,
  // then verify hash/size/prefix/tenant, then idempotent committed insert).
  "commitArtifactVersion",
  // DAT-003 — the fenced apply/review of a committed workspace_patch (fence-first,
  // then base revalidation → advance the accepted base (applied) OR conflict
  // quarantine; NEVER auto-applies a mismatched base; idempotent).
  "recordPatchApplyState",
  "readSecretHandle",
  "completeAttempt",
  "recordServiceHealth",
  "applyProjectionReceipt",
  "ackControlCommand",
] as const;
export type GuardedJobMutator = (typeof GUARDED_JOB_MUTATORS)[number];

/** Job-attempt statuses in which the run has terminated; no governed fence may
 * mutate against a terminal attempt (it returns `attempt_terminal`). */
export const TERMINAL_ATTEMPT_STATUSES = ["succeeded", "failed", "cancelled", "expired"] as const;
export type TerminalAttemptStatus = (typeof TERMINAL_ATTEMPT_STATUSES)[number];

/** Why a governed mutation was refused. These map 1:1 onto the frozen worker
 * operation error codes surfaced by the leasing/fencing services. */
export type JobFenceErrorCode = "stale_fence" | "target_revoked" | "attempt_terminal";

/**
 * Raised by the common active-fence guard when the presenting fence is not the
 * current active fence. Never discloses payload, fence material, or foreign
 * identifiers — only the closed classification code.
 */
export class JobFenceError extends Error {
  constructor(public readonly code: JobFenceErrorCode) {
    super(`Job fence ${code}`);
    this.name = "JobFenceError";
  }
}

/** DAT-002 — why a fenced artifact commit was refused AFTER the fence admitted it
 * (i.e. the fence is active but the manifest fails verification). These are the
 * INTERNAL precise reasons; the server maps them onto the frozen closed protocol
 * error vocabulary for the wire (`wrong_prefix`/`size_mismatch`/`tenant_mismatch`
 * → `malformed`, `hash_mismatch` → `event_hash_mismatch`). Fence staleness always
 * precedes these (the guard runs first), so an active-but-mismatched manifest is
 * the only path here. */
export type ArtifactCommitRejectionReason = "wrong_prefix" | "size_mismatch" | "hash_mismatch" | "tenant_mismatch";

/** Raised by the fenced commit mutator when the active-fence guard admitted the
 * caller but the manifest fails hash/size/prefix/tenant verification. Distinct from
 * `JobFenceError` so the service maps it to a verification reject, never a fence
 * reject. Discloses only the closed classification reason. */
export class ArtifactCommitRejection extends Error {
  constructor(public readonly reason: ArtifactCommitRejectionReason) {
    super(`Artifact commit rejected: ${reason}`);
    this.name = "ArtifactCommitRejection";
  }
}

/** DAT-003 — why a fenced patch APPLY was refused AFTER the fence admitted it.
 * `patch_not_committed` = no committed `workspace_patch` row for the identity;
 * `object_key_mismatch` = the caller-presented object key does not equal the
 * committed row's object key (the parsed content is not bound to the committed,
 * immutable object). A base MISMATCH is NOT a rejection — it is an
 * `apply_status='conflict_quarantined'` disposition, surfaced for review. */
export type PatchApplyRejectionReason = "patch_not_committed" | "object_key_mismatch";

/** Raised by the fenced apply mutator when the active-fence guard admitted the
 * caller but the target patch row is missing/uncommitted or the presented object
 * key does not match the committed row. Distinct from `JobFenceError` so the
 * service maps it to a coarse, non-disclosing reject, never a fence reject. */
export class PatchApplyRejection extends Error {
  constructor(public readonly reason: PatchApplyRejectionReason) {
    super(`Patch apply rejected: ${reason}`);
    this.name = "PatchApplyRejection";
  }
}

/** The complete lease identity a governed mutation binds to. Every field is
 * matched under a row lock before any governed row is touched. */
export interface ActiveFenceRequest {
  organizationId: string;
  companyId: string;
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  leaseId: string;
  workerId: string;
  targetId: string;
  targetAuthorityKey: string;
  targetGeneration: number;
  profileHash: string;
  providerConstraintHash: string;
  fence: string;
}

/** The locked lease + attempt snapshot the predicate decides against, plus the
 * freshly-evaluated `expires_at > clock_timestamp()` fact (computed in SQL inside
 * the same transaction — never a transaction-start or JavaScript wall-clock time). */
export interface ActiveFenceSnapshot {
  leaseStatus: string;
  attemptStatus: string;
  /** `expires_at > clock_timestamp()` evaluated with a FRESH database clock. */
  expiresFresh: boolean;
}

/**
 * THE common active-fence predicate. A fence is active iff the lease is `active`,
 * its stored expiry is still ahead of a FRESH database clock, and its attempt has
 * not reached a terminal state. Pure and side-effect free: the caller supplies the
 * locked snapshot (identity is matched by the guard's locking read) and the
 * freshly-computed expiry fact.
 */
export function isActiveFence(snapshot: ActiveFenceSnapshot): boolean {
  return (
    snapshot.leaseStatus === "active" &&
    snapshot.expiresFresh &&
    !(TERMINAL_ATTEMPT_STATUSES as readonly string[]).includes(snapshot.attemptStatus)
  );
}

/**
 * Classify a locked snapshot into the refusal code (or `null` when the fence is
 * active). Terminal attempts are `attempt_terminal`; everything else non-active
 * (wrong status, expired against fresh time) is `stale_fence`. Fence/identity
 * MISMATCH and a missing row are `stale_fence` too, but that is decided by the
 * guard's locking read (a non-match returns no row), not here.
 */
export function classifyFence(snapshot: ActiveFenceSnapshot): JobFenceErrorCode | null {
  if ((TERMINAL_ATTEMPT_STATUSES as readonly string[]).includes(snapshot.attemptStatus)) {
    return "attempt_terminal";
  }
  if (!isActiveFence(snapshot)) return "stale_fence";
  return null;
}
