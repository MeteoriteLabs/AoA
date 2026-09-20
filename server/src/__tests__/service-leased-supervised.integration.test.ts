// E9 — a SERVICE job LEASED end-to-end, then SUPERVISED KEYLESS by the real worker
// supervisor. This is the "biggest unexercised gap" the E9 findings name: until this suite,
// NOTHING leased a workload_type=service job (service-management.integration.test.ts:30 — "no
// worker ever leases the service job this test creates"), and E9-F002 keeps `workload.service`
// UNOFFERABLE unless a daemon advertises a free service slot. Here a service-capable worker is
// enrolled, the reconciled service job is polled/leased/acked through the REAL
// createJobLeasingService, and the REAL createSupervisor runs it against an in-process
// (keyless, no E2B) sandbox double to the frozen service_instance_started + service_health +
// terminal stream. A BATCH positive control proves the same harness leases + supervises, so a
// service-only failure is a real service gap.
//
// SCOPE / boundary (deliberate): this is Option A — it asserts the SUPERVISOR's emitted event
// stream (the worker-side collecting WorkerEventSink), not server-side projection of
// service_instances.status. Forwarding the events into the JOB-005 ingest is a fuller e2e left
// as a follow-up. And ONE seam is a seed, not the real thing: reconcile's submission writes a
// bare pending attempt with no placement (JOB-009 owns placement), so the placement columns are
// hand-UPDATEd here exactly as the base harness hand-seeds them
// (composed-loop-real-server.integration.test.ts / job-control-fixture.ts insertPlacedAttempt).
//
// Keyless: the supervisor is given `provider` (the DESKTOP branch) with NO makeRunProvider and
// NO materializeRunSecrets, so no capability is minted and the sandbox env stays {}. The
// E2bSandboxProvider+MockE2bTransport double is imported RELATIVELY — the control plane must
// never gain a provider in its runtime graph (same rationale as
// cli-008-unit-b-staging-channel.integration.test.ts:51-55).
//
// Windows CI can't start embedded-postgres on the runneradmin runner (Issue #114) — gated; opt
// in with AOA_RUN_WIN_INTEGRATION=1. The required Linux e2e/verify gate runs it for real.

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres, { type Sql } from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  applyPendingMigrations,
  createOperatorDbConnection,
  createTenantAppDbConnection,
  type NonOwnerDbConnection,
} from "@armyofagents/db";
import {
  canonicalizeJsonV1,
  canonicalProviderConstraintProfileDigestInputV1,
  type LeaseAckOperationRequestV1,
  type LeaseOfferV1,
  type PollRequestV1,
  type ProviderConstraintProfileV1,
  type RegisteredTargetProfileV1,
  type WorkerEventV1,
} from "@armyofagents/worker-protocol";
import { createSupervisor } from "@armyofagents/worker-daemon";
// RELATIVE, not a package specifier — see header.
import { E2bSandboxProvider } from "../../../packages/sandbox-e2b-provider/src/e2b-provider.js";
import { MockE2bTransport } from "../../../packages/sandbox-e2b-provider/src/mock-transport.js";
import { provisionTenantAppRoleLoginSql } from "../db/rls-tenant.js";
import { createJobLeasingService, type VerifiedWorkerOperation } from "../services/job-leasing.js";
import { createService } from "../services/service-management.js";
import { reconcileService } from "../services/service-reconciler.js";
import { allocateEmbeddedPgPort } from "./helpers/embedded-pg-port.js";

type EmbeddedPostgresInstance = { initialise(): Promise<void>; start(): Promise<void>; stop(): Promise<void> };
type EmbeddedPostgresCtor = new (opts: Record<string, unknown>) => EmbeddedPostgresInstance;

// Unique, non-sentinel UUIDs (distinct from job-control-fixture a600…, cli-008 c8b0…).
const ORG = "e9f00000-0000-4000-8000-000000000001";
const COMPANY = "e9f00000-0000-4000-8000-000000000002";
const TARGET = "e9f00000-0000-4000-8000-000000000003";
const WORKER = "e9f00000-0000-4000-8000-000000000005";
const OPERATOR_ID = "e9f00000-0000-4000-8000-0000000000aa";
const PASSWORD = "e9-svc-role-password";
const POLICY_HASH = "3".repeat(64);
const THUMBPRINT = "4".repeat(64);
const AUTHORITY_KEY = `organization:${ORG}`;

const sha256 = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");

function providerProfile(): ProviderConstraintProfileV1 {
  const unsigned = {
    profileId: "e9-svc-provider",
    version: 1,
    maxContinuousRuntimeSeconds: 3_600,
    maxIdleSeconds: 300,
    resourceCeiling: { cpuMillis: 2_000, memoryMiB: 4_096, pids: 512, diskMiB: 8_192 },
    maxConcurrentOperations: 2,
    supportedOperations: ["create", "execute", "cancel", "kill", "destroy", "list", "inspect", "reconcile_cleanup"],
    localityTags: ["organization_target_only"],
    checkpointMode: "none",
    healthMode: "none",
  } as const;
  return { ...unsigned, digest: sha256(canonicalProviderConstraintProfileDigestInputV1(unsigned)) };
}

// Delta vs the batch-only fixture: `workload.service` in the ceiling.
function registeredProfile(provider: ProviderConstraintProfileV1): RegisteredTargetProfileV1 {
  return {
    protocolVersion: 1,
    targetId: TARGET,
    targetClass: "organization_dedicated",
    scope: "organization",
    organizationId: ORG,
    ownerPrincipalId: null,
    trustCeiling: "organization_isolated",
    credentialCeiling: "organization_brokered",
    dataLocalityCeiling: "organization_target_only",
    providerConstraints: { profileId: provider.profileId, version: provider.version, digest: provider.digest },
    capabilityCeiling: ["workload.batch", "workload.service", "sandbox.process_isolated"],
    deviceGeneration: 1,
    revokedAt: null,
    policyHash: POLICY_HASH,
  };
}

// Deltas vs the fixture: `workload.service` in reportedCapabilities AND serviceSlots 0 -> 1.
// Both the stored hello capacity AND the poll-request capacity must carry serviceSlots >= 1, and
// `workload.service` must be in BOTH the ceiling and the reported set, or the offer silently
// vanishes (job-leasing.ts deriveAdmissibleWorkloadTypes + the frozen matcher).
function serviceHello() {
  return {
    protocolVersion: 1 as const,
    workerId: WORKER,
    targetId: TARGET,
    deviceGeneration: 1,
    agentVersion: "e9-svc-integration",
    supportedProtocol: { min: 1, max: 1 },
    platform: { os: "linux" as const, arch: "x64" as const, runtime: "worker" },
    reportedCapabilities: ["workload.batch" as const, "workload.service" as const, "sandbox.process_isolated" as const],
    capacity: { batchSlots: 2, browserSessionSlots: 0, serviceSlots: 1, freeCpuMillis: 2_000, freeMemoryMiB: 4_096, freeDiskMiB: 8_192 },
    policyHash: POLICY_HASH,
  };
}

const WORKER_PROFILE_HASH = sha256(JSON.stringify(serviceHello()));
const PROVIDER_DIGEST = providerProfile().digest;
// The TARGET's registered_profile_hash — what the poll matches placement_profile_hash against
// (job-leasing.ts normalizedCurrentTarget.profileHash). NOT the worker's JSON.stringify hash.
const REGISTERED_PROFILE_HASH = sha256(canonicalizeJsonV1(registeredProfile(providerProfile())));

function auth(proofId: string): VerifiedWorkerOperation {
  return {
    organizationId: ORG,
    workerId: WORKER,
    targetId: TARGET,
    targetGeneration: 1,
    deviceThumbprint: THUMBPRINT,
    profileHash: WORKER_PROFILE_HASH,
    publicKey: "e9-svc-public-key",
    proofId,
    proofIssuedAt: new Date(),
    sessionExpiresAt: new Date(Date.now() + 10 * 60_000),
  };
}

function pollRequest(nonce: string): PollRequestV1 {
  return {
    protocolVersion: 1,
    correlationId: randomUUID(),
    issuedAt: new Date().toISOString(),
    nonce,
    audience: "worker_poll",
    workerId: WORKER,
    targetId: TARGET,
    deviceGeneration: 1,
    capacity: { batchSlots: 2, browserSessionSlots: 0, serviceSlots: 1, freeCpuMillis: 2_000, freeMemoryMiB: 4_096, freeDiskMiB: 8_192 },
  } as PollRequestV1;
}

function ackRequest(offer: LeaseOfferV1): LeaseAckOperationRequestV1 {
  return {
    protocolVersion: 1,
    correlationId: randomUUID(),
    issuedAt: new Date().toISOString(),
    nonce: `ack-${randomUUID()}`,
    audience: "worker_run",
    idempotencyKey: randomUUID(),
    body: {
      protocolVersion: 1,
      workerId: offer.workerId,
      jobId: offer.job.jobId,
      attempt: offer.job.attempt,
      leaseId: offer.leaseId,
      fenceToken: offer.fenceToken,
      ackedAt: new Date().toISOString(),
      extensions: [],
    },
  } as LeaseAckOperationRequestV1;
}

const integration = describe.skipIf(
  process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1",
);

integration("E9 service leased + supervised (keyless)", () => {
  let embedded: EmbeddedPostgresInstance | undefined;
  let admin: Sql;
  let app: NonOwnerDbConnection;
  let operator: NonOwnerDbConnection;
  let dataDir = "";
  let setupError: unknown = null;

  beforeAll(async () => {
    try {
      dataDir = await mkdtemp(join(tmpdir(), "aoa-e9-svc-"));
      const { default: EmbeddedPostgres } = (await import("embedded-postgres")) as { default: EmbeddedPostgresCtor };
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
      const adminUrl = `postgres://test:test@127.0.0.1:${port}/postgres`;
      await applyPendingMigrations(adminUrl);
      admin = postgres(adminUrl, { max: 4 });
      await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_app", PASSWORD));
      await admin.unsafe(provisionTenantAppRoleLoginSql("aoa_operator", PASSWORD));
      app = createTenantAppDbConnection(adminUrl.replace("test:test", `aoa_app:${PASSWORD}`), { max: 16 });
      operator = createOperatorDbConnection(adminUrl.replace("test:test", `aoa_operator:${PASSWORD}`), { max: 8 });

      await admin`INSERT INTO organizations (id, name, slug) VALUES (${ORG}, 'E9 svc org', 'e9-svc-org')`;
      await admin`INSERT INTO companies (id, organization_id, name, issue_prefix)
        VALUES (${COMPANY}, ${ORG}, 'E9 svc company', 'E9S')`;
      const provider = providerProfile();
      const profile = registeredProfile(provider);
      await admin`INSERT INTO execution_targets
        (id, organization_id, slug, kind, trust_class, status, capabilities, config, scope,
         target_authority_key, device_generation, registered_profile, registered_profile_hash,
         provider_constraint_profile, last_seen_at)
        VALUES (${TARGET}, ${ORG}, 'e9-svc-target', 'dedicated_worker', 'dedicated_tenant', 'active', '{}', '{}',
          'organization', ${AUTHORITY_KEY}, 1, ${profile}, ${REGISTERED_PROFILE_HASH},
          ${provider}, clock_timestamp())`;
      const hello = serviceHello();
      await admin`INSERT INTO workers
        (id, scope, organization_id, execution_target_id, target_authority_key, device_public_key,
         device_thumbprint, device_generation, profile_hash, profile_snapshot, enrolled_at,
         last_seen_at, label, status)
        VALUES (${WORKER}, 'organization', ${ORG}, ${TARGET}, ${AUTHORITY_KEY}, 'e9-svc-public-key',
          ${THUMBPRINT}, 1, ${WORKER_PROFILE_HASH}, ${hello}, clock_timestamp(),
          clock_timestamp(), 'E9 svc worker', 'enrolled')`;
    } catch (error) {
      setupError = error;
    }
  }, 180_000);

  afterAll(async () => {
    await operator?.close({ timeoutSeconds: 5 }).catch(() => {});
    await app?.close({ timeoutSeconds: 5 }).catch(() => {});
    await admin?.end().catch(() => {});
    await embedded?.stop().catch(() => {});
    if (dataDir) await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }, 60_000);

  beforeEach(async () => {
    if (setupError) throw setupError;
    // Gates admitAttemptCapacity in submitJobWithinTenant (reconcile's submission path).
    process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED = "true";
    for (const table of [
      "job_control_commands", "job_events", "job_projection_receipts", "worker_operation_receipts",
      "leases", "job_outbox", "job_attempts", "jobs", "worker_proof_replays",
      "service_instances", "service_generations", "services", "activity_log",
    ]) {
      await admin.unsafe(`DELETE FROM ${table}`);
    }
    // Keep the poll's maxHeartbeatAgeMs (default 300s) gate satisfied; the poll reads the DB clock.
    await admin`UPDATE execution_targets SET status = 'active', device_generation = 1, last_seen_at = clock_timestamp() WHERE id = ${TARGET}`;
    await admin`UPDATE workers SET status = 'enrolled', device_generation = 1, last_seen_at = clock_timestamp() WHERE id = ${WORKER}`;
  });

  afterEach(() => {
    delete process.env.AOA_DISTRIBUTED_EXECUTION_ENABLED;
  });

  /** Hand-set the 15 placement columns on an already-inserted `pending` attempt so a poll can
   * offer it — the one seam that is a seed rather than the real thing (see header). Mirrors
   * job-control-fixture.ts insertPlacedAttempt column-for-column; the atomic CHECK requires all
   * non-null together and `placement_lease_eligible = (disposition selected AND mode active)`. */
  async function placeAttempt(attemptId: string): Promise<void> {
    await admin`UPDATE job_attempts SET
      status = 'pending', placement_disposition = 'selected', placement_owner = 'organization_dedicated',
      placement_target_id = ${TARGET}, placement_target_class = 'organization_dedicated',
      placement_target_scope = 'organization', placement_target_generation = 1,
      placement_profile_hash = ${REGISTERED_PROFILE_HASH}, placement_provider_constraint_hash = ${PROVIDER_DIGEST},
      placement_fallback_disposition = 'primary', placement_reason_code = 'target_selected',
      placement_mode = 'active', placement_lease_eligible = true,
      placement_input_digest = ${"6".repeat(64)}, placement_policy_digest = ${"6".repeat(64)},
      placement_decided_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE id = ${attemptId}`;
  }

  /** Seed a placed batch job for the positive control (mirrors job-control-fixture.ts seedPlacedJob). */
  async function seedBatchJob(): Promise<{ jobId: string; attemptId: string }> {
    const jobId = "e9f10000-0000-4000-8000-000000000001";
    const attemptId = "e9f20000-0000-4000-8000-000000000001";
    const outboxId = "e9f30000-0000-4000-8000-000000000001";
    const availableAt = new Date(Date.now() - 60_000);
    const workload = { command: "codex", args: ["exec", "--json"], stdinArtifactId: null, maxRuntimeSeconds: 600 };
    await admin`INSERT INTO jobs
      (id, organization_id, company_id, workload_type, source_kind, source_identity, source_intent,
       requester_principal_kind, requester_principal_id, executor_principal_kind, executor_principal_id,
       input, input_hash, policy_snapshot, policy_hash, requirements, placement_request,
       available_at, priority, status, max_attempts, created_at, updated_at)
      VALUES (${jobId}, ${ORG}, ${COMPANY}, 'batch', 'one_shot', ${jobId},
        ${{ kind: "one_shot", operationId: jobId, operationKind: "extraction" }},
        'system', 'e9-svc-test', 'worker', ${WORKER}, ${workload},
        ${"5".repeat(64)}, ${{ policyId: "job-submission-default", version: 1 }}, ${POLICY_HASH},
        ${{ workloadType: "batch", requiredCapabilities: ["sandbox.process_isolated"] }},
        ${{ policyId: "job-submission-default", policyVersion: 1, requestedTarget: TARGET }},
        ${availableAt}, 50, 'queued', 3, ${availableAt}, ${availableAt})`;
    await admin`INSERT INTO job_attempts
      (id, organization_id, company_id, job_id, attempt_number, status, created_at, updated_at)
      VALUES (${attemptId}, ${ORG}, ${COMPANY}, ${jobId}, 1, 'pending', ${availableAt}, ${availableAt})`;
    await placeAttempt(attemptId);
    await admin`INSERT INTO job_outbox
      (id, organization_id, company_id, job_id, attempt_id, kind, status, payload, available_at)
      VALUES (${outboxId}, ${ORG}, ${COMPANY}, ${jobId}, ${attemptId}, 'attempt_ready', 'pending',
        ${{ organizationId: ORG, companyId: COMPANY, jobId, attemptId, sourceKind: "one_shot" }},
        clock_timestamp())`;
    return { jobId, attemptId };
  }

  /** A fresh REAL supervisor over a keyless in-process sandbox double, driven to its terminal.
   * `accept()` resolves only after the full lifecycle + teardown, so awaiting it is the whole run. */
  async function superviseOffer(offer: LeaseOfferV1, workloadClass: "service" | "batch"): Promise<WorkerEventV1[]> {
    const events: WorkerEventV1[] = [];
    const sink = { emit(event: WorkerEventV1) { events.push(event); } };
    const supervisor = createSupervisor({
      provider: new E2bSandboxProvider({ transport: new MockE2bTransport() }),
      identity: { targetId: TARGET, deviceGeneration: 1 },
      eventSink: sink,
      redactionCanaries: [],
      now: () => Date.now(),
      opDeadlineMs: 1000,
      serviceHealthTickMs: 20,
    });
    await supervisor.accept({
      offer,
      leaseId: String(offer.leaseId),
      fenceToken: String(offer.fenceToken),
      workloadClass,
    } as never);
    return events;
  }

  async function assertLeasedAndAcked(attemptId: string): Promise<void> {
    const attempt = await admin<{ status: string }[]>`SELECT status FROM job_attempts WHERE id = ${attemptId}`;
    expect(attempt[0]?.status).toBe("leased");
    const lease = await admin<{ worker_id: string; status: string }[]>`SELECT worker_id, status FROM leases WHERE attempt_id = ${attemptId}`;
    expect(lease[0]?.status).toBe("active");
    expect(String(lease[0]?.worker_id)).toBe(WORKER);
    const receipts = await admin`SELECT operation FROM worker_operation_receipts WHERE attempt_id = ${attemptId} AND operation = ${"lease_ack"}`;
    expect(receipts.length).toBeGreaterThanOrEqual(1);
  }

  it("leases a service job end-to-end and the real supervisor runs it keyless to a clean terminal", async () => {
    // create -> reconcile (the literal path; only placement is a seed, per the header).
    const created = await createService(app.db, {
      organizationId: ORG,
      companyId: COMPANY,
      definition: { command: "node", args: ["server.js"], gracefulStopSeconds: 1 },
      desiredState: "running",
      createdBy: "e9-svc-e2e",
      actor: { actorType: "user", actorId: OPERATOR_ID },
    });
    if (!created) throw new Error("createService returned null");
    const outcome = await reconcileService(app.db, { organizationId: ORG, companyId: COMPANY, serviceId: created.serviceId });
    if (outcome.action !== "created") throw new Error(`reconcile: ${JSON.stringify(outcome)}`);
    await placeAttempt(outcome.attemptId);
    await admin`UPDATE jobs SET available_at = clock_timestamp() - interval '60 seconds' WHERE id = ${outcome.jobId}`;

    // REAL poll -> lease -> ack of the SERVICE job. Fail fast so a silent E9-F002 no_work is legible.
    const leasing = createJobLeasingService({ appDb: app.db });
    const polled = await leasing.poll({ auth: auth("poll-svc"), request: pollRequest("poll-svc") });
    if (polled.outcome !== "offer") throw new Error(`expected service offer, got ${polled.outcome}`);
    const offer = polled.body;
    expect(offer.job.workloadType).toBe("service");
    expect((offer.job.workload as { serviceId: string }).serviceId).toBe(created.serviceId);
    expect((offer.job.workload as { serviceInstanceId: string }).serviceInstanceId).toBe(outcome.serviceInstanceId);
    const acked = await leasing.ack({ auth: auth("ack-svc"), request: ackRequest(offer) });
    expect(acked.outcome).toBe("acknowledged");

    // The lease is REAL (offerLease leaves rows 'offered'; only activateLeaseAck flips them).
    await assertLeasedAndAcked(outcome.attemptId);

    // REAL supervisor runs it keyless to a clean terminal.
    const events = await superviseOffer(offer, "service");
    const types = events.map((event) => event.eventType);

    // started, naming the reconciled service instance.
    expect(types).toContain("service_instance_started");
    expect(events.find((event) => event.eventType === "service_instance_started")!.payload).toMatchObject({
      serviceId: created.serviceId,
      serviceInstanceId: outcome.serviceInstanceId,
      generation: 1,
      providerResourceId: expect.any(String),
    });
    // the loop OBSERVED a running process (a started+stopped-only stream would pass a weaker test).
    const healthy = events.filter(
      (event) => event.eventType === "service_health" && (event.payload as { status: string }).status === "healthy",
    );
    expect(healthy.length).toBeGreaterThanOrEqual(1);
    expect((healthy[0]!.payload as { detail: string | null }).detail).toBeNull();
    // clean terminal, and it is LAST.
    expect(types.at(-1)).toBe("terminal");
    expect(events.find((event) => event.eventType === "terminal")!.payload).toMatchObject({ status: "succeeded" });
    // frozen sequencer invariant: seq is 1..N with no gaps.
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
  }, 60_000);

  it("POSITIVE CONTROL: the same harness leases + supervises a BATCH job (so a service-only failure is a real service gap)", async () => {
    const { attemptId } = await seedBatchJob();
    const leasing = createJobLeasingService({ appDb: app.db });
    const polled = await leasing.poll({ auth: auth("poll-batch"), request: pollRequest("poll-batch") });
    if (polled.outcome !== "offer") throw new Error(`expected batch offer, got ${polled.outcome}`);
    const offer = polled.body;
    expect(offer.job.workloadType).toBe("batch");
    const acked = await leasing.ack({ auth: auth("ack-batch"), request: ackRequest(offer) });
    expect(acked.outcome).toBe("acknowledged");
    await assertLeasedAndAcked(attemptId);

    const events = await superviseOffer(offer, "batch");
    const types = events.map((event) => event.eventType);
    expect(types).toContain("attempt_started");
    expect(types.at(-1)).toBe("terminal");
    expect(events.find((event) => event.eventType === "terminal")!.payload).toMatchObject({ status: "succeeded", exitCode: 0 });
  }, 60_000);
});
