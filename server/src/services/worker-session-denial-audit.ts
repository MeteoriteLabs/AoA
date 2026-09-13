// server/src/services/worker-session-denial-audit.ts
//
// DE-18, session arm — the durable record a worker-SESSION `target_revoked`
// refusal leaves behind. `createWorkerSessionAuthenticator.authenticate` runs on
// EVERY session-authenticated worker request and refuses `target_revoked` when
// the presented (HMAC-verified) session's target/worker rows are no longer
// current — a disabled target, a revoked worker, a lost owner membership, or a
// device-generation bump (the DE-18 generation cutoff). Until this unit those
// refusals reached the route as a bare 401 with no row, no metric and no log
// line, on exactly the surface a superseded target-generation would probe first.
//
// ★ THREE REFUSAL SITES, THREE CODES — distinct branches, distinct machine
// reasons, matching the deny-path convention:
//   `session_authority_revoked`  — `verifyCurrent`'s current-authority recheck
//                                  (the per-request gate). The failing disjuncts
//                                  are collected into `details.failed` so a
//                                  reader can tell a disabled target from a
//                                  membership loss without widening the code set.
//   `platform_authority_revoked` — the shared-platform physical-authority
//                                  recheck for a platform-scope target.
//   `heartbeat_profile_revoked`  — `registerProofBoundHeartbeat`'s session-profile
//                                  touch refused (generation/profile drift at the
//                                  heartbeat write).
//
// ★ ATTRIBUTION. WHO = the presented worker (`actorType: "system"`,
// `actorId` = the session's `sub` — token-attested, HMAC-verified). TENANT =
// the ORGANIZATION axis only (`workers`/`execution_targets` carry no company),
// and for a PLATFORM-scope session the organization is null too: that row is
// DOUBLY NULL, which the reserved `security.denied.` namespace admits by the
// partial CHECK (E0-F013 Decision 2 (a2)) and which is the honest ceiling, not
// an oversight — the device thumbprint in `details` is what remains.
// RESOURCE = the execution target the session is pinned to.
//
// ★ WRITE PLACEMENT. The refusals THROW out of `runInTenant` / the operator
// transaction; the recorder is called by the OWNING function AFTER the
// transaction promise has rejected (catch → record on the POOL `appDb` →
// rethrow unchanged), so nothing here runs inside the transaction that is
// unwinding. ★ AMPLIFICATION, WEIGHED: `authenticate` runs per request, so a
// revoked-but-still-polling worker writes one row per refused request. That is
// the founder-ruled per-refusal reading (E0-F013 Decision 1.2c, the DE-27
// precedent), the request is already HMAC-verified device traffic (not
// anonymous), and the class-wide retention bound is E0-F018 — not a deviation
// here. ★ NEVER THROWS, inherited from `recordSecurityDenial`.

import type { Db } from "@armyofagents/db";
import { recordSecurityDenial } from "./security-denial-audit.js";

/** The reserved `surface` slug → the action `security.denied.worker_session`. */
export const WORKER_SESSION_DENIAL_SURFACE = "worker_session";

/** The crossing whose `audit` clause ("… generation changes are audited") every
 * row written here serves — the session arm DE-18's register row names as the
 * dominant unaudited production `target_revoked` surface. */
export const WORKER_SESSION_DENIAL_CROSSING = "DE-18";

export const WORKER_SESSION_DENIAL_REASONS = [
  "session_authority_revoked",
  "platform_authority_revoked",
  "heartbeat_profile_revoked",
] as const;

export type WorkerSessionDenialReason = (typeof WORKER_SESSION_DENIAL_REASONS)[number];

/** The `details.failed` conjunct name that marks a genuine generation cutoff — the
 * ONLY session-denial condition that is DE-18's target-generation replacement. */
export const SESSION_GENERATION_CONJUNCT = "generation_drift";

/**
 * Which crossing a session denial serves, DERIVED from the failed predicate
 * (Codex P2 on PR #448). Only a `generation_drift` failure is DE-18's
 * generation-replacement cutoff; a disabled target, a revoked worker, a lost
 * owner membership, a missing authority row or a credential/profile drift is a
 * stale-worker admission refusal → DE-04, NOT DE-18. A hardcoded DE-18 here would
 * pollute DE-18's audit measure exactly as the poll arm's did.
 */
export function workerSessionDenialCrossing(failed: readonly string[] | undefined): string {
  return failed?.includes(SESSION_GENERATION_CONJUNCT) ? "DE-18" : "DE-04";
}

/**
 * Record ONE worker-session `target_revoked` refusal. `db` MUST be a pool
 * handle — the caller invokes this after its transaction has unwound, never
 * inside it. The crossing is derived from `failed` (see
 * `workerSessionDenialCrossing`), so a non-generation failure is not filed under
 * DE-18. Returns the row id or null; never throws.
 */
export async function recordWorkerSessionDenial(
  db: Db,
  input: {
    reason: WorkerSessionDenialReason;
    /** Token-attested (session claims) or DB-resolved; null for a platform-scope
     * session, which is the doubly-null case the header names. */
    organizationId: string | null;
    workerId: string;
    targetId: string;
    targetGeneration: number;
    deviceThumbprint: string;
    /** The disjuncts that failed, naming the enforcing predicate(s). Decides the
     * crossing: `generation_drift` present → DE-18, else DE-04. Every call site
     * passes at least one name. */
    failed?: string[];
    control: string;
  },
): Promise<string | null> {
  return recordSecurityDenial(db, {
    companyId: null,
    organizationId: input.organizationId,
    crossing: workerSessionDenialCrossing(input.failed),
    surface: WORKER_SESSION_DENIAL_SURFACE,
    reason: input.reason,
    actorType: "system",
    actorId: input.workerId,
    entityType: "execution_target",
    entityId: input.targetId,
    control: input.control,
    details: {
      workerId: input.workerId,
      targetId: input.targetId,
      targetGeneration: input.targetGeneration,
      deviceThumbprint: input.deviceThumbprint,
      ...(input.failed && input.failed.length > 0 ? { failed: input.failed } : {}),
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    },
  });
}
