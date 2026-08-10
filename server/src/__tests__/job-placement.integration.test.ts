import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres, { type Sql } from "postgres";
import { sql } from "drizzle-orm";
import {
  applyPendingMigrations,
  createOperatorDbConnection,
  createTenantAppDbConnection,
  type NonOwnerDbConnection,
} from "@armyofagents/db";
import {
  canonicalProviderConstraintProfileDigestInputV1,
  canonicalizeJsonV1,
  type ProviderConstraintProfileV1,
  type RegisteredTargetProfileV1,
} from "@armyofagents/worker-protocol";
import * as resolverNamespace from "../services/execution-target-resolver.js";
import * as placementNamespace from "../services/job-placement.js";
import { provisionTenantAppRoleLoginSql } from "../db/rls-tenant.js";
import { runInTenant } from "../db/tenant-context.js";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};
type EmbeddedPostgresCtor = new (opts: Record<string, unknown>) => EmbeddedPostgresInstance;

const ORG_A = "91000000-0000-4000-8000-000000000001";
const ORG_B = "91000000-0000-4000-8000-000000000002";
const TARGET_A = "92000000-0000-4000-8000-000000000001";
const TARGET_B = "92000000-0000-4000-8000-000000000002";
const TARGET_PLATFORM = "92000000-0000-4000-8000-000000000003";
const TARGET_OWNER_A = "92000000-0000-4000-8000-000000000004";
const TARGET_OWNER_B = "92000000-0000-4000-8000-000000000005";
const COMPANY_A = "96000000-0000-4000-8000-000000000001";
const COMPANY_B = "96000000-0000-4000-8000-000000000002";
const WORKER_A = "97000000-0000-4000-8000-000000000001";
const WORKER_PLATFORM = "97000000-0000-4000-8000-000000000002";
const WORKER_OWNER_A = "97000000-0000-4000-8000-000000000003";
const WORKER_OWNER_B = "97000000-0000-4000-8000-000000000004";
const OWNER_A = "job-009-owner-a";
const PASSWORD = "job-009-role-password";
const POLICY_HASH = "a".repeat(64);

const integration = describe.skipIf(
  process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1",
);

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function providerProfile(): ProviderConstraintProfileV1 {
  const unsigned = {
    profileId: "platform-v1",
    version: 1,
    maxContinuousRuntimeSeconds: 3_600,
    maxIdleSeconds: 300,
    resourceCeiling: { cpuMillis: 2_000, memoryMiB: 4_096, pids: 512, diskMiB: 8_192 },
    maxConcurrentOperations: 8,
    supportedOperations: [
      "create", "execute", "cancel", "kill", "destroy", "list", "inspect", "reconcile_cleanup",
    ],
    localityTags: ["transfer_allowed"],
    checkpointMode: "none",
    healthMode: "none",
  } as const;
  return {
    ...unsigned,
    digest: sha256(canonicalProviderConstraintProfileDigestInputV1(unsigned)),
  };
}

function registeredProfile(provider: ProviderConstraintProfileV1): RegisteredTargetProfileV1 {
  return {
    protocolVersion: 1,
    targetId: TARGET_PLATFORM,
    targetClass: "managed_cloud",
    scope: "platform",
    organizationId: null,
    ownerPrincipalId: null,
    trustCeiling: "shared_isolated",
    credentialCeiling: "platform_brokered",
    dataLocalityCeiling: "transfer_allowed",
    providerConstraints: {
      profileId: provider.profileId,
      version: provider.version,
      digest: provider.digest,
    },
    capabilityCeiling: ["workload.batch", "sandbox.process_isolated"],
    deviceGeneration: 4,
    revokedAt: null,
    policyHash: POLICY_HASH,
  };
}

function organizationProfile(provider: ProviderConstraintProfileV1): RegisteredTargetProfileV1 {
  return {
    ...registeredProfile(provider),
    targetId: TARGET_A,
    targetClass: "organization_dedicated",
    scope: "organization",
    organizationId: ORG_A,
    trustCeiling: "organization_isolated",
    credentialCeiling: "organization_brokered",
    dataLocalityCeiling: "organization_target_only",
    deviceGeneration: 1,
  };
}

function ownerProfile(
  provider: ProviderConstraintProfileV1,
  targetId: string,
): RegisteredTargetProfileV1 {
  return {
    ...registeredProfile(provider),
    targetId,
    targetClass: "owner_desktop",
    scope: "owner",
    organizationId: ORG_A,
    ownerPrincipalId: OWNER_A,
    trustCeiling: "owner_local_trusted",
    credentialCeiling: "owner_bound",
    dataLocalityCeiling: "owner_device_only",
    deviceGeneration: 1,
  };
}

function workerHello() {
  return {
    protocolVersion: 1 as const,
    workerId: WORKER_A,
    targetId: TARGET_A,
    deviceGeneration: 1,
    agentVersion: "job-009-integration",
    supportedProtocol: { min: 1, max: 1 },
    platform: { os: "linux" as const, arch: "x64" as const, runtime: "worker" },
    reportedCapabilities: ["workload.batch" as const, "sandbox.process_isolated" as const],
    capacity: {
      batchSlots: 2, browserSessionSlots: 0, serviceSlots: 0,
      freeCpuMillis: 2_000, freeMemoryMiB: 4_096, freeDiskMiB: 8_192,
    },
    policyHash: POLICY_HASH,
  };
}

function platformWorkerHello() {
  return {
    ...workerHello(),
    workerId: WORKER_PLATFORM,
    targetId: TARGET_PLATFORM,
    deviceGeneration: 4,
  };
}

function ownerWorkerHello(workerId: string, targetId: string) {
  return {
    ...workerHello(),
    workerId,
    targetId,
  };
}

function placementRequirements(
  provider: ProviderConstraintProfileV1,
  targetClass: "organization_dedicated" | "managed_cloud" = "organization_dedicated",
) {
  const target = targetClass === "managed_cloud"
    ? {
        allowedTargetClasses: ["managed_cloud"] as const,
        allowedTrustClasses: ["shared_isolated"] as const,
        credentialKind: "platform_brokered" as const,
        dataLocality: "transfer_allowed" as const,
      }
    : {
        allowedTargetClasses: ["organization_dedicated"] as const,
        allowedTrustClasses: ["organization_isolated"] as const,
        credentialKind: "organization_brokered" as const,
        dataLocality: "organization_target_only" as const,
      };
  return {
    protocol: { min: 1, max: 1 },
    capabilities: ["sandbox.process_isolated"],
    workloadType: "batch",
    targetRequirements: {
      allowedTargetClasses: target.allowedTargetClasses,
      allowedTrustClasses: target.allowedTrustClasses,
      requiredOwnerPrincipalId: null,
      credentialKind: target.credentialKind,
      dataLocality: target.dataLocality,
      fallback: { mode: "forbidden", orderedTargetClasses: [] },
      providerConstraints: { profileId: provider.profileId, version: provider.version, digest: provider.digest },
    },
    policyHash: POLICY_HASH,
    mustUnderstand: [],
  };
}

function placementRequest() {
  return {
    providerDemand: {
      maxRuntimeSeconds: 600,
      maxIdleSeconds: 60,
      resources: { cpuMillis: 1_000, memoryMiB: 1_024, pids: 128, diskMiB: 1_024 },
      concurrentOperations: 1,
      operations: ["create", "execute"],
      localityTags: ["transfer_allowed"],
    },
    credentialOwnerPrincipalId: null,
  };
}

describe("JOB-009 slice A registry normalization", () => {
  it("normalizes a server-owned target/profile snapshot without trusting the legacy row alone", async () => {
    const provider = providerProfile();
    const registered = registeredProfile(provider);
    const normalize = (resolverNamespace as Record<string, unknown>).normalizePlacementRegistryTarget;
    expect(typeof normalize, "the existing resolver must expose the JOB-009 normalization seam").toBe("function");

    const result = await (normalize as (input: unknown) => Promise<unknown>)({
      id: TARGET_PLATFORM,
      slug: "platform-main",
      kind: "pooled_gvisor",
      trustClass: "shared_multitenant",
      status: "active",
      organizationId: null,
      ownerUserId: null,
      scope: "platform",
      targetAuthorityKey: "platform",
      deviceGeneration: 4,
      registeredProfile: registered,
      registeredProfileHash: sha256(canonicalizeJsonV1(registered)),
      providerConstraintProfile: provider,
      lastSeenAt: new Date("2026-08-10T10:00:00.000Z"),
    });

    expect(result).toMatchObject({
      targetId: TARGET_PLATFORM,
      targetClass: "managed_cloud",
      targetScope: "platform",
      targetGeneration: 4,
      profileHash: sha256(canonicalizeJsonV1(registered)),
      providerConstraintHash: provider.digest,
      status: "active",
    });
  });

  it("fails closed when the bounded row and registered E1 profile disagree", async () => {
    const provider = providerProfile();
    const registered = registeredProfile(provider);
    const normalize = (resolverNamespace as Record<string, unknown>).normalizePlacementRegistryTarget;
    expect(typeof normalize).toBe("function");
    await expect((normalize as (input: unknown) => Promise<unknown>)({
      id: TARGET_PLATFORM,
      slug: "platform-main",
      kind: "desktop",
      trustClass: "local_trusted",
      status: "active",
      organizationId: null,
      ownerUserId: null,
      scope: "platform",
      targetAuthorityKey: "platform",
      deviceGeneration: 4,
      registeredProfile: registered,
      registeredProfileHash: sha256(canonicalizeJsonV1(registered)),
      providerConstraintProfile: provider,
      lastSeenAt: new Date("2026-08-10T10:00:00.000Z"),
    })).resolves.toBeNull();
  });

  it("fails closed when the immutable registered-profile hash changes", async () => {
    const provider = providerProfile();
    const registered = registeredProfile(provider);
    await expect(resolverNamespace.normalizePlacementRegistryTarget({
      id: TARGET_PLATFORM,
      slug: "platform-main",
      kind: "pooled_gvisor",
      trustClass: "shared_multitenant",
      status: "active",
      organizationId: null,
      ownerUserId: null,
      scope: "platform",
      targetAuthorityKey: "platform",
      deviceGeneration: 4,
      registeredProfile: registered,
      registeredProfileHash: "f".repeat(64),
      providerConstraintProfile: provider,
      lastSeenAt: new Date("2026-08-10T10:00:00.000Z"),
    })).resolves.toBeNull();
  });
});

integration("JOB-009 slice A schema and role boundaries", () => {
  let embedded: EmbeddedPostgresInstance | null = null;
  let dataDir = "";
  let adminUrl = "";
  let admin: Sql | null = null;
  let app: NonOwnerDbConnection | null = null;
  let operator: NonOwnerDbConnection | null = null;
  let setupError: unknown = null;
  const targetClassByJob = new Map<string, "organization_dedicated" | "managed_cloud">();

  function guard() {
    if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
    if (!admin || !app || !operator) throw new Error("test setup incomplete");
    return { admin, app, operator };
  }

  beforeAll(async () => {
    try {
      dataDir = await mkdtemp(join(tmpdir(), "aoa-job-placement-a-"));
      const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
        default: EmbeddedPostgresCtor;
      };
      const port = await allocateEmbeddedPgPort();
      embedded = new EmbeddedPostgres({
        databaseDir: join(dataDir, "db"), user: "test", password: "test", port,
        persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"],
      });
      await embedded.initialise();
      await embedded.start();
      adminUrl = `postgres://test:test@127.0.0.1:${port}/postgres`;
      await applyPendingMigrations(adminUrl);
      admin = postgres(adminUrl, { max: 2 });
      await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_app", PASSWORD));
      await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_operator", PASSWORD));
      app = createTenantAppDbConnection(adminUrl.replace("test:test", `aoa_app:${PASSWORD}`));
      operator = createOperatorDbConnection(adminUrl.replace("test:test", `aoa_operator:${PASSWORD}`));
      await admin`INSERT INTO organizations (id, name, slug) VALUES
        (${ORG_A}, 'Placement A', 'placement-a'), (${ORG_B}, 'Placement B', 'placement-b')`;
      await admin`INSERT INTO companies (id, organization_id, name, issue_prefix) VALUES
        (${COMPANY_A}, ${ORG_A}, 'Placement Company A', 'PCA'),
        (${COMPANY_B}, ${ORG_B}, 'Placement Company B', 'PCB')`;
      await admin`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES (${OWNER_A}, 'Placement Owner', 'job-009-owner@example.invalid', true, now(), now())`;
      await admin`INSERT INTO organization_memberships
        (organization_id, user_id, role, status, joined_at)
        VALUES (${ORG_A}, ${OWNER_A}, 'owner', 'active', now())`;
      await admin`INSERT INTO execution_targets
        (id, organization_id, owner_user_id, slug, kind, trust_class, status, capabilities, config,
         scope, target_authority_key, device_generation)
        VALUES
        (${TARGET_A}, ${ORG_A}, NULL, 'placement-a', 'dedicated_worker', 'dedicated_tenant', 'active', '{}', '{}',
         'organization', ${`organization:${ORG_A}`}, 1),
        (${TARGET_B}, ${ORG_B}, NULL, 'placement-b', 'dedicated_worker', 'dedicated_tenant', 'active', '{}', '{}',
         'organization', ${`organization:${ORG_B}`}, 1),
        (${TARGET_PLATFORM}, NULL, NULL, 'platform-main', 'pooled_gvisor', 'shared_multitenant', 'active', '{}', '{}',
         'platform', 'platform', 4),
        (${TARGET_OWNER_A}, ${ORG_A}, ${OWNER_A}, 'owner-a', 'local_host', 'local_trusted', 'active', '{}', '{}',
         'owner', ${`owner:${ORG_A}:${OWNER_A}`}, 1),
        (${TARGET_OWNER_B}, ${ORG_A}, ${OWNER_A}, 'owner-b', 'local_host', 'local_trusted', 'active', '{}', '{}',
         'owner', ${`owner:${ORG_A}:${OWNER_A}`}, 1)`;

      const provider = providerProfile();
      const organization = organizationProfile(provider);
      const platform = registeredProfile(provider);
      await admin`UPDATE execution_targets SET
        registered_profile = ${organization},
        registered_profile_hash = ${sha256(canonicalizeJsonV1(organization))},
        provider_constraint_profile = ${provider},
        last_seen_at = ${new Date("2026-08-10T10:00:00.000Z")}
        WHERE id = ${TARGET_A}`;
      await admin`UPDATE execution_targets SET
        registered_profile = ${platform},
        registered_profile_hash = ${sha256(canonicalizeJsonV1(platform))},
        provider_constraint_profile = ${provider},
        last_seen_at = ${new Date("2026-08-10T10:00:00.000Z")}
        WHERE id = ${TARGET_PLATFORM}`;
      const ownerProviderUnsigned = {
        ...provider,
        profileId: "owner-v1",
        localityTags: ["owner_device_only"],
      };
      const { digest: _ownerOldDigest, ...ownerProviderFacts } = ownerProviderUnsigned;
      const ownerProvider = {
        ...ownerProviderFacts,
        digest: sha256(canonicalProviderConstraintProfileDigestInputV1(ownerProviderFacts)),
      } as ProviderConstraintProfileV1;
      const ownerAProfile = ownerProfile(ownerProvider, TARGET_OWNER_A);
      const ownerBProfile = ownerProfile(ownerProvider, TARGET_OWNER_B);
      await admin`UPDATE execution_targets SET
        registered_profile = ${ownerAProfile},
        registered_profile_hash = ${sha256(canonicalizeJsonV1(ownerAProfile))},
        provider_constraint_profile = ${ownerProvider},
        last_seen_at = ${new Date("2026-08-10T10:00:00.000Z")}
        WHERE id = ${TARGET_OWNER_A}`;
      await admin`UPDATE execution_targets SET
        registered_profile = ${ownerBProfile},
        registered_profile_hash = ${sha256(canonicalizeJsonV1(ownerBProfile))},
        provider_constraint_profile = ${ownerProvider},
        last_seen_at = ${new Date("2026-08-10T10:00:00.000Z")}
        WHERE id = ${TARGET_OWNER_B}`;
      const hello = workerHello();
      const platformHello = platformWorkerHello();
      await admin`INSERT INTO workers
        (id, scope, organization_id, owner_user_id, execution_target_id, target_authority_key,
         device_public_key, device_thumbprint, device_generation, profile_hash, profile_snapshot,
         enrolled_at, last_seen_at, label, status)
        VALUES (${WORKER_A}, 'organization', ${ORG_A}, NULL, ${TARGET_A}, ${`organization:${ORG_A}`},
          'job-009-public-key', ${"d".repeat(64)}, 1, ${sha256(JSON.stringify(hello))}, ${hello},
          ${new Date("2026-08-10T09:59:00.000Z")}, ${new Date("2026-08-10T10:00:00.000Z")},
          'JOB-009 worker', 'enrolled')`;
      await admin`INSERT INTO workers
        (id, scope, organization_id, owner_user_id, execution_target_id, target_authority_key,
         device_public_key, device_thumbprint, device_generation, profile_hash, profile_snapshot,
         enrolled_at, last_seen_at, label, status)
        VALUES (${WORKER_PLATFORM}, 'platform', NULL, NULL, ${TARGET_PLATFORM}, 'platform',
          'job-009-platform-public-key', ${"e".repeat(64)}, 4,
          ${sha256(JSON.stringify(platformHello))}, ${platformHello},
          ${new Date("2026-08-10T09:59:00.000Z")}, ${new Date("2026-08-10T10:00:00.000Z")},
          'JOB-009 platform worker', 'enrolled')`;
      const ownerAHello = ownerWorkerHello(WORKER_OWNER_A, TARGET_OWNER_A);
      const ownerBHello = ownerWorkerHello(WORKER_OWNER_B, TARGET_OWNER_B);
      await admin`INSERT INTO workers
        (id, scope, organization_id, owner_user_id, execution_target_id, target_authority_key,
         device_public_key, device_thumbprint, device_generation, profile_hash, profile_snapshot,
         enrolled_at, last_seen_at, label, status)
        VALUES
        (${WORKER_OWNER_A}, 'owner', ${ORG_A}, ${OWNER_A}, ${TARGET_OWNER_A}, ${`owner:${ORG_A}:${OWNER_A}`},
          'job-009-owner-a-key', ${"1".repeat(64)}, 1, ${sha256(JSON.stringify(ownerAHello))}, ${ownerAHello},
          ${new Date("2026-08-10T09:59:00.000Z")}, ${new Date("2026-08-10T10:00:00.000Z")},
          'JOB-009 owner worker A', 'enrolled'),
        (${WORKER_OWNER_B}, 'owner', ${ORG_A}, ${OWNER_A}, ${TARGET_OWNER_B}, ${`owner:${ORG_A}:${OWNER_A}`},
          'job-009-owner-b-key', ${"2".repeat(64)}, 1, ${sha256(JSON.stringify(ownerBHello))}, ${ownerBHello},
          ${new Date("2026-08-10T09:59:00.000Z")}, ${new Date("2026-08-10T10:00:00.000Z")},
          'JOB-009 owner worker B', 'enrolled')`;
    } catch (error) {
      setupError = error;
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    await operator?.close().catch(() => {});
    await admin?.end().catch(() => {});
    await embedded?.stop().catch(() => {});
    if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  });

  it("applies the placement migration at head and replays the journal as a no-op", async () => {
    const { admin } = guard();
    await expect(applyPendingMigrations(adminUrl)).resolves.toBeUndefined();
    const columns = await admin<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND (
        (table_name = 'job_attempts' AND column_name IN (
          'placement_disposition', 'placement_owner', 'placement_target_id', 'placement_target_class',
          'placement_target_scope', 'placement_target_generation', 'placement_profile_hash',
          'placement_provider_constraint_hash', 'placement_fallback_disposition', 'placement_reason_code',
          'placement_mode', 'placement_lease_eligible', 'placement_input_digest', 'placement_policy_digest',
          'placement_decided_at'
        )) OR
        (table_name = 'execution_targets' AND column_name IN (
          'registered_profile', 'registered_profile_hash', 'provider_constraint_profile'
        )) OR
        (table_name = 'workers' AND column_name = 'profile_snapshot')
      )
    `;
    expect(columns).toHaveLength(19);
  });

  it("keeps composite target lookup tenant-bound with foreign and missing IDs indistinguishable", async () => {
    const { app } = guard();
    const [foreign, missing, own] = await runInTenant(app.db, ORG_A, async (repos) => Promise.all([
      repos.workerEnrollment.findActiveTarget({ executionTargetId: TARGET_B, scope: "organization", ownerUserId: null }),
      repos.workerEnrollment.findActiveTarget({ executionTargetId: "92000000-0000-4000-8000-000000000099", scope: "organization", ownerUserId: null }),
      repos.workerEnrollment.findActiveTarget({ executionTargetId: TARGET_A, scope: "organization", ownerUserId: null }),
    ]));
    expect(foreign).toBeNull();
    expect(missing).toBeNull();
    expect(own?.id).toBe(TARGET_A);
  });

  it("lets the operator read only bounded null-Organization placement metadata and never jobs", async () => {
    const { operator } = guard();
    const rows = await operator.db.execute<{
      id: string; registered_profile: unknown; registered_profile_hash: string | null;
      provider_constraint_profile: unknown;
    }>(sql`SELECT id, registered_profile, registered_profile_hash, provider_constraint_profile
        FROM execution_targets ORDER BY id`);
    expect(rows.map((row) => row.id)).toEqual([TARGET_PLATFORM]);
    await expect(operator.db.execute(sql`SELECT id FROM jobs`)).rejects.toThrow();
  });

  async function seedJob(input: {
    jobId: string;
    attemptId: string;
    organizationId?: string;
    companyId?: string;
    targetClass?: "organization_dedicated" | "managed_cloud";
  }) {
    const { admin } = guard();
    const organizationId = input.organizationId ?? ORG_A;
    const companyId = input.companyId ?? COMPANY_A;
    targetClassByJob.set(input.jobId, input.targetClass ?? "organization_dedicated");
    await admin`INSERT INTO jobs
      (id, organization_id, company_id, workload_type, input_hash, policy_hash, requirements,
       placement_request, status)
      VALUES (${input.jobId}, ${organizationId}, ${companyId}, 'batch', ${"b".repeat(64)},
        ${POLICY_HASH}, ${{ workloadType: "batch", requiredCapabilities: [] }},
        ${{ policyId: "job-submission-default", policyVersion: 1, requestedTarget: null }}, 'queued')`;
    await admin`INSERT INTO job_attempts
      (id, organization_id, company_id, job_id, attempt_number, status)
      VALUES (${input.attemptId}, ${organizationId}, ${companyId}, ${input.jobId}, 1, 'pending')`;
  }

  async function place(input: {
    jobId: string; attemptId: string; organizationId?: string; companyId?: string;
    mode?: "active" | "shadow"; enabled?: boolean; credentialId?: string | null;
    organizationEnabled?: boolean;
    workloadEnabled?: boolean;
    credentialBinding?: {
      credentialId: string | null;
      credentialKind: "company_api_key" | "personal_subscription" | null;
      executionTargetSlug: string | null;
      pinnedTargetId: string | null;
    };
  }) {
    const { app, operator } = guard();
    const factory = (placementNamespace as Record<string, unknown>).createJobPlacementService;
    expect(typeof factory, "Slice C must expose the trusted placement service").toBe("function");
    const managed = targetClassByJob.get(input.jobId) === "managed_cloud";
    const service = (factory as (value: unknown) => { place(value: unknown): Promise<Record<string, unknown>> })({
      appDb: app.db,
      operatorDb: input.enabled === false || input.organizationEnabled === false || input.workloadEnabled === false
        ? { transaction: () => { throw new Error("flag_off_operator_contact"); } }
        : operator.db,
      deploymentMode: "local_trusted",
      deploymentEnabled: input.enabled !== false,
      resolveOrganizationPolicy: () => ({ enabled: input.organizationEnabled !== false, mode: input.mode ?? "active" }),
      resolveWorkloadPolicy: () => input.workloadEnabled !== false,
      resolveCredentialBinding: () => input.credentialBinding ?? ({
        credentialId: input.credentialId ?? "credential-a",
        credentialKind: "company_api_key",
        executionTargetSlug: null,
        pinnedTargetId: managed ? null : TARGET_A,
      }),
    });
    return service.place({
      organizationId: input.organizationId ?? ORG_A,
      companyId: input.companyId ?? COMPANY_A,
      jobId: input.jobId,
      attemptId: input.attemptId,
      now: new Date("2026-08-10T10:00:05.000Z"),
      maxHeartbeatAgeMs: 30_000,
    });
  }

  it("[I-03] consumes Decision #117 binding for two owner targets and fails mismatch/foreign/shared closed", async () => {
    const { admin } = guard();
    const personalBoundToB = {
      credentialId: "personal-owner-b",
      credentialKind: "personal_subscription" as const,
      executionTargetSlug: "owner-b",
      pinnedTargetId: null,
    };
    const selectedJob = "98000000-0000-4000-8000-000000000070";
    const selectedAttempt = "99000000-0000-4000-8000-000000000070";
    await seedJob({ jobId: selectedJob, attemptId: selectedAttempt });
    const selectedResult = await place({
      jobId: selectedJob,
      attemptId: selectedAttempt,
      credentialBinding: personalBoundToB,
    });
    expect(selectedResult, JSON.stringify(selectedResult)).toMatchObject({
      disposition: "selected",
      targetId: TARGET_OWNER_B,
      targetClass: "owner_desktop",
      leaseEligible: true,
    });

    const deniedCases = [
      {
        suffix: "071",
        requestedTarget: TARGET_OWNER_A,
        binding: personalBoundToB,
        reasonCode: "execution_target_resolution_failed",
      },
      {
        suffix: "072",
        requestedTarget: null,
        binding: { ...personalBoundToB, executionTargetSlug: "missing-owner" },
        reasonCode: "execution_target_resolution_failed",
      },
      {
        suffix: "073",
        requestedTarget: TARGET_B,
        binding: {
          credentialId: "company-a",
          credentialKind: "company_api_key" as const,
          executionTargetSlug: null,
          pinnedTargetId: null,
        },
        reasonCode: "execution_target_resolution_failed",
      },
      {
        suffix: "074",
        requestedTarget: TARGET_PLATFORM,
        binding: { ...personalBoundToB, executionTargetSlug: "platform-main" },
        reasonCode: "execution_target_resolution_failed",
      },
    ];
    for (const denied of deniedCases) {
      const jobId = `98000000-0000-4000-8000-000000000${denied.suffix}`;
      const attemptId = `99000000-0000-4000-8000-000000000${denied.suffix}`;
      await seedJob({ jobId, attemptId });
      if (denied.requestedTarget) {
        await admin`UPDATE jobs SET placement_request = jsonb_set(
          placement_request, '{requestedTarget}', ${JSON.stringify(denied.requestedTarget)}::jsonb
        ) WHERE id = ${jobId}`;
      }
      await expect(place({ jobId, attemptId, credentialBinding: denied.binding })).resolves.toMatchObject({
        disposition: "failed",
        targetId: null,
        reasonCode: denied.reasonCode,
        leaseEligible: false,
      });
    }
  });

  it("persists one immutable decision and creates no lease or capacity reservation", async () => {
    const { admin } = guard();
    const jobId = "98000000-0000-4000-8000-000000000001";
    const attemptId = "99000000-0000-4000-8000-000000000001";
    await seedJob({ jobId, attemptId });
    const beforeWorker = await admin`SELECT profile_snapshot, profile_hash FROM workers WHERE id = ${WORKER_A}`;
    const result = await place({ jobId, attemptId });
    expect(result).toMatchObject({ disposition: "selected", targetId: TARGET_A, leaseEligible: true });
    const [stored] = await admin<{ placement_disposition: string; placement_target_id: string; placement_decided_at: Date }[]>`
      SELECT placement_disposition, placement_target_id, placement_decided_at
      FROM job_attempts WHERE id = ${attemptId}`;
    expect(stored).toMatchObject({ placement_disposition: "selected", placement_target_id: TARGET_A });
    const [leaseCount] = await admin<{ count: number }[]>`SELECT count(*)::int AS count FROM leases WHERE attempt_id = ${attemptId}`;
    expect(leaseCount?.count).toBe(0);
    expect(await admin`SELECT profile_snapshot, profile_hash FROM workers WHERE id = ${WORKER_A}`).toEqual(beforeWorker);
  });

  it("converges concurrent identical writers and refuses a later different immutable digest", async () => {
    const { admin } = guard();
    const jobId = "98000000-0000-4000-8000-000000000002";
    const attemptId = "99000000-0000-4000-8000-000000000002";
    await seedJob({ jobId, attemptId });
    const results = await Promise.all([place({ jobId, attemptId }), place({ jobId, attemptId })]);
    expect(results[0]).toEqual(results[1]);
    await admin`UPDATE jobs SET input_hash = ${"e".repeat(64)} WHERE id = ${jobId}`;
    await expect(place({ jobId, attemptId })).rejects.toThrow("placement_already_decided");
    const [row] = await admin<{ digest: string }[]>`SELECT placement_input_digest AS digest FROM job_attempts WHERE id = ${attemptId}`;
    expect(row?.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("selects a platform worker only through the bounded operator snapshot", async () => {
    const jobId = "98000000-0000-4000-8000-000000000009";
    const attemptId = "99000000-0000-4000-8000-000000000009";
    await seedJob({ jobId, attemptId, targetClass: "managed_cloud" });
    await expect(place({ jobId, attemptId })).resolves.toMatchObject({
      disposition: "selected",
      targetId: TARGET_PLATFORM,
      targetClass: "managed_cloud",
      targetScope: "platform",
      targetGeneration: 4,
      leaseEligible: true,
    });
  });

  it("persists shadow and flag-off legacy outcomes as lease-ineligible", async () => {
    for (const [suffix, options, expected] of [
      ["3", { mode: "shadow" as const }, { disposition: "selected", mode: "shadow", leaseEligible: false }],
      ["4", { enabled: false }, { disposition: "legacy", owner: "legacy", leaseEligible: false }],
    ] as const) {
      const jobId = `98000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
      const attemptId = `99000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
      await seedJob({ jobId, attemptId });
      expect(await place({ jobId, attemptId, ...options })).toMatchObject(expected);
    }
  });

  it("queues current status changes and generation replacements without widening", async () => {
    const { admin } = guard();
    await admin`UPDATE execution_targets SET status = 'draining' WHERE id = ${TARGET_A}`;
    try {
      const jobId = "98000000-0000-4000-8000-000000000007";
      const attemptId = "99000000-0000-4000-8000-000000000007";
      await seedJob({ jobId, attemptId });
      await expect(place({ jobId, attemptId })).resolves.toMatchObject({
        disposition: "queued",
        reasonCode: "required_target_unavailable",
        leaseEligible: false,
      });
    } finally {
      await admin`UPDATE execution_targets SET status = 'active' WHERE id = ${TARGET_A}`;
    }

    await admin`UPDATE execution_targets SET device_generation = 2 WHERE id = ${TARGET_A}`;
    try {
      const jobId = "98000000-0000-4000-8000-000000000008";
      const attemptId = "99000000-0000-4000-8000-000000000008";
      await seedJob({ jobId, attemptId });
      await expect(place({ jobId, attemptId })).resolves.toMatchObject({
        disposition: "queued",
        reasonCode: "required_target_unavailable",
        leaseEligible: false,
      });
    } finally {
      await admin`UPDATE execution_targets SET device_generation = 1 WHERE id = ${TARGET_A}`;
    }
  });

  it("makes foreign and nonexistent jobs indistinguishable inside the tenant transaction", async () => {
    const foreignJob = "98000000-0000-4000-8000-000000000005";
    const foreignAttempt = "99000000-0000-4000-8000-000000000005";
    await seedJob({ jobId: foreignJob, attemptId: foreignAttempt, organizationId: ORG_B, companyId: COMPANY_B });
    const missingJob = "98000000-0000-4000-8000-000000000099";
    const missingAttempt = "99000000-0000-4000-8000-000000000099";
    const errors = await Promise.all([
      place({ jobId: foreignJob, attemptId: foreignAttempt }),
      place({ jobId: missingJob, attemptId: missingAttempt }),
    ].map((promise) => promise.then(() => "resolved", (error) => String(error))));
    expect(errors[0]).toContain("placement_not_found");
    expect(errors[1]).toContain("placement_not_found");
  });

  it("rolls back a forced decision write failure", async () => {
    const { admin } = guard();
    const jobId = "98000000-0000-4000-8000-000000000006";
    const attemptId = "99000000-0000-4000-8000-000000000006";
    await seedJob({ jobId, attemptId });
    await admin.unsafe(`CREATE OR REPLACE FUNCTION job009_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'job009 forced placement write failure'; END $$;
      CREATE TRIGGER job009_fail_write_trigger BEFORE UPDATE ON job_attempts
      FOR EACH ROW WHEN (NEW.placement_decided_at IS NOT NULL) EXECUTE FUNCTION job009_fail_write();`);
    await expect(place({ jobId, attemptId })).rejects.toThrow();
    await admin.unsafe(`DROP TRIGGER IF EXISTS job009_fail_write_trigger ON job_attempts; DROP FUNCTION IF EXISTS job009_fail_write()`);
    const [row] = await admin<{ decided: Date | null }[]>`SELECT placement_decided_at AS decided FROM job_attempts WHERE id = ${attemptId}`;
    expect(row?.decided).toBeNull();
  });

  it("[I-04] rejects replay when any canonical placement authority fact changes", async () => {
    const { admin } = guard();
    const mutations: Array<{
      name: string;
      mutate(jobId: string): Promise<unknown>;
      restore?(): Promise<unknown>;
      placeOptions?: {
        mode?: "active" | "shadow";
        enabled?: boolean;
        organizationEnabled?: boolean;
        workloadEnabled?: boolean;
        credentialId?: string | null;
        credentialBinding?: {
          credentialId: string | null;
          credentialKind: "company_api_key" | "personal_subscription" | null;
          executionTargetSlug: string | null;
          pinnedTargetId: string | null;
        };
      };
    }> = [
      {
        name: "submitted workload requirement",
        mutate: (jobId) => admin`UPDATE jobs SET requirements = jsonb_set(requirements, '{workloadType}', '"service"') WHERE id = ${jobId}`,
      },
      {
        name: "submitted capability requirement",
        mutate: (jobId) => admin`UPDATE jobs SET requirements = ${{
          workloadType: "batch",
          requiredCapabilities: ["sandbox.process_isolated"],
        }} WHERE id = ${jobId}`,
      },
      {
        name: "submitted placement policy id",
        mutate: (jobId) => admin`UPDATE jobs SET placement_request = ${{
          policyId: "job-submission-changed",
          policyVersion: 1,
          requestedTarget: null,
        }} WHERE id = ${jobId}`,
      },
      {
        name: "submitted placement policy version",
        mutate: (jobId) => admin`UPDATE jobs SET placement_request = ${{
          policyId: "job-submission-default",
          policyVersion: 2,
          requestedTarget: null,
        }} WHERE id = ${jobId}`,
      },
      {
        name: "submitted requested target",
        mutate: (jobId) => admin`UPDATE jobs SET placement_request = ${{
          policyId: "job-submission-default",
          policyVersion: 1,
          requestedTarget: TARGET_A,
        }} WHERE id = ${jobId}`,
      },
      {
        name: "submitted input hash",
        mutate: (jobId) => admin`UPDATE jobs SET input_hash = ${"c".repeat(64)} WHERE id = ${jobId}`,
      },
      {
        name: "submitted policy hash",
        mutate: (jobId) => admin`UPDATE jobs SET policy_hash = ${"d".repeat(64)} WHERE id = ${jobId}`,
      },
      {
        name: "provider demand",
        mutate: async () => {
          const original = providerProfile();
          const { digest: _oldDigest, ...unsigned } = original;
          const changedUnsigned = { ...unsigned, maxContinuousRuntimeSeconds: 500 };
          const changed = {
            ...changedUnsigned,
            digest: sha256(canonicalProviderConstraintProfileDigestInputV1(changedUnsigned)),
          } as ProviderConstraintProfileV1;
          const profile = organizationProfile(changed);
          await admin`UPDATE execution_targets SET provider_constraint_profile = ${changed},
            registered_profile = ${profile},
            registered_profile_hash = ${sha256(canonicalizeJsonV1(profile))}
            WHERE id = ${TARGET_A}`;
        },
        restore: async () => {
          const provider = providerProfile();
          const profile = organizationProfile(provider);
          await admin`UPDATE execution_targets SET provider_constraint_profile = ${provider},
            registered_profile = ${profile},
            registered_profile_hash = ${sha256(canonicalizeJsonV1(profile))}
            WHERE id = ${TARGET_A}`;
        },
      },
      {
        name: "credential identity",
        mutate: async () => undefined,
        placeOptions: { credentialId: "different-credential" },
      },
      {
        name: "credential kind",
        mutate: async () => undefined,
        placeOptions: {
          credentialBinding: {
            credentialId: "credential-a",
            credentialKind: null,
            executionTargetSlug: null,
            pinnedTargetId: TARGET_A,
          },
        },
      },
      {
        name: "credential bound slug",
        mutate: async () => undefined,
        placeOptions: {
          credentialBinding: {
            credentialId: "credential-a",
            credentialKind: "company_api_key",
            executionTargetSlug: "placement-a",
            pinnedTargetId: TARGET_A,
          },
        },
      },
      {
        name: "credential pinned target",
        mutate: async () => undefined,
        placeOptions: {
          credentialBinding: {
            credentialId: "credential-a",
            credentialKind: "company_api_key",
            executionTargetSlug: null,
            pinnedTargetId: null,
          },
        },
      },
      {
        name: "source kind",
        mutate: (jobId) => admin`UPDATE jobs SET source_kind = 'crew_run' WHERE id = ${jobId}`,
      },
      {
        name: "rollout mode",
        mutate: async () => undefined,
        placeOptions: { mode: "shadow" },
      },
      {
        name: "deployment rollout reason",
        mutate: async () => undefined,
        placeOptions: { enabled: false },
      },
      {
        name: "Organization rollout reason",
        mutate: async () => undefined,
        placeOptions: { organizationEnabled: false },
      },
      {
        name: "workload rollout reason",
        mutate: async () => undefined,
        placeOptions: { workloadEnabled: false },
      },
      {
        name: "target slug",
        mutate: async () => admin`UPDATE execution_targets SET slug = 'placement-a-changed' WHERE id = ${TARGET_A}`,
        restore: async () => admin`UPDATE execution_targets SET slug = 'placement-a' WHERE id = ${TARGET_A}`,
      },
      {
        name: "target generation",
        mutate: async () => admin`UPDATE execution_targets SET device_generation = 2 WHERE id = ${TARGET_A}`,
        restore: async () => admin`UPDATE execution_targets SET device_generation = 1 WHERE id = ${TARGET_A}`,
      },
      {
        name: "selected profile hash",
        mutate: async () => admin`UPDATE execution_targets SET registered_profile_hash = ${"f".repeat(64)} WHERE id = ${TARGET_A}`,
        restore: async () => {
          const profile = organizationProfile(providerProfile());
          await admin`UPDATE execution_targets SET registered_profile_hash = ${sha256(canonicalizeJsonV1(profile))} WHERE id = ${TARGET_A}`;
        },
      },
    ];

    for (const [index, mutation] of mutations.entries()) {
      const suffix = (100 + index).toString().padStart(12, "0");
      const jobId = `98000000-0000-4000-8000-${suffix}`;
      const attemptId = `99000000-0000-4000-8000-${suffix}`;
      await seedJob({ jobId, attemptId });
      await place({ jobId, attemptId });
      try {
        await mutation.mutate(jobId);
        await expect(place({
          jobId,
          attemptId,
          ...mutation.placeOptions,
        }), mutation.name).rejects.toThrow("placement_already_decided");
      } finally {
        await mutation.restore?.();
      }
    }
  });

  it("[I-05] cannot enable or shadow placement through caller-supplied rollout", async () => {
    const { app } = guard();
    const jobId = "98000000-0000-4000-8000-000000000040";
    const attemptId = "99000000-0000-4000-8000-000000000040";
    await seedJob({ jobId, attemptId });
    const fn = (placementNamespace as Record<string, unknown>).placeJobAttempt;
    expect(typeof fn).toBe("function");
    const prior = process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED;
    process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED = "false";
    try {
      const result = await (fn as (value: unknown) => Promise<Record<string, unknown>>)(
        {
          appDb: app.db,
          operatorDb: { transaction: () => { throw new Error("flag_off_operator_contact"); } },
          organizationId: ORG_A,
          companyId: COMPANY_A,
          jobId,
          attemptId,
          rollout: { enabled: true, mode: "shadow", reason: "CALLER_CONTROLLED_PRIVATE_VALUE" },
          now: new Date("2026-08-10T10:00:05.000Z"),
          maxHeartbeatAgeMs: 30_000,
        } as never,
      );
      expect(result).toMatchObject({
        disposition: "legacy",
        mode: "legacy",
        reasonCode: "deployment_disabled",
        leaseEligible: false,
      });
      expect(JSON.stringify(result)).not.toContain("CALLER_CONTROLLED_PRIVATE_VALUE");
    } finally {
      if (prior === undefined) delete process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED;
      else process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED = prior;
    }
  });

  it("[I-05] keeps deployment, Organization, and workload rollout gates tenant-local and effect-free", async () => {
    const cases = [
      { suffix: "041", options: { enabled: false }, reasonCode: "deployment_disabled" },
      { suffix: "042", options: { organizationEnabled: false }, reasonCode: "organization_disabled" },
      { suffix: "043", options: { workloadEnabled: false }, reasonCode: "workload_disabled" },
    ] as const;
    for (const current of cases) {
      const jobId = `98000000-0000-4000-8000-000000000${current.suffix}`;
      const attemptId = `99000000-0000-4000-8000-000000000${current.suffix}`;
      await seedJob({ jobId, attemptId });
      await expect(place({ jobId, attemptId, ...current.options })).resolves.toMatchObject({
        disposition: "legacy",
        owner: "legacy",
        mode: "legacy",
        reasonCode: current.reasonCode,
        leaseEligible: false,
      });
    }
  });

  it("[I-06] enforces lease eligibility iff the decision is selected and active", async () => {
    const { admin } = guard();
    const cases = [
      { disposition: "selected", mode: "shadow", eligible: true },
      { disposition: "selected", mode: "legacy", eligible: true },
      { disposition: "selected", mode: "active", eligible: false },
      { disposition: "legacy", mode: "legacy", eligible: true },
      { disposition: "queued", mode: "active", eligible: true },
      { disposition: "failed", mode: "active", eligible: true },
    ] as const;
    for (const [index, invalid] of cases.entries()) {
      const suffix = (50 + index).toString().padStart(12, "0");
      const jobId = `98000000-0000-4000-8000-${suffix}`;
      const attemptId = `99000000-0000-4000-8000-${suffix}`;
      await seedJob({ jobId, attemptId });
      const selected = invalid.disposition === "selected";
      await expect(admin`UPDATE job_attempts SET
        placement_disposition = ${invalid.disposition},
        placement_owner = ${selected ? "organization_dedicated" : invalid.disposition === "legacy" ? "legacy" : null},
        placement_target_id = ${selected ? TARGET_A : null},
        placement_target_class = ${selected ? "organization_dedicated" : null},
        placement_target_scope = ${selected ? "organization" : null},
        placement_target_generation = ${selected ? 1 : null},
        placement_profile_hash = ${selected ? "a".repeat(64) : null},
        placement_provider_constraint_hash = ${selected ? "b".repeat(64) : null},
        placement_fallback_disposition = 'not_applicable',
        placement_reason_code = 'constraint_probe',
        placement_mode = ${invalid.mode},
        placement_lease_eligible = ${invalid.eligible},
        placement_input_digest = ${"c".repeat(64)},
        placement_policy_digest = ${"d".repeat(64)},
        placement_decided_at = now()
        WHERE id = ${attemptId}`,
      `${invalid.disposition}/${invalid.mode}/${invalid.eligible}`).rejects.toThrow();
    }
  });
});
