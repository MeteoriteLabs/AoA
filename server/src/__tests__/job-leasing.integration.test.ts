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
  type LeaseAckOperationRequestV1,
  type LeaseOfferV1,
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

function pollRequestWithCapacity(
  workerId: string,
  targetId: string,
  nonce: string,
  capacity: PollRequestV1["capacity"],
): PollRequestV1 {
  return { ...pollRequest(workerId, targetId, nonce), capacity };
}

function ackRequest(
  offer: LeaseOfferV1,
  idempotencyKey = crypto.randomUUID(),
  body: Partial<LeaseAckOperationRequestV1["body"]> = {},
): LeaseAckOperationRequestV1 {
  return {
    protocolVersion: 1,
    correlationId: crypto.randomUUID(),
    issuedAt: new Date().toISOString(),
    nonce: `ack-${crypto.randomUUID()}`,
    audience: "worker_run",
    idempotencyKey,
    body: {
      protocolVersion: 1,
      workerId: offer.workerId,
      jobId: offer.job.jobId,
      attempt: offer.job.attempt,
      leaseId: offer.leaseId,
      fenceToken: offer.fenceToken,
      ackedAt: new Date().toISOString(),
      extensions: [],
      ...body,
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

  async function configureMixedWorkloadAuthority(): Promise<{
    workerProfileHash: string;
    targetProfileHash: string;
    providerHash: string;
  }> {
    const { admin } = guard();
    const provider = providerProfile(2);
    const profile = {
      ...registeredProfile(provider),
      capabilityCeiling: [
        "workload.batch",
        "workload.browser_session",
        "sandbox.process_isolated",
      ],
    };
    const hello = {
      ...workerHello(WORKER, TARGET, 1),
      reportedCapabilities: [
        "workload.batch",
        "workload.browser_session",
        "sandbox.process_isolated",
      ],
      capacity: {
        batchSlots: 1,
        browserSessionSlots: 1,
        serviceSlots: 0,
        freeCpuMillis: 2_000,
        freeMemoryMiB: 4_096,
        freeDiskMiB: 8_192,
      },
    };
    const workerProfileHash = sha256(JSON.stringify(hello));
    const targetProfileHash = sha256(canonicalizeJsonV1(profile));
    await admin`UPDATE execution_targets SET
      registered_profile = ${profile},
      registered_profile_hash = ${targetProfileHash},
      provider_constraint_profile = ${provider},
      status = 'active', device_generation = 1, last_seen_at = clock_timestamp()
      WHERE id = ${TARGET}`;
    await admin`UPDATE workers SET
      profile_hash = ${workerProfileHash}, profile_snapshot = ${hello}, status = 'enrolled',
      revoked_at = NULL, device_generation = 1, last_seen_at = clock_timestamp()
      WHERE id = ${WORKER}`;
    return { workerProfileHash, targetProfileHash, providerHash: provider.digest };
  }

  async function seedPlacedJob(input: {
    ordinal: number;
    availableAt?: Date;
    workloadType?: "batch" | "browser_session";
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
    const workloadType = input.workloadType ?? "batch";
    const workload = workloadType === "browser_session"
      ? {
          engine: "chromium",
          viewport: { width: 1280, height: 720 },
          locale: "en-US",
          timezone: "UTC",
          recordTrace: false,
          recordVideo: false,
          maxSessionSeconds: 600,
        }
      : { command: "codex", args: ["exec", "--json"], stdinArtifactId: null, maxRuntimeSeconds: 600 };
    const requiredCapabilities = workloadType === "browser_session"
      ? ["workload.browser_session"]
      : ["sandbox.process_isolated"];
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
       VALUES (${jobId}, ${ORG}, ${COMPANY}, ${workloadType}, 'one_shot', ${jobId},
         ${{ kind: "one_shot", operationId: jobId, operationKind: "extraction" }},
         'system', 'job-003-test', 'worker', ${WORKER},
         ${workload},
         ${"5".repeat(64)}, ${{ policyId: "job-submission-default", version: 1 }}, ${POLICY_HASH},
         ${{ workloadType, requiredCapabilities }},
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

  async function offerPlacedJob(input: {
    ordinal: number;
    service?: ReturnType<typeof createJobLeasingService>;
  }): Promise<{
    seeded: Awaited<ReturnType<typeof seedPlacedJob>>;
    offer: LeaseOfferV1;
    service: ReturnType<typeof createJobLeasingService>;
  }> {
    const { app } = guard();
    const seeded = await seedPlacedJob({ ordinal: input.ordinal });
    const service = input.service ?? createJobLeasingService({ appDb: app.db });
    const result = await service.poll({
      auth: auth(`offer-${input.ordinal}`),
      request: pollRequest(WORKER, TARGET, `offer-${input.ordinal}`),
    });
    if (result.outcome !== "offer") throw new Error("expected lease offer");
    return { seeded, offer: result.body, service };
  }

  async function expectOfferUnchanged(attemptId: string): Promise<void> {
    const { admin } = guard();
    const [state] = await admin<{
      leaseStatus: string;
      attemptStatus: string;
      receipts: number;
    }[]>`SELECT
      (SELECT status FROM leases WHERE attempt_id = ${attemptId}) AS "leaseStatus",
      (SELECT status FROM job_attempts WHERE id = ${attemptId}) AS "attemptStatus",
      (SELECT count(*)::int FROM worker_operation_receipts WHERE attempt_id = ${attemptId}) AS receipts`;
    expect(state).toEqual({ leaseStatus: "offered", attemptStatus: "offered", receipts: 0 });
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

  it("accounts live offers by workload class so a batch lease does not consume a browser slot", async () => {
    const { app } = guard();
    await resetRuntimeRows();
    const authority = await configureMixedWorkloadAuthority();
    const placement = { profileHash: authority.targetProfileHash, providerHash: authority.providerHash };
    await seedPlacedJob({ ordinal: 20, workloadType: "batch", placement });
    const browser = await seedPlacedJob({ ordinal: 21, workloadType: "browser_session", placement });
    const service = createJobLeasingService({ appDb: app.db });
    const mixedCapacity = {
      batchSlots: 1,
      browserSessionSlots: 1,
      serviceSlots: 0,
      freeCpuMillis: 2_000,
      freeMemoryMiB: 4_096,
      freeDiskMiB: 8_192,
    };

    const batchOffer = await service.poll({
      auth: auth("mixed-batch", WORKER, TARGET, authority.workerProfileHash),
      request: pollRequestWithCapacity(WORKER, TARGET, "mixed-batch", mixedCapacity),
    });
    expect(batchOffer.outcome).toBe("offer");
    const browserOffer = await service.poll({
      auth: auth("mixed-browser", WORKER, TARGET, authority.workerProfileHash),
      request: pollRequestWithCapacity(WORKER, TARGET, "mixed-browser", mixedCapacity),
    });
    expect(browserOffer.outcome).toBe("offer");
    if (browserOffer.outcome !== "offer") return;
    expect(browserOffer.body.job.jobId).toBe(browser.jobId);
    expect(browserOffer.body.job.workloadType).toBe("browser_session");
  });

  it("continues past zero-slot and full head candidates to later eligible work", async () => {
    const { app } = guard();
    await resetRuntimeRows();
    const authority = await configureMixedWorkloadAuthority();
    const placement = { profileHash: authority.targetProfileHash, providerHash: authority.providerHash };
    await seedPlacedJob({ ordinal: 30, workloadType: "batch", placement });
    await seedPlacedJob({ ordinal: 31, workloadType: "batch", placement });
    const browser = await seedPlacedJob({ ordinal: 32, workloadType: "browser_session", placement });
    const service = createJobLeasingService({ appDb: app.db });
    const browserOnly = {
      batchSlots: 0,
      browserSessionSlots: 1,
      serviceSlots: 0,
      freeCpuMillis: 2_000,
      freeMemoryMiB: 4_096,
      freeDiskMiB: 8_192,
    };
    const result = await service.poll({
      auth: auth("browser-no-hol", WORKER, TARGET, authority.workerProfileHash),
      request: pollRequestWithCapacity(WORKER, TARGET, "browser-no-hol", browserOnly),
    });
    expect(result.outcome).toBe("offer");
    if (result.outcome !== "offer") return;
    expect(result.body.job.jobId).toBe(browser.jobId);
  });

  it("allows concurrent claims in independent workload classes under the explicit provider total", async () => {
    const { app } = guard();
    await resetRuntimeRows();
    const authority = await configureMixedWorkloadAuthority();
    const placement = { profileHash: authority.targetProfileHash, providerHash: authority.providerHash };
    await seedPlacedJob({ ordinal: 40, workloadType: "batch", placement });
    await seedPlacedJob({ ordinal: 41, workloadType: "browser_session", placement });
    const service = createJobLeasingService({ appDb: app.db });
    const baseCapacity = {
      serviceSlots: 0,
      freeCpuMillis: 2_000,
      freeMemoryMiB: 4_096,
      freeDiskMiB: 8_192,
    };
    const [batch, browser] = await Promise.all([
      service.poll({
        auth: auth("concurrent-batch-class", WORKER, TARGET, authority.workerProfileHash),
        request: pollRequestWithCapacity(WORKER, TARGET, "concurrent-batch-class", {
          ...baseCapacity, batchSlots: 1, browserSessionSlots: 0,
        }),
      }),
      service.poll({
        auth: auth("concurrent-browser-class", WORKER, TARGET, authority.workerProfileHash),
        request: pollRequestWithCapacity(WORKER, TARGET, "concurrent-browser-class", {
          ...baseCapacity, batchSlots: 0, browserSessionSlots: 1,
        }),
      }),
    ]);
    expect([batch, browser].filter((result) => result.outcome === "offer")).toHaveLength(2);
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

  it("activates exactly once across 100 concurrent ACKs and semantically replays after restart", async () => {
    const { admin, app } = guard();
    await resetRuntimeRows();
    const { seeded, offer, service } = await offerPlacedJob({ ordinal: 300 });
    const idempotencyKey = crypto.randomUUID();
    const first = ackRequest(offer, idempotencyKey);
    const results = await Promise.all(Array.from({ length: 100 }, (_, index) => service.ack({
      auth: auth(`ack-race-${index}`),
      request: {
        ...first,
        correlationId: crypto.randomUUID(),
        issuedAt: new Date().toISOString(),
        nonce: `ack-race-${index}`,
      },
    })));
    expect(results.every((result) => result.outcome === "acknowledged")).toBe(true);
    expect(new Set(results.map((result) => `${result.leaseId}:${result.expiresAt}`))).toEqual(
      new Set([`${offer.leaseId}:${offer.expiresAt}`]),
    );
    const [state] = await admin<{
      leaseStatus: string;
      attemptStatus: string;
      jobStatus: string;
      activated: boolean;
      receipts: number;
    }[]>`SELECT
      (SELECT status FROM leases WHERE id = ${offer.leaseId}) AS "leaseStatus",
      (SELECT status FROM job_attempts WHERE id = ${seeded.attemptId}) AS "attemptStatus",
      (SELECT status FROM jobs WHERE id = ${seeded.jobId}) AS "jobStatus",
      (SELECT activated_at IS NOT NULL FROM leases WHERE id = ${offer.leaseId}) AS activated,
      (SELECT count(*)::int FROM worker_operation_receipts WHERE lease_id = ${offer.leaseId}) AS receipts`;
    expect(state).toEqual({
      leaseStatus: "active",
      attemptStatus: "leased",
      jobStatus: "queued",
      activated: true,
      receipts: 1,
    });

    const restarted = createJobLeasingService({ appDb: app.db });
    const replay = await restarted.ack({
      auth: auth("ack-restart-replay"),
      request: { ...first, correlationId: crypto.randomUUID(), nonce: "ack-restart-replay" },
    });
    expect(replay).toMatchObject({ outcome: "acknowledged", leaseId: offer.leaseId, expiresAt: offer.expiresAt });

    const changed = ackRequest(offer, idempotencyKey, {
      ackedAt: new Date(Date.parse(first.body.ackedAt) + 1_000).toISOString(),
    });
    await expect(restarted.ack({ auth: auth("ack-changed-digest"), request: changed }))
      .rejects.toMatchObject({ code: "malformed" });
    await expect(restarted.ack({
      auth: auth("ack-restart-replay"),
      request: ackRequest(offer, crypto.randomUUID()),
    })).rejects.toMatchObject({ code: "unauthorized" });
  }, 60_000);

  it("never replays an exact expired ACK receipt hidden behind more than 100 older rows", async () => {
    const { admin } = guard();
    await resetRuntimeRows();
    const { offer, service } = await offerPlacedJob({ ordinal: 305 });
    const idempotencyKey = crypto.randomUUID();
    const request = ackRequest(offer, idempotencyKey);
    await expect(service.ack({ auth: auth("ack-expiry-first"), request }))
      .resolves.toMatchObject({ outcome: "acknowledged" });

    await admin`UPDATE worker_operation_receipts
      SET created_at = clock_timestamp() - interval '3 hours',
          expires_at = clock_timestamp() - interval '1 hour'
      WHERE lease_id = ${offer.leaseId} AND idempotency_key = ${idempotencyKey}`;
    await admin`INSERT INTO worker_operation_receipts
      (organization_id, company_id, job_id, attempt_id, lease_id, operation, worker_id,
       target_id, target_authority_key, target_generation, profile_hash, idempotency_key,
       semantic_digest, outcome, expires_at, created_at)
      SELECT organization_id, company_id, job_id, attempt_id, lease_id, operation, worker_id,
        target_id, target_authority_key, target_generation, profile_hash,
        md5('job003-expired-' || series::text)::uuid, semantic_digest, outcome,
        clock_timestamp() - interval '2 hours', clock_timestamp() - interval '3 hours'
      FROM worker_operation_receipts receipt
      CROSS JOIN generate_series(1, 101) series
      WHERE receipt.lease_id = ${offer.leaseId} AND receipt.idempotency_key = ${idempotencyKey}`;

    await expect(service.ack({
      auth: auth("ack-expiry-retry-fresh-proof"),
      request: { ...request, correlationId: crypto.randomUUID(), nonce: "ack-expiry-retry" },
    })).rejects.toMatchObject({ code: "attempt_terminal" });
  });

  it("uses fresh DB time so before-deadline ACK succeeds and late or crossing ACK changes nothing", async () => {
    const { admin } = guard();
    await resetRuntimeRows();
    const before = await offerPlacedJob({ ordinal: 310 });
    await admin`UPDATE leases SET ack_deadline = clock_timestamp() + interval '1 second'
      WHERE id = ${before.offer.leaseId}`;
    await expect(before.service.ack({
      auth: auth("ack-before-deadline"),
      request: ackRequest(before.offer),
    })).resolves.toMatchObject({ outcome: "acknowledged", leaseId: before.offer.leaseId });

    await resetRuntimeRows();
    const late = await offerPlacedJob({ ordinal: 311 });
    await admin`UPDATE leases SET ack_deadline = clock_timestamp() - interval '1 millisecond'
      WHERE id = ${late.offer.leaseId}`;
    await expect(late.service.ack({
      auth: auth("ack-after-deadline"),
      request: ackRequest(late.offer),
    })).rejects.toMatchObject({ code: "stale_fence" });
    await expectOfferUnchanged(late.seeded.attemptId);

    await resetRuntimeRows();
    const crossing = await offerPlacedJob({ ordinal: 312 });
    await admin.unsafe(`CREATE OR REPLACE FUNCTION job003_sleep_ack_proof() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.proof_id = 'ack-crossing-deadline' THEN PERFORM pg_sleep(0.10); END IF;
        RETURN NEW;
      END $$`);
    await admin.unsafe(`CREATE TRIGGER job003_sleep_ack_proof_trigger BEFORE INSERT ON worker_proof_replays
      FOR EACH ROW EXECUTE FUNCTION job003_sleep_ack_proof()`);
    try {
      await admin`UPDATE leases SET ack_deadline = clock_timestamp() + interval '50 milliseconds'
        WHERE id = ${crossing.offer.leaseId}`;
      await expect(crossing.service.ack({
        auth: auth("ack-crossing-deadline"),
        request: ackRequest(crossing.offer),
      })).rejects.toMatchObject({ code: "stale_fence" });
    } finally {
      await admin.unsafe("DROP TRIGGER IF EXISTS job003_sleep_ack_proof_trigger ON worker_proof_replays");
      await admin.unsafe("DROP FUNCTION IF EXISTS job003_sleep_ack_proof()");
    }
    await expectOfferUnchanged(crossing.seeded.attemptId);
  });

  it("rejects wrong worker, target, fence, lease, and revoked authority without disclosing or mutating", async () => {
    const { admin } = guard();
    await resetRuntimeRows();
    const offered = await offerPlacedJob({ ordinal: 320 });
    const cases = [
      {
        proof: "ack-wrong-worker",
        auth: auth("ack-wrong-worker"),
        request: ackRequest(offered.offer, undefined, { workerId: OTHER_WORKER }),
      },
      {
        proof: "ack-wrong-target",
        auth: auth("ack-wrong-target", OTHER_WORKER, OTHER_TARGET),
        request: ackRequest(offered.offer),
      },
      {
        proof: "ack-wrong-fence",
        auth: auth("ack-wrong-fence"),
        request: ackRequest(offered.offer, undefined, { fenceToken: "x".repeat(43) }),
      },
      {
        proof: "ack-wrong-lease",
        auth: auth("ack-wrong-lease"),
        request: ackRequest(offered.offer, undefined, { leaseId: crypto.randomUUID() }),
      },
    ];
    for (const candidate of cases) {
      await expect(offered.service.ack({ auth: candidate.auth, request: candidate.request }))
        .rejects.toMatchObject({ code: expect.stringMatching(/^(unauthorized|target_revoked|stale_fence)$/) });
      await expectOfferUnchanged(offered.seeded.attemptId);
    }
    await admin`UPDATE execution_targets SET status = 'revoked' WHERE id = ${TARGET}`;
    await expect(offered.service.ack({
      auth: auth("ack-revoked-target"),
      request: ackRequest(offered.offer),
    })).rejects.toMatchObject({ code: "target_revoked" });
    await expectOfferUnchanged(offered.seeded.attemptId);
  });

  it("rolls back lease, attempt, receipt, and proof when any ACK statement fails", async () => {
    const { admin } = guard();
    const stages = [
      { table: "leases", event: "UPDATE", when: "WHEN (NEW.status = 'active')" },
      { table: "job_attempts", event: "UPDATE", when: "WHEN (NEW.status = 'leased')" },
      { table: "worker_operation_receipts", event: "INSERT", when: "" },
    ] as const;
    for (const [index, stage] of stages.entries()) {
      await resetRuntimeRows();
      const offered = await offerPlacedJob({ ordinal: 330 + index });
      const functionName = `job003_fail_ack_${index}`;
      const triggerName = `job003_fail_ack_trigger_${index}`;
      await admin.unsafe(`CREATE OR REPLACE FUNCTION ${functionName}() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'job003 forced ack rollback'; END $$`);
      await admin.unsafe(`CREATE TRIGGER ${triggerName} BEFORE ${stage.event} ON ${stage.table}
        FOR EACH ROW ${stage.when} EXECUTE FUNCTION ${functionName}()`);
      try {
        await expect(offered.service.ack({
          auth: auth(`ack-rollback-${index}`),
          request: ackRequest(offered.offer),
        })).rejects.toThrow();
      } finally {
        await admin.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON ${stage.table}`);
        await admin.unsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
      }
      await expectOfferUnchanged(offered.seeded.attemptId);
      const [proof] = await admin<{ count: number }[]>`SELECT count(*)::int AS count
        FROM worker_proof_replays WHERE proof_id = ${`ack-rollback-${index}`}`;
      expect(proof?.count).toBe(0);
    }
  });
});
