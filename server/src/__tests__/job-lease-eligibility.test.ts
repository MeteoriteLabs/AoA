import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalizeJsonV1,
  canonicalProviderConstraintProfileDigestInputV1,
  verifyAndBrandProviderConstraintProfileV1,
  workerSatisfiesRequirements,
} from "@armyofagents/worker-protocol";

const moduleUrl = new URL("../services/job-lease-eligibility.ts", import.meta.url);
const source = existsSync(moduleUrl) ? readFileSync(moduleUrl, "utf8") : "";

interface EligibilityModule {
  LEASE_STATIC_ELIGIBILITY_VERSION: number;
  LEASE_CANONICALIZER_VERSION: number;
  LEASE_ALGORITHM_VERSION: number;
  LEASE_MATCHER_VERSION: number;
  LEASE_PLACEMENT_NORMALIZER_VERSION: number;
  LEASE_WORKLOAD_VOCABULARY_VERSION: number;
  NEUTRAL_LEASE_MATCHER_CAPACITY: Record<string, number>;
  logicalWorkerStaticMatcherProfileHash(hello: Record<string, unknown>): string;
  leaseStaticContextHash(input: Record<string, unknown>): string;
  evaluateStaticLeaseEligibility(input: {
    target: Record<string, unknown>;
    verifiedProviderConstraints: unknown;
    worker: Record<string, unknown>;
    requirements: Record<string, unknown>;
  }): { eligible: boolean; reasonCode: "static_requirements_mismatch" | null };
}

async function loadEligibility(): Promise<EligibilityModule | null> {
  expect.soft(existsSync(moduleUrl), "job-lease-eligibility.ts must exist").toBe(true);
  if (!existsSync(moduleUrl)) return null;
  const specifier = `../services/${"job-lease-eligibility"}.js`;
  return vi.importActual(specifier) as Promise<EligibilityModule>;
}

function hello(capacity: Record<string, number> = {
  batchSlots: 3,
  browserSessionSlots: 2,
  serviceSlots: 1,
  freeCpuMillis: 4_000,
  freeMemoryMiB: 8_192,
  freeDiskMiB: 16_384,
}): Record<string, unknown> {
  return {
    protocolVersion: 1,
    workerId: "e3200000-0000-4000-8000-000000000001",
    targetId: "e3200000-0000-4000-8000-000000000002",
    deviceGeneration: 1,
    agentVersion: "job003-static-matcher",
    supportedProtocol: { min: 1, max: 1 },
    platform: { os: "linux", arch: "x64", runtime: "worker" },
    reportedCapabilities: ["workload.batch", "sandbox.process_isolated"],
    capacity,
    policyHash: "a".repeat(64),
  };
}

function context(): Record<string, unknown> {
  return {
    organizationId: "e3200000-0000-4000-8000-000000000003",
    logicalWorkerId: "e3200000-0000-4000-8000-000000000001",
    logicalWorkerScope: "organization",
    logicalWorkerOwnerUserId: null,
    logicalWorkerTargetAuthorityKey: "organization:e3200000-0000-4000-8000-000000000003",
    logicalWorkerDeviceGeneration: 1,
    logicalWorkerDeviceThumbprint: "b".repeat(64),
    logicalWorkerProfileHash: "c".repeat(64),
    logicalWorkerStaticMatcherProfileHash: "d".repeat(64),
    physicalAuthorityWorkerId: null,
    physicalAuthorityWorkerDeviceGeneration: null,
    physicalAuthorityWorkerProfileHash: null,
    targetId: "e3200000-0000-4000-8000-000000000002",
    targetScope: "organization",
    targetOwnerUserId: null,
    targetAuthorityKey: "organization:e3200000-0000-4000-8000-000000000003",
    targetDeviceGeneration: 1,
    targetRegisteredProfileHash: "e".repeat(64),
    targetProviderConstraintHash: "f".repeat(64),
  };
}

async function matcherPair(overrides: {
  target?: Record<string, unknown>;
  worker?: Record<string, unknown>;
  requirements?: Record<string, unknown>;
} = {}) {
  const profile: Record<string, unknown> = {
    profileId: "job003-static",
    version: 1,
    digest: "0".repeat(64),
    maxContinuousRuntimeSeconds: 3600,
    maxIdleSeconds: 300,
    resourceCeiling: { cpuMillis: 4000, memoryMiB: 8192, pids: 1024, diskMiB: 20480 },
    maxConcurrentOperations: 4,
    supportedOperations: ["create", "execute", "cancel", "kill", "destroy", "list", "inspect", "reconcile_cleanup"],
    localityTags: ["transfer_allowed"],
    checkpointMode: "none",
    healthMode: "none",
  };
  profile.digest = createHash("sha256")
    .update(canonicalProviderConstraintProfileDigestInputV1(profile))
    .digest("hex");
  const reference = { profileId: profile.profileId, version: 1, digest: profile.digest };
  const target = {
    protocolVersion: 1,
    targetId: "e3200000-0000-4000-8000-000000000002",
    targetClass: "managed_cloud",
    scope: "platform",
    organizationId: null,
    ownerPrincipalId: null,
    trustCeiling: "shared_isolated",
    credentialCeiling: "platform_brokered",
    dataLocalityCeiling: "transfer_allowed",
    providerConstraints: reference,
    capabilityCeiling: ["workload.batch", "provider.lifecycle_v1", "sandbox.process_isolated"],
    deviceGeneration: 1,
    revokedAt: null,
    policyHash: "a".repeat(64),
    ...overrides.target,
  };
  const worker = {
    ...hello({
      batchSlots: 1,
      browserSessionSlots: 0,
      serviceSlots: 0,
      freeCpuMillis: 4000,
      freeMemoryMiB: 8192,
      freeDiskMiB: 20480,
    }),
    reportedCapabilities: ["workload.batch", "provider.lifecycle_v1", "sandbox.process_isolated"],
    policyHash: "a".repeat(64),
    ...overrides.worker,
  };
  const requirements = {
    protocol: { min: 1, max: 1 },
    capabilities: ["workload.batch", "provider.lifecycle_v1", "sandbox.process_isolated"],
    workloadType: "batch",
    targetRequirements: {
      allowedTargetClasses: ["managed_cloud"],
      allowedTrustClasses: ["shared_isolated"],
      requiredOwnerPrincipalId: null,
      credentialKind: "platform_brokered",
      dataLocality: "transfer_allowed",
      fallback: { mode: "forbidden", orderedTargetClasses: [] },
      providerConstraints: reference,
    },
    policyHash: "a".repeat(64),
    mustUnderstand: ["provider.lifecycle_v1"],
    ...overrides.requirements,
  };
  const verifiedProviderConstraints = await verifyAndBrandProviderConstraintProfileV1(
    profile,
    async (bytes) => createHash("sha256").update(bytes).digest("hex"),
  );
  expect(verifiedProviderConstraints).not.toBeNull();
  return { target, worker, requirements, verifiedProviderConstraints };
}

describe("JOB-003 static-only lease eligibility", () => {
  it("pins six explicit versions, the neutral capacity, and canonical SHA-256 hashing", async () => {
    const eligibility = await loadEligibility();
    if (!eligibility) return;
    expect.soft({
      certificate: eligibility.LEASE_STATIC_ELIGIBILITY_VERSION,
      canonicalizer: eligibility.LEASE_CANONICALIZER_VERSION,
      algorithm: eligibility.LEASE_ALGORITHM_VERSION,
      matcher: eligibility.LEASE_MATCHER_VERSION,
      placement: eligibility.LEASE_PLACEMENT_NORMALIZER_VERSION,
      vocabulary: eligibility.LEASE_WORKLOAD_VOCABULARY_VERSION,
    }).toEqual({ certificate: 1, canonicalizer: 1, algorithm: 1, matcher: 1, placement: 1, vocabulary: 1 });
    expect.soft(eligibility.NEUTRAL_LEASE_MATCHER_CAPACITY).toEqual({
      batchSlots: 1,
      browserSessionSlots: 1,
      serviceSlots: 1,
      freeCpuMillis: 0,
      freeMemoryMiB: 0,
      freeDiskMiB: 0,
    });
    expect.soft(source).toContain("canonicalizeJsonV1");
    expect.soft(source).not.toMatch(/JSON\.stringify\s*\(/);
    expect.soft(source).toContain("workerSatisfiesRequirements");
    expect.soft(source).toContain("static_requirements_mismatch");
  });

  it("hashes every non-capacity matcher field but leaves capacity changes to dynamic gates", async () => {
    const eligibility = await loadEligibility();
    if (!eligibility) return;
    const baseline = hello();
    const baselineHash = eligibility.logicalWorkerStaticMatcherProfileHash(baseline);
    expect.soft(baselineHash).toMatch(/^[0-9a-f]{64}$/);

    const capacityOnly = hello({
      batchSlots: 99,
      browserSessionSlots: 0,
      serviceSlots: 17,
      freeCpuMillis: 1,
      freeMemoryMiB: 2,
      freeDiskMiB: 3,
    });
    expect.soft(eligibility.logicalWorkerStaticMatcherProfileHash(capacityOnly)).toBe(baselineHash);

    const mutations: Array<[string, Record<string, unknown>]> = [
      ["agentVersion", { ...baseline, agentVersion: "changed" }],
      ["protocol", { ...baseline, supportedProtocol: { min: 1, max: 2 } }],
      ["platform", { ...baseline, platform: { os: "windows", arch: "x64", runtime: "worker" } }],
      ["capabilities", { ...baseline, reportedCapabilities: ["workload.batch"] }],
      ["policy", { ...baseline, policyHash: "9".repeat(64) }],
    ];
    for (const [label, mutation] of mutations) {
      expect.soft(
        eligibility.logicalWorkerStaticMatcherProfileHash(mutation),
        label,
      ).not.toBe(baselineHash);
    }

    const expectedNeutral = {
      ...baseline,
      capacity: eligibility.NEUTRAL_LEASE_MATCHER_CAPACITY,
    };
    const expectedHash = createHash("sha256")
      .update(canonicalizeJsonV1(expectedNeutral))
      .digest("hex");
    expect.soft(baselineHash).toBe(expectedHash);
  });

  it("binds every poll-invariant authority fact and all version values in one context hash", async () => {
    const eligibility = await loadEligibility();
    if (!eligibility) return;
    const baseline = context();
    const baselineHash = eligibility.leaseStaticContextHash(baseline);
    expect.soft(baselineHash).toMatch(/^[0-9a-f]{64}$/);
    for (const key of Object.keys(baseline)) {
      const changed = { ...baseline, [key]: baseline[key] === null ? "changed" : `${String(baseline[key])}-changed` };
      expect.soft(eligibility.leaseStaticContextHash(changed), key).not.toBe(baselineHash);
    }
    expect.soft(source).toMatch(/certificateVersion[\s\S]*canonicalizerVersion[\s\S]*leasingAlgorithmVersion/);
    expect.soft(source).toMatch(/matcherVersion[\s\S]*placementNormalizerVersion[\s\S]*workloadVocabularyVersion/);
  });

  it("keeps dynamic capacity/live-count gates outside durable static-negative reasons", () => {
    expect.soft(source).not.toMatch(/reasonCode\s*:\s*["'](?:capacity|slots|provider_total|resource)/);
    expect.soft(source).not.toMatch(/static_context_hash[\s\S]{0,300}(?:liveLeases|freeCpuMillis|batchSlots)/);
    expect.soft(source).toMatch(/eligible[\s\S]*static_requirements_mismatch|static_requirements_mismatch[\s\S]*eligible/);
  });

  it("is bidirectionally equivalent to frozen matching after dynamic gates pass", async () => {
    const eligibility = await loadEligibility();
    if (!eligibility) return;
    expect.soft(typeof eligibility.evaluateStaticLeaseEligibility).toBe("function");
    if (typeof eligibility.evaluateStaticLeaseEligibility !== "function") return;

    const cases = [
      { name: "coherent", pair: await matcherPair(), expected: true },
      { name: "capability", pair: await matcherPair({ worker: { reportedCapabilities: ["workload.batch"] } }), expected: false },
      { name: "protocol", pair: await matcherPair({ worker: { supportedProtocol: { min: 2, max: 2 } } }), expected: false },
      { name: "worker-policy", pair: await matcherPair({ worker: { policyHash: "b".repeat(64) } }), expected: false },
      { name: "revoked-target", pair: await matcherPair({ target: { revokedAt: "2026-08-11T00:00:00.000Z" } }), expected: false },
      { name: "target-class", pair: await matcherPair({
        requirements: {
          targetRequirements: {
            ...(await matcherPair()).requirements.targetRequirements,
            allowedTargetClasses: ["organization_dedicated"],
          },
        },
      }), expected: false },
    ];
    const dynamicallyAdmissibleCapacity = [
      { batchSlots: 1, browserSessionSlots: 0, serviceSlots: 0, freeCpuMillis: 1, freeMemoryMiB: 1, freeDiskMiB: 1 },
      { batchSlots: 3, browserSessionSlots: 2, serviceSlots: 1, freeCpuMillis: 4000, freeMemoryMiB: 8192, freeDiskMiB: 20480 },
    ];
    for (const testCase of cases) {
      const adapter = eligibility.evaluateStaticLeaseEligibility(testCase.pair);
      expect.soft(adapter.eligible, testCase.name).toBe(testCase.expected);
      expect.soft(adapter.reasonCode, testCase.name).toBe(testCase.expected ? null : "static_requirements_mismatch");
      for (const capacity of dynamicallyAdmissibleCapacity) {
        const frozen = workerSatisfiesRequirements(
          testCase.pair.target as never,
          testCase.pair.verifiedProviderConstraints!,
          { ...testCase.pair.worker, capacity } as never,
          testCase.pair.requirements as never,
        );
        expect.soft(adapter.eligible, `${testCase.name}:${capacity.batchSlots}`).toBe(frozen);
      }
    }

    const dynamicOnly = await matcherPair({ worker: { capacity: {
      batchSlots: 0,
      browserSessionSlots: 0,
      serviceSlots: 0,
      freeCpuMillis: 999_999,
      freeMemoryMiB: 999_999,
      freeDiskMiB: 999_999,
    } } });
    expect.soft(workerSatisfiesRequirements(
      dynamicOnly.target as never,
      dynamicOnly.verifiedProviderConstraints!,
      dynamicOnly.worker as never,
      dynamicOnly.requirements as never,
    )).toBe(false);
    expect.soft(eligibility.evaluateStaticLeaseEligibility(dynamicOnly).eligible).toBe(true);
  });
});
