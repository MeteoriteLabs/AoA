// JOB-016 — the E3-D-ACC in-transaction accepted-event seam, pricing registered on it, the
// hard-stop scope cancel, the terminal-without-usage signal and the bounded re-drive. Embedded
// PostgreSQL; Linux CI is the formal authority, SKIPPED on Windows unless AOA_RUN_WIN_INTEGRATION=1.
//
// Decision: docs/replatform/epics/E3-job-control/decisions.md, `E3-D-ACC` (accepted with three
// amendments). Every behaviour is proven against the REAL repository `acceptEvent` under a REAL
// fence, and the production composition (the ingest registers pricing) is proven through the real
// poll → ack → ingest path.
//
// MULTI-TENANT (F10): two Organizations, each with its own Company, target, worker, agent and
// model config, price side by side; a hard stop in one refuses only that one.
import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { AcceptEventInput, AcceptedEventProjector, ActiveFenceRequest, Db } from "@armyofagents/db";
import {
  canonicalEventDigestInputV1,
  type EventUploadOperationRequestV1,
  type LeaseOfferV1,
} from "@armyofagents/worker-protocol";
import type { SubmitJobSource } from "@armyofagents/shared";
import {
  setupJobControlFixture,
  auth,
  sha256,
  COMPANY,
  ORG,
  TARGET,
  WORKER,
  type JobControlFixture,
} from "./helpers/job-control-fixture.js";
import { runInTenant } from "../db/tenant-context.js";
import {
  createAcceptedUsagePricingProjector,
  createAuthoritativeCostRedriveSweep,
  createHubStuckChargeNotifier,
  redrivePendingAuthoritativeCost,
  STUCK_CHARGE_HUB_SOURCE_TYPE,
  type AcceptedUsageOutcome,
} from "../services/job-accepted-usage-pricing.js";
import {
  jobBudgetCostBridge,
  priceAcceptedUsageCore,
  JobBudgetCostTenantError,
} from "../services/job-budget-cost-bridge.js";
import { computeCostCents } from "../services/internal-agent/cost-model.js";
import { admitAttemptCapacity } from "../services/org-concurrency.js";
import { createJobEventIngestService } from "../services/job-events.js";
import { createDistributedExecutionDrainStore } from "../services/job-distributed-drain-store.js";
import { createDistributedExecutionDrain } from "../services/job-distributed-drain.js";
import { logger } from "../middleware/logger.js";
import { clearBudgetHooks, onBudgetExhausted, type BudgetEnforcementScope } from "../services/budget-hooks.js";
import { subscribeCompanyLiveEvents } from "../services/live-events.js";
import { ackRequest, pollRequest } from "./helpers/job-control-fixture.js";

const ENABLED_ENV = { AOA_DISTRIBUTED_EXECUTION_ENABLED: "true" } as const;
const KNOWN_MODEL = "claude-sonnet-4-6";
const UNKNOWN_MODEL = "totally-unknown-model-x";

// Organization B — a SECOND tenant with its own Company, target, worker and agent.
const ORG_B = "a6000000-0000-4000-8000-0000000000b1";
const COMPANY_B = "a6000000-0000-4000-8000-0000000000b2";
const TARGET_B = "a6000000-0000-4000-8000-0000000000b3";
const WORKER_B = "a6000000-0000-4000-8000-0000000000b5";

const AGENT_A = "a7160000-0000-4000-8000-0000000000a1";
const AGENT_A_UNKNOWN = "a7160000-0000-4000-8000-0000000000a2";
const AGENT_B = "a7160000-0000-4000-8000-0000000000b1";
const USER_A = "job016-user-a";
const USER_B = "job016-user-b";

const HASH_A = "7".repeat(64);
const HASH_B = "8".repeat(64);

interface Tenant {
  organizationId: string;
  companyId: string;
  targetId: string;
  workerId: string;
  targetAuthorityKey: string;
}
const TENANT_A: Tenant = {
  organizationId: ORG, companyId: COMPANY, targetId: TARGET, workerId: WORKER,
  targetAuthorityKey: `organization:${ORG}`,
};
const TENANT_B: Tenant = {
  organizationId: ORG_B, companyId: COMPANY_B, targetId: TARGET_B, workerId: WORKER_B,
  targetAuthorityKey: `organization:${ORG_B}`,
};

let fixture: JobControlFixture | null = null;
let setupError: unknown = null;

function guard(): JobControlFixture {
  if (setupError) throw new Error(`fixture setup failed: ${String(setupError)}`);
  if (!fixture) throw new Error("fixture not initialised");
  return fixture;
}

async function count(table: string, where: string): Promise<number> {
  const [row] = await guard().admin.unsafe(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`);
  return (row as { n: number }).n;
}

function taskSource(agentId: string): SubmitJobSource {
  return { kind: "task_run", runId: randomUUID(), issueId: randomUUID(), assigneeAgentId: agentId };
}

/** Seed a job + a RUNNING attempt + an ACTIVE lease for `tenant`, directly. Returns the fence. */
async function seedLeasedAttempt(tenant: Tenant, source: SubmitJobSource): Promise<ActiveFenceRequest> {
  const f = guard();
  const jobId = randomUUID();
  const attemptId = randomUUID();
  const leaseId = randomUUID();
  const fence = `fence-${randomUUID()}`;
  await f.admin`INSERT INTO jobs (id, organization_id, company_id, source_kind, source_identity, source_intent, status)
    VALUES (${jobId}, ${tenant.organizationId}, ${tenant.companyId}, ${source.kind}, ${jobId}, ${f.admin.json(source as never)}, 'running')`;
  await f.admin`INSERT INTO job_attempts (id, organization_id, company_id, job_id, attempt_number, status)
    VALUES (${attemptId}, ${tenant.organizationId}, ${tenant.companyId}, ${jobId}, 1, 'running')`;
  const hash = tenant === TENANT_A ? HASH_A : HASH_B;
  await f.admin`INSERT INTO leases
    (id, organization_id, attempt_id, company_id, job_id, attempt_number, worker_id, target_id,
     target_authority_key, target_generation, profile_hash, provider_constraint_hash, status, fence,
     ack_deadline, expires_at, activated_at)
    VALUES (${leaseId}, ${tenant.organizationId}, ${attemptId}, ${tenant.companyId}, ${jobId}, 1,
      ${tenant.workerId}, ${tenant.targetId}, ${tenant.targetAuthorityKey}, 1, ${hash}, ${hash},
      'active', ${fence}, now() + interval '1 minute', now() + interval '10 minutes', now())`;
  return {
    organizationId: tenant.organizationId,
    companyId: tenant.companyId,
    jobId,
    attemptId,
    attemptNumber: 1,
    leaseId,
    workerId: tenant.workerId,
    targetId: tenant.targetId,
    targetAuthorityKey: tenant.targetAuthorityKey,
    targetGeneration: 1,
    profileHash: hash,
    providerConstraintHash: hash,
    fence,
  };
}

/** Seed a QUEUED job (no lease) for `tenant`; returns its ids. */
async function seedQueuedJob(tenant: Tenant, source: SubmitJobSource): Promise<{ jobId: string; attemptId: string }> {
  const f = guard();
  const jobId = randomUUID();
  const attemptId = randomUUID();
  await f.admin`INSERT INTO jobs (id, organization_id, company_id, source_kind, source_identity, source_intent, status)
    VALUES (${jobId}, ${tenant.organizationId}, ${tenant.companyId}, ${source.kind}, ${jobId}, ${f.admin.json(source as never)}, 'queued')`;
  await f.admin`INSERT INTO job_attempts (id, organization_id, company_id, job_id, attempt_number, status)
    VALUES (${attemptId}, ${tenant.organizationId}, ${tenant.companyId}, ${jobId}, 1, 'pending')`;
  return { jobId, attemptId };
}

function acceptInput(
  fence: ActiveFenceRequest,
  seq: number,
  eventType: string,
  payload: Record<string, unknown>,
  opts: { eventId?: string; terminalStatus?: "succeeded" | "failed" | "cancelled" | "expired" } = {},
): AcceptEventInput {
  const eventId = opts.eventId ?? randomUUID();
  const digest = createHash("sha256").update(`${eventId}:${seq}`).digest("hex");
  return {
    eventId,
    sequence: seq,
    eventType,
    fenceToken: fence.fence,
    suppliedDigest: digest,
    recomputedDigest: digest,
    occurredAt: new Date(),
    // The repository stores the WHOLE wire event; the usage units ride its `payload`.
    payload: { eventId, eventType, seq, payload },
    terminalStatus: opts.terminalStatus ?? null,
    serviceProjection: null,
  };
}
const usage = (fence: ActiveFenceRequest, seq: number, eventId?: string) =>
  acceptInput(fence, seq, "usage", { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0, runtimeMillis: 100 }, { eventId });
const terminal = (fence: ActiveFenceRequest, seq: number) =>
  acceptInput(fence, seq, "terminal", { status: "succeeded", exitCode: 0, errorCode: null, errorMessage: null }, { terminalStatus: "succeeded" });
const cancelEv = (fence: ActiveFenceRequest, seq: number) =>
  acceptInput(fence, seq, "log", { stream: "stdout", level: "info", message: "cancel acknowledged" });

/** Drive the REAL repository `acceptEvent` under the fence, with the given registrations. */
async function accept(
  fence: ActiveFenceRequest,
  events: AcceptEventInput[],
  projectors: readonly AcceptedEventProjector[] = [createAcceptedUsagePricingProjector()],
) {
  return runInTenant(guard().app.db, fence.organizationId, (repos) =>
    repos.jobControl.acceptEvent({ ...fence, batch: { events, acceptedEventProjectors: projectors } }));
}

async function seedCompanyHardStop(companyId: string, amountCents: number): Promise<void> {
  await guard().admin`INSERT INTO budget_policies
    (company_id, scope_type, scope_id, metric, window_kind, amount_cents, warn_percent, hard_stop_enabled, is_active)
    VALUES (${companyId}, 'company', ${companyId}, 'cost_cents', 'calendar_month_utc', ${amountCents}, 80, true, true)`;
}

async function receiptFor(fence: ActiveFenceRequest, eventId: string) {
  const rows = await guard().admin`SELECT id, status, target_aggregate_id, aggregate_kind, organization_id, company_id
    FROM job_projection_receipts WHERE projection_kind = 'authoritative_cost'
      AND organization_id = ${fence.organizationId} AND source_identity = ${`cost:${fence.companyId}:${eventId}`}`;
  return rows[0] as { id: string; status: string; target_aggregate_id: string; aggregate_kind: string; organization_id: string; company_id: string } | undefined;
}

/** Submit-time admission exactly as `submitJobWithinTenant` runs it: inside the tenant tx. */
async function admitIn(f: JobControlFixture, input: Parameters<typeof admitAttemptCapacity>[1]) {
  return runInTenant(f.app.db, input.organizationId, (_repos, tx) => admitAttemptCapacity(tx, input));
}

// The OWNER pool the production notifier gets (`db` in index.ts). A SEPARATE client: drizzle's
// postgres-js driver rewrites its client's type serializers, so wrapping `fixture.admin` would
// corrupt every later raw query the fixture makes.
let ownerClient: ReturnType<typeof postgres> | null = null;
function ownerDb(): Db {
  if (!ownerClient) {
    const options = guard().admin.options as unknown as { port: number[] };
    ownerClient = postgres(`postgres://test:test@127.0.0.1:${options.port[0]}/postgres`, { max: 2 });
  }
  return drizzle(ownerClient) as unknown as Db;
}

beforeAll(async () => {
  try {
    fixture = await setupJobControlFixture("job016-seam");
    const f = fixture;
    // Organization B: its own org, Company, target and worker (cloned shape, new identities).
    await f.admin`INSERT INTO organizations (id, name, slug) VALUES (${ORG_B}, 'JOB-016 org B', 'job-016-org-b')`;
    await f.admin`INSERT INTO companies (id, organization_id, name, issue_prefix) VALUES (${COMPANY_B}, ${ORG_B}, 'JOB-016 company B', 'J16B')`;
    await f.admin`INSERT INTO execution_targets
      (id, organization_id, slug, kind, trust_class, status, capabilities, config, scope,
       target_authority_key, device_generation, registered_profile, registered_profile_hash,
       provider_constraint_profile, last_seen_at)
      SELECT ${TARGET_B}, ${ORG_B}, 'job-016-target-b', kind, trust_class, status, capabilities, config, scope,
        ${TENANT_B.targetAuthorityKey}, 1, registered_profile, registered_profile_hash,
        provider_constraint_profile, clock_timestamp()
      FROM execution_targets WHERE id = ${TARGET}`;
    await f.admin`INSERT INTO workers
      (id, scope, organization_id, execution_target_id, target_authority_key, device_public_key,
       device_thumbprint, device_generation, profile_hash, profile_snapshot, enrolled_at, last_seen_at, label, status)
      SELECT ${WORKER_B}, scope, ${ORG_B}, ${TARGET_B}, ${TENANT_B.targetAuthorityKey}, 'job-016-b-public-key',
        ${"9".repeat(64)}, 1, profile_hash, profile_snapshot, clock_timestamp(), clock_timestamp(), 'JOB-016 worker B', 'enrolled'
      FROM workers WHERE id = ${WORKER}`;
    // Per-tenant agents + model config (each Company resolves its OWN rate source).
    await f.admin`INSERT INTO agents (id, company_id, name, kind, status, adapter_type, adapter_config)
      VALUES (${AGENT_A}, ${COMPANY}, 'J016 A', 'org', 'idle', 'claude_local', ${f.admin.json({ model: KNOWN_MODEL })})`;
    await f.admin`INSERT INTO agents (id, company_id, name, kind, status, adapter_type, adapter_config)
      VALUES (${AGENT_A_UNKNOWN}, ${COMPANY}, 'J016 A unknown', 'org', 'idle', 'claude_local', ${f.admin.json({ model: UNKNOWN_MODEL })})`;
    await f.admin`INSERT INTO agents (id, company_id, name, kind, status, adapter_type, adapter_config)
      VALUES (${AGENT_B}, ${COMPANY_B}, 'J016 B', 'org', 'idle', 'claude_local', ${f.admin.json({ model: KNOWN_MODEL })})`;
    await f.admin`INSERT INTO internal_agent_config (company_id, model, provider) VALUES (${COMPANY}, ${KNOWN_MODEL}, 'anthropic')`;
    await f.admin`INSERT INTO internal_agent_config (company_id, model, provider) VALUES (${COMPANY_B}, ${KNOWN_MODEL}, 'anthropic')`;
    for (const [user, company] of [[USER_A, COMPANY], [USER_B, COMPANY_B]] as const) {
      await f.admin`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
        VALUES (${user}, ${user}, ${`${user}@example.test`}, true, now(), now())`;
      await f.admin`INSERT INTO company_memberships (company_id, principal_type, principal_id, status, membership_role)
        VALUES (${company}, 'user', ${user}, 'active', 'owner')`;
    }
  } catch (error) {
    setupError = error;
  }
}, 180_000);

afterAll(async () => {
  await ownerClient?.end().catch(() => {});
  await fixture?.teardown().catch(() => {});
}, 60_000);

beforeEach(async () => {
  if (!fixture) return;
  await fixture.resetRuntimeRows();
  await fixture.admin`DELETE FROM budget_incidents`;
  await fixture.admin`DELETE FROM budget_policies`;
  await fixture.admin`DELETE FROM cost_events`;
  await fixture.admin`DELETE FROM approvals`;
  await fixture.admin`DELETE FROM notifications`;
  await fixture.admin`UPDATE companies SET spent_monthly_cents = 0`;
  await fixture.admin`UPDATE agents SET spent_monthly_cents = 0, status = 'idle'`;
  await fixture.admin`UPDATE agents SET adapter_config = ${fixture.admin.json({ model: UNKNOWN_MODEL })} WHERE id = ${AGENT_A_UNKNOWN}`;
});

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "JOB-016 E3-D-ACC accepted-event seam (embedded PG)",
  () => {
    it("[acc 1 + d] usage-then-terminal in ONE batch prices exactly once (cost > 0) with an applied receipt, and never trips the fence", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const u = usage(fence, 1);
      const result = await accept(fence, [u, terminal(fence, 2)]);

      expect(result.ingest?.status).toBe("accepted");
      expect(result.ingest?.acceptedThroughSeq).toBe(2);
      expect(result.acceptedEventProjections?.map((p) => p.outcome)).toEqual(["applied"]);
      const rows = await f.admin`SELECT id, cost_cents, company_id, source_idempotency_key FROM cost_events`;
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.cost_cents)).toBeGreaterThan(0);
      expect(Number(rows[0]!.cost_cents)).toBe(computeCostCents("claude_local", KNOWN_MODEL, 1_000_000, 1_000_000));
      expect(rows[0]!.company_id).toBe(COMPANY);
      expect(rows[0]!.source_idempotency_key).toBe(`cost:${COMPANY}:${u.eventId}`);
      const receipt = await receiptFor(fence, u.eventId);
      expect(receipt?.status).toBe("applied");
      expect(receipt?.aggregate_kind).toBe("cost_events");
      expect(receipt?.target_aggregate_id).toBe(rows[0]!.id);
      // The terminal projected AFTER the charge, in the same transaction.
      expect(await count("job_attempts", `id = '${fence.attemptId}' AND status = 'succeeded'`)).toBe(1);
    });

    it("[d] cancel-then-terminal in ONE batch does not trip the fence either", async () => {
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const result = await accept(fence, [cancelEv(fence, 1), usage(fence, 2), terminal(fence, 3)]);
      expect(result.ingest?.status).toBe("accepted");
      expect(result.acceptedEventProjections?.map((p) => p.outcome)).toEqual(["applied"]);
      expect(await count("cost_events", "true")).toBe(1);
    });

    it("[acc 2 + d] a replay re-runs nothing: the replayed batch prices nothing, and the wrapper reports `replayed` off the SAME receipt", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const u = usage(fence, 1);
      await accept(fence, [u]);
      const replay = await accept(fence, [u]);
      expect(replay.ingest?.status).toBe("accepted");
      expect(replay.acceptedEventProjections ?? []).toEqual([]);
      expect(await count("cost_events", "true")).toBe(1);

      // The JOB-012 wrapper shares the identity `cost:{company}:{eventId}` → `replayed`, no row.
      const out = await jobBudgetCostBridge(f.app.db, { env: ENABLED_ENV }).priceAcceptedUsage({
        source: taskSource(AGENT_A),
        actor: { kind: "user", id: USER_A, companyId: COMPANY },
        fence,
        acceptedEventId: u.eventId,
        eventDigest: u.recomputedDigest,
        units: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, runtimeMillis: 1 },
      });
      expect(out.status).toBe("replayed");
      expect(await count("cost_events", "true")).toBe(1);
    });

    it("[d] the idempotency comes from the RECEIPT table: a new-tail event whose receipt already exists is `replayed`, not re-charged", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const eventId = randomUUID();
      // Price it through the wrapper first (same identity), then deliver it as a NEW event.
      await jobBudgetCostBridge(f.app.db, { env: ENABLED_ENV }).priceAcceptedUsage({
        source: taskSource(AGENT_A),
        actor: { kind: "user", id: USER_A, companyId: COMPANY },
        fence, acceptedEventId: eventId, eventDigest: "a".repeat(64),
        units: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, runtimeMillis: 1 },
      });
      const result = await accept(fence, [usage(fence, 1, eventId)]);
      expect(result.acceptedEventProjections?.map((p) => p.outcome)).toEqual(["replayed"]);
      expect(await count("cost_events", "true")).toBe(1);
    });

    it("[acc 5] an injected projector failure (unknown-rate model) leaves the append COMMITTED and the receipt `pending`, pointed at the attempt; the detector surfaces it", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A_UNKNOWN));
      const u = usage(fence, 1);
      const result = await accept(fence, [u, terminal(fence, 2)]);

      expect(result.ingest?.status).toBe("accepted");
      expect(result.acceptedEventProjections).toEqual([
        expect.objectContaining({ outcome: "pending", reason: "JOB_BUDGET_COST_RATE", eventId: u.eventId }),
      ]);
      expect(await count("job_events", `attempt_id = '${fence.attemptId}'`)).toBe(2);
      expect(await count("job_attempts", `id = '${fence.attemptId}' AND status = 'succeeded'`)).toBe(1);
      expect(await count("cost_events", "true")).toBe(0);
      const receipt = await receiptFor(fence, u.eventId);
      expect(receipt?.status).toBe("pending");
      expect(receipt?.target_aggregate_id).toBe(fence.attemptId);
      expect(receipt?.aggregate_kind).toBe("job_attempts");

      // The detector surfaces it (per Organization + Company, with kind and ids).
      const warn = vi.fn();
      const sweep = createAuthoritativeCostRedriveSweep({
        appDb: f.app.db,
        notifier: { isNotified: async () => false, notify: async () => {} },
        log: { warn, info: () => {} },
        // Keep the failure persistent so this test observes only the detector.
        redrive: async () => { throw new Error("still unpriceable"); },
        maxAttempts: 100,
        staleAfterMs: 0,
        now: () => new Date(Date.now() + 1_000),
      });
      const swept = await sweep.sweepOrganization(ORG);
      expect(swept.stale).toBe(1);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          classification: "stale_pending_projection_receipt",
          organizationId: ORG, companyId: COMPANY, projectionKind: "authoritative_cost",
          jobId: fence.jobId, attemptId: fence.attemptId, receiptId: receipt!.id,
        }),
        expect.any(String),
      );
    });

    it("[c] a projector's own writes roll back with its savepoint; the append and the pending receipt survive", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const throwing: AcceptedEventProjector = {
        projectionKind: "authoritative_cost",
        aggregateKind: "cost_events",
        sourceIdentity: (event, fenceIn) => event.eventType === "usage" ? `cost:${fenceIn.companyId}:${event.eventId}` : null,
        async apply({ tx }) {
          await tx.execute(
            // A write through the savepoint handle, then a throw: it must NOT survive.
            (await import("drizzle-orm")).sql`INSERT INTO cost_events (company_id, provider, biller, billing_type, model, input_tokens, output_tokens, cost_cents, occurred_at)
              VALUES (${COMPANY}, 'x', 'x', 'unknown', 'x', 0, 0, 999, now())`,
          );
          throw new Error("boom");
        },
      };
      const u = usage(fence, 1);
      const result = await accept(fence, [u, terminal(fence, 2)], [throwing]);
      expect(result.ingest?.status).toBe("accepted");
      expect(result.acceptedEventProjections?.[0]?.outcome).toBe("pending");
      expect(await count("cost_events", "true")).toBe(0);
      expect(await count("job_events", `attempt_id = '${fence.attemptId}'`)).toBe(2);
      expect((await receiptFor(fence, u.eventId))?.status).toBe("pending");
      void f;
    });

    it("[b1 step 2] a usage event AFTER the terminal in the same batch is recorded `pending` (after_terminal), never dropped and never charged", async () => {
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const u = usage(fence, 2);
      const result = await accept(fence, [terminal(fence, 1), u]);
      expect(result.ingest?.status).toBe("accepted");
      expect(result.acceptedEventProjections).toEqual([
        expect.objectContaining({ outcome: "pending", reason: "after_terminal", eventId: u.eventId }),
      ]);
      expect(await count("cost_events", "true")).toBe(0);
      expect((await receiptFor(fence, u.eventId))?.status).toBe("pending");
    });

    it("[acc 3 + Amendment 2] after a Company hard-stop breach a job queued BEFORE the breach is never leased (cancelled, the legacy-equivalent state), and the next submit is refused", async () => {
      const f = guard();
      // J: a real PLACED, leasable job of Company A, queued before the breach.
      const placed = await f.seedPlacedJob(41);
      await seedCompanyHardStop(COMPANY, 1);
      // A different attempt breaches the Company hard stop through a priced usage event.
      const breaching = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      await accept(breaching, [usage(breaching, 1)]);

      expect(await count("budget_incidents", `company_id = '${COMPANY}' AND threshold_type = 'hard_stop'`)).toBe(1);
      expect(await count("jobs", `id = '${placed.jobId}' AND status = 'cancelled'`)).toBe(1);
      expect(await count("job_attempts", `id = '${placed.attemptId}' AND status = 'cancelled'`)).toBe(1);
      // J is not leased: the real poll finds nothing to offer.
      const polled = await f.leasing.poll({ auth: auth("j016-poll"), request: pollRequest("j016-poll") });
      expect(polled.outcome).not.toBe("offer");
      expect(await count("leases", `job_id = '${placed.jobId}'`)).toBe(0);

      // The next dispatch is refused at submit (company-scoped preflight in admitAttemptCapacity).
      const nextJ = await seedQueuedJob(TENANT_A, taskSource(AGENT_A));
      const admission = await admitIn(f, {
        organizationId: ORG, companyId: COMPANY, workloadType: "batch", attemptId: nextJ.attemptId,
        principalId: USER_A, principalKind: "user", cap: 100,
      });
      expect(admission).toMatchObject({ admitted: false, reason: "budget" });
    });

    it("[acc 3 positive control] with NO hard stop, the same queued job stays leasable and IS offered", async () => {
      const f = guard();
      const placed = await f.seedPlacedJob(42);
      const other = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      await accept(other, [usage(other, 1)]);
      expect(await count("jobs", `id = '${placed.jobId}' AND status = 'queued'`)).toBe(1);
      const polled = await f.leasing.poll({ auth: auth("j016-poll-pc"), request: pollRequest("j016-poll-pc") });
      expect(polled.outcome).toBe("offer");
    });

    it("[Codex P2] a savepoint that rolls back AFTER the core ran emits NO budget.exhausted signal (no live work is cancelled for a charge that never committed)", async () => {
      clearBudgetHooks();
      const emitted: BudgetEnforcementScope[] = [];
      onBudgetExhausted((scope) => { emitted.push(scope); });
      // Codex P2 (second round): nor may a `budget.incident_created` live event escape.
      const liveTypes: string[] = [];
      const unsubscribe = subscribeCompanyLiveEvents(COMPANY, (event) => { liveTypes.push(event.type); });
      try {
        await seedCompanyHardStop(COMPANY, 1);
        const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
        const real = createAcceptedUsagePricingProjector();
        const failsLate: AcceptedEventProjector = {
          ...real,
          async apply(ctx) {
            await real.apply(ctx); // the whole core ran: charge, incident, breach
            throw new Error("a later step in the savepoint failed");
          },
        };
        const result = await accept(fence, [usage(fence, 1)], [failsLate]);
        expect(result.acceptedEventProjections?.[0]?.outcome).toBe("pending");
        expect(await count("cost_events", "true")).toBe(0);
        expect(await count("budget_incidents", "true")).toBe(0);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(emitted).toEqual([]);
        expect(liveTypes).not.toContain("budget.incident_created");
      } finally {
        unsubscribe();
        clearBudgetHooks();
      }
    });

    it("[Codex P1] a job whose lease was OFFERED but not yet ACKed at the breach is cancelled, and its ACK is refused (never leased)", async () => {
      const f = guard();
      const placed = await f.seedPlacedJob(43);
      // The worker has polled: an OFFERED lease exists; jobs.status is still `queued`.
      const polled = await f.leasing.poll({ auth: auth("j016-p1-poll"), request: pollRequest("j016-p1-poll") });
      expect(polled.outcome).toBe("offer");
      if (polled.outcome !== "offer") return;
      expect(await count("leases", `job_id = '${placed.jobId}' AND status = 'offered'`)).toBe(1);
      expect(await count("jobs", `id = '${placed.jobId}' AND status = 'queued'`)).toBe(1);

      await seedCompanyHardStop(COMPANY, 1);
      const breaching = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      await accept(breaching, [usage(breaching, 1)]);

      expect(await count("jobs", `id = '${placed.jobId}' AND status = 'cancel_requested'`)).toBe(1);
      expect(await count("job_attempts", `id = '${placed.attemptId}' AND status = 'cancel_requested'`)).toBe(1);
      // The worker's late ACK does not make the attempt leased.
      const acked = await f.leasing.ack({ auth: auth("j016-p1-ack"), request: ackRequest(polled.body) })
        .then((r) => r.outcome, () => "refused");
      expect(acked).not.toBe("acknowledged");
      expect(await count("job_attempts", `id = '${placed.attemptId}' AND status IN ('leased', 'running')`)).toBe(0);
      expect(await count("leases", `job_id = '${placed.jobId}' AND status = 'active'`)).toBe(0);
    });

    it("[acc 7 / F10] two Organizations price side by side; each row carries its own tenant; a hard stop in A refuses only A", async () => {
      const f = guard();
      await seedCompanyHardStop(COMPANY, 1);
      const queuedA = await seedQueuedJob(TENANT_A, taskSource(AGENT_A));
      const queuedB = await seedQueuedJob(TENANT_B, taskSource(AGENT_B));
      const fenceA = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A));
      const fenceB = await seedLeasedAttempt(TENANT_B, taskSource(AGENT_B));
      const uA = usage(fenceA, 1);
      const uB = usage(fenceB, 1);
      await accept(fenceA, [uA, terminal(fenceA, 2)]);
      await accept(fenceB, [uB, terminal(fenceB, 2)]);

      const rows = await f.admin`SELECT company_id, source_idempotency_key, cost_cents FROM cost_events ORDER BY company_id`;
      expect(rows.map((r) => r.company_id).sort()).toEqual([COMPANY, COMPANY_B].sort());
      expect(rows.find((r) => r.company_id === COMPANY)!.source_idempotency_key).toBe(`cost:${COMPANY}:${uA.eventId}`);
      expect(rows.find((r) => r.company_id === COMPANY_B)!.source_idempotency_key).toBe(`cost:${COMPANY_B}:${uB.eventId}`);
      const rA = await receiptFor(fenceA, uA.eventId);
      const rB = await receiptFor(fenceB, uB.eventId);
      expect([rA?.organization_id, rA?.company_id, rA?.status]).toEqual([ORG, COMPANY, "applied"]);
      expect([rB?.organization_id, rB?.company_id, rB?.status]).toEqual([ORG_B, COMPANY_B, "applied"]);
      // Budget evaluation is per tenant: only A has an incident.
      expect(await count("budget_incidents", `company_id = '${COMPANY}'`)).toBe(1);
      expect(await count("budget_incidents", `company_id = '${COMPANY_B}'`)).toBe(0);
      // The hard stop in A cancels A's queued job and NOT B's.
      expect(await count("jobs", `id = '${queuedA.jobId}' AND status = 'cancelled'`)).toBe(1);
      expect(await count("jobs", `id = '${queuedB.jobId}' AND status = 'queued'`)).toBe(1);
      // Next dispatch: A refused, B admitted (the positive control for the refusal).
      const nextA = await seedQueuedJob(TENANT_A, taskSource(AGENT_A));
      const nextB = await seedQueuedJob(TENANT_B, taskSource(AGENT_B));
      const admitA = await admitIn(f, {
        organizationId: ORG, companyId: COMPANY, workloadType: "batch", attemptId: nextA.attemptId,
        principalId: USER_A, principalKind: "user", cap: 100,
      });
      const admitB = await admitIn(f, {
        organizationId: ORG_B, companyId: COMPANY_B, workloadType: "batch", attemptId: nextB.attemptId,
        principalId: USER_B, principalKind: "user", cap: 100,
      });
      expect(admitA).toMatchObject({ admitted: false, reason: "budget" });
      expect(admitB).toMatchObject({ admitted: true });
    });

    it("[F10] the core refuses to charge a Company the Organization does not own (no cost row written)", async () => {
      const f = guard();
      const fenceB = await seedLeasedAttempt(TENANT_B, taskSource(AGENT_B));
      await expect(runInTenant(f.app.db, ORG_B, (repos, tx) => priceAcceptedUsageCore({ tx, repos }, {
        source: taskSource(AGENT_A),
        organizationId: ORG_B,
        companyId: COMPANY, // Organization A's Company
        jobId: fenceB.jobId,
        acceptedEventId: randomUUID(),
        units: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, runtimeMillis: 1 },
      }))).rejects.toBeInstanceOf(JobBudgetCostTenantError);
      expect(await count("cost_events", "true")).toBe(0);

      // Nor can Organization B's attempt borrow Organization A's agent as its rate source: the
      // model lookup is scoped to the charge's own Company, so it fails closed → `pending`.
      const borrowing = await seedLeasedAttempt(TENANT_B, taskSource(AGENT_A));
      const bu = usage(borrowing, 1);
      const out = await accept(borrowing, [bu]);
      expect(out.acceptedEventProjections).toEqual([
        expect.objectContaining({ outcome: "pending", reason: "JOB_BUDGET_COST_RATE" }),
      ]);
      expect(await count("cost_events", "true")).toBe(0);
    });

    it("[acc 6a] a pending cost receipt BLOCKS the drain; re-driven to applied, the SAME drain proceeds", async () => {
      const f = guard();
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A_UNKNOWN));
      const u = usage(fence, 1);
      await accept(fence, [u]); // the attempt stays live, so the drain has something to cancel
      const receipt = await receiptFor(fence, u.eventId);
      expect(receipt?.status).toBe("pending");

      const store = createDistributedExecutionDrainStore(f.app.db, f.operator.db);
      const bridge = jobBudgetCostBridge(f.app.db, { env: ENABLED_ENV });
      const requestCancellation = vi.fn(async () => ({ status: "queued" as const, command: null }));
      const drain = createDistributedExecutionDrain({
        listAdmittedOrganizationIds: async ({ afterOrganizationId }) => afterOrganizationId === null ? [ORG] : [],
        listOrganizationCompanyIds: (organizationId) => store.listOrganizationCompanyIds(organizationId),
        listActiveAttempts: (organizationId) => store.listActiveAttempts(organizationId),
        requestCancellation,
        assertRollbackSafe: (companyId) => bridge.assertRollbackSafe(companyId),
      });
      // The JOB-012 wrapper's fast path reads the receipt STATUS: an owed charge is `pending`,
      // never `replayed` with the attempt id passed off as a cost row.
      const viaWrapper = await bridge.priceAcceptedUsage({
        source: taskSource(AGENT_A_UNKNOWN),
        actor: { kind: "user", id: USER_A, companyId: COMPANY },
        fence, acceptedEventId: u.eventId, eventDigest: u.recomputedDigest,
        units: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, runtimeMillis: 1 },
      });
      expect(viaWrapper).toMatchObject({ status: "pending", costEventId: null, receiptId: receipt!.id });

      const blocked = await drain.drainAll();
      expect(blocked.skippedOrganizations).toEqual([ORG]);
      expect(blocked.perOrganization[0]).toMatchObject({ skipped: true, reason: "rollback_pending" });
      expect(requestCancellation).not.toHaveBeenCalled();

      // Fix the cause (the agent's model becomes a known rate) and re-drive.
      await f.admin`UPDATE agents SET adapter_config = ${f.admin.json({ model: KNOWN_MODEL })} WHERE id = ${AGENT_A_UNKNOWN}`;
      const redriven = await redrivePendingAuthoritativeCost(f.app.db, { organizationId: ORG, receiptId: receipt!.id });
      expect(redriven.status).toBe("redriven");
      const after = await receiptFor(fence, u.eventId);
      expect(after?.status).toBe("applied");
      expect(after?.aggregate_kind).toBe("cost_events");
      const [cost] = await f.admin`SELECT id, cost_cents FROM cost_events`;
      expect(after?.target_aggregate_id).toBe(cost!.id);
      expect(Number(cost!.cost_cents)).toBeGreaterThan(0);
      // A second re-drive of the same receipt is a no-op (compare-and-set on `pending`).
      expect((await redrivePendingAuthoritativeCost(f.app.db, { organizationId: ORG, receiptId: receipt!.id })).status).toBe("not_pending");
      expect(await count("cost_events", "true")).toBe(1);

      const proceeded = await drain.drainAll();
      expect(proceeded.skippedOrganizations).toEqual([]);
      expect(requestCancellation).toHaveBeenCalled();
    });

    it("[Amendment 3] a PERSISTENT failure stops at the bound and raises EXACTLY ONE Inbox item, durably (a restarted sweep neither retries nor re-raises)", async () => {
      const f = guard();
      await f.admin`DELETE FROM notifications WHERE source_type = ${STUCK_CHARGE_HUB_SOURCE_TYPE}`;
      const fence = await seedLeasedAttempt(TENANT_A, taskSource(AGENT_A_UNKNOWN));
      const u = usage(fence, 1);
      await accept(fence, [u, terminal(fence, 2)]);
      const receipt = await receiptFor(fence, u.eventId);
      expect(receipt?.status).toBe("pending");

      let redriveCalls = 0;
      const countingRedrive: typeof redrivePendingAuthoritativeCost = async (db, input) => {
        redriveCalls += 1;
        return redrivePendingAuthoritativeCost(db, input);
      };
      const outcomes: AcceptedUsageOutcome[] = [];
      const makeSweep = () => createAuthoritativeCostRedriveSweep({
        appDb: f.app.db,
        notifier: createHubStuckChargeNotifier(ownerDb()),
        log: { warn: () => {}, info: () => {} },
        telemetry: { count: ({ outcome }) => { outcomes.push(outcome); } },
        maxAttempts: 3,
        staleAfterMs: 0,
        now: () => new Date(Date.now() + 1_000),
        redrive: countingRedrive,
      });
      const sweep = makeSweep();
      for (let tick = 0; tick < 6; tick += 1) await sweep.sweepOrganization(ORG);
      expect(redriveCalls).toBe(3);
      expect(await count("notifications", `source_type = '${STUCK_CHARGE_HUB_SOURCE_TYPE}' AND source_id = '${receipt!.id}'`)).toBe(1);
      expect(outcomes.filter((o) => o === "redrive_exhausted")).toHaveLength(1);

      // A "restarted" process: a fresh sweep (fresh in-memory counters) must not retry or re-raise.
      const restarted = makeSweep();
      for (let tick = 0; tick < 3; tick += 1) await restarted.sweepOrganization(ORG);
      expect(redriveCalls).toBe(3);
      expect(await count("notifications", `source_type = '${STUCK_CHARGE_HUB_SOURCE_TYPE}'`)).toBe(1);
      expect((await receiptFor(fence, u.eventId))?.status).toBe("pending");
    });
  },
);

// -------------------------------------------------------------------------------------------
// The PRODUCTION composition: the real poll → ack → ingest path registers pricing with no switch.

function wireEvent(offer: LeaseOfferV1, seq: number, eventType: string, payload: Record<string, unknown>) {
  const base = {
    protocolVersion: 1,
    eventId: randomUUID(),
    organizationId: ORG,
    companyId: COMPANY,
    workerId: WORKER,
    jobId: offer.job.jobId,
    attempt: offer.job.attempt,
    leaseId: offer.leaseId,
    fenceToken: offer.fenceToken,
    seq,
    occurredAt: new Date().toISOString(),
    extensions: [] as unknown[],
    eventType,
    payload,
  };
  return { ...base, eventDigest: sha256(canonicalEventDigestInputV1(base as never)) };
}

function batchRequest(offer: LeaseOfferV1, events: Record<string, unknown>[]): EventUploadOperationRequestV1 {
  return {
    protocolVersion: 1,
    correlationId: randomUUID(),
    issuedAt: new Date().toISOString(),
    nonce: `ev-${randomUUID()}`,
    audience: "worker_run",
    idempotencyKey: randomUUID(),
    body: {
      protocolVersion: 1, organizationId: ORG, companyId: COMPANY, workerId: WORKER,
      jobId: offer.job.jobId, attempt: offer.job.attempt, leaseId: offer.leaseId,
      fenceToken: offer.fenceToken, events,
    },
  } as unknown as EventUploadOperationRequestV1;
}

describe.skipIf(process.platform === "win32" && process.env.AOA_RUN_WIN_INTEGRATION !== "1")(
  "JOB-016 production ingest composition (embedded PG)",
  () => {
    it("[acc 1 / acc 8 target] the REAL ingest prices a handed-off run: exactly one cost row with cost > 0 and one applied receipt", async () => {
      const f = guard();
      const { offer } = await f.activateLease(51);
      const outcomes: AcceptedUsageOutcome[] = [];
      const ingest = createJobEventIngestService({
        appDb: f.app.db,
        acceptedUsageTelemetry: { count: ({ outcome }) => { outcomes.push(outcome); } },
      });
      const events = [
        wireEvent(offer, 1, "attempt_started", { sandboxId: "sbx-j016" }),
        wireEvent(offer, 2, "usage", { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0, runtimeMillis: 42 }),
        wireEvent(offer, 3, "terminal", { status: "succeeded", exitCode: 0, errorCode: null, errorMessage: null }),
      ];
      const response = await ingest.ingest({ auth: auth("j016-ev-1"), request: batchRequest(offer, events) });
      expect(response.ack.status).toBe("accepted");
      expect(response.ack.acceptedThroughSeq).toBe(3);
      const rows = await f.admin`SELECT id, cost_cents FROM cost_events WHERE company_id = ${COMPANY}`;
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.cost_cents)).toBeGreaterThan(0);
      expect(await count("job_projection_receipts",
        `projection_kind = 'authoritative_cost' AND status = 'applied' AND target_aggregate_id = '${rows[0]!.id}'`)).toBe(1);
      expect(outcomes).toContain("priced");
      expect(outcomes).not.toContain("terminal_without_usage");
    });

    it("[Codex P2] a committed breach through the REAL ingest emits budget.exhausted exactly once, AFTER commit", async () => {
      const f = guard();
      const { offer } = await f.activateLease(53);
      await seedCompanyHardStop(COMPANY, 1);
      clearBudgetHooks();
      const seen: { scope: BudgetEnforcementScope; costRowsVisible: Promise<number> }[] = [];
      // The listener reads the ledger on a SEPARATE connection: a pre-commit emit would see 0.
      onBudgetExhausted((scope) => { seen.push({ scope, costRowsVisible: count("cost_events", "true") }); });
      try {
        const ingest = createJobEventIngestService({ appDb: f.app.db });
        const events = [
          wireEvent(offer, 1, "attempt_started", { sandboxId: "sbx-j016c" }),
          wireEvent(offer, 2, "usage", { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 0, runtimeMillis: 1 }),
        ];
        const response = await ingest.ingest({ auth: auth("j016-ev-3"), request: batchRequest(offer, events) });
        expect(response.ack.status).toBe("accepted");
        expect(seen.map((entry) => entry.scope)).toEqual([
          { companyId: COMPANY, scopeType: "company", scopeId: COMPANY },
        ]);
        expect(await seen[0]!.costRowsVisible).toBe(1);
      } finally {
        clearBudgetHooks();
      }
    });

    it("[acc 4] a terminal with NO usage event emits the classified terminal_without_usage signal (log + count)", async () => {
      const f = guard();
      const { offer, seeded } = await f.activateLease(52);
      const outcomes: AcceptedUsageOutcome[] = [];
      const warn = vi.spyOn(logger, "warn");
      try {
        const ingest = createJobEventIngestService({
          appDb: f.app.db,
          acceptedUsageTelemetry: { count: ({ outcome }) => { outcomes.push(outcome); } },
        });
        const events = [
          wireEvent(offer, 1, "attempt_started", { sandboxId: "sbx-j016b" }),
          wireEvent(offer, 2, "terminal", { status: "succeeded", exitCode: 0, errorCode: null, errorMessage: null }),
        ];
        const response = await ingest.ingest({ auth: auth("j016-ev-2"), request: batchRequest(offer, events) });
        expect(response.ack.status).toBe("accepted");
        expect(outcomes).toEqual(["terminal_without_usage"]);
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({
            classification: "terminal_without_usage",
            organizationId: ORG, companyId: COMPANY, jobId: offer.job.jobId,
            attemptId: seeded.attemptId, terminalStatus: "succeeded", sourceKind: "one_shot",
          }),
          expect.any(String),
        );
        expect(await count("cost_events", "true")).toBe(0);
      } finally {
        warn.mockRestore();
      }
    });
  },
);
