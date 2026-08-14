// server/src/services/job-operations.ts
//
// JOB-008 — the operator READ + delegate-MUTATION service behind the tenant-authorized
// job/worker controls. This is SERVER authority (a board operator holding the org's
// `execution_target:manage` cap), never a worker-fenced path.
//
// REDACTION BY CONSTRUCTION (the core deliverable): every read is a PROJECTED
// `tx.select({ ...safeColumns })` inside `runInTenant` — NOT the full-row tenant
// repository methods (`TenantRepositories.jobs.listForCompany`, etc.), which
// `SELECT *` and would return every secret column. A projected select cannot leak a
// column that is not in its map, so the cross-tenant id sinks
// (`job_attempts.placement_target_id`, `leases.target_id`, `workers.execution_target_id`)
// and the capability/token sinks (`leases.fence`, `job_events.fence_token`,
// `workers.*_token_hash`) never appear in the map and therefore never reach the wire.
// FORCE RLS (the `aoa.organization_id` GUC set by `runInTenant`) plus the explicit
// `eq(<table>.organizationId, orgId)` / `eq(jobs.companyId, companyId)` predicates scope
// every read to the caller's tenant and exclude null-org platform rows (R5).
//
// MUTATIONS delegate to the existing JOB-006/007 authorities — this service invents no
// new writer. Drain is a job-level graceful cancellation (`requestCancellation` with
// `graceful: true`); worker revocation resolves the worker's execution target id
// SERVER-SIDE (so the cross-tenant target id is never sent to or from the client) and
// calls JOB-007 `revokeExecutionTarget`. The operator cancel path is JOB-006's existing
// `worker-control.ts` route (reused, not duplicated here — see routes/job-control.ts).

import { and, eq } from "drizzle-orm";
import {
  jobs,
  jobAttempts,
  leases,
  jobEvents,
  workers,
  type CancellationOutcome,
  type Db,
} from "@armyofagents/db";
import type {
  JobDetail,
  JobSummary,
  WorkerRevokeResult,
  WorkerSummary,
} from "@armyofagents/shared";
import { runInTenant } from "../db/tenant-context.js";
import { createJobReconciliationService } from "./job-reconciliation.js";
import { revokeExecutionTarget } from "./execution-targets.js";

// ── Projected column maps. Adding a column here widens the wire exposure: every
// addition MUST be re-checked against the redaction map in CLAUDE.md / the ticket. The
// cross-tenant id + token + payload columns are DELIBERATELY absent. ────────────────
const JOB_SUMMARY_COLUMNS = {
  id: jobs.id,
  status: jobs.status,
  workloadType: jobs.workloadType,
  priority: jobs.priority,
  availableAt: jobs.availableAt,
  maxAttempts: jobs.maxAttempts,
  deadLetterReason: jobs.deadLetterReason,
  createdAt: jobs.createdAt,
  updatedAt: jobs.updatedAt,
} as const;

const ATTEMPT_SUMMARY_COLUMNS = {
  id: jobAttempts.id,
  attemptNumber: jobAttempts.attemptNumber,
  status: jobAttempts.status,
  placementDisposition: jobAttempts.placementDisposition,
  placementOwner: jobAttempts.placementOwner,
  // placementTargetClass/Scope/reason are SAFE (class/scope descriptors, not the id).
  placementTargetClass: jobAttempts.placementTargetClass,
  placementTargetScope: jobAttempts.placementTargetScope,
  placementReasonCode: jobAttempts.placementReasonCode,
  placementMode: jobAttempts.placementMode,
  placementFallbackDisposition: jobAttempts.placementFallbackDisposition,
  placementLeaseEligible: jobAttempts.placementLeaseEligible,
  capacityClaimState: jobAttempts.capacityClaimState,
  capacityWorkloadType: jobAttempts.capacityWorkloadType,
  placementDecidedAt: jobAttempts.placementDecidedAt,
  backoffUntil: jobAttempts.backoffUntil,
  createdAt: jobAttempts.createdAt,
  updatedAt: jobAttempts.updatedAt,
  // DROPPED: placementTargetId (cross-tenant execution_targets.id), placementProfileHash,
  // placementProviderConstraintHash, placementInputDigest, placementPolicyDigest.
} as const;

const LEASE_SUMMARY_COLUMNS = {
  id: leases.id,
  attemptId: leases.attemptId,
  attemptNumber: leases.attemptNumber,
  status: leases.status,
  ackDeadline: leases.ackDeadline,
  expiresAt: leases.expiresAt,
  activatedAt: leases.activatedAt,
  releasedAt: leases.releasedAt,
  targetGeneration: leases.targetGeneration,
  createdAt: leases.createdAt,
  // DROPPED: fence (capability token), targetId (cross-tenant), workerId, profileHash,
  // providerConstraintHash, targetAuthorityKey.
} as const;

const EVENT_SUMMARY_COLUMNS = {
  id: jobEvents.id,
  attemptId: jobEvents.attemptId,
  attemptNumber: jobEvents.attemptNumber,
  sequence: jobEvents.sequence,
  eventType: jobEvents.eventType,
  eventDigest: jobEvents.eventDigest,
  occurredAt: jobEvents.occurredAt,
  createdAt: jobEvents.createdAt,
  // DROPPED: event (jsonb payload), fenceToken, leaseId.
} as const;

const WORKER_SUMMARY_COLUMNS = {
  id: workers.id,
  scope: workers.scope,
  status: workers.status,
  label: workers.label,
  lastSeenAt: workers.lastSeenAt,
  deviceGeneration: workers.deviceGeneration,
  enrolledAt: workers.enrolledAt,
  revokedAt: workers.revokedAt,
  createdAt: workers.createdAt,
  // DROPPED: devicePublicKey, deviceThumbprint, profileHash, profileSnapshot,
  // ownerUserId, executionTargetId (cross-tenant), targetAuthorityKey.
} as const;

export interface JobOperationsService {
  listJobs(organizationId: string, companyId: string): Promise<JobSummary[]>;
  getJobDetail(
    organizationId: string,
    companyId: string,
    jobId: string,
  ): Promise<JobDetail | null>;
  listWorkers(organizationId: string): Promise<WorkerSummary[]>;
  /** Job-level graceful stop — delegates to JOB-006 requestCancellation(graceful:true). */
  drainJob(
    organizationId: string,
    companyId: string,
    jobId: string,
    reason: string,
  ): Promise<CancellationOutcome>;
  /** Resolves the worker's execution target server-side, then JOB-007 revoke. */
  revokeWorker(
    organizationId: string,
    workerId: string,
    reason: string,
  ): Promise<WorkerRevokeResult>;
}

export function createJobOperationsService(input: {
  appDb: Db;
  operatorDb: Db;
}): JobOperationsService {
  const reconciliation = createJobReconciliationService({ appDb: input.appDb });

  return {
    async listJobs(organizationId, companyId) {
      const rows = await runInTenant(input.appDb, organizationId, async (_repos, tx) => {
        return tx
          .select(JOB_SUMMARY_COLUMNS)
          .from(jobs)
          .where(and(eq(jobs.organizationId, organizationId), eq(jobs.companyId, companyId)));
      });
      // The projected rows carry Date timestamps; res.json serializes them to the ISO
      // strings the wire DTO declares. Cross the boundary via unknown (wire ≠ row type).
      return rows as unknown as JobSummary[];
    },

    async getJobDetail(organizationId, companyId, jobId) {
      return runInTenant(input.appDb, organizationId, async (_repos, tx) => {
        const jobRows = await tx
          .select(JOB_SUMMARY_COLUMNS)
          .from(jobs)
          .where(
            and(
              eq(jobs.organizationId, organizationId),
              eq(jobs.companyId, companyId),
              eq(jobs.id, jobId),
            ),
          )
          .limit(1);
        const job = jobRows[0];
        if (!job) return null; // absent OR cross-tenant → caller maps to a uniform 404.

        const attempts = await tx
          .select(ATTEMPT_SUMMARY_COLUMNS)
          .from(jobAttempts)
          .where(and(eq(jobAttempts.organizationId, organizationId), eq(jobAttempts.jobId, jobId)));
        const leaseRows = await tx
          .select(LEASE_SUMMARY_COLUMNS)
          .from(leases)
          .where(and(eq(leases.organizationId, organizationId), eq(leases.jobId, jobId)));
        const events = await tx
          .select(EVENT_SUMMARY_COLUMNS)
          .from(jobEvents)
          .where(and(eq(jobEvents.organizationId, organizationId), eq(jobEvents.jobId, jobId)));

        return { job, attempts, leases: leaseRows, events } as unknown as JobDetail;
      });
    },

    async listWorkers(organizationId) {
      const rows = await runInTenant(input.appDb, organizationId, async (_repos, tx) => {
        // eq(workers.organizationId, orgId) excludes null-org platform rows (R5); the
        // run-path scope filter matches listExecutionTargets' org-scope guarantee.
        return tx
          .select(WORKER_SUMMARY_COLUMNS)
          .from(workers)
          .where(eq(workers.organizationId, organizationId));
      });
      return rows as unknown as WorkerSummary[];
    },

    async drainJob(organizationId, companyId, jobId, reason) {
      // R1: there is no worker-fleet "drain" seam — drain is a job-level graceful stop.
      return reconciliation.requestCancellation({
        organizationId,
        companyId,
        jobId,
        reason,
        graceful: true,
      });
    },

    async revokeWorker(organizationId, workerId, reason) {
      // R2: resolve the worker's execution target id SERVER-SIDE inside the tenant so the
      // cross-tenant target id is never exposed to the client. The org predicate also
      // ensures we never resolve a worker owned by another organization.
      const executionTargetId = await runInTenant(input.appDb, organizationId, async (_repos, tx) => {
        const rows = (await tx
          .select({ executionTargetId: workers.executionTargetId })
          .from(workers)
          .where(and(eq(workers.id, workerId), eq(workers.organizationId, organizationId)))
          .limit(1)) as Array<{ executionTargetId: string }>;
        return rows[0]?.executionTargetId ?? null;
      });
      if (!executionTargetId) {
        return { revoked: false, reason: "not_found" };
      }
      const result = await revokeExecutionTarget({
        appDb: input.appDb,
        operatorDb: input.operatorDb,
        targetId: executionTargetId,
        organizationId,
        reason,
      });
      return {
        revoked: result.revoked,
        reason: result.reason,
        revokedGeneration: result.revokedGeneration,
      };
    },
  };
}
