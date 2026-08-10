import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres, { type Sql } from "postgres";
import {
  applyPendingMigrations,
  createTenantAppDbConnection,
  type NonOwnerDbConnection,
} from "@armyofagents/db";
import {
  canonicalProviderConstraintProfileDigestInputV1,
  canonicalizeJsonV1,
  type PollRequestV1,
  type ProviderConstraintProfileV1,
  type RegisteredTargetProfileV1,
} from "@armyofagents/worker-protocol";
import { provisionTenantAppRoleLoginSql } from "../db/rls-tenant.js";
import {
  createJobLeasingService,
  JobLeasingError,
  type VerifiedWorkerOperation,
} from "../services/job-leasing.js";
import { createJobReadyScheduler } from "../services/job-ready-scheduler.js";
import { createJobOutboxWorker } from "../services/job-outbox-worker.js";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};
type EmbeddedPostgresCtor = new (opts: Record<string, unknown>) => EmbeddedPostgresInstance;

const ORG = "a3000000-0000-4000-8000-000000000001";
const COMPANY = "a3000000-0000-4000-8000-000000000002";
const TARGET = "a3000000-0000-4000-8000-000000000003";
const OTHER_TARGET = "a3000000-0000-4000-8000-000000000004";
const WORKER = "a3000000-0000-4000-8000-000000000005";
const OTHER_WORKER = "a3000000-0000-4000-8000-000000000006";
const PASSWORD = "job-003-role-password";
const POLICY_HASH = "3".repeat(64);
const THUMBPRINT = "4".repeat(64);

const integration = describe.skipIf(
  process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1",
);

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function providerProfile(maxConcurrentOperations = 2): ProviderConstraintProfileV1 {
  const unsigned = {
    profileId: "job-003-provider",
    version: 1,
    maxContinuousRuntimeSeconds: 3_600,
    maxIdleSeconds: 300,
    resourceCeiling: { cpuMillis: 2_000, memoryMiB: 4_096, pids: 512, diskMiB: 8_192 },
    maxConcurrentOperations,
    supportedOperations: [
      "create", "execute", "cancel", "kill", "destroy", "list", "inspect", "reconcile_cleanup",
    ],
    localityTags: ["organization_target_only"],
    checkpointMode: "none",
    healthMode: "none",
  } as const;
  return {
    ...unsigned,
    digest: sha256(canonicalProviderConstraintProfileDigestInputV1(unsigned)),
  };
}

function registeredProfile(
  provider: ProviderConstraintProfileV1,
  targetId = TARGET,
): RegisteredTargetProfileV1 {
  return {
    protocolVersion: 1,
    targetId,
    targetClass: "organization_dedicated",
    scope: "organization",
    organizationId: ORG,
    ownerPrincipalId: null,
    trustCeiling: "organization_isolated",
    credentialCeiling: "organization_brokered",
    dataLocalityCeiling: "organization_target_only",
    providerConstraints: {
      profileId: provider.profileId,
      version: provider.version,
      digest: provider.digest,
    },
    capabilityCeiling: ["workload.batch", "sandbox.process_isolated"],
    deviceGeneration: 1,
    revokedAt: null,
    policyHash: POLICY_HASH,
  };
}

function workerHello(workerId = WORKER, targetId = TARGET, batchSlots = 2) {
  return {
    protocolVersion: 1 as const,
    workerId,
    targetId,
    deviceGeneration: 1,
    agentVersion: "job-003-integration",
    supportedProtocol: { min: 1, max: 1 },
    platform: { os: "linux" as const, arch: "x64" as const, runtime: "worker" },
    reportedCapabilities: ["workload.batch" as const, "sandbox.process_isolated" as const],
    capacity: {
      batchSlots,
      browserSessionSlots: 0,
      serviceSlots: 0,
      freeCpuMillis: 2_000,
      freeMemoryMiB: 4_096,
      freeDiskMiB: 8_192,
    },
    policyHash: POLICY_HASH,
  };
}

function pollRequest(workerId: string, targetId: string, nonce: string, batchSlots = 2): PollRequestV1 {
  return {
    protocolVersion: 1,
    correlationId: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
    nonce,
    audience: "worker_poll",
    workerId,
    targetId,
    deviceGeneration: 1,
    capacity: {
      batchSlots,
      browserSessionSlots: 0,
      serviceSlots: 0,
      freeCpuMillis: 2_000,
      freeMemoryMiB: 4_096,
      freeDiskMiB: 8_192,
    },
  };
}

integration("JOB-003 atomic poll/offer and ready hints", () => {
  let embedded: EmbeddedPostgresInstance | null = null;
  let dataDir = "";
  let adminUrl = "";
  let admin: Sql | null = null;
  let app: NonOwnerDbConnection | null = null;
  let setupError: unknown = null;

  function guard() {
    if (setupError) throw new Error(`embedded-postgres setup failed: ${String(setupError)}`);
    if (!admin || !app) throw new Error("test setup incomplete");
    return { admin, app };
  }

  function auth(
    proofId: string,
    workerId = WORKER,
    targetId = TARGET,
    profileHash = sha256(JSON.stringify(workerHello(workerId, targetId))),
  ): VerifiedWorkerOperation {
    return {
      organizationId: ORG,
      workerId,
      targetId,
      targetGeneration: 1,
      deviceThumbprint: THUMBPRINT,
      profileHash,
      publicKey: "job-003-public-key",
      proofId,
      proofIssuedAt: new Date(),
      sessionExpiresAt: new Date(Date.now() + 10 * 60_000),
    };
  }

  async function resetRuntimeRows(): Promise<void> {
    const { admin } = guard();
    await admin`DELETE FROM worker_operation_receipts`;
    await admin`DELETE FROM leases`;
    await admin`DELETE FROM job_outbox`;
    await admin`DELETE FROM job_attempts`;
    await admin`DELETE FROM jobs`;
    await admin`DELETE FROM worker_proof_replays`;
    const provider = providerProfile();
    const profile = registeredProfile(provider);
    const otherProfile = registeredProfile(provider, OTHER_TARGET);
    await admin`UPDATE execution_targets SET status = 'active', device_generation = 1,
      registered_profile = ${profile}, registered_profile_hash = ${sha256(canonicalizeJsonV1(profile))},
      provider_constraint_profile = ${provider}, last_seen_at = clock_timestamp()
      WHERE id = ${TARGET}`;
    await admin`UPDATE execution_targets SET status = 'active', device_generation = 1,
      registered_profile = ${otherProfile}, registered_profile_hash = ${sha256(canonicalizeJsonV1(otherProfile))},
      provider_constraint_profile = ${provider}, last_seen_at = clock_timestamp()
      WHERE id = ${OTHER_TARGET}`;
    const hello = workerHello();
    const otherHello = workerHello(OTHER_WORKER, OTHER_TARGET);
    await admin`UPDATE workers SET status = 'enrolled', revoked_at = NULL, device_generation = 1,
      profile_hash = ${sha256(JSON.stringify(hello))}, profile_snapshot = ${hello},
      device_public_key = 'job-003-public-key', device_thumbprint = ${THUMBPRINT},
      last_seen_at = clock_timestamp() WHERE id = ${WORKER}`;
    await admin`UPDATE workers SET status = 'enrolled', revoked_at = NULL, device_generation = 1,
      profile_hash = ${sha256(JSON.stringify(otherHello))}, profile_snapshot = ${otherHello},
      device_public_key = 'job-003-public-key', device_thumbprint = ${THUMBPRINT},
      last_seen_at = clock_timestamp() WHERE id = ${OTHER_WORKER}`;
  }

  async function seedPlacedJob(input: {
    ordinal: number;
    availableAt?: Date;
    placement?: Partial<{
      disposition: string;
      mode: string;
      leaseEligible: boolean;
      targetId: string;
      generation: number;
      profileHash: string;
      providerHash: string;
    }>;
    outbox?: boolean;
  }): Promise<{ jobId: string; attemptId: string; outboxId: string }> {
    const { admin } = guard();
    const suffix = input.ordinal.toString().padStart(12, "0");
    const jobId = `a3100000-0000-4000-8000-${suffix}`;
    const attemptId = `a3200000-0000-4000-8000-${suffix}`;
    const outboxId = `a3300000-0000-4000-8000-${suffix}`;
    const provider = providerProfile();
    const profile = registeredProfile(provider);
    const placement = {
      disposition: "selected",
      mode: "active",
      leaseEligible: true,
      targetId: TARGET,
      generation: 1,
      profileHash: sha256(canonicalizeJsonV1(profile)),
      providerHash: provider.digest,
      ...input.placement,
    };
    const availableAt = input.availableAt ?? new Date(Date.now() - 60_000 + input.ordinal);
    await admin`INSERT INTO jobs
      (id, organization_id, company_id, workload_type, source_kind, source_identity, source_intent,
       requester_principal_kind, requester_principal_id, executor_principal_kind, executor_principal_id,
       input, input_hash, policy_snapshot, policy_hash, requirements, placement_request,
       available_at, priority, status, created_at, updated_at)
      VALUES (${jobId}, ${ORG}, ${COMPANY}, 'batch', 'one_shot', ${jobId},
        ${{ kind: "one_shot", operationId: jobId, operationKind: "extraction" }},
        'system', 'job-003-test', 'worker', ${WORKER},
        ${{ command: "codex", args: ["exec", "--json"], stdinArtifactId: null, maxRuntimeSeconds: 600 }},
        ${"5".repeat(64)}, ${{ policyId: "job-submission-default", version: 1 }}, ${POLICY_HASH},
        ${{ workloadType: "batch", requiredCapabilities: ["sandbox.process_isolated"] }},
        ${{ policyId: "job-submission-default", policyVersion: 1, requestedTarget: TARGET }},
        ${availableAt}, 50, 'queued', ${availableAt}, ${availableAt})`;
    await admin`INSERT INTO job_attempts
      (id, organization_id, company_id, job_id, attempt_number, status,
       placement_disposition, placement_owner, placement_target_id, placement_target_class,
       placement_target_scope, placement_target_generation, placement_profile_hash,
       placement_provider_constraint_hash, placement_fallback_disposition, placement_reason_code,
       placement_mode, placement_lease_eligible, placement_input_digest, placement_policy_digest,
       placement_decided_at, created_at, updated_at)
      VALUES (${attemptId}, ${ORG}, ${COMPANY}, ${jobId}, 1, 'pending',
        ${placement.disposition}, 'organization_dedicated', ${placement.targetId},
        'organization_dedicated', 'organization', ${placement.generation}, ${placement.profileHash},
        ${placement.providerHash}, 'primary', 'target_selected', ${placement.mode},
        ${placement.leaseEligible}, ${"6".repeat(64)}, ${"6".repeat(64)}, clock_timestamp(),
        ${availableAt}, ${availableAt})`;
    if (input.outbox !== false) {
      await admin`INSERT INTO job_outbox
        (id, organization_id, company_id, job_id, attempt_id, kind, status, payload, available_at)
        VALUES (${outboxId}, ${ORG}, ${COMPANY}, ${jobId}, ${attemptId}, 'attempt_ready', 'pending',
          ${{ organizationId: ORG, companyId: COMPANY, jobId, attemptId, sourceKind: "one_shot" }},
          clock_timestamp())`;
    }
    return { jobId, attemptId, outboxId };
  }

  beforeAll(async () => {
    try {
      dataDir = await mkdtemp(join(tmpdir(), "aoa-job-leasing-"));
      const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as {
        default: EmbeddedPostgresCtor;
      };
      const port = await allocateEmbeddedPgPort();
      embedded = new EmbeddedPostgres({
        databaseDir: join(dataDir, "db"),
        user: "test",
        password: "test",
        port,
        persistent: false,
        initdbFlags: ["--encoding=UTF8", "--locale=C"],
      });
      await embedded.initialise();
      await embedded.start();
      adminUrl = `postgres://test:test@127.0.0.1:${port}/postgres`;
      await applyPendingMigrations(adminUrl);
      admin = postgres(adminUrl, { max: 4 });
      await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_app", PASSWORD));
      app = createTenantAppDbConnection(adminUrl.replace("test:test", `aoa_app:${PASSWORD}`), { max: 24 });
      await admin`INSERT INTO organizations (id, name, slug) VALUES (${ORG}, 'JOB-003 org', 'job-003-org')`;
      await admin`INSERT INTO companies (id, organization_id, name, issue_prefix)
        VALUES (${COMPANY}, ${ORG}, 'JOB-003 company', 'J003')`;
      const provider = providerProfile();
      const profile = registeredProfile(provider);
      const otherProfile = registeredProfile(provider, OTHER_TARGET);
      await admin`INSERT INTO execution_targets
        (id, organization_id, slug, kind, trust_class, status, capabilities, config, scope,
         target_authority_key, device_generation, registered_profile, registered_profile_hash,
         provider_constraint_profile, last_seen_at)
        VALUES
        (${TARGET}, ${ORG}, 'job-003-target', 'dedicated_worker', 'dedicated_tenant', 'active', '{}', '{}',
          'organization', ${`organization:${ORG}`}, 1, ${profile}, ${sha256(canonicalizeJsonV1(profile))},
          ${provider}, clock_timestamp()),
        (${OTHER_TARGET}, ${ORG}, 'job-003-other-target', 'dedicated_worker', 'dedicated_tenant', 'active', '{}', '{}',
          'organization', ${`organization:${ORG}`}, 1, ${otherProfile}, ${sha256(canonicalizeJsonV1(otherProfile))},
          ${provider}, clock_timestamp())`;
      const hello = workerHello();
      const otherHello = workerHello(OTHER_WORKER, OTHER_TARGET);
      await admin`INSERT INTO workers
        (id, scope, organization_id, execution_target_id, target_authority_key, device_public_key,
         device_thumbprint, device_generation, profile_hash, profile_snapshot, enrolled_at,
         last_seen_at, label, status)
        VALUES
        (${WORKER}, 'organization', ${ORG}, ${TARGET}, ${`organization:${ORG}`}, 'job-003-public-key',
          ${THUMBPRINT}, 1, ${sha256(JSON.stringify(hello))}, ${hello}, clock_timestamp(),
          clock_timestamp(), 'JOB-003 worker', 'enrolled'),
        (${OTHER_WORKER}, 'organization', ${ORG}, ${OTHER_TARGET}, ${`organization:${ORG}`}, 'job-003-public-key',
          ${THUMBPRINT}, 1, ${sha256(JSON.stringify(otherHello))}, ${otherHello}, clock_timestamp(),
          clock_timestamp(), 'JOB-003 other worker', 'enrolled')`;
    } catch (error) {
      setupError = error;
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    await admin?.end().catch(() => {});
    await embedded?.stop().catch(() => {});
    if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }, 60_000);

  it("gives exactly one of 100 concurrent claimers one opaque offer and reveals nothing to losers", async () => {
    const { admin, app } = guard();
    await resetRuntimeRows();
    const seeded = await seedPlacedJob({ ordinal: 1 });
    const service = createJobLeasingService({ appDb: app.db });
    const results = await Promise.all(Array.from({ length: 100 }, (_, index) => service.poll({
      auth: auth(`poll-race-${index}`),
      request: pollRequest(WORKER, TARGET, `poll-race-${index}`),
    })));
    const offers = results.filter((result) => result.outcome === "offer");
    const noWork = results.filter((result) => result.outcome === "no_work");
    expect(offers).toHaveLength(1);
    expect(noWork).toHaveLength(99);
    expect(Object.keys(noWork[0] ?? {}).sort()).toEqual([
      "correlationId", "outcome", "protocolVersion", "retryAfterMs", "serverTime",
    ]);
    if (offers[0]?.outcome !== "offer") throw new Error("offer missing");
    expect(offers[0].body.job.jobId).toBe(seeded.jobId);
    expect(offers[0].body.fenceToken).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    const [counts] = await admin<{ leases: number; offered: number; queued: number }[]>`
      SELECT
        (SELECT count(*)::int FROM leases WHERE attempt_id = ${seeded.attemptId}) AS leases,
        (SELECT count(*)::int FROM job_attempts WHERE id = ${seeded.attemptId} AND status = 'offered') AS offered,
        (SELECT count(*)::int FROM jobs WHERE id = ${seeded.jobId} AND status = 'queued') AS queued`;
    expect(counts).toEqual({ leases: 1, offered: 1, queued: 1 });
  }, 60_000);

  it("chooses the oldest compatible attempt and clamps a widening report to registered slots", async () => {
    const { app } = guard();
    await resetRuntimeRows();
    const oldest = await seedPlacedJob({ ordinal: 10, availableAt: new Date(Date.now() - 30_000) });
    const middle = await seedPlacedJob({ ordinal: 11, availableAt: new Date(Date.now() - 20_000) });
    await seedPlacedJob({ ordinal: 12, availableAt: new Date(Date.now() - 10_000) });
    const service = createJobLeasingService({ appDb: app.db });

    const incompatible = await service.poll({
      auth: auth("poll-incompatible", OTHER_WORKER, OTHER_TARGET),
      request: pollRequest(OTHER_WORKER, OTHER_TARGET, "poll-incompatible", 99),
    });
    expect(incompatible.outcome).toBe("no_work");

    const first = await service.poll({
      auth: auth("poll-oldest-1"),
      request: pollRequest(WORKER, TARGET, "poll-oldest-1", 99),
    });
    const second = await service.poll({
      auth: auth("poll-oldest-2"),
      request: pollRequest(WORKER, TARGET, "poll-oldest-2", 99),
    });
    const third = await service.poll({
      auth: auth("poll-oldest-3"),
      request: pollRequest(WORKER, TARGET, "poll-oldest-3", 99),
    });
    expect(first.outcome === "offer" ? first.body.job.jobId : null).toBe(oldest.jobId);
    expect(second.outcome === "offer" ? second.body.job.jobId : null).toBe(middle.jobId);
    expect(third.outcome).toBe("no_work");
  });

  it("fails closed for stale placement, target, worker, generation, and profile/provider authority", async () => {
    const { admin, app } = guard();
    const mutations: Array<{ name: string; mutate(jobId: string, attemptId: string): Promise<unknown> }> = [
      { name: "shadow", mutate: async (_jobId, attemptId) => admin`UPDATE job_attempts SET
          placement_mode = 'shadow', placement_lease_eligible = false WHERE id = ${attemptId}` },
      { name: "target offline", mutate: async () => admin`UPDATE execution_targets SET status = 'offline' WHERE id = ${TARGET}` },
      { name: "worker draining", mutate: async () => admin`UPDATE workers SET status = 'draining' WHERE id = ${WORKER}` },
      { name: "generation", mutate: async () => admin`UPDATE execution_targets SET device_generation = 2 WHERE id = ${TARGET}` },
      { name: "placement target profile", mutate: async (_jobId, attemptId) => admin`UPDATE job_attempts SET
          placement_profile_hash = ${"7".repeat(64)} WHERE id = ${attemptId}` },
      { name: "placement provider profile", mutate: async (_jobId, attemptId) => admin`UPDATE job_attempts SET
          placement_provider_constraint_hash = ${"8".repeat(64)} WHERE id = ${attemptId}` },
    ];
    for (const [index, mutation] of mutations.entries()) {
      await resetRuntimeRows();
      const seeded = await seedPlacedJob({ ordinal: 100 + index });
      await mutation.mutate(seeded.jobId, seeded.attemptId);
      const service = createJobLeasingService({ appDb: app.db });
      try {
        const result = await service.poll({
          auth: auth(`poll-stale-${index}`),
          request: pollRequest(WORKER, TARGET, `poll-stale-${index}`),
        });
        expect(result.outcome, mutation.name).not.toBe("offer");
      } catch (error) {
        expect(error, mutation.name).toBeInstanceOf(JobLeasingError);
        expect((error as JobLeasingError).code, mutation.name).toMatch(/^(unauthorized|target_revoked)$/);
      }
      const [count] = await admin<{ count: number }[]>`SELECT count(*)::int AS count FROM leases`;
      expect(count?.count, mutation.name).toBe(0);
    }
  });

  it("keeps ready hints identifier-only, bounded, duplicate-safe, and recovers a crashed claim", async () => {
    const { admin, app } = guard();
    await resetRuntimeRows();
    const seeded = await seedPlacedJob({ ordinal: 200 });
    const scheduler = createJobReadyScheduler({ maxOrganizationShards: 32, maxHintsPerShard: 64 });
    let crashOnce = true;
    const worker = createJobOutboxWorker({
      appDb: app.db,
      scheduler,
      listAdmittedOrganizationIds: async () => [ORG, ORG],
      visibilityTimeoutMs: 1,
      publishHint: async (hint) => {
        expect(Object.keys(hint).sort()).toEqual(["attemptId", "organizationId"]);
        if (crashOnce) {
          crashOnce = false;
          throw new Error("simulated_after_commit_crash");
        }
        scheduler.hint(hint);
      },
    });
    await expect(worker.tick()).rejects.toThrow("simulated_after_commit_crash");
    const [claimed] = await admin<{ status: string }[]>`SELECT status FROM job_outbox WHERE id = ${seeded.outboxId}`;
    expect(claimed?.status).toBe("claimed");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await expect(worker.tick()).resolves.toMatchObject({ claimed: 1, delivered: 1 });
    scheduler.hint({ organizationId: ORG, attemptId: seeded.attemptId });
    expect(scheduler.take(ORG, 10)).toEqual([seeded.attemptId]);
    const [delivered] = await admin<{ status: string }[]>`SELECT status FROM job_outbox WHERE id = ${seeded.outboxId}`;
    expect(delivered?.status).toBe("delivered");
  });
});
