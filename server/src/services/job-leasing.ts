import { createHash, randomBytes } from "node:crypto";
import {
  configurePlatformTargetAuthorityLockTimeout,
  operatorJobLeasingRepository,
  type Db,
  type Job,
  type JobAttempt,
  type LeaseWorkerAuthority,
  type TenantRepositories,
} from "@armyofagents/db";
import {
  jobEnvelopeV1Schema,
  canonicalizeJsonV1,
  leaseAckOperationRequestV1Schema,
  leaseAckOperationResponseV1Schema,
  leaseOfferV1Schema,
  pollRequestV1Schema,
  pollResponseV1Schema,
  principalV1Schema,
  workerHelloV1Schema,
  workerSatisfiesRequirements,
  type ExecutionSourceV1,
  type JobCapabilityRequirementsV1,
  type JobEnvelopeV1,
  type LeaseAckOperationRequestV1,
  type LeaseAckOperationResponseV1,
  type PollRequestV1,
  type PollResponseV1,
  type PrincipalV1,
  type WorkerCapacity,
  type WorkerHelloV1,
} from "@armyofagents/worker-protocol";
import { runInTenant } from "../db/tenant-context.js";
import type { JobReadyScheduler } from "./job-ready-scheduler.js";
import {
  normalizePlacementRegistryTarget,
  type NormalizedPlacementRegistryTarget,
} from "./execution-target-resolver.js";
import { normalizeSubmittedJobPlacementFacts } from "./job-placement.js";
import type { VerifiedWorkerOperation } from "../middleware/worker-operation-proof.js";

export type { VerifiedWorkerOperation } from "../middleware/worker-operation-proof.js";

const ACTIVE_WORKER_STATUSES = new Set(["enrolled", "active"]);

export class JobLeasingError extends Error {
  constructor(public readonly code:
    | "malformed"
    | "unauthorized"
    | "target_revoked"
    | "stale_fence"
    | "attempt_terminal"
    | "internal_unavailable") {
    super(`Job leasing ${code}`);
    this.name = "JobLeasingError";
  }
}

function semanticAckDigest(
  auth: VerifiedWorkerOperation,
  request: LeaseAckOperationRequestV1,
): string {
  return createHash("sha256").update(canonicalizeJsonV1({
    audience: request.audience,
    workerId: auth.workerId,
    targetId: auth.targetId,
    targetGeneration: auth.targetGeneration,
    profileHash: auth.profileHash,
    body: request.body,
  })).digest("hex");
}

function principal(kind: string, id: string): PrincipalV1 {
  const principalType = kind === "agent"
    ? "agent"
    : kind === "system"
      ? "system"
      : kind === "service" || kind === "service_instance"
        ? "service"
        : "user";
  return principalV1Schema.parse({ principalType, principalId: id });
}

function source(job: Job): ExecutionSourceV1 | null {
  const intent = job.sourceIntent as Record<string, unknown>;
  const requestedBy = principal(job.requesterPrincipalKind, job.requesterPrincipalId);
  const defaultExecutor = principal(job.executorPrincipalKind, job.executorPrincipalId);
  const kind = intent.kind;
  const candidate = kind === "task_run"
    ? {
        kind,
        runId: intent.runId,
        issueId: intent.issueId,
        assigneeAgentId: intent.assigneeAgentId,
        requestedBy,
        executionPrincipal: { principalType: "agent", principalId: job.executorPrincipalId },
      }
    : kind === "commander_turn"
      ? {
          kind,
          internalAgentRunId: intent.internalAgentRunId,
          conversationId: intent.conversationId,
          requestedBy,
          executionPrincipal: defaultExecutor,
        }
      : kind === "crew_run"
        ? { kind, crewRunId: intent.crewRunId, requestedBy, executionPrincipal: defaultExecutor }
        : kind === "one_shot"
          ? {
              kind,
              operationId: intent.operationId,
              operationKind: intent.operationKind,
              requestedBy,
              executionPrincipal: defaultExecutor,
            }
          : kind === "browser_request"
            ? {
                kind,
                browserRequestId: intent.browserRequestId,
                parentJobId: intent.parentJobId,
                requestedBy,
                executionPrincipal: defaultExecutor,
              }
            : kind === "service_reconcile"
              ? {
                  kind,
                  serviceId: intent.serviceId,
                  generation: intent.generation,
                  reconciliationId: intent.reconciliationId,
                  requestedBy,
                  executionPrincipal: defaultExecutor,
                }
              : null;
  if (!candidate) return null;
  // The final JobEnvelope parse below is the authoritative strict source parse.
  return candidate as ExecutionSourceV1;
}

function minCapacity(left: WorkerCapacity, right: WorkerCapacity): WorkerCapacity {
  return {
    batchSlots: Math.min(left.batchSlots, right.batchSlots),
    browserSessionSlots: Math.min(left.browserSessionSlots, right.browserSessionSlots),
    serviceSlots: Math.min(left.serviceSlots, right.serviceSlots),
    freeCpuMillis: Math.min(left.freeCpuMillis, right.freeCpuMillis),
    freeMemoryMiB: Math.min(left.freeMemoryMiB, right.freeMemoryMiB),
    freeDiskMiB: Math.min(left.freeDiskMiB, right.freeDiskMiB),
  };
}

function workloadSlots(capacity: WorkerCapacity, workloadType: string): number {
  if (workloadType === "batch") return capacity.batchSlots;
  if (workloadType === "browser_session") return capacity.browserSessionSlots;
  if (workloadType === "service") return capacity.serviceSlots;
  return 0;
}

function inferredCredentialBinding(target: NormalizedPlacementRegistryTarget) {
  if (target.targetClass === "owner_desktop") {
    return {
      credentialId: "stored-owner-authority",
      credentialKind: "personal_subscription" as const,
      executionTargetSlug: target.targetSlug,
      pinnedTargetId: target.targetId,
    };
  }
  return {
    credentialId: "stored-organization-authority",
    credentialKind: "company_api_key" as const,
    executionTargetSlug: null,
    pinnedTargetId: target.targetId,
  };
}

function normalizedRequirements(job: Job, target: NormalizedPlacementRegistryTarget) {
  const normalized = normalizeSubmittedJobPlacementFacts({
    sourceKind: job.sourceKind as never,
    inputHash: job.inputHash,
    policyHash: job.policyHash,
    requirements: job.requirements,
    placementRequest: job.placementRequest,
    rollout: { enabled: true, mode: "active", reason: "stored_placement" },
    credentialBinding: inferredCredentialBinding(target),
    resolvedTarget: target,
  });
  return normalized.success && normalized.active ? normalized : null;
}

function authorityCurrent(input: {
  auth: VerifiedWorkerOperation;
  authority: LeaseWorkerAuthority;
  request: PollRequestV1;
  databaseNow: Date;
  maxHeartbeatAgeMs: number;
  platformPhysicalHeartbeatAt?: Date | null;
}): boolean {
  const { auth, authority, request } = input;
  const worker = authority.worker;
  const target = authority.target;
  const oldestHeartbeat = target.scope === "platform"
    ? input.platformPhysicalHeartbeatAt?.getTime() ?? null
    : !worker.lastSeenAt || !target.lastSeenAt
      ? null
      : Math.min(worker.lastSeenAt.getTime(), target.lastSeenAt.getTime());
  return worker.id === auth.workerId
    && worker.executionTargetId === auth.targetId
    && worker.organizationId === auth.organizationId
    && worker.scope !== "platform"
    && worker.deviceGeneration === auth.targetGeneration
    && worker.deviceThumbprint === auth.deviceThumbprint
    && worker.devicePublicKey === auth.publicKey
    && worker.profileHash === auth.profileHash
    && worker.revokedAt === null
    && ACTIVE_WORKER_STATUSES.has(worker.status)
    && authority.ownerMembershipActive
    && target.id === auth.targetId
    && target.status === "active"
    && target.deviceGeneration === auth.targetGeneration
    && request.workerId === auth.workerId
    && request.targetId === auth.targetId
    && request.deviceGeneration === auth.targetGeneration
    && oldestHeartbeat !== null
    && input.databaseNow.getTime() - oldestHeartbeat <= input.maxHeartbeatAgeMs;
}

function ackAuthorityCurrent(input: {
  auth: VerifiedWorkerOperation;
  authority: LeaseWorkerAuthority;
  workerId: string;
  databaseNow: Date;
  maxHeartbeatAgeMs: number;
  platformPhysicalHeartbeatAt?: Date | null;
}): boolean {
  const { auth, authority } = input;
  const worker = authority.worker;
  const target = authority.target;
  const oldestHeartbeat = target.scope === "platform"
    ? input.platformPhysicalHeartbeatAt?.getTime() ?? null
    : !worker.lastSeenAt || !target.lastSeenAt
      ? null
      : Math.min(worker.lastSeenAt.getTime(), target.lastSeenAt.getTime());
  return input.workerId === auth.workerId
    && worker.id === auth.workerId
    && worker.executionTargetId === auth.targetId
    && worker.organizationId === auth.organizationId
    && worker.scope !== "platform"
    && worker.deviceGeneration === auth.targetGeneration
    && worker.deviceThumbprint === auth.deviceThumbprint
    && worker.devicePublicKey === auth.publicKey
    && worker.profileHash === auth.profileHash
    && worker.revokedAt === null
    && ACTIVE_WORKER_STATUSES.has(worker.status)
    && authority.ownerMembershipActive
    && target.id === auth.targetId
    && target.status === "active"
    && target.deviceGeneration === auth.targetGeneration
    && oldestHeartbeat !== null
    && input.databaseNow.getTime() - oldestHeartbeat <= input.maxHeartbeatAgeMs;
}

function candidateMatchesPlacement(
  attempt: JobAttempt,
  authority: LeaseWorkerAuthority,
  target: NormalizedPlacementRegistryTarget,
): boolean {
  const expectedOwner = target.targetClass;
  return attempt.status === "pending"
    && attempt.placementDisposition === "selected"
    && attempt.placementMode === "active"
    && attempt.placementLeaseEligible === true
    && attempt.placementOwner === expectedOwner
    && attempt.placementTargetId === target.targetId
    && attempt.placementTargetClass === target.targetClass
    && attempt.placementTargetScope === target.targetScope
    && attempt.placementTargetGeneration === target.targetGeneration
    && attempt.placementProfileHash === target.profileHash
    && attempt.placementProviderConstraintHash === target.providerConstraintHash
    && authority.worker.targetAuthorityKey === authority.target.targetAuthorityKey;
}

function ackPlacementCurrent(
  attempt: JobAttempt,
  authority: LeaseWorkerAuthority,
  target: NormalizedPlacementRegistryTarget,
): boolean {
  return attempt.status === "offered"
    && attempt.placementDisposition === "selected"
    && attempt.placementMode === "active"
    && attempt.placementLeaseEligible === true
    && attempt.placementOwner === target.targetClass
    && attempt.placementTargetId === target.targetId
    && attempt.placementTargetClass === target.targetClass
    && attempt.placementTargetScope === target.targetScope
    && attempt.placementTargetGeneration === target.targetGeneration
    && attempt.placementProfileHash === target.profileHash
    && attempt.placementProviderConstraintHash === target.providerConstraintHash
    && authority.worker.targetAuthorityKey === authority.target.targetAuthorityKey;
}

function resourceCapacityFits(
  capacity: WorkerCapacity,
  demand: { resources: { cpuMillis: number; memoryMiB: number; diskMiB: number } },
): boolean {
  return capacity.freeCpuMillis >= demand.resources.cpuMillis
    && capacity.freeMemoryMiB >= demand.resources.memoryMiB
    && capacity.freeDiskMiB >= demand.resources.diskMiB;
}

function buildJobEnvelope(input: {
  job: Job;
  attempt: JobAttempt;
  target: NormalizedPlacementRegistryTarget;
  requirements: JobCapabilityRequirementsV1;
  resourceLimits: { cpuMillis: number; memoryMiB: number; pids: number; diskMiB: number };
  databaseNow: Date;
  leaseExpiresAt: Date;
}): JobEnvelopeV1 | null {
  const executionSource = source(input.job);
  if (!executionSource) return null;
  const deadline = new Date(Math.max(
    input.job.createdAt.getTime() + 1,
    input.databaseNow.getTime() + Math.max(1, Number((input.job.input as Record<string, unknown>).maxRuntimeSeconds ?? 600)) * 1_000,
    input.leaseExpiresAt.getTime() + 1,
  ));
  const candidate = {
    protocolVersion: 1,
    jobId: input.job.id,
    attempt: input.attempt.attemptNumber,
    organizationId: input.job.organizationId,
    companyId: input.job.companyId,
    source: executionSource,
    createdAt: input.job.createdAt.toISOString(),
    notBefore: input.job.availableAt.toISOString(),
    deadline: deadline.toISOString(),
    inputHash: input.job.inputHash,
    policyHash: input.requirements.policyHash,
    placement: {
      policyId: typeof (input.job.placementRequest as Record<string, unknown>).policyId === "string"
        ? String((input.job.placementRequest as Record<string, unknown>).policyId)
        : "job-placement",
      version: Number((input.job.placementRequest as Record<string, unknown>).policyVersion ?? 1),
      digest: input.attempt.placementPolicyDigest,
      targetRequirements: input.requirements.targetRequirements,
    },
    adapter: { type: "aoa_job_control", version: "1", configArtifactId: null },
    requiredCapabilities: input.requirements.capabilities,
    workspace: null,
    secretHandles: [],
    resourceLimits: input.resourceLimits,
    networkPolicy: {
      policyId: "job-default-deny",
      version: 1,
      digest: input.attempt.placementPolicyDigest,
    },
    offlinePolicy: "cancel",
    extensions: [],
    workloadType: input.job.workloadType,
    workload: input.job.input,
  };
  const parsed = jobEnvelopeV1Schema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function createJobLeasingService(input: {
  appDb: Db;
  operatorDb?: Db;
  scheduler?: JobReadyScheduler;
  ackTimeoutMs?: number;
  leaseDurationMs?: number;
  maxHeartbeatAgeMs?: number;
}) {
  const ackTimeoutMs = Math.max(1_000, input.ackTimeoutMs ?? 15_000);
  const leaseDurationMs = Math.max(ackTimeoutMs + 1_000, input.leaseDurationMs ?? 5 * 60_000);
  const maxHeartbeatAgeMs = Math.max(1_000, input.maxHeartbeatAgeMs ?? 5 * 60_000);

  const guardPlatformAuthority = async (
    repos: TenantRepositories,
    auth: VerifiedWorkerOperation,
    authority: LeaseWorkerAuthority,
  ): Promise<Date | null> => {
    if (authority.target.scope !== "platform") return null;
    if (!input.operatorDb) throw new JobLeasingError("internal_unavailable");
    let physicalHeartbeatAt: Date | null = null;
    try {
      await input.operatorDb.transaction(async (operatorTx) => {
        await configurePlatformTargetAuthorityLockTimeout(operatorTx as unknown as Db);
        const physical = await operatorJobLeasingRepository(operatorTx as unknown as Db)
          .lockPlatformPhysicalAuthority(auth.targetId, "share");
        if (!physical || physical.target.status !== "active" ||
            physical.target.targetAuthorityKey !== "platform" ||
            physical.target.deviceGeneration !== auth.targetGeneration ||
            physical.target.registeredProfileHash !== authority.target.registeredProfileHash ||
            physical.worker.status === "revoked" || physical.worker.revokedAt !== null ||
            physical.worker.deviceGeneration !== auth.targetGeneration ||
            physical.worker.devicePublicKey !== auth.publicKey ||
            physical.worker.deviceThumbprint !== auth.deviceThumbprint ||
            !physical.worker.profileHash ||
            !physical.target.lastSeenAt || !physical.worker.lastSeenAt) {
          throw new JobLeasingError("target_revoked");
        }

        // App transaction is outermost. Acquire its shared xact advisory lock
        // while the operator target→physical-worker FOR SHARE locks are held,
        // then plain-recheck the app-visible target before operator commit.
        await repos.jobControl.acquirePlatformTargetAuthorityShared(auth.targetId);
        const current = await repos.jobControl.recheckPlatformTargetAuthority({
          targetId: auth.targetId,
          targetAuthorityKey: "platform",
          targetGeneration: auth.targetGeneration,
        });
        if (!current || current.status !== "active" ||
            current.registeredProfileHash !== physical.target.registeredProfileHash) {
          throw new JobLeasingError("target_revoked");
        }
        physicalHeartbeatAt = new Date(Math.min(
          physical.target.lastSeenAt.getTime(),
          physical.worker.lastSeenAt.getTime(),
        ));
      });
    } catch (error) {
      if (error instanceof JobLeasingError) throw error;
      throw new JobLeasingError("internal_unavailable");
    }
    return physicalHeartbeatAt;
  };

  return {
    async poll(pollInput: {
      auth: VerifiedWorkerOperation;
      request: PollRequestV1;
    }): Promise<PollResponseV1> {
      const parsedRequest = pollRequestV1Schema.safeParse(pollInput.request);
      if (!parsedRequest.success) throw new JobLeasingError("malformed");
      const request = parsedRequest.data;
      return runInTenant(input.appDb, pollInput.auth.organizationId, async (repos) => {
        const databaseNow = await repos.jobControl.currentDatabaseTime();
        await repos.workerEnrollment.cleanupExpiredProofs(databaseNow, 100);
        const proofRecorded = await repos.workerEnrollment.recordProof({
          organizationId: pollInput.auth.organizationId,
          deviceThumbprint: pollInput.auth.deviceThumbprint,
          proofId: pollInput.auth.proofId,
          issuedAt: pollInput.auth.proofIssuedAt,
          expiresAt: pollInput.auth.sessionExpiresAt,
        });
        if (!proofRecorded) throw new JobLeasingError("unauthorized");

        const authority = await repos.jobControl.lockWorkerLeaseAuthority({
          workerId: pollInput.auth.workerId,
          targetId: pollInput.auth.targetId,
        });
        const platformPhysicalHeartbeatAt = authority
          ? await guardPlatformAuthority(repos, pollInput.auth, authority)
          : null;
        const authorityNow = await repos.jobControl.currentDatabaseTime();
        if (!authority || !authorityCurrent({
          auth: pollInput.auth,
          authority,
          request,
          databaseNow: authorityNow,
          maxHeartbeatAgeMs,
          platformPhysicalHeartbeatAt,
        })) throw new JobLeasingError(authority ? "target_revoked" : "unauthorized");

        const target = await normalizePlacementRegistryTarget(authority.target);
        const storedHello = workerHelloV1Schema.safeParse(authority.worker.profileSnapshot);
        if (!target || !storedHello.success || target.status !== "active") {
          throw new JobLeasingError("target_revoked");
        }
        const effectiveCapacity = minCapacity(storedHello.data.capacity, request.capacity);
        const effectiveHello: WorkerHelloV1 = { ...storedHello.data, capacity: effectiveCapacity };
        if (!await repos.jobControl.touchWorkerLeaseProfile({
          workerId: pollInput.auth.workerId,
          targetId: pollInput.auth.targetId,
          targetGeneration: pollInput.auth.targetGeneration,
        })) throw new JobLeasingError("target_revoked");
        const providerSlots = target.providerConstraintProfile.maxConcurrentOperations;
        type LeaseCandidate = Awaited<ReturnType<
          TenantRepositories["jobControl"]["lockEligibleLeaseCandidates"]
        >>[number];
        const tryOffer = async (candidate: LeaseCandidate): Promise<PollResponseV1 | null> => {
          if (!candidateMatchesPlacement(candidate.attempt, authority, target)) return null;
          const normalized = normalizedRequirements(candidate.job, target);
          if (!normalized) return null;
          const workloadLimit = workloadSlots(effectiveCapacity, candidate.job.workloadType);
          if (workloadLimit < 1) return null;
          const liveLeases = await repos.jobControl.countLiveWorkerLeases({
            workerId: pollInput.auth.workerId,
            targetId: pollInput.auth.targetId,
            workloadType: candidate.job.workloadType,
          });
          if (liveLeases.total >= providerSlots || liveLeases.workload >= workloadLimit) return null;
          if (!resourceCapacityFits(effectiveCapacity, normalized.providerDemand)) return null;
          if (!workerSatisfiesRequirements(
            target.registeredProfile,
            target.providerConstraintProfile,
            effectiveHello,
            normalized.requirements,
          )) return null;

          const ackDeadline = new Date(authorityNow.getTime() + ackTimeoutMs);
          const expiresAt = new Date(authorityNow.getTime() + leaseDurationMs);
          const job = buildJobEnvelope({
            job: candidate.job,
            attempt: candidate.attempt,
            target,
            requirements: normalized.requirements,
            resourceLimits: normalized.providerDemand.resources,
            databaseNow: authorityNow,
            leaseExpiresAt: expiresAt,
          });
          if (!job) return null;
          const fence = randomBytes(32).toString("base64url");
          const lease = await repos.jobControl.offerLease({
            attemptId: candidate.attempt.id,
            organizationId: candidate.job.organizationId,
            companyId: candidate.job.companyId,
            jobId: candidate.job.id,
            attemptNumber: candidate.attempt.attemptNumber,
            workerId: pollInput.auth.workerId,
            targetId: target.targetId,
            targetAuthorityKey: authority.worker.targetAuthorityKey,
            targetGeneration: target.targetGeneration,
            profileHash: pollInput.auth.profileHash,
            providerConstraintHash: target.providerConstraintHash,
            fence,
            ackDeadline,
            expiresAt,
            createdAt: authorityNow,
          });
          if (!lease) return null;
          const offer = leaseOfferV1Schema.parse({
            protocolVersion: 1,
            workerId: pollInput.auth.workerId,
            leaseId: lease.id,
            fenceToken: fence,
            ackDeadline: ackDeadline.toISOString(),
            expiresAt: expiresAt.toISOString(),
            job,
            extensions: [],
          });
          return pollResponseV1Schema.parse({
            protocolVersion: 1,
            correlationId: request.correlationId,
            serverTime: authorityNow.toISOString(),
            outcome: "offer",
            body: offer,
          });
        };

        // Hints are identifier-only preference, never authority. Consume them
        // only after session, tenant, worker, target and platform guards pass;
        // PostgreSQL then locks and rechecks the exact attempts. A lost, stale,
        // duplicate or process-restart hint always falls through to ordered pull.
        const hintedAttemptIds = input.scheduler?.take(
          pollInput.auth.organizationId,
          pollInput.auth.targetId,
          32,
        ) ?? [];
        if (hintedAttemptIds.length > 0) {
          const hintedCandidates = await repos.jobControl.lockEligibleLeaseCandidates({
            targetId: target.targetId,
            attemptIds: hintedAttemptIds,
            limit: hintedAttemptIds.length,
          });
          for (const candidate of hintedCandidates) {
            const response = await tryOffer(candidate);
            if (response) return response;
          }
        }

        let after: { availableAt: Date; priority: number; createdAt: Date; jobId: string } | undefined;
        let scanned = 0;
        while (scanned < 256) {
          const candidates = await repos.jobControl.lockEligibleLeaseCandidates({
            targetId: target.targetId,
            limit: Math.min(32, 256 - scanned),
            after,
          });
          if (candidates.length === 0) break;
          scanned += candidates.length;
          for (const candidate of candidates) {
            const response = await tryOffer(candidate);
            if (response) return response;
          }
          const last = candidates[candidates.length - 1]!;
          after = {
            availableAt: last.job.availableAt,
            priority: last.job.priority,
            createdAt: last.job.createdAt,
            jobId: last.job.id,
          };
          if (candidates.length < 32) break;
        }

        return pollResponseV1Schema.parse({
          protocolVersion: 1,
          correlationId: request.correlationId,
          serverTime: authorityNow.toISOString(),
          outcome: "no_work",
          retryAfterMs: 750,
        });
      });
    },

    async ack(ackInput: {
      auth: VerifiedWorkerOperation;
      request: LeaseAckOperationRequestV1;
    }): Promise<LeaseAckOperationResponseV1> {
      const parsedRequest = leaseAckOperationRequestV1Schema.safeParse(ackInput.request);
      if (!parsedRequest.success) throw new JobLeasingError("malformed");
      const request = parsedRequest.data;
      const digest = semanticAckDigest(ackInput.auth, request);
      return runInTenant(input.appDb, ackInput.auth.organizationId, async (repos) => {
        const databaseNow = await repos.jobControl.currentDatabaseTime();
        await repos.workerEnrollment.cleanupExpiredProofs(databaseNow, 100);
        await repos.jobControl.cleanupExpiredOperationReceipts(databaseNow, 100);
        const proofRecorded = await repos.workerEnrollment.recordProof({
          organizationId: ackInput.auth.organizationId,
          deviceThumbprint: ackInput.auth.deviceThumbprint,
          proofId: ackInput.auth.proofId,
          issuedAt: ackInput.auth.proofIssuedAt,
          expiresAt: ackInput.auth.sessionExpiresAt,
        });
        if (!proofRecorded) throw new JobLeasingError("unauthorized");

        const authority = await repos.jobControl.lockWorkerLeaseAuthority({
          workerId: ackInput.auth.workerId,
          targetId: ackInput.auth.targetId,
        });
        const platformPhysicalHeartbeatAt = authority
          ? await guardPlatformAuthority(repos, ackInput.auth, authority)
          : null;
        const authorityNow = await repos.jobControl.currentDatabaseTime();
        if (!authority || !ackAuthorityCurrent({
          auth: ackInput.auth,
          authority,
          workerId: request.body.workerId,
          databaseNow: authorityNow,
          maxHeartbeatAgeMs,
          platformPhysicalHeartbeatAt,
        })) throw new JobLeasingError(authority ? "target_revoked" : "unauthorized");

        const target = await normalizePlacementRegistryTarget(authority.target);
        if (!target || target.status !== "active") throw new JobLeasingError("target_revoked");
        if (!await repos.jobControl.touchWorkerLeaseProfile({
          workerId: ackInput.auth.workerId,
          targetId: ackInput.auth.targetId,
          targetGeneration: ackInput.auth.targetGeneration,
        })) throw new JobLeasingError("target_revoked");
        const prior = await repos.jobControl.findOperationReceipt({
          organizationId: ackInput.auth.organizationId,
          workerId: ackInput.auth.workerId,
          targetId: ackInput.auth.targetId,
          targetGeneration: ackInput.auth.targetGeneration,
          profileHash: ackInput.auth.profileHash,
          operation: "lease_ack",
          idempotencyKey: request.idempotencyKey,
        });
        if (prior) {
          if (prior.semanticDigest !== digest) throw new JobLeasingError("malformed");
          return leaseAckOperationResponseV1Schema.parse({
            protocolVersion: 1,
            correlationId: request.correlationId,
            serverTime: authorityNow.toISOString(),
            outcome: "acknowledged",
            ...prior.outcome,
          });
        }

        const context = await repos.jobControl.lockLeaseAckContext({
          organizationId: ackInput.auth.organizationId,
          workerId: ackInput.auth.workerId,
          targetId: ackInput.auth.targetId,
          targetGeneration: ackInput.auth.targetGeneration,
          profileHash: ackInput.auth.profileHash,
          leaseId: request.body.leaseId,
          jobId: request.body.jobId,
          attemptNumber: request.body.attempt,
          fence: request.body.fenceToken,
        });
        if (!context) throw new JobLeasingError("stale_fence");
        if (context.lease.status !== "offered" || context.attempt.status !== "offered") {
          throw new JobLeasingError("attempt_terminal");
        }
        if (!ackPlacementCurrent(context.attempt, authority, target)
          || context.lease.organizationId !== ackInput.auth.organizationId
          || context.lease.workerId !== ackInput.auth.workerId
          || context.lease.targetId !== target.targetId
          || context.lease.targetAuthorityKey !== authority.worker.targetAuthorityKey
          || context.lease.targetGeneration !== target.targetGeneration
          || context.lease.profileHash !== ackInput.auth.profileHash
          || context.lease.providerConstraintHash !== target.providerConstraintHash
          || !context.lease.companyId
          || !context.lease.jobId
          || !context.lease.attemptNumber
          || !context.lease.expiresAt) {
          throw new JobLeasingError("stale_fence");
        }

        const outcome = {
          leaseId: context.lease.id,
          expiresAt: context.lease.expiresAt.toISOString(),
        };
        const activated = await repos.jobControl.activateLeaseAck({
          organizationId: ackInput.auth.organizationId,
          companyId: context.lease.companyId,
          jobId: context.lease.jobId,
          attemptId: context.lease.attemptId,
          attemptNumber: context.lease.attemptNumber,
          leaseId: context.lease.id,
          workerId: ackInput.auth.workerId,
          targetId: target.targetId,
          targetAuthorityKey: authority.worker.targetAuthorityKey,
          targetGeneration: target.targetGeneration,
          profileHash: ackInput.auth.profileHash,
          providerConstraintHash: target.providerConstraintHash,
          placementProfileHash: target.profileHash,
          fence: request.body.fenceToken,
          idempotencyKey: request.idempotencyKey,
          semanticDigest: digest,
          receiptExpiresAt: context.lease.expiresAt,
          outcome,
        });
        if (!activated) throw new JobLeasingError("stale_fence");
        return leaseAckOperationResponseV1Schema.parse({
          protocolVersion: 1,
          correlationId: request.correlationId,
          serverTime: authorityNow.toISOString(),
          outcome: "acknowledged",
          ...outcome,
        });
      });
    },
  };
}
