import { beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  canonicalProviderConstraintProfileDigestInputV1,
  canonicalizeJsonV1,
  type JobCapabilityRequirementsV1,
  type ProviderConstraintProfileV1,
  type RegisteredTargetProfileV1,
  type WorkerHelloV1,
} from "@armyofagents/worker-protocol";

type Decide = (input: Record<string, unknown>) => Record<string, unknown>;

const ORG = "93000000-0000-4000-8000-000000000001";
const OWNER = "job-009-owner";
const POLICY_HASH = "a".repeat(64);
const INPUT_DIGEST = "b".repeat(64);
const POLICY_DIGEST = "c".repeat(64);
const NOW = new Date("2026-08-10T10:00:00.000Z");

let decide: Decide | null = null;
let placementModule: Record<string, unknown> | null = null;

beforeAll(async () => {
  const module = await import("../services/job-placement.js").catch(() => null);
  placementModule = module as Record<string, unknown> | null;
  decide = module && typeof module.decideJobPlacement === "function"
    ? module.decideJobPlacement as Decide
    : null;
});

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function providerProfile(overrides: Partial<ProviderConstraintProfileV1> = {}): ProviderConstraintProfileV1 {
  const unsigned = {
    profileId: "provider-v1",
    version: 1,
    maxContinuousRuntimeSeconds: 3_600,
    maxIdleSeconds: 300,
    resourceCeiling: { cpuMillis: 4_000, memoryMiB: 8_192, pids: 1_024, diskMiB: 16_384 },
    maxConcurrentOperations: 8,
    supportedOperations: [
      "create", "execute", "cancel", "kill", "destroy", "list", "inspect", "reconcile_cleanup",
    ],
    localityTags: ["transfer_allowed"],
    checkpointMode: "none",
    healthMode: "none",
    ...overrides,
  } as Omit<ProviderConstraintProfileV1, "digest">;
  return {
    ...unsigned,
    digest: sha256(canonicalProviderConstraintProfileDigestInputV1(unsigned)),
  };
}

function targetProfile(input: {
  targetId: string;
  targetClass: "managed_cloud" | "organization_dedicated" | "owner_desktop";
  provider: ProviderConstraintProfileV1;
}): RegisteredTargetProfileV1 {
  const rows = {
    managed_cloud: {
      scope: "platform", organizationId: null, ownerPrincipalId: null,
      trustCeiling: "shared_isolated", credentialCeiling: "platform_brokered",
      dataLocalityCeiling: "transfer_allowed",
    },
    organization_dedicated: {
      scope: "organization", organizationId: ORG, ownerPrincipalId: null,
      trustCeiling: "organization_isolated", credentialCeiling: "organization_brokered",
      dataLocalityCeiling: "organization_target_only",
    },
    owner_desktop: {
      scope: "owner", organizationId: ORG, ownerPrincipalId: OWNER,
      trustCeiling: "owner_local_trusted", credentialCeiling: "owner_bound",
      dataLocalityCeiling: "owner_device_only",
    },
  } as const;
  return {
    protocolVersion: 1,
    targetId: input.targetId,
    targetClass: input.targetClass,
    ...rows[input.targetClass],
    providerConstraints: {
      profileId: input.provider.profileId,
      version: input.provider.version,
      digest: input.provider.digest,
    },
    capabilityCeiling: ["workload.batch", "sandbox.process_isolated", "provider.lifecycle_v1"],
    deviceGeneration: 1,
    revokedAt: null,
    policyHash: POLICY_HASH,
  };
}

function candidate(
  targetClass: "managed_cloud" | "organization_dedicated" | "owner_desktop",
  suffix: number,
  overrides: Record<string, unknown> = {},
) {
  const targetId = `94000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`;
  const provider = providerProfile();
  const profile = targetProfile({ targetId, targetClass, provider });
  const worker: WorkerHelloV1 = {
    protocolVersion: 1,
    workerId: `95000000-0000-4000-8000-${suffix.toString().padStart(12, "0")}`,
    targetId,
    deviceGeneration: 1,
    agentVersion: "job-009-test",
    supportedProtocol: { min: 1, max: 1 },
    platform: { os: "linux", arch: "x64", runtime: "worker" },
    reportedCapabilities: ["workload.batch", "sandbox.process_isolated", "provider.lifecycle_v1"],
    capacity: {
      batchSlots: 2, browserSessionSlots: 0, serviceSlots: 0,
      freeCpuMillis: 2_000, freeMemoryMiB: 4_096, freeDiskMiB: 8_192,
    },
    policyHash: POLICY_HASH,
  };
  return {
    registry: {
      targetId,
      targetClass,
      targetScope: profile.scope,
      targetGeneration: 1,
      profileHash: sha256(canonicalizeJsonV1(profile)),
      providerConstraintHash: provider.digest,
      status: "active",
      lastSeenAt: new Date(NOW.getTime() - 1_000),
      registeredProfile: profile,
      providerConstraintProfile: provider,
    },
    worker,
    workerProfileHash: sha256(JSON.stringify(worker)),
    workerStatus: "active",
    ownerMembershipActive: true,
    currentOperations: 0,
    ...overrides,
  };
}

function requirements(
  classes: Array<"managed_cloud" | "organization_dedicated" | "owner_desktop"> = ["managed_cloud"],
  overrides: Record<string, unknown> = {},
): JobCapabilityRequirementsV1 {
  const trust = {
    managed_cloud: "shared_isolated",
    organization_dedicated: "organization_isolated",
    owner_desktop: "owner_local_trusted",
  } as const;
  return {
    protocol: { min: 1, max: 1 },
    capabilities: ["sandbox.process_isolated"],
    workloadType: "batch",
    targetRequirements: {
      allowedTargetClasses: classes,
      allowedTrustClasses: classes.map((value) => trust[value]),
      requiredOwnerPrincipalId: null,
      credentialKind: "platform_brokered",
      dataLocality: "transfer_allowed",
      fallback: { mode: "ordered_explicit", orderedTargetClasses: classes },
      providerConstraints: {
        profileId: "provider-v1", version: 1, digest: providerProfile().digest,
      },
    },
    policyHash: POLICY_HASH,
    mustUnderstand: [],
    ...overrides,
  } as JobCapabilityRequirementsV1;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    sourceKind: "task_run",
    rollout: { enabled: true, mode: "active", reason: "enabled" },
    requirements: requirements(),
    providerDemand: {
      maxRuntimeSeconds: 600,
      maxIdleSeconds: 60,
      resources: { cpuMillis: 1_000, memoryMiB: 1_024, pids: 128, diskMiB: 1_024 },
      concurrentOperations: 1,
      operations: ["create", "execute"],
      localityTags: ["transfer_allowed"],
    },
    credentialOwnerPrincipalId: null,
    now: NOW,
    maxHeartbeatAgeMs: 30_000,
    inputDigest: INPUT_DIGEST,
    policyDigest: POLICY_DIGEST,
    candidates: [candidate("managed_cloud", 1)],
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}) {
  expect(decide, "JOB-009 pure policy must load without DB/worker/provider side effects").not.toBeNull();
  return decide!(input(overrides));
}

function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const next = state % (index + 1);
    [result[index], result[next]] = [result[next]!, result[index]!];
  }
  return result;
}

describe("JOB-009 slice B deterministic placement policy", () => {
  it("[I-01] normalizes the exact JOB-001 persisted shapes without caller-authored provider authority", async () => {
    const normalize = placementModule?.normalizeSubmittedJobPlacementFacts;
    expect(typeof normalize, "JOB-001 persisted facts need a production JOB-009 normalizer").toBe("function");
    if (typeof normalize !== "function") return;
    const normalized = await (normalize as (input: unknown) => Promise<Record<string, unknown>> | Record<string, unknown>)({
      sourceKind: "browser_request",
      inputHash: INPUT_DIGEST,
      policyHash: POLICY_HASH,
      requirements: {
        workloadType: "browser_session",
        requiredCapabilities: ["browser.chromium"],
      },
      placementRequest: {
        policyId: "job-submission-default",
        policyVersion: 1,
        requestedTarget: null,
      },
      rollout: { enabled: true, mode: "active", reason: "enabled" },
      credentialBinding: {
        credentialId: null,
        credentialKind: null,
        executionTargetSlug: null,
        pinnedTargetId: null,
      },
      resolvedTarget: candidate("managed_cloud", 1).registry,
    });
    expect(normalized).toMatchObject({ success: true });
    expect(JSON.stringify(normalized)).not.toContain("credentialOwnerPrincipalId");
  });

  it("[I-03] honors exact Decision #117 target identity instead of re-routing lexicographically", () => {
    const first = candidate("owner_desktop", 1);
    const bound = candidate("owner_desktop", 2);
    const ownerRequirements = requirements(["owner_desktop"], {
      targetRequirements: {
        ...requirements(["owner_desktop"]).targetRequirements,
        requiredOwnerPrincipalId: OWNER,
        credentialKind: "owner_bound",
        dataLocality: "owner_device_only",
        fallback: { mode: "forbidden", orderedTargetClasses: [] },
      },
    });
    expect(run({
      requirements: ownerRequirements,
      credentialOwnerPrincipalId: OWNER,
      resolvedTargetId: bound.registry.targetId,
      targetIdentityPolicy: {
        disposition: "required",
        targetId: bound.registry.targetId,
        targetSlug: "owner-bound",
        unavailableDisposition: "queue",
      },
      candidates: [first, bound],
    })).toMatchObject({ disposition: "selected", targetId: bound.registry.targetId });

    expect(run({
      requirements: ownerRequirements,
      credentialOwnerPrincipalId: OWNER,
      resolvedTargetId: bound.registry.targetId,
      targetIdentityPolicy: {
        disposition: "forbidden",
        targetId: bound.registry.targetId,
        targetSlug: "owner-bound",
        unavailableDisposition: "fail",
      },
      candidates: [bound],
    })).toMatchObject({ disposition: "failed", targetId: null, leaseEligible: false });
  });

  it("keeps legacy authoritative when any rollout gate is off", () => {
    expect(run({ rollout: { enabled: false, mode: "legacy", reason: "organization_disabled" } })).toMatchObject({
      disposition: "legacy", owner: "legacy", leaseEligible: false, reasonCode: "organization_disabled",
    });
  });

  it("selects a server-compatible target and makes shadow ineligible", () => {
    expect(run()).toMatchObject({
      disposition: "selected", owner: "managed_cloud", targetClass: "managed_cloud",
      fallbackDisposition: "primary", reasonCode: "target_selected", leaseEligible: true,
    });
    expect(run({ rollout: { enabled: true, mode: "shadow", reason: "enabled" } })).toMatchObject({
      disposition: "selected", mode: "shadow", leaseEligible: false, reasonCode: "shadow_selected",
    });
  });

  it("never widens a false privileged hello or provider/runtime/resource/operation ceiling", () => {
    const base = candidate("managed_cloud", 1);
    const reducedWorker = { ...base.worker, reportedCapabilities: ["workload.batch"] as const };
    const falseHello = {
      ...base,
      worker: reducedWorker,
      workerProfileHash: sha256(JSON.stringify(reducedWorker)),
    };
    expect(run({ candidates: [falseHello] })).toMatchObject({ disposition: "queued", reasonCode: "no_eligible_target" });

    for (const providerDemand of [
      { ...input().providerDemand, maxRuntimeSeconds: 3_601 },
      { ...input().providerDemand, resources: { cpuMillis: 4_001, memoryMiB: 1_024, pids: 128, diskMiB: 1_024 } },
      { ...input().providerDemand, operations: ["create", "checkpoint"] },
      { ...input().providerDemand, concurrentOperations: 9 },
      { ...input().providerDemand, localityTags: ["owner_device_only"] },
    ]) {
      expect(run({ providerDemand })).toMatchObject({ disposition: "queued", reasonCode: "no_eligible_target" });
    }
  });

  it("fails owner membership/credential binding and local-only to cloud closed", () => {
    const ownerRequirements = requirements(["owner_desktop"], {
      targetRequirements: {
        ...requirements(["owner_desktop"]).targetRequirements,
        requiredOwnerPrincipalId: OWNER,
        credentialKind: "owner_bound",
        dataLocality: "owner_device_only",
        fallback: { mode: "forbidden", orderedTargetClasses: [] },
      },
    });
    expect(run({
      requirements: ownerRequirements,
      credentialOwnerPrincipalId: OWNER,
      candidates: [candidate("owner_desktop", 3, { ownerMembershipActive: false })],
    })).toMatchObject({ disposition: "queued", reasonCode: "required_target_unavailable" });
    expect(run({ requirements: ownerRequirements, candidates: [candidate("managed_cloud", 1)] }))
      .toMatchObject({ disposition: "queued", reasonCode: "required_target_unavailable" });
    expect(run({
      requirements: ownerRequirements,
      credentialOwnerPrincipalId: "different-owner",
      candidates: [candidate("owner_desktop", 3)],
    })).toMatchObject({ disposition: "queued", reasonCode: "required_target_unavailable" });
    const sharedRequirements = requirements(["owner_desktop"], {
      targetRequirements: {
        ...requirements(["owner_desktop"]).targetRequirements,
        credentialKind: "organization_brokered",
        fallback: { mode: "forbidden", orderedTargetClasses: [] },
      },
    });
    expect(run({ requirements: sharedRequirements, candidates: [candidate("owner_desktop", 3)] }))
      .toMatchObject({ disposition: "queued", reasonCode: "required_target_unavailable" });
  });

  it("respects required/ordered fallback and status, generation, health and capacity as read-only inputs", () => {
    const classes = ["managed_cloud", "organization_dedicated"] as const;
    const req = requirements([...classes]);
    const primary = candidate("managed_cloud", 1, { workerStatus: "draining" });
    const fallback = candidate("organization_dedicated", 2);
    const before = JSON.stringify([primary, fallback]);
    expect(run({ requirements: req, candidates: [primary, fallback] })).toMatchObject({
      disposition: "selected", targetClass: "organization_dedicated", fallbackDisposition: "ordered_explicit",
    });
    expect(JSON.stringify([primary, fallback])).toBe(before);

    const stale = candidate("managed_cloud", 1, {
      registry: { ...candidate("managed_cloud", 1).registry, lastSeenAt: new Date(NOW.getTime() - 60_000) },
    });
    expect(run({ candidates: [stale] })).toMatchObject({ disposition: "queued" });

    const revokedBase = candidate("managed_cloud", 1);
    const revoked = {
      ...revokedBase,
      registry: {
        ...revokedBase.registry,
        registeredProfile: { ...revokedBase.registry.registeredProfile, revokedAt: "2026-08-10T09:00:00.000Z" },
      },
    };
    expect(run({ candidates: [revoked] })).toMatchObject({ disposition: "queued" });
    expect(run({ candidates: [candidate("managed_cloud", 1, { currentOperations: 8 })] }))
      .toMatchObject({ disposition: "queued" });
    const wrongGenerationBase = candidate("managed_cloud", 1);
    expect(run({
      candidates: [{
        ...wrongGenerationBase,
        worker: { ...wrongGenerationBase.worker, deviceGeneration: 2 },
        workerProfileHash: sha256(JSON.stringify({ ...wrongGenerationBase.worker, deviceGeneration: 2 })),
      }],
    })).toMatchObject({ disposition: "queued" });

    const noCapacity = candidate("managed_cloud", 1, {
      currentCapacity: {
        batchSlots: 0, browserSessionSlots: 0, serviceSlots: 0,
        freeCpuMillis: 2_000, freeMemoryMiB: 4_096, freeDiskMiB: 8_192,
      },
    });
    const capacityBefore = JSON.stringify(noCapacity);
    expect(run({ candidates: [noCapacity] })).toMatchObject({ disposition: "queued" });
    expect(JSON.stringify(noCapacity)).toBe(capacityBefore);
  });

  it.each(["task_run", "commander_turn", "crew_run", "one_shot", "browser_request", "service_reconcile"])(
    "does not let source kind %s change the same authorized decision",
    (sourceKind) => expect(run({ sourceKind })).toMatchObject({ disposition: "selected", targetClass: "managed_cloud" }),
  );

  it("is byte-equivalent across candidate order for 20 fixed seeds", () => {
    const classes = ["managed_cloud", "organization_dedicated"] as const;
    const candidates = [
      candidate("organization_dedicated", 20), candidate("managed_cloud", 11),
      candidate("managed_cloud", 10), candidate("organization_dedicated", 21),
    ];
    const expected = JSON.stringify(run({ requirements: requirements([...classes]), candidates }));
    for (let seed = 1; seed <= 20; seed += 1) {
      expect(JSON.stringify(run({ requirements: requirements([...classes]), candidates: seededShuffle(candidates, seed) })),
        `seed ${seed}`).toBe(expected);
    }
  });
});
