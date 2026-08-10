import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalizeJsonV1,
} from "@armyofagents/worker-protocol";

const moduleUrl = new URL("../services/job-lease-eligibility.ts", import.meta.url);
const source = existsSync(moduleUrl) ? readFileSync(moduleUrl, "utf8") : "";
const frozenV1Url = new URL(
  "../../../tests/fixtures/worker-protocol-consumers/v1/dist/index.js",
  import.meta.url,
);
const frozenConformanceUrl = new URL(
  "../../../docs/contracts/worker-protocol/v1/conformance.json",
  import.meta.url,
);

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

async function loadFrozenV1Matcher(): Promise<(
  target: unknown,
  verifiedProviderConstraints: unknown,
  worker: unknown,
  requirements: unknown,
) => boolean> {
  expect.soft(existsSync(frozenV1Url), "immutable E1 v1 consumer fixture must exist").toBe(true);
  const frozen = await loadFrozenV1Module();
  expect.soft(typeof frozen.workerSatisfiesRequirements).toBe("function");
  return frozen.workerSatisfiesRequirements as (
    target: unknown,
    verifiedProviderConstraints: unknown,
    worker: unknown,
    requirements: unknown,
  ) => boolean;
}

async function loadFrozenV1Module(): Promise<Record<string, any>> {
  expect.soft(existsSync(frozenV1Url), "immutable E1 v1 consumer fixture must exist").toBe(true);
  return vi.importActual<Record<string, any>>(frozenV1Url.href);
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
    supportedProtocol: { min: 1, max: 2 },
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
  const frozen = await loadFrozenV1Module();
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
    .update(frozen.canonicalProviderConstraintProfileDigestInputV1(profile))
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
  const verifiedProviderConstraints = await frozen.verifyAndBrandProviderConstraintProfileV1(
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

    const mutations: Array<[string, Record<string, unknown>]> = [
      ["protocolVersion", { ...baseline, protocolVersion: 2 }],
      ["workerId", { ...baseline, workerId: "e3200000-0000-4000-8000-000000000099" }],
      ["targetId", { ...baseline, targetId: "e3200000-0000-4000-8000-000000000098" }],
      ["deviceGeneration", { ...baseline, deviceGeneration: 2 }],
      ["agentVersion", { ...baseline, agentVersion: "changed" }],
      ["supportedProtocol.min", { ...baseline, supportedProtocol: { min: 2, max: 2 } }],
      ["supportedProtocol.max", { ...baseline, supportedProtocol: { min: 1, max: 3 } }],
      ["platform.os", { ...baseline, platform: { os: "windows", arch: "x64", runtime: "worker" } }],
      ["platform.arch", { ...baseline, platform: { os: "linux", arch: "arm64", runtime: "worker" } }],
      ["platform.runtime", { ...baseline, platform: { os: "linux", arch: "x64", runtime: "changed" } }],
      ["capabilities", { ...baseline, reportedCapabilities: ["workload.batch"] }],
      ["capability-order", { ...baseline, reportedCapabilities: [...baseline.reportedCapabilities as string[]].reverse() }],
      ["policy", { ...baseline, policyHash: "9".repeat(64) }],
    ];
    for (const [label, mutation] of mutations) {
      expect.soft(
        eligibility.logicalWorkerStaticMatcherProfileHash(mutation),
        label,
      ).not.toBe(baselineHash);
      expect.soft(
        createHash("sha256").update(JSON.stringify(mutation)).digest("hex"),
        `${label}:correctly rehashed enrollment snapshot`,
      ).not.toBe(createHash("sha256").update(JSON.stringify(baseline)).digest("hex"));
    }

    const baselineCapacity = baseline.capacity as Record<string, number>;
    for (const field of [
      "batchSlots", "browserSessionSlots", "serviceSlots",
      "freeCpuMillis", "freeMemoryMiB", "freeDiskMiB",
    ]) {
      const capacityOnly = {
        ...baseline,
        capacity: { ...baselineCapacity, [field]: baselineCapacity[field]! + 1 },
      };
      expect.soft(eligibility.logicalWorkerStaticMatcherProfileHash(capacityOnly), field).toBe(baselineHash);
    }

    const expectedNeutral = {
      ...baseline,
      capacity: eligibility.NEUTRAL_LEASE_MATCHER_CAPACITY,
    };
    const frozen = await loadFrozenV1Module();
    expect.soft(canonicalizeJsonV1(expectedNeutral)).toBe(frozen.canonicalizeJsonV1(expectedNeutral));
    const expectedHash = createHash("sha256")
      .update(frozen.canonicalizeJsonV1(expectedNeutral))
      .digest("hex");
    expect.soft(baselineHash).toBe(expectedHash);
  });

  it("binds every poll-invariant authority fact and all version values in one context hash", async () => {
    const eligibility = await loadEligibility();
    if (!eligibility) return;
    const baseline = context();
    const baselineHash = eligibility.leaseStaticContextHash(baseline);
    expect.soft(baselineHash).toMatch(/^[0-9a-f]{64}$/);
    const expectedCanonical = {
      certificateVersion: eligibility.LEASE_STATIC_ELIGIBILITY_VERSION,
      canonicalizerVersion: eligibility.LEASE_CANONICALIZER_VERSION,
      leasingAlgorithmVersion: eligibility.LEASE_ALGORITHM_VERSION,
      matcherVersion: eligibility.LEASE_MATCHER_VERSION,
      placementNormalizerVersion: eligibility.LEASE_PLACEMENT_NORMALIZER_VERSION,
      workloadVocabularyVersion: eligibility.LEASE_WORKLOAD_VOCABULARY_VERSION,
      ...baseline,
    };
    const frozen = await loadFrozenV1Module();
    expect.soft(Object.keys(expectedCanonical)).toHaveLength(25);
    expect.soft(baselineHash).toBe(createHash("sha256")
      .update(frozen.canonicalizeJsonV1(expectedCanonical))
      .digest("hex"));
    for (const key of Object.keys(baseline)) {
      const value = baseline[key];
      const changedValue = value === null ? "changed" : typeof value === "number" ? value + 1 : `${String(value)}-changed`;
      const changed = { ...baseline, [key]: changedValue };
      expect.soft(eligibility.leaseStaticContextHash(changed), key).not.toBe(baselineHash);
    }
    expect.soft(eligibility.leaseStaticContextHash({ ...baseline, ignoredExtraKey: "must-not-enter-hash" }))
      .toBe(baselineHash);
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
    const frozenWorkerSatisfiesRequirements = await loadFrozenV1Matcher();
    expect.soft(typeof eligibility.evaluateStaticLeaseEligibility).toBe("function");
    if (typeof eligibility.evaluateStaticLeaseEligibility !== "function") return;

    const baselinePair = await matcherPair();
    const providerMismatch = await matcherPair();
    providerMismatch.target.providerConstraints = {
      ...(providerMismatch.target.providerConstraints as Record<string, unknown>),
      digest: "9".repeat(64),
    };
    const targetClassMismatch = await matcherPair({
      requirements: {
        targetRequirements: {
          ...baselinePair.requirements.targetRequirements as Record<string, unknown>,
          allowedTargetClasses: ["organization_dedicated"],
        },
      },
    });
    const trustMismatch = await matcherPair({
      requirements: {
        targetRequirements: {
          ...baselinePair.requirements.targetRequirements as Record<string, unknown>,
          allowedTrustClasses: ["organization_isolated"],
        },
      },
    });
    const ownerMismatch = await matcherPair({
      target: {
        targetClass: "owner_desktop",
        scope: "owner",
        organizationId: "e3200000-0000-4000-8000-000000000003",
        ownerPrincipalId: "owner-principal-9",
        trustCeiling: "owner_local_trusted",
        credentialCeiling: "owner_bound",
        dataLocalityCeiling: "owner_device_only",
      },
      requirements: {
        targetRequirements: {
          ...baselinePair.requirements.targetRequirements as Record<string, unknown>,
          allowedTargetClasses: ["owner_desktop"],
          allowedTrustClasses: ["owner_local_trusted"],
          requiredOwnerPrincipalId: "someone-else",
          credentialKind: "owner_bound",
          dataLocality: "owner_device_only",
        },
      },
    });
    const credentialMismatch = await matcherPair({
      target: {
        targetClass: "organization_dedicated",
        scope: "organization",
        organizationId: "e3200000-0000-4000-8000-000000000003",
        trustCeiling: "organization_isolated",
        credentialCeiling: "platform_brokered",
        dataLocalityCeiling: "organization_target_only",
      },
      requirements: {
        targetRequirements: {
          ...baselinePair.requirements.targetRequirements as Record<string, unknown>,
          allowedTargetClasses: ["organization_dedicated"],
          allowedTrustClasses: ["organization_isolated"],
          credentialKind: "organization_brokered",
          dataLocality: "organization_target_only",
        },
      },
    });
    const localityMismatch = await matcherPair({
      target: {
        targetClass: "organization_dedicated",
        scope: "organization",
        organizationId: "e3200000-0000-4000-8000-000000000003",
        trustCeiling: "organization_isolated",
        credentialCeiling: "organization_brokered",
        dataLocalityCeiling: "transfer_allowed",
      },
      requirements: {
        targetRequirements: {
          ...baselinePair.requirements.targetRequirements as Record<string, unknown>,
          allowedTargetClasses: ["organization_dedicated"],
          allowedTrustClasses: ["organization_isolated"],
          credentialKind: "organization_brokered",
          dataLocality: "organization_target_only",
        },
      },
    });
    const requirementsProviderMismatch = await matcherPair({
      requirements: {
        targetRequirements: {
          ...baselinePair.requirements.targetRequirements as Record<string, unknown>,
          providerConstraints: {
            ...baselinePair.requirements.targetRequirements.providerConstraints as Record<string, unknown>,
            digest: "8".repeat(64),
          },
        },
      },
    });
    const cases = [
      { name: "coherent", pair: baselinePair, expected: true },
      { name: "target-id", pair: await matcherPair({ worker: { targetId: "e3200000-0000-4000-8000-000000000099" } }), expected: false },
      { name: "target-generation", pair: await matcherPair({ worker: { deviceGeneration: 2 } }), expected: false },
      { name: "revoked-target", pair: await matcherPair({ target: { revokedAt: "2026-08-11T00:00:00.000Z" } }), expected: false },
      { name: "provider-profile", pair: providerMismatch, expected: false },
      { name: "requirements-provider-profile", pair: requirementsProviderMismatch, expected: false },
      { name: "server-capability-ceiling", pair: await matcherPair({ target: { capabilityCeiling: ["workload.batch"] } }), expected: false },
      { name: "worker-capability-report", pair: await matcherPair({ worker: { reportedCapabilities: ["workload.batch"] } }), expected: false },
      { name: "unknown-must-understand", pair: await matcherPair({ requirements: { mustUnderstand: ["provider.unknownfuture_v9"] } }), expected: false },
      { name: "withheld-must-understand", pair: await matcherPair({
        target: { capabilityCeiling: ["workload.batch", "provider.lifecycle_v1", "sandbox.process_isolated"] },
        requirements: { mustUnderstand: ["secret.proxy"] },
      }), expected: false },
      { name: "requirements-policy", pair: await matcherPair({ requirements: { policyHash: "b".repeat(64) } }), expected: false },
      { name: "worker-policy", pair: await matcherPair({ worker: { policyHash: "b".repeat(64) } }), expected: false },
      { name: "protocol", pair: await matcherPair({ worker: { supportedProtocol: { min: 2, max: 2 } } }), expected: false },
      { name: "target-class", pair: targetClassMismatch, expected: false },
      { name: "target-trust", pair: trustMismatch, expected: false },
      { name: "credential-ceiling", pair: credentialMismatch, expected: false },
      { name: "data-locality", pair: localityMismatch, expected: false },
      { name: "owner-principal", pair: ownerMismatch, expected: false },
      { name: "workload-capability", pair: await matcherPair({ requirements: { workloadType: "service", capabilities: [] } }), expected: false },
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
        const frozen = frozenWorkerSatisfiesRequirements(
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
    expect.soft(frozenWorkerSatisfiesRequirements(
      dynamicOnly.target as never,
      dynamicOnly.verifiedProviderConstraints!,
      dynamicOnly.worker as never,
      dynamicOnly.requirements as never,
    )).toBe(false);
    expect.soft(eligibility.evaluateStaticLeaseEligibility(dynamicOnly).eligible).toBe(true);
  });

  it("runs every immutable target_worker_pair conformance case through frozen v1 and the adapter", async () => {
    const eligibility = await loadEligibility();
    if (!eligibility) return;
    const frozen = await vi.importActual<Record<string, any>>(frozenV1Url.href);
    const conformance = JSON.parse(readFileSync(frozenConformanceUrl, "utf8")) as {
      cases: Array<{ name: string; schema: string; valid: boolean; input: Record<string, unknown> }>;
    };
    const cases = conformance.cases.filter((entry) => entry.schema === "target_worker_pair");
    expect.soft(cases.length).toBeGreaterThan(0);
    for (const entry of cases) {
      const target = frozen.registeredTargetProfileV1Schema.parse(entry.input.registeredTarget);
      const provider = await frozen.verifyAndBrandProviderConstraintProfileV1(
        entry.input.providerProfile,
        async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex"),
      );
      const worker = frozen.workerHelloV1Schema.parse(entry.input.worker);
      const requirements = frozen.jobCapabilityRequirementsSchema.parse(entry.input.requirements);
      expect.soft(provider, entry.name).not.toBeNull();
      if (!provider) continue;
      const frozenResult = frozen.workerSatisfiesRequirements(target, provider, worker, requirements);
      expect.soft(frozenResult, `${entry.name}:fixture disposition`).toBe(entry.valid);
      const adapter = eligibility.evaluateStaticLeaseEligibility({
        target,
        verifiedProviderConstraints: provider,
        worker,
        requirements,
      });
      expect.soft(adapter.eligible, `${entry.name}:adapter`).toBe(frozenResult);
      expect.soft(adapter.reasonCode, `${entry.name}:reason`)
        .toBe(frozenResult ? null : "static_requirements_mismatch");
    }
  });
});
