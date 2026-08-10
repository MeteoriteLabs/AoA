import {
  jobCapabilityRequirementsSchema,
  workerSatisfiesRequirements,
  type ExecutionSourceKind,
  type JobCapabilityRequirementsV1,
  type ProviderOperation,
  type ResourceLimits,
  type WorkerCapacity,
  type WorkerHelloV1,
} from "@armyofagents/worker-protocol";
import { createHash } from "node:crypto";
import type { NormalizedPlacementRegistryTarget } from "./execution-target-resolver.js";

export type PlacementMode = "active" | "shadow" | "legacy";
export type PlacementOwner = "legacy" | "managed_cloud" | "organization_dedicated" | "owner_desktop";
export type PlacementDisposition = "selected" | "legacy" | "queued" | "failed";

export interface PlacementProviderDemand {
  maxRuntimeSeconds: number;
  maxIdleSeconds: number;
  resources: ResourceLimits;
  concurrentOperations: number;
  operations: ProviderOperation[];
  localityTags: string[];
}

export interface PlacementCandidate {
  registry: NormalizedPlacementRegistryTarget;
  worker: WorkerHelloV1;
  workerProfileHash: string;
  currentCapacity?: WorkerCapacity;
  workerStatus: string;
  ownerMembershipActive: boolean;
  currentOperations: number;
}

export interface DecideJobPlacementInput {
  sourceKind: ExecutionSourceKind;
  rollout: {
    enabled: boolean;
    mode: PlacementMode;
    reason: string;
  };
  requirements: JobCapabilityRequirementsV1;
  providerDemand: PlacementProviderDemand;
  credentialOwnerPrincipalId: string | null;
  now: Date;
  maxHeartbeatAgeMs: number;
  inputDigest: string;
  policyDigest: string;
  candidates: PlacementCandidate[];
}

export interface JobPlacementDecision {
  disposition: PlacementDisposition;
  owner: PlacementOwner | null;
  targetId: string | null;
  targetClass: Exclude<PlacementOwner, "legacy"> | null;
  targetScope: "platform" | "organization" | "owner" | null;
  targetGeneration: number | null;
  profileHash: string | null;
  providerConstraintHash: string | null;
  fallbackDisposition: "not_applicable" | "primary" | "ordered_explicit" | "forbidden";
  reasonCode: string;
  mode: PlacementMode;
  leaseEligible: boolean;
  inputDigest: string;
  policyDigest: string;
}

const SHA256 = /^[0-9a-f]{64}$/;

function terminalDecision(input: DecideJobPlacementInput, values: {
  disposition: "legacy" | "queued" | "failed";
  owner: "legacy" | null;
  reasonCode: string;
  mode: PlacementMode;
  fallbackDisposition: "not_applicable" | "forbidden" | "ordered_explicit";
}): JobPlacementDecision {
  return {
    ...values,
    targetId: null,
    targetClass: null,
    targetScope: null,
    targetGeneration: null,
    profileHash: null,
    providerConstraintHash: null,
    leaseEligible: false,
    inputDigest: input.inputDigest,
    policyDigest: input.policyDigest,
  };
}

function providerDemandFits(
  candidate: PlacementCandidate,
  worker: WorkerHelloV1,
  demand: PlacementProviderDemand,
): boolean {
  const provider = candidate.registry.providerConstraintProfile;
  if (!Number.isInteger(demand.maxRuntimeSeconds) || demand.maxRuntimeSeconds < 1 ||
      demand.maxRuntimeSeconds > provider.maxContinuousRuntimeSeconds) return false;
  if (!Number.isInteger(demand.maxIdleSeconds) || demand.maxIdleSeconds < 1 ||
      demand.maxIdleSeconds > provider.maxIdleSeconds) return false;
  if (!Number.isInteger(demand.concurrentOperations) || demand.concurrentOperations < 1) return false;
  if (candidate.currentOperations < 0 ||
      candidate.currentOperations + demand.concurrentOperations > provider.maxConcurrentOperations) return false;

  const ceiling = provider.resourceCeiling;
  if (demand.resources.cpuMillis > ceiling.cpuMillis ||
      demand.resources.memoryMiB > ceiling.memoryMiB ||
      demand.resources.pids > ceiling.pids ||
      demand.resources.diskMiB > ceiling.diskMiB) return false;
  const free = worker.capacity;
  if (demand.resources.cpuMillis > free.freeCpuMillis ||
      demand.resources.memoryMiB > free.freeMemoryMiB ||
      demand.resources.diskMiB > free.freeDiskMiB) return false;

  const operations = new Set(provider.supportedOperations);
  if (new Set(demand.operations).size !== demand.operations.length ||
      demand.operations.some((operation) => !operations.has(operation))) return false;
  const locality = new Set(provider.localityTags);
  if (new Set(demand.localityTags).size !== demand.localityTags.length ||
      demand.localityTags.some((tag) => !locality.has(tag))) return false;
  return true;
}

function candidateFits(input: DecideJobPlacementInput, candidate: PlacementCandidate): boolean {
  const { registry, worker } = candidate;
  if (registry.status !== "active" || candidate.workerStatus !== "active") return false;
  if (!(registry.lastSeenAt instanceof Date) ||
      input.now.getTime() - registry.lastSeenAt.getTime() > input.maxHeartbeatAgeMs ||
      registry.lastSeenAt.getTime() > input.now.getTime() + 1_000) return false;
  if (worker.deviceGeneration !== registry.targetGeneration || String(worker.targetId) !== registry.targetId) return false;
  if (registry.registeredProfile.revokedAt !== null) return false;
  if (registry.registeredProfile.deviceGeneration !== registry.targetGeneration) return false;
  if (String(registry.registeredProfile.providerConstraints.digest) !== registry.providerConstraintHash) return false;

  // The proof-bound enrolled snapshot is immutable. A caller may supply current
  // capacity only by replacing worker.capacity after session auth; every other
  // member must still hash to the stored profile. Capacity is therefore checked
  // as eligibility only and is never mutated or reserved here.
  if (!SHA256.test(candidate.workerProfileHash) ||
      createHash("sha256").update(JSON.stringify(worker)).digest("hex") !== candidate.workerProfileHash) return false;
  const effectiveWorker = candidate.currentCapacity
    ? { ...worker, capacity: candidate.currentCapacity }
    : worker;

  const targetRequirements = input.requirements.targetRequirements;
  if (targetRequirements.credentialKind === "owner_bound") {
    if (!targetRequirements.requiredOwnerPrincipalId ||
        input.credentialOwnerPrincipalId !== String(targetRequirements.requiredOwnerPrincipalId) ||
        !candidate.ownerMembershipActive) return false;
  } else if (input.credentialOwnerPrincipalId !== null) {
    return false;
  }
  if (registry.targetScope === "owner" && !candidate.ownerMembershipActive) return false;

  return workerSatisfiesRequirements(
    registry.registeredProfile,
    registry.providerConstraintProfile,
    effectiveWorker,
    input.requirements,
  ) && providerDemandFits(candidate, effectiveWorker, input.providerDemand);
}

/**
 * Pure JOB-009 placement authority. This function has no database, lease,
 * capacity-reservation, provider, worker-contact, logging, or clock side effect.
 * All volatile facts enter as bounded snapshots and stable tie-breaks make the
 * same input byte-equivalent regardless of candidate enumeration order.
 */
export function decideJobPlacement(input: DecideJobPlacementInput): JobPlacementDecision {
  if (!input.rollout.enabled) {
    return terminalDecision(input, {
      disposition: "legacy",
      owner: "legacy",
      reasonCode: input.rollout.reason,
      mode: "legacy",
      fallbackDisposition: "not_applicable",
    });
  }

  const parsedRequirements = jobCapabilityRequirementsSchema.safeParse(input.requirements);
  if (!parsedRequirements.success || !SHA256.test(input.inputDigest) || !SHA256.test(input.policyDigest) ||
      !(input.now instanceof Date) || !Number.isFinite(input.now.getTime()) ||
      !Number.isInteger(input.maxHeartbeatAgeMs) || input.maxHeartbeatAgeMs < 0 ||
      !["active", "shadow"].includes(input.rollout.mode)) {
    return terminalDecision(input, {
      disposition: "failed",
      owner: null,
      reasonCode: "invalid_placement_input",
      mode: input.rollout.mode === "shadow" ? "shadow" : "active",
      fallbackDisposition: "forbidden",
    });
  }

  const fallback = parsedRequirements.data.targetRequirements.fallback;
  const allowed = parsedRequirements.data.targetRequirements.allowedTargetClasses;
  const order = fallback.mode === "ordered_explicit" && fallback.orderedTargetClasses.length > 0
    ? fallback.orderedTargetClasses
    : [allowed[0]!];
  const rank = new Map(order.map((targetClass, index) => [targetClass, index]));
  const eligible = input.candidates
    .filter((candidate) => rank.has(candidate.registry.targetClass) && candidateFits(input, candidate))
    .sort((left, right) => {
      const byRank = rank.get(left.registry.targetClass)! - rank.get(right.registry.targetClass)!;
      return byRank || left.registry.targetId.localeCompare(right.registry.targetId);
    });

  const selected = eligible[0];
  if (!selected) {
    return terminalDecision(input, {
      disposition: "queued",
      owner: null,
      reasonCode: fallback.mode === "forbidden" ? "required_target_unavailable" : "no_eligible_target",
      mode: input.rollout.mode,
      fallbackDisposition: fallback.mode === "forbidden" ? "forbidden" : "ordered_explicit",
    });
  }

  const selectedRank = rank.get(selected.registry.targetClass)!;
  return {
    disposition: "selected",
    owner: selected.registry.targetClass,
    targetId: selected.registry.targetId,
    targetClass: selected.registry.targetClass,
    targetScope: selected.registry.targetScope,
    targetGeneration: selected.registry.targetGeneration,
    profileHash: selected.registry.profileHash,
    providerConstraintHash: selected.registry.providerConstraintHash,
    fallbackDisposition: selectedRank === 0 ? "primary" : "ordered_explicit",
    reasonCode: input.rollout.mode === "shadow" ? "shadow_selected" : "target_selected",
    mode: input.rollout.mode,
    leaseEligible: input.rollout.mode === "active",
    inputDigest: input.inputDigest,
    policyDigest: input.policyDigest,
  };
}
