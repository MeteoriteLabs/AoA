// server/src/services/worker-fence-context.ts
//
// DAT-002 — the shared worker-operation authentication + fence-identity resolution
// used by the artifact transfer-grant and fenced-commit services. It mirrors the
// dual-auth recheck the event-ingest / lease-renewal services already run
// (proof record → CURRENT authority recheck under fresh DB time → active target →
// lease-row resolution of the rich JOB-003 fence tuple) and returns the complete
// `ActiveFenceRequest` identity + the locked lease row.
//
// It does NOT itself gate on the active fence — the caller decides: an artifact
// UPLOAD grant + a COMMIT require a live fence (guard/commit mutator), while a
// DOWNLOAD grant is deliberately tenant-scoped + object-existence only (a committed
// artifact must stay readable after lease loss). Auth failures throw
// `JobLeasingError` (mapped to an HTTP protocol error by the route); only fence /
// verification refusals are surfaced by the caller as a `rejected` outcome.

import type { ActiveFenceRequest, TenantRepositories } from "@armyofagents/db";
import {
  ackAuthorityCurrent,
  JobLeasingError,
  type VerifiedWorkerOperation,
} from "./job-leasing.js";
import { normalizePlacementRegistryTarget } from "./execution-target-resolver.js";

export interface ResolvedFenceContext {
  fenceIdentity: ActiveFenceRequest;
  /** The locked lease's resolved company/job/attempt (not on the wire) for the
   * caller's own tenant checks. */
  companyId: string;
  authorityNow: Date;
  /** DEP-011 Slice 1 (§1.4) — the locked lease's `expires_at`, surfaced so a caller can
   * bound a minted token to the lease it authorizes (`min(now + TTL, leaseDeadline)`).
   * Already validated non-null below (a null `expiresAt` is a `stale_fence` refusal).
   * Additive: artifact-commit / transfer-grant callers simply ignore it. */
  leaseDeadline: Date;
}

/** DAT-006 — the DEVICE-only authority context (no lease, no fence). Proves the worker's
 * device authority is CURRENT (proof replay, authority lock, generation cutoff, active
 * target, profile) and returns the verified target identity — but stops BEFORE the lease
 * resolution, because an orphan is a dead-fence output with no live lease. */
export interface ResolvedDeviceContext {
  organizationId: string;
  targetId: string;
  targetGeneration: number;
  authorityNow: Date;
}

/**
 * Authenticate the worker operation and resolve the presented fence identity from
 * the lease row. Throws `JobLeasingError` on any auth failure:
 *   - `unauthorized`   — replayed/duplicate proof, or missing authority
 *   - `target_revoked` — authority not current / target inactive / profile drift
 *   - `stale_fence`    — no lease matches the presented (leaseId, job, attempt, fence)
 *                        tuple pinned to the CURRENT authority/target
 * A returned context means the worker is authenticated and the fence identity is
 * fully pinned; whether the fence must additionally be ACTIVE is the caller's call.
 */
export async function resolveWorkerFenceContext(
  repos: TenantRepositories,
  auth: VerifiedWorkerOperation,
  presented: { leaseId: string; jobId: string; attempt: number; fenceToken: string },
  maxHeartbeatAgeMs: number,
): Promise<ResolvedFenceContext> {
  const databaseNow = await repos.jobControl.currentDatabaseTime();
  await repos.workerEnrollment.cleanupExpiredProofs(databaseNow, 100);
  await repos.jobControl.cleanupExpiredOperationReceipts(databaseNow, 100);
  const proofRecorded = await repos.workerEnrollment.recordProof({
    organizationId: auth.organizationId,
    deviceThumbprint: auth.deviceThumbprint,
    proofId: auth.proofId,
    issuedAt: auth.proofIssuedAt,
    expiresAt: auth.sessionExpiresAt,
  });
  if (!proofRecorded) throw new JobLeasingError("unauthorized");

  const authority = await repos.jobControl.lockWorkerLeaseAuthority({
    workerId: auth.workerId,
    targetId: auth.targetId,
  });
  const authorityNow = await repos.jobControl.currentDatabaseTime();
  if (!authority || !ackAuthorityCurrent({
    auth,
    authority,
    workerId: auth.workerId,
    databaseNow: authorityNow,
    maxHeartbeatAgeMs,
    platformPhysicalHeartbeatAt: null,
  })) throw new JobLeasingError(authority ? "target_revoked" : "unauthorized");

  const target = await normalizePlacementRegistryTarget(authority.target);
  if (!target || target.status !== "active") throw new JobLeasingError("target_revoked");
  if (!await repos.jobControl.touchWorkerLeaseProfile({
    workerId: auth.workerId,
    targetId: auth.targetId,
    targetGeneration: auth.targetGeneration,
  })) throw new JobLeasingError("target_revoked");

  const context = await repos.jobControl.lockLeaseAckContext({
    organizationId: auth.organizationId,
    workerId: auth.workerId,
    targetId: auth.targetId,
    targetGeneration: auth.targetGeneration,
    profileHash: auth.profileHash,
    leaseId: presented.leaseId,
    jobId: presented.jobId,
    attemptNumber: presented.attempt,
    fence: presented.fenceToken,
  });
  if (!context) throw new JobLeasingError("stale_fence");
  if (!context.lease.companyId
    || !context.lease.jobId
    || !context.lease.attemptNumber
    || !context.lease.expiresAt
    || context.lease.jobId !== presented.jobId
    || context.lease.attemptNumber !== presented.attempt
    || context.lease.targetAuthorityKey !== authority.worker.targetAuthorityKey
    || context.lease.targetId !== target.targetId
    || context.lease.targetGeneration !== target.targetGeneration
    || context.lease.profileHash !== auth.profileHash
    || context.lease.providerConstraintHash !== target.providerConstraintHash) {
    throw new JobLeasingError("stale_fence");
  }

  const fenceIdentity: ActiveFenceRequest = {
    organizationId: auth.organizationId,
    companyId: context.lease.companyId,
    jobId: context.lease.jobId,
    attemptId: context.lease.attemptId,
    attemptNumber: context.lease.attemptNumber,
    leaseId: context.lease.id,
    workerId: auth.workerId,
    targetId: target.targetId,
    targetAuthorityKey: authority.worker.targetAuthorityKey,
    targetGeneration: target.targetGeneration,
    profileHash: auth.profileHash,
    providerConstraintHash: target.providerConstraintHash,
    fence: presented.fenceToken,
  };
  return { fenceIdentity, companyId: context.lease.companyId, authorityNow, leaseDeadline: context.lease.expiresAt };
}

/**
 * DAT-006 — authenticate a DEVICE-scoped worker operation WITHOUT a lease/fence. It runs
 * the same CURRENT-authority recheck `resolveWorkerFenceContext` runs (proof record →
 * authority lock under a fresh DB clock → active target → profile touch) but STOPS before
 * `lockLeaseAckContext`: an orphan quarantine has no live lease, so there is nothing to
 * resolve a fence tuple against. Throws `JobLeasingError` on any auth failure —
 * `unauthorized` (replayed/duplicate proof, missing authority) or `target_revoked`
 * (authority not current / target inactive / profile drift / bumped generation). It NEVER
 * throws `stale_fence` (there is no fence): staleness is precisely why an orphan is
 * quarantined, so it can never be a refusal here.
 */
export async function resolveWorkerDeviceContext(
  repos: TenantRepositories,
  auth: VerifiedWorkerOperation,
  maxHeartbeatAgeMs: number,
): Promise<ResolvedDeviceContext> {
  const databaseNow = await repos.jobControl.currentDatabaseTime();
  await repos.workerEnrollment.cleanupExpiredProofs(databaseNow, 100);
  await repos.jobControl.cleanupExpiredOperationReceipts(databaseNow, 100);
  const proofRecorded = await repos.workerEnrollment.recordProof({
    organizationId: auth.organizationId,
    deviceThumbprint: auth.deviceThumbprint,
    proofId: auth.proofId,
    issuedAt: auth.proofIssuedAt,
    expiresAt: auth.sessionExpiresAt,
  });
  if (!proofRecorded) throw new JobLeasingError("unauthorized");

  const authority = await repos.jobControl.lockWorkerLeaseAuthority({
    workerId: auth.workerId,
    targetId: auth.targetId,
  });
  const authorityNow = await repos.jobControl.currentDatabaseTime();
  if (!authority || !ackAuthorityCurrent({
    auth,
    authority,
    workerId: auth.workerId,
    databaseNow: authorityNow,
    maxHeartbeatAgeMs,
    platformPhysicalHeartbeatAt: null,
  })) throw new JobLeasingError(authority ? "target_revoked" : "unauthorized");

  const target = await normalizePlacementRegistryTarget(authority.target);
  if (!target || target.status !== "active") throw new JobLeasingError("target_revoked");
  if (!await repos.jobControl.touchWorkerLeaseProfile({
    workerId: auth.workerId,
    targetId: auth.targetId,
    targetGeneration: auth.targetGeneration,
  })) throw new JobLeasingError("target_revoked");

  return {
    organizationId: auth.organizationId,
    targetId: target.targetId,
    targetGeneration: target.targetGeneration,
    authorityNow,
  };
}
