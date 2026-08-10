import {
  EXECUTION_SOURCE_KINDS,
  workerHelloV1Schema,
  type ExecutionSourceKind,
} from "@armyofagents/worker-protocol";
import {
  listPlatformPlacementCandidateSnapshots,
  type JobAttempt,
  type PlacementCandidateSnapshot,
} from "@armyofagents/db";
import { runInTenant } from "../db/tenant-context.js";
import {
  decideJobPlacement,
  parsePlacementRequestSnapshot,
  type JobPlacementDecision,
  type PlaceJobAttemptInput,
  type PlacementCandidate,
} from "./job-placement.js";
import { normalizePlacementRegistryTarget } from "./execution-target-resolver.js";

const SOURCE_KINDS = new Set<string>(EXECUTION_SOURCE_KINDS);

export class JobPlacementError extends Error {
  constructor(public readonly code: "placement_not_found" | "placement_already_decided") {
    super(code);
    this.name = "JobPlacementError";
  }
}

function oldestSeen(target: Date | null, worker: Date | null): Date | null {
  if (!target || !worker) return null;
  return target.getTime() <= worker.getTime() ? target : worker;
}

async function candidateFromSnapshot(
  snapshot: PlacementCandidateSnapshot,
  organizationId: string,
): Promise<PlacementCandidate | null> {
  const registry = await normalizePlacementRegistryTarget(snapshot.target);
  const hello = workerHelloV1Schema.safeParse(snapshot.worker.profileSnapshot);
  if (!registry || !hello.success || !snapshot.worker.profileHash) return null;
  if (snapshot.worker.id !== String(hello.data.workerId) ||
      snapshot.worker.executionTargetId !== registry.targetId ||
      snapshot.worker.targetAuthorityKey !== snapshot.target.targetAuthorityKey ||
      snapshot.worker.deviceGeneration !== registry.targetGeneration) return null;

  if (registry.targetScope === "platform") {
    if (snapshot.target.organizationId !== null || snapshot.worker.organizationId !== null ||
        snapshot.worker.scope !== "platform") return null;
  } else {
    if (snapshot.target.organizationId !== organizationId ||
        snapshot.worker.organizationId !== organizationId ||
        snapshot.worker.scope !== registry.targetScope) return null;
  }

  const currentOperations = snapshot.target.capabilities.currentOperations;
  if (currentOperations !== undefined &&
      (!Number.isInteger(currentOperations) || Number(currentOperations) < 0)) return null;
  return {
    registry: {
      ...registry,
      lastSeenAt: oldestSeen(registry.lastSeenAt, snapshot.worker.lastSeenAt),
    },
    worker: hello.data,
    workerProfileHash: snapshot.worker.profileHash,
    workerStatus: snapshot.worker.status,
    ownerMembershipActive: snapshot.ownerMembershipActive,
    currentOperations: Number(currentOperations ?? 0),
  };
}

function decisionFromAttempt(attempt: JobAttempt): JobPlacementDecision | null {
  if (!attempt.placementDecidedAt || !attempt.placementDisposition || !attempt.placementMode ||
      attempt.placementLeaseEligible === null || !attempt.placementInputDigest ||
      !attempt.placementPolicyDigest || !attempt.placementFallbackDisposition ||
      !attempt.placementReasonCode) return null;
  return {
    disposition: attempt.placementDisposition as JobPlacementDecision["disposition"],
    owner: attempt.placementOwner as JobPlacementDecision["owner"],
    targetId: attempt.placementTargetId,
    targetClass: attempt.placementTargetClass as JobPlacementDecision["targetClass"],
    targetScope: attempt.placementTargetScope as JobPlacementDecision["targetScope"],
    targetGeneration: attempt.placementTargetGeneration,
    profileHash: attempt.placementProfileHash,
    providerConstraintHash: attempt.placementProviderConstraintHash,
    fallbackDisposition: attempt.placementFallbackDisposition as JobPlacementDecision["fallbackDisposition"],
    reasonCode: attempt.placementReasonCode,
    mode: attempt.placementMode as JobPlacementDecision["mode"],
    leaseEligible: attempt.placementLeaseEligible,
    inputDigest: attempt.placementInputDigest,
    policyDigest: attempt.placementPolicyDigest,
  };
}

/** Called only through the lazy public wrapper in job-placement.ts. */
export async function placeJobAttemptTransaction(
  input: PlaceJobAttemptInput,
): Promise<JobPlacementDecision> {
  return runInTenant(input.appDb, input.organizationId, async (repos) => {
    const context = await repos.jobControl.lockPlacementContext({
      organizationId: input.organizationId,
      companyId: input.companyId,
      jobId: input.jobId,
      attemptId: input.attemptId,
    });
    if (!context) throw new JobPlacementError("placement_not_found");

    const existing = decisionFromAttempt(context.attempt);
    if (existing) {
      if (existing.inputDigest !== context.job.inputHash ||
          existing.policyDigest !== context.job.policyHash) {
        throw new JobPlacementError("placement_already_decided");
      }
      return existing;
    }

    const sourceKind = SOURCE_KINDS.has(context.job.sourceKind)
      ? context.job.sourceKind as ExecutionSourceKind
      : "task_run";
    const request = parsePlacementRequestSnapshot(context.job.placementRequest);
    const tenantSnapshots = input.rollout.enabled
      ? await repos.jobControl.listPlacementCandidateSnapshots()
      : [];

    const decideAndPersist = async (platformSnapshots: PlacementCandidateSnapshot[]) => {
      const candidates = (await Promise.all(
        [...tenantSnapshots, ...platformSnapshots]
          .map((snapshot) => candidateFromSnapshot(snapshot, input.organizationId)),
      )).filter((candidate): candidate is PlacementCandidate => candidate !== null);

      const decision = decideJobPlacement({
        sourceKind,
        rollout: input.rollout,
        requirements: context.job.requirements as never,
        providerDemand: request.success ? request.data.providerDemand : ({} as never),
        credentialOwnerPrincipalId: request.success ? request.data.credentialOwnerPrincipalId : null,
        now: input.now,
        maxHeartbeatAgeMs: input.maxHeartbeatAgeMs,
        inputDigest: context.job.inputHash,
        policyDigest: context.job.policyHash,
        candidates,
      });
      const stored = await repos.jobControl.persistPlacementDecision({
        organizationId: input.organizationId,
        companyId: input.companyId,
        jobId: input.jobId,
        attemptId: input.attemptId,
        placementDisposition: decision.disposition,
        placementOwner: decision.owner,
        placementTargetId: decision.targetId,
        placementTargetClass: decision.targetClass,
        placementTargetScope: decision.targetScope,
        placementTargetGeneration: decision.targetGeneration,
        placementProfileHash: decision.profileHash,
        placementProviderConstraintHash: decision.providerConstraintHash,
        placementFallbackDisposition: decision.fallbackDisposition,
        placementReasonCode: decision.reasonCode,
        placementMode: decision.mode,
        placementLeaseEligible: decision.leaseEligible,
        placementInputDigest: decision.inputDigest,
        placementPolicyDigest: decision.policyDigest,
        placementDecidedAt: input.now,
      });
      if (!stored) throw new JobPlacementError("placement_already_decided");
      return decisionFromAttempt(stored)!;
    };

    // Flag-off is tenant-local legacy bookkeeping and must not depend on or
    // contact the distributed operator pool at all.
    if (!input.rollout.enabled) return decideAndPersist([]);

    // Hold the bounded platform registry snapshot stable until the tenant
    // decision is persisted. This operator callback accepts no job identifiers
    // or payload and FORCE RLS exposes only null-Organization target/worker rows.
    return input.operatorDb.transaction(async (operatorTx) => {
      const platformSnapshots = await listPlatformPlacementCandidateSnapshots(operatorTx);
      return decideAndPersist(platformSnapshots);
    });
  });
}
