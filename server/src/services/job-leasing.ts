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
import {
  buildLeaseStaticContextInput,
  evaluateStaticLeaseEligibility,
  LEASE_STATIC_ELIGIBILITY_VERSION,
  leaseStaticContextHash,
} from "./job-lease-eligibility.js";
import type { VerifiedWorkerOperation } from "../middleware/worker-operation-proof.js";

export type { VerifiedWorkerOperation } from "../middleware/worker-operation-proof.js";


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

function normalizeOperatorDatabaseErrors(operatorDb: Db | undefined): Db | undefined {
  if (!operatorDb) return undefined;
  return {
    transaction: async (callback: (tx: Db) => Promise<unknown>) => {
      try {
        return await operatorDb.transaction(callback as never);
      } catch (error) {
        if (error instanceof JobLeasingError) throw error;
        throw new JobLeasingError("internal_unavailable");
      }
    },
  } as unknown as Db;
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

function normalizedProviderDemand(target: NormalizedPlacementRegistryTarget) {
  const provider = target.providerConstraintProfile;
  const supported: ReadonlySet<string> = new Set(provider.supportedOperations);
  const operations = ["create", "execute"].filter((operation) => supported.has(operation));
  return {
    maxRuntimeSeconds: Math.min(600, provider.maxContinuousRuntimeSeconds),
    maxIdleSeconds: Math.min(60, provider.maxIdleSeconds),
    resources: {
      cpuMillis: Math.min(1000, provider.resourceCeiling.cpuMillis),
      memoryMiB: Math.min(1024, provider.resourceCeiling.memoryMiB),
      pids: Math.min(128, provider.resourceCeiling.pids),
      diskMiB: Math.min(1024, provider.resourceCeiling.diskMiB),
    },
    concurrentOperations: Math.min(1, provider.maxConcurrentOperations),
    operations,
    localityTags: provider.localityTags.slice(0, 1),
  };
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
    && (worker.status === "enrolled" || worker.status === "active")
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
    && (worker.status === "enrolled" || worker.status === "active")
    && authority.ownerMembershipActive
    && target.id === auth.targetId
    && target.status === "active"
    && target.deviceGeneration === auth.targetGeneration
    && oldestHeartbeat !== null
    && input.databaseNow.getTime() - oldestHeartbeat <= input.maxHeartbeatAgeMs;
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
  input.operatorDb = normalizeOperatorDatabaseErrors(input.operatorDb);
  const ackTimeoutMs = Math.max(1000, input.ackTimeoutMs ?? 15000);
  const leaseDurationMs = Math.max(ackTimeoutMs + 1000, input.leaseDurationMs ?? 300000);
  const maxHeartbeatAgeMs = Math.max(1000, input.maxHeartbeatAgeMs ?? 300000);

  class HeadRestartConflict extends Error {}
  const isHeadRestartConflict = (error: unknown): error is HeadRestartConflict =>
    error instanceof HeadRestartConflict;
  const guardPlatformAuthority = async (
    guardRepos: TenantRepositories,
    guardAuth: VerifiedWorkerOperation,
    locked: LeaseWorkerAuthority,
  ) => {
    if (locked.target.scope === "organization" || locked.target.scope === "owner") {
      return { currentTarget: locked.target, physicalAuthorityWorker: null };
    }
    if (locked.target.scope !== "platform") throw new JobLeasingError("target_revoked");
    return input.operatorDb!.transaction(async (operatorTx) => {
      await configurePlatformTargetAuthorityLockTimeout(operatorTx as unknown as Db);
      const physical = await operatorJobLeasingRepository(operatorTx as unknown as Db)
        .lockPlatformPhysicalAuthority(guardAuth.targetId, "share");
      await guardRepos.jobControl.acquirePlatformTargetAuthorityShared(guardAuth.targetId);
      const current = await guardRepos.jobControl.recheckPlatformTargetAuthority({
        targetId: guardAuth.targetId,
        targetAuthorityKey: "platform",
        targetGeneration: guardAuth.targetGeneration,
      });
      const platformNow = await guardRepos.jobControl.currentDatabaseTime();
      if (!physical ||
          !current ||
          physical.target.scope !== "platform" ||
          physical.worker.scope !== "platform" ||
          current.scope !== "platform" ||
          physical.target.status !== "active" ||
          !(physical.worker.status === "enrolled" || physical.worker.status === "active") ||
          current.status !== "active" ||
          physical.worker.revokedAt !== null ||
          physical.target.id !== guardAuth.targetId ||
          current.id !== guardAuth.targetId ||
          physical.worker.executionTargetId !== physical.target.id ||
          physical.worker.targetAuthorityKey !== physical.target.targetAuthorityKey ||
          current.targetAuthorityKey !== physical.target.targetAuthorityKey ||
          locked.worker.executionTargetId !== current.id ||
          locked.worker.targetAuthorityKey !== current.targetAuthorityKey ||
          locked.worker.deviceGeneration !== guardAuth.targetGeneration ||
          physical.target.deviceGeneration !== guardAuth.targetGeneration ||
          physical.worker.deviceGeneration !== guardAuth.targetGeneration ||
          current.deviceGeneration !== guardAuth.targetGeneration ||
          physical.worker.devicePublicKey !== guardAuth.publicKey ||
          physical.worker.deviceThumbprint !== guardAuth.deviceThumbprint ||
          !physical.target.registeredProfileHash ||
          physical.target.registeredProfileHash !== current.registeredProfileHash ||
          !physical.worker.profileHash ||
          locked.worker.profileHash !== guardAuth.profileHash ||
          !physical.target.lastSeenAt ||
          !physical.worker.lastSeenAt ||
          platformNow.getTime() - physical.target.lastSeenAt.getTime() > maxHeartbeatAgeMs ||
          platformNow.getTime() - physical.worker.lastSeenAt.getTime() > maxHeartbeatAgeMs) {
        throw new JobLeasingError("target_revoked");
      }
      return { currentTarget: current, physicalAuthorityWorker: physical.worker };
    });
  };
  const deriveAdmissibleWorkloadTypes = (
    capacity: WorkerCapacity,
    live: { total: number; batch: number; browserSession: number; service: number },
    provider: NormalizedPlacementRegistryTarget["providerConstraintProfile"],
    demand: { resources: { cpuMillis: number; memoryMiB: number; diskMiB: number } },
  ) => {
    if (live.total >= provider.maxConcurrentOperations ||
        capacity.freeCpuMillis > provider.resourceCeiling.cpuMillis ||
        capacity.freeMemoryMiB > provider.resourceCeiling.memoryMiB ||
        capacity.freeDiskMiB > provider.resourceCeiling.diskMiB ||
        capacity.freeCpuMillis < demand.resources.cpuMillis ||
        capacity.freeMemoryMiB < demand.resources.memoryMiB ||
        capacity.freeDiskMiB < demand.resources.diskMiB) return [];
    const workloadTypes: string[] = [];
    if (capacity.batchSlots > live.batch) workloadTypes.push("batch");
    if (capacity.browserSessionSlots > live.browserSession) workloadTypes.push("browser_session");
    if (capacity.serviceSlots > live.service) workloadTypes.push("service");
    return workloadTypes;
  };

  return {
    async poll(pollInput: {
      auth: VerifiedWorkerOperation;
      request: PollRequestV1;
    }): Promise<PollResponseV1> {
      const parsedRequestResult = pollRequestV1Schema.safeParse(pollInput.request);
      if (!parsedRequestResult.success) throw new JobLeasingError("malformed");
      const parsedRequest = parsedRequestResult.data;
      const proofContext = {
        organizationId: pollInput.auth.organizationId,
        deviceThumbprint: pollInput.auth.deviceThumbprint,
        proofId: pollInput.auth.proofId,
        issuedAt: pollInput.auth.proofIssuedAt,
        expiresAt: pollInput.auth.sessionExpiresAt,
      };
      const touchContext = {
        workerId: pollInput.auth.workerId,
        targetId: pollInput.auth.targetId,
        targetGeneration: pollInput.auth.targetGeneration,
      };
      const readySignaled = input.scheduler?.consume(
        pollInput.auth.organizationId,
        pollInput.auth.targetId,
      ) ?? false;
      for (let restartAttempt = 0; restartAttempt < 3; restartAttempt += 1) {
        try {
          return await runInTenant(input.appDb, pollInput.auth.organizationId, async (repos) => {
            const cleanupNow = await repos.jobControl.currentDatabaseTime();
            await repos.workerEnrollment.cleanupExpiredProofs(cleanupNow, 100);
            const databaseNow = await repos.jobControl.currentDatabaseTime();
            const proofRecorded = await repos.workerEnrollment.recordProof(proofContext);
            const profileTouched = await repos.jobControl.touchWorkerLeaseProfile(touchContext);
            const lockedAuthority = await repos.jobControl.lockWorkerLeaseAuthority({
              workerId: pollInput.auth.workerId,
              targetId: pollInput.auth.targetId,
            });
            const authorityErrorCode = !lockedAuthority || !proofRecorded
              ? "unauthorized"
              : "target_revoked";
            if (!lockedAuthority || !proofRecorded || !profileTouched) {
              throw new JobLeasingError(authorityErrorCode);
            }
            const guardedAuthority = await guardPlatformAuthority(repos, pollInput.auth, lockedAuthority);
            const platformPhysicalHeartbeatAt = guardedAuthority.physicalAuthorityWorker &&
                guardedAuthority.currentTarget.lastSeenAt &&
                guardedAuthority.physicalAuthorityWorker.lastSeenAt
              ? new Date(Math.min(
                  guardedAuthority.currentTarget.lastSeenAt.getTime(),
                  guardedAuthority.physicalAuthorityWorker.lastSeenAt.getTime(),
                ))
              : null;
            const currentAuthority = authorityCurrent({
              auth: pollInput.auth,
              authority: lockedAuthority,
              request: parsedRequest,
              databaseNow,
              maxHeartbeatAgeMs,
              platformPhysicalHeartbeatAt,
            });
            if (!currentAuthority) throw new JobLeasingError("target_revoked");
            const normalizedCurrentTarget = await normalizePlacementRegistryTarget(
              guardedAuthority.currentTarget,
            );
            if (!normalizedCurrentTarget) throw new JobLeasingError("target_revoked");
            const parsedStoredHello = workerHelloV1Schema.safeParse(
              lockedAuthority.worker.profileSnapshot,
            );
            if (!parsedStoredHello.success) throw new JobLeasingError("target_revoked");
            const effectiveCapacity = minCapacity(
              parsedStoredHello.data.capacity,
              parsedRequest.capacity,
            );
            const providerDemand = normalizedProviderDemand(normalizedCurrentTarget);
            const liveCapacity = await repos.jobControl.snapshotLiveLeaseCapacity({
              workerId: pollInput.auth.workerId,
              targetId: normalizedCurrentTarget.targetId,
            });
            const admissibleWorkloadTypes = deriveAdmissibleWorkloadTypes(
              effectiveCapacity,
              liveCapacity,
              normalizedCurrentTarget.providerConstraintProfile,
              providerDemand,
            );
            const staticContextInput = buildLeaseStaticContextInput({
              organizationId: lockedAuthority.worker.organizationId!,
              parsedWorkerHello: parsedStoredHello.data,
              logicalWorker: lockedAuthority.worker as never,
              currentTarget: normalizedCurrentTarget as never,
              physicalAuthorityWorker: guardedAuthority.physicalAuthorityWorker as never,
            });
            const staticContextHash = leaseStaticContextHash(staticContextInput);
            type LeaseCandidate = Awaited<ReturnType<
              TenantRepositories["jobControl"]["lockEligibleLeaseCandidates"]
            >>[number];
            const tryOffer = async (
              candidate: LeaseCandidate,
              normalized: { requirements: JobCapabilityRequirementsV1 },
            ): Promise<PollResponseV1 | null> => {
          const ackDeadline = new Date(databaseNow.getTime() + ackTimeoutMs);
          const expiresAt = new Date(databaseNow.getTime() + leaseDurationMs);
          const jobEnvelope = buildJobEnvelope({
            job: candidate.job,
            attempt: candidate.attempt,
            target: normalizedCurrentTarget,
            requirements: normalized.requirements,
            resourceLimits: providerDemand.resources,
            databaseNow,
            leaseExpiresAt: expiresAt,
          });
          if (!jobEnvelope) throw new JobLeasingError("internal_unavailable");
          const fence = randomBytes(32).toString("base64url");
          const lease = await repos.jobControl.offerLease({
            attemptId: candidate.attempt.id,
            organizationId: candidate.job.organizationId,
            companyId: candidate.job.companyId,
            jobId: candidate.job.id,
            attemptNumber: candidate.attempt.attemptNumber,
            workerId: pollInput.auth.workerId,
            targetId: normalizedCurrentTarget.targetId,
            targetAuthorityKey: lockedAuthority.worker.targetAuthorityKey,
            targetGeneration: normalizedCurrentTarget.targetGeneration,
            profileHash: pollInput.auth.profileHash,
            providerConstraintHash: normalizedCurrentTarget.providerConstraintHash,
            fence,
            ackDeadline,
            expiresAt,
            createdAt: databaseNow,
          });
          if (!lease) return null;
          const offer = leaseOfferV1Schema.parse({
            protocolVersion: 1,
            workerId: pollInput.auth.workerId,
            leaseId: lease.id,
            fenceToken: fence,
            ackDeadline: ackDeadline.toISOString(),
            expiresAt: expiresAt.toISOString(),
            job: jobEnvelope,
            extensions: [],
          });
          return pollResponseV1Schema.parse({
            protocolVersion: 1,
            correlationId: parsedRequest.correlationId,
            serverTime: databaseNow.toISOString(),
            outcome: "offer",
            body: offer,
          });
        };

            const candidates = await repos.jobControl.lockEligibleLeaseCandidates({
              admissibleWorkloadTypes,
              eligibilityVersion: LEASE_STATIC_ELIGIBILITY_VERSION,
              limit: 256,
              staticContextHash,
              targetAuthorityKey: guardedAuthority.currentTarget.targetAuthorityKey,
              targetClass: normalizedCurrentTarget.targetClass,
              targetGeneration: normalizedCurrentTarget.targetGeneration,
              targetId: normalizedCurrentTarget.targetId,
              placementOwner: normalizedCurrentTarget.targetClass,
              targetProfileHash: normalizedCurrentTarget.profileHash,
              targetProviderConstraintHash: normalizedCurrentTarget.providerConstraintHash,
              targetScope: normalizedCurrentTarget.targetScope,
              workerId: pollInput.auth.workerId,
            });
            const staticNegativeCertificates: Array<{
              candidate: LeaseCandidate;
              reasonCode: "static_requirements_mismatch";
              staticContextHash: string;
            }> = [];
            for (const candidate of candidates) {
              const normalized = normalizedRequirements(candidate.job, normalizedCurrentTarget);
              if (!normalized) throw new JobLeasingError("internal_unavailable");
              const evaluation = evaluateStaticLeaseEligibility({
                target: normalizedCurrentTarget.registeredProfile,
                verifiedProviderConstraints: normalizedCurrentTarget.providerConstraintProfile,
                worker: parsedStoredHello.data,
                requirements: normalized.requirements,
              });
              if (!evaluation.eligible) {
                if (evaluation.reasonCode !== "static_requirements_mismatch") {
                  throw new JobLeasingError("internal_unavailable");
                }
                staticNegativeCertificates.push({
                  candidate,
                  reasonCode: evaluation.reasonCode,
                  staticContextHash,
                });
                continue;
              }
              if (staticNegativeCertificates.length > 0) {
                await repos.jobControl.upsertLeaseRejectionCertificates(staticNegativeCertificates);
              }
              const offered = await tryOffer(candidate, normalized);
              if (!offered) throw new HeadRestartConflict();
              return offered;
            }
            if (staticNegativeCertificates.length > 0) {
              await repos.jobControl.upsertLeaseRejectionCertificates(staticNegativeCertificates);
            }
            return pollResponseV1Schema.parse({
              protocolVersion: 1,
              correlationId: parsedRequest.correlationId,
              serverTime: databaseNow.toISOString(),
              outcome: "no_work",
              retryAfterMs: readySignaled ? 100 : 750,
            });
          });
        } catch (error) {
          if (!isHeadRestartConflict(error)) throw error;
          if (restartAttempt >= 2) throw new JobLeasingError("internal_unavailable");
          continue;
        }
      }
      throw new JobLeasingError("internal_unavailable");
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
        const guardedAuthority = authority
          ? await guardPlatformAuthority(repos, ackInput.auth, authority)
          : null;
        const platformPhysicalHeartbeatAt = guardedAuthority?.physicalAuthorityWorker &&
            guardedAuthority.currentTarget.lastSeenAt &&
            guardedAuthority.physicalAuthorityWorker.lastSeenAt
          ? new Date(Math.min(
              guardedAuthority.currentTarget.lastSeenAt.getTime(),
              guardedAuthority.physicalAuthorityWorker.lastSeenAt.getTime(),
            ))
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

        const target = guardedAuthority
          ? await normalizePlacementRegistryTarget(guardedAuthority.currentTarget)
          : null;
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
