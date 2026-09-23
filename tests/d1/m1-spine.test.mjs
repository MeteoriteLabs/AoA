// -----------------------------------------------------------------------------
// DEP-016 — the `m1-spine` campaign profile (LIVE; Linux/CI ONLY — Docker + the D1 stack brought
// up WITH the one-worker override). The harness the M1-D1-SPINE gate record is produced from.
//
//   docker compose -f docker-compose.d1.yml -f docker/d1/m1-spine.override.yml up -d --wait
//   AOA_D1_LIVE=1 AOA_D1_CAMPAIGN=m1-spine node --test --test-concurrency=1 tests/d1/m1-spine.test.mjs
//
// Without AOA_D1_LIVE=1 every case SKIPS (never faked). With AOA_D1_LIVE=1 but a campaign other
// than `m1-spine` it REFUSES to run: the tenant set only exists in the override's environment, so
// running this against the two-worker train would fail for a reason that says nothing.
//
// ── What it proves ───────────────────────────────────────────────────────────
//   1. F10: every control-plane replica carries the SAME per-Organization rollout — two enabled
//      Organizations (`canary`) and a control Organization that is absent — read through the
//      server's OWN rollout source from each replica's environment; the deployment-wide crew
//      switch is unset or false on every replica (M1 plan §6, S0-8).
//   2. Per ENABLED tenant: a handed-off attempt (enroll → poll → lease → ack → execute on the
//      reference provider → attempt_started, usage, terminal uploaded through the REAL fenced
//      `/worker-control/events` ingest) writes EXACTLY ONE `cost_events` row with cost > 0,
//      attributed to that tenant's own Company; ONE applied `authoritative_cost` receipt (JOB-016);
//      and the JOB-017 audit rows `job.attempt_started` + `job.attempt_terminal`, with their
//      applied `activity_audit` receipts.
//   3. The CONTROL tenant is refused: the REAL placement service, composed on EACH replica as
//      `server/src/index.ts` composes it, decides `legacy` / `organization_disabled` for its
//      attempt; the SAME service on an enabled tenant reaches a non-legacy decision (the positive
//      control that makes the refusal the rollout's and not a broken placement path); its worker
//      is offered no work; it has no events, cost rows, receipts or leases.
//
// ── The usage (and its positive control) ─────────────────────────────────────
// The reference provider reports canned usage from `execute` (DEP-016, FAKE_PROVIDER_CANNED_USAGE_V1
// in packages/sandbox-fake-provider). The harness plays the worker, as every E6F suite does: it
// forwards the provider's usage as a `usage` event, and forwards NOTHING when the provider reports
// none. With AOA_M1_SPINE_USAGE_MODE=suppressed the provider id is scripted `usageMode:
// "suppressed"`, execute reports `usage: null`, and the cost assertion MUST go red — the workflow
// runs exactly that and fails the lane if it does not. Nothing else in this file branches on the
// mode.
//
// ── Evidence ─────────────────────────────────────────────────────────────────
// With AOA_M1_SPINE_EVIDENCE_DIR set, an `m1-spine-evidence.json` is written there after the run
// — pass OR fail — with the per-replica rollout digests, and per tenant the ids, the event types,
// the cost rows, the receipts and the audit rows the verdicts were computed from.
// -----------------------------------------------------------------------------

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  SKIP,
  LIVE,
  FAKE_PROVIDER_API_URL,
  FAKE_PROVIDER_CTL_URL,
  newScenarioIds,
  generateDeviceKey,
  newEnrollmentCode,
  buildWorkerHello,
  stampWorkerLiveness,
  enroll,
  poll,
  ack,
  containerFetch,
  computeEventDigests,
  queryJobEventsAsApp,
  uploadEvents,
  seedSpineOrganization,
  seedSpineTarget,
  seedSpineJob,
  probeReplicaRollout,
  placeSpineAttemptOnReplica,
  querySpineAttempt,
  querySpineControl,
  runDistributedDrainCli,
  queryDrainAudit,
  queryDrainCandidates,
  // DEP-019 — the worker-driven half: the harness DISPATCHES and ASSERTS; the deployed worker runs it.
  SPINE_DEPLOYED_TARGET_ID,
  queryDeployedWorker,
  seedSpineWorkerDrivenJob,
  querySpineWorkerDriven,
  awaitSpineWorkerDrivenTerminal,
  queryForeignPlacementOnDeployedTarget,
} from "./lib/e6f-harness.mjs";
import {
  M1_SPINE_TENANTS,
  M1_SPINE_AGENT_MODEL,
  M1_SPINE_AGENT_ADAPTER_TYPE,
  M1_SPINE_WORKLOAD,
  M1_SPINE_CONTROL_PLANE_REPLICAS,
  M1_SPINE_CANARY_TARGET_SLUG,
  evaluateReplicaRollout,
  evaluateEnabledTenantSpine,
  evaluateControlTenant,
  evaluateCrossTenantIsolation,
  evaluateEnvProbeObservability,
  evaluateRollbackRehearsal,
  // DEP-019
  M1_SPINE_WORKER_DRIVEN_TENANT_KEY,
  M1_SPINE_EXECUTOR_MODES,
  evaluateWorkerDrivenJourney,
  evaluateSpineEnvProbe,
  formatViolations,
} from "../../scripts/lib/m1-spine-assertions.mjs";

const CAMPAIGN = process.env.AOA_D1_CAMPAIGN ?? "";
const USAGE_MODE = process.env.AOA_M1_SPINE_USAGE_MODE ?? "canned";
/** The provider reports no usage only in `suppressed`; `duplicate` keeps the canned units and makes
 * the WORKER send a SECOND, distinct usage event for the same attempt. */
const PROVIDER_USAGE_MODE = USAGE_MODE === "suppressed" ? "suppressed" : "canned";
const EVIDENCE_DIR = process.env.AOA_M1_SPINE_EVIDENCE_DIR ?? "";
const FIXTURE_ID = "batch-success";

if (LIVE && CAMPAIGN !== "m1-spine") {
  throw new Error(
    `tests/d1/m1-spine.test.mjs needs AOA_D1_CAMPAIGN=m1-spine and the one-worker override ` +
      `(docker/d1/m1-spine.override.yml); got AOA_D1_CAMPAIGN=${JSON.stringify(CAMPAIGN)}`,
  );
}
/** DEP-019 — `worker` (the claim) or `harness` (the NOT-THE-EXECUTOR control, which must RED). */
const EXECUTOR = process.env.AOA_M1_SPINE_EXECUTOR ?? "worker";
if (!M1_SPINE_EXECUTOR_MODES.includes(EXECUTOR)) {
  throw new Error(`AOA_M1_SPINE_EXECUTOR must be ${M1_SPINE_EXECUTOR_MODES.join(" or ")}, got ${JSON.stringify(EXECUTOR)}`);
}
if (!["canned", "suppressed", "duplicate"].includes(USAGE_MODE)) {
  throw new Error(`AOA_M1_SPINE_USAGE_MODE must be canned, suppressed or duplicate, got ${JSON.stringify(USAGE_MODE)}`);
}

const evidence = {
  profile: "m1-spine",
  ticket: "DEP-016",
  usageMode: USAGE_MODE,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  tenants: {
    enabled: M1_SPINE_TENANTS.enabled.map((t) => ({ key: t.key, organizationId: t.organizationId, companyId: t.companyId })),
    control: { key: M1_SPINE_TENANTS.control.key, organizationId: M1_SPINE_TENANTS.control.organizationId, companyId: M1_SPINE_TENANTS.control.companyId },
  },
  executor: EXECUTOR,
  replicas: {},
  enabled: {},
  workerDriven: null,
  workerDrivenIsolation: null,
  control: null,
  verdicts: {},
};

after(() => {
  if (!EVIDENCE_DIR) return;
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, "m1-spine-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
});

/** Each enabled tenant's leased-worker context, kept for the hostile cross-tenant case below. */
const leased = new Map();

function truncate(value, max = 6000) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}… [+${text.length - max} chars]` : text;
}

/** Parse a step's __E6F_RESULT__ or fail with the raw container output. */
function step(res, label) {
  assert.ok(
    res.result !== null && res.result !== undefined,
    `${label}: no result parsed (exit=${res.status}${res.error ? ` error=${res.error}` : ""})\n` +
      `--- stdout ---\n${truncate(res.stdout)}\n--- stderr ---\n${truncate(res.stderr, 3000)}`,
  );
  return res.result;
}

function makeEvent(ids, tenant, offer, { eventType, seq, payload }) {
  return {
    protocolVersion: 1,
    eventId: randomUUID(),
    organizationId: tenant.organizationId,
    companyId: tenant.companyId,
    workerId: ids.workerId,
    jobId: ids.jobId,
    attempt: offer.job.attempt,
    leaseId: offer.leaseId,
    fenceToken: offer.fenceToken,
    seq,
    occurredAt: new Date().toISOString(),
    extensions: [],
    eventType,
    payload,
  };
}

/** The delivery identity every batch repeats (workerEventBatchV1 requires it on the batch too). */
function batchIdentity(ids, tenant, offer) {
  return {
    protocolVersion: 1,
    organizationId: tenant.organizationId,
    companyId: tenant.companyId,
    workerId: ids.workerId,
    jobId: ids.jobId,
    attempt: offer.job.attempt,
    leaseId: offer.leaseId,
    fenceToken: offer.fenceToken,
  };
}

/** Enroll a fresh worker for `tenant` against its per-run target and stamp liveness. */
function enrollWorker(tenant, ids, { canarySlug = false } = {}) {
  const deviceKey = generateDeviceKey();
  const code = newEnrollmentCode();
  // Only the tenant's JOURNEY target carries the canary slug: `execution_targets` is unique on
  // (organization_id, slug), and that slug is what the production credential binding routes to, so
  // exactly one target per tenant per run may hold it. Every other target in the run (the isolation
  // case's, the control tenant's) keeps its ordinary per-run slug.
  const target = step(seedSpineTarget({
    tenant, slug: ids.slug, targetId: ids.targetId, code,
    ...(canarySlug ? { targetSlug: M1_SPINE_CANARY_TARGET_SLUG } : {}),
  }), `${tenant.key} target`);
  assert.equal(target.ok, true, `${tenant.key} target seed: ${truncate(target)}`);
  const enrolled = step(
    enroll({ code: code.code, hello: buildWorkerHello({ workerId: ids.workerId, targetId: ids.targetId }), deviceKey }),
    `${tenant.key} enroll`,
  );
  assert.equal(enrolled.status, 200, `${tenant.key} enroll: ${truncate(enrolled.body)}`);
  assert.ok(typeof enrolled.session === "string" && enrolled.session.length > 0, `${tenant.key} enroll returns a session`);
  const live = step(stampWorkerLiveness({ workerId: ids.workerId, targetId: ids.targetId }), `${tenant.key} liveness`);
  assert.equal(live.workerUpdated, 1, `${tenant.key} liveness: ${truncate(live)}`);
  return { deviceKey, session: enrolled.session, target };
}

// ── 1. every replica: the tenant set and the crew switch ─────────────────────

test("m1-spine: every control-plane replica carries the F10 tenant set, and the crew switch is off", { skip: SKIP }, () => {
  const organizationIds = [
    ...M1_SPINE_TENANTS.enabled.map((t) => t.organizationId),
    M1_SPINE_TENANTS.control.organizationId,
  ];
  const violations = [];
  for (const replica of M1_SPINE_CONTROL_PLANE_REPLICAS) {
    const probe = step(probeReplicaRollout({ replica, organizationIds, workloadType: M1_SPINE_WORKLOAD }), `${replica} rollout probe`);
    assert.equal(probe.ok, true, `${replica} rollout probe: ${truncate(probe)}`);
    evidence.replicas[replica] = {
      deploymentMode: probe.deploymentMode,
      deploymentEnabled: probe.deploymentEnabled,
      rolloutSha256: probe.rolloutSha256,
      rolloutRaw: probe.rolloutRaw,
      resolved: probe.resolved,
      crewRaw: probe.crewRaw,
      crewEnabled: probe.crewEnabled,
      toolSurfaceRaw: probe.toolSurfaceRaw,
      toolSurfaceArmed: probe.toolSurfaceArmed,
      organizationToolSurface: probe.organizationToolSurface,
    };
    violations.push(...evaluateReplicaRollout({ replica, ...probe }));
  }
  const digests = new Set(Object.values(evidence.replicas).map((r) => r.rolloutSha256));
  if (digests.size !== 1) violations.push({ code: "rollout:replicas_disagree", message: `rollout digests ${[...digests].join(", ")}` });
  evidence.verdicts.replicas = violations;
  assert.deepEqual(violations, [], `replica rollout violations:\n${formatViolations(violations)}`);
});

// ── 2. per enabled tenant: journey + cost + audit ────────────────────────────

for (const tenant of M1_SPINE_TENANTS.enabled) {
  test(`m1-spine: tenant ${tenant.key} — a handed-off attempt through the REAL ingest is priced once and audited`, { skip: SKIP }, () => {
    const ids = { ...newScenarioIds(), issueId: randomUUID(), runId: randomUUID() };
    const record = { jobId: ids.jobId, attemptId: ids.attemptId, workerId: ids.workerId, targetId: ids.targetId };
    evidence.enabled[tenant.key] = record;

    const org = step(seedSpineOrganization({ tenant, model: M1_SPINE_AGENT_MODEL, adapterType: M1_SPINE_AGENT_ADAPTER_TYPE }), `${tenant.key} org`);
    assert.equal(org.ok, true, `${tenant.key} org seed: ${truncate(org)}`);
    assert.equal(org.agentModel, M1_SPINE_AGENT_MODEL, `${tenant.key} agent model`);
    assert.equal(org.agentAdapterType, M1_SPINE_AGENT_ADAPTER_TYPE, `${tenant.key} agent adapter type`);
    const worker = enrollWorker(tenant, ids, { canarySlug: true });
    const job = step(seedSpineJob({
      tenant,
      issueId: ids.issueId,
      runId: ids.runId,
      jobId: ids.jobId,
      attemptId: ids.attemptId,
      placement: { targetId: ids.targetId, registeredProfileHash: worker.target.registeredProfileHash, providerDigest: worker.target.providerDigest },
    }), `${tenant.key} job`);
    assert.equal(job.ok, true, `${tenant.key} job seed: ${truncate(job)}`);

    // poll → lease → ack, as the tenant's own worker.
    const polled = step(poll({ session: worker.session, workerId: ids.workerId, targetId: ids.targetId, deviceKey: worker.deviceKey }), `${tenant.key} poll`);
    assert.equal(polled.status, 200, `${tenant.key} poll: ${truncate(polled.body)}`);
    assert.equal(polled.body.outcome, "offer", `${tenant.key} must be offered its own job: ${truncate(polled.body)}`);
    const offer = polled.body.body;
    assert.equal(offer.job.jobId, ids.jobId, `${tenant.key} offer names its own job`);
    record.leaseId = offer.leaseId;
    const acked = step(ack({
      session: worker.session, workerId: ids.workerId, jobId: ids.jobId, attempt: offer.job.attempt,
      leaseId: offer.leaseId, fenceToken: offer.fenceToken, deviceKey: worker.deviceKey,
    }), `${tenant.key} ack`);
    assert.equal(acked.status, 200, `${tenant.key} ack: ${truncate(acked.body)}`);
    assert.equal(acked.body.outcome, "acknowledged", `${tenant.key} ack outcome: ${truncate(acked.body)}`);

    // execute on the reference provider; its usage (or none) is what the worker forwards.
    const providerId = `m1s-${tenant.key.toLowerCase()}-${ids.slug}`;
    const scripted = step(containerFetch("test-runner", {
      url: `${FAKE_PROVIDER_CTL_URL}/script`, method: "POST",
      body: { providerId, fixtureId: FIXTURE_ID, usageMode: PROVIDER_USAGE_MODE },
    }), `${tenant.key} fake script`);
    assert.equal(scripted.status, 200, `${tenant.key} fake /script: ${truncate(scripted.body)}`);
    const created = step(containerFetch("test-runner", {
      url: `${FAKE_PROVIDER_API_URL}/invoke`, method: "POST", body: { providerId, op: "create", args: {} },
    }), `${tenant.key} fake create`);
    assert.equal(created.status, 200, `${tenant.key} fake create: ${truncate(created.body)}`);
    const resourceId = created.body.result.resource.resourceId;
    const executed = step(containerFetch("test-runner", {
      url: `${FAKE_PROVIDER_API_URL}/invoke`, method: "POST", body: { providerId, op: "execute", args: { resourceId } },
    }), `${tenant.key} fake execute`);
    assert.equal(executed.status, 200, `${tenant.key} fake execute: ${truncate(executed.body)}`);
    const usage = executed.body.result.usage ?? null;
    record.providerUsage = usage;

    const events = [makeEvent(ids, tenant, offer, { eventType: "attempt_started", seq: 1, payload: { sandboxId: resourceId } })];
    if (usage !== null) events.push(makeEvent(ids, tenant, offer, { eventType: "usage", seq: 2, payload: usage }));
    if (usage !== null && USAGE_MODE === "duplicate") {
      // POSITIVE CONTROL for the cardinality arm (WRK-018 acceptance 1). A DISTINCT event id
      // carrying the same units — the case a stored `usage_json` row cannot be told apart from,
      // and the one the ingest's own replay guard does NOT catch (that guard keys on the event id).
      events.push(makeEvent(ids, tenant, offer, { eventType: "usage", seq: 3, payload: usage }));
    }
    events.push(makeEvent(ids, tenant, offer, {
      eventType: "terminal", seq: events.length + 1,
      payload: { status: "succeeded", exitCode: 0, errorCode: null, errorMessage: null },
    }));
    const digested = step(computeEventDigests({ events }), `${tenant.key} digests`);
    assert.equal(digested.ok, true, `${tenant.key} digests: ${truncate(digested)}`);
    const uploaded = step(uploadEvents({
      session: worker.session,
      deviceKey: worker.deviceKey,
      batch: { ...batchIdentity(ids, tenant, offer), events: digested.events },
    }), `${tenant.key} events`);
    assert.equal(uploaded.status, 200, `${tenant.key} event upload: ${truncate(uploaded.body)}`);
    assert.equal(uploaded.body.ack.status, "accepted", `${tenant.key} events accepted: ${truncate(uploaded.body)}`);
    assert.equal(uploaded.body.ack.acceptedThroughSeq, events.length, `${tenant.key} accepted through the last seq`);

    // What the server wrote, and the verdict on it.
    const rows = step(querySpineAttempt({ organizationId: tenant.organizationId, jobId: ids.jobId }), `${tenant.key} rows`);
    assert.equal(rows.ok, true, `${tenant.key} row probe: ${truncate(rows)}`);
    Object.assign(record, {
      attemptStatus: rows.attemptStatus,
      events: rows.events,
      usageEvents: rows.usageEvents,
      costRows: rows.costRows,
      receipts: rows.receipts,
      activity: rows.activity,
    });
    leased.set(tenant.key, { ids, offer, session: worker.session, deviceKey: worker.deviceKey, target: worker.target });

    // Acceptance 6 (DEP-017 carried in), second fork: this lane CANNOT observe the env probe — its
    // workers do not dispatch and the reference provider runs no command — so the profile records
    // that, and asserts the attempt carries no probe summary. If that ever stops being true, this
    // reds and the record must be rewritten rather than quietly inheriting a pass.
    record.criterion5EnvProbe = {
      observed: false,
      reason: "the m1-spine lane runs the reference provider, which executes no command, and its workers do not dispatch; criterion 5 is observed in the DEP-015 shipped-boot lane only",
      logMessages: rows.logMessages.length,
    };
    const probeViolations = evaluateEnvProbeObservability({ declaredObserved: false, logMessages: rows.logMessages });
    evidence.verdicts[`${tenant.key}:criterion5`] = probeViolations;
    assert.deepEqual(probeViolations, [], `tenant ${tenant.key} criterion-5 violations:
${formatViolations(probeViolations)}`);

    const violations = evaluateEnabledTenantSpine({
      tenant,
      observation: {
        attemptStatus: rows.attemptStatus,
        events: rows.events,
        usageEvents: rows.usageEvents,
        expectedUnits: usage,
        costRows: rows.costRows,
        costReceipts: rows.receipts.filter((r) => r.projectionKind === "authoritative_cost"),
        activity: rows.activity,
        expectedActorId: `worker:${ids.workerId}`,
        auditReceipts: rows.receipts.filter((r) => r.projectionKind === "activity_audit"),
      },
    });
    evidence.verdicts[tenant.key] = violations;
    assert.deepEqual(violations, [], `tenant ${tenant.key} spine violations:\n${formatViolations(violations)}`);
  });
}

// ── 2b. DEP-019: the journey performed by the DEPLOYED worker ────────────────
//
// `M1-D1-SPINE` requires the included lifecycle on "one control-plane instance, ONE SEPARATELY
// DEPLOYED WORKER". Everything above satisfies that as a TOPOLOGY: a deployed worker exists while
// this harness performs the journey. This case is the JOURNEY claim — the harness only DISPATCHES
// (seeds a job placed on the deployed worker's own target, with the one secret handle the run
// capability rides) and then ASSERTS what that worker wrote.
//
// ONE deployed worker means ONE worker-driven tenant, and it is the first enabled Organization.
// Tenant B's journey above stays harness-driven with every F10 property still asserted, and the
// deployed worker being offered NO work for B or for the control tenant is itself a cross-tenant
// case (§2c) with A's own offer as its positive control.
//
// AOA_M1_SPINE_EXECUTOR:
//   `worker`  (default) — the claim: the deployed worker drives it.
//   `harness` — THE NOT-THE-EXECUTOR CONTROL. The same seeded job is driven by a harness-minted
//               worker instead, and `evaluateWorkerDrivenJourney` MUST go red. The lane runs it
//               and fails if it passes; without that, "worker-driven" is claimable vacuously.

test("m1-spine: the DEPLOYED worker performs tenant A's journey — lease, execute, events, terminal", { skip: SKIP || EXECUTOR !== "worker" }, () => {
  const tenant = M1_SPINE_TENANTS.enabled.find((t) => t.key === M1_SPINE_WORKER_DRIVEN_TENANT_KEY);
  assert.ok(tenant, `the worker-driven tenant ${M1_SPINE_WORKER_DRIVEN_TENANT_KEY} is not in the enabled set`);

  const org = step(seedSpineOrganization({ tenant, model: M1_SPINE_AGENT_MODEL, adapterType: M1_SPINE_AGENT_ADAPTER_TYPE }), "worker-driven org");
  assert.equal(org.ok, true, `worker-driven org seed: ${truncate(org)}`);

  const deployed = step(queryDeployedWorker({}), "deployed worker");
  assert.equal(deployed.ok, true, `deployed worker probe: ${truncate(deployed)}`);
  // The deployed worker's own enrolled identity is what every assertion below compares against.
  // Its ABSENCE is a violation in the verdict, never a skip — a vacuous pass here would be the
  // whole ticket failing silently.
  const record = {
    executor: EXECUTOR,
    deployedWorkerId: deployed.workerId,
    deployedTargetId: SPINE_DEPLOYED_TARGET_ID,
    deployedWorkerCount: deployed.workerCount,
  };
  evidence.workerDriven = record;

  const ids = { jobId: randomUUID(), attemptId: randomUUID(), issueId: randomUUID(), runId: randomUUID(), handleId: randomUUID() };
  Object.assign(record, { jobId: ids.jobId, attemptId: ids.attemptId });
  // The script rides the TENANT COMMAND's args: a worker-driven journey mints the provider id
  // inside the worker, so there is no id for the harness to `/script`.
  const workloadArgs = USAGE_MODE === "suppressed" ? ["--aoa-fake-usage=suppressed"] : [];
  const seeded = step(seedSpineWorkerDrivenJob({ tenant, ...ids, workloadArgs, target: deployed.target }), "worker-driven seed");
  assert.equal(seeded.ok, true, `worker-driven job seed: ${truncate(seeded)}`);

  const observation = step(awaitSpineWorkerDrivenTerminal({ jobId: ids.jobId }), "worker-driven rows");
  assert.equal(observation.ok, true, `worker-driven row probe: ${truncate(observation)}`);
  Object.assign(record, {
    attemptStatus: observation.attemptStatus,
    events: observation.events,
    leaseWorkerIds: observation.leaseWorkerIds,
    terminal: observation.terminal,
    logMessages: observation.logMessages.length,
  });

  const violations = evaluateWorkerDrivenJourney({
    declaredExecutor: EXECUTOR,
    deployedWorkerId: deployed.workerId,
    deployedTargetId: SPINE_DEPLOYED_TARGET_ID,
    observation,
  });
  evidence.verdicts.workerDriven = violations;
  assert.deepEqual(violations, [], `worker-driven violations:\n${formatViolations(violations)}`);

  // DEP-016 acceptance item 6, closed POSITIVELY: the probe RAN inside the reference sandbox and
  // reported `absent`, judged by the SHARED read side. Only on the worker-driven path — the
  // control's harness worker executes nothing, so there is no probe to observe and asserting one
  // would make the control red for the wrong reason.
  if (EXECUTOR === "worker") {
    const probeViolations = evaluateSpineEnvProbe({ logMessages: observation.logMessages });
    record.criterion5EnvProbe = {
      observed: probeViolations.length === 0,
      // ★ WHAT THIS LANE CANNOT SEE, recorded with the evidence rather than only in prose: a
      // reference sandbox has no baked image env and no provider-host env, so the probe observes
      // the STAGE-IN env only. The template-baked and provider-host classes stay the DEP-015
      // keyed lane's to observe.
      scope: "stage_in_env_only",
      logMessages: observation.logMessages.length,
    };
    evidence.verdicts.criterion5 = probeViolations;
    assert.deepEqual(probeViolations, [], `criterion-5 env-probe violations:\n${formatViolations(probeViolations)}`);
  }
});

// ── 2b-control. DEP-019: the SAME verdict, on a HARNESS-driven attempt, must RED ──
//
// ★★★ THE ACCEPTANCE-2 CONTROL, and it runs on EVERY execution of this profile rather than only
// under a special mode. Without it "worker-driven" is claimable vacuously: a verdict that has
// never been shown to fail on a not-the-executor attempt is not evidence about who executed.
//
// It judges tenant A's OWN harness-driven attempt from §2 — the journey `DEP-016` performs, with
// this harness playing the worker over the real endpoints — with the SAME function, the SAME
// deployed-worker identity, and `declaredExecutor: "worker"`. It must come back RED on both arms.
//
// ★ An earlier shape of this control PASSED, and it was vacuous: it seeded its own job, drove
// nothing, and read empty rows — "no events at all" is not "somebody else's events". The control
// now reads an attempt that a DIFFERENT worker really did drive to terminal.

test("m1-spine: ★ the worker-driven verdict REDS on tenant A's HARNESS-driven attempt (the control)", { skip: SKIP }, () => {
  const [A] = M1_SPINE_TENANTS.enabled;
  const harnessDriven = leased.get(A.key);
  assert.ok(harnessDriven, "the per-tenant case did not record tenant A's harness-driven attempt");

  const deployed = step(queryDeployedWorker({}), "deployed worker");
  assert.equal(deployed.ok, true, `deployed worker probe: ${truncate(deployed)}`);
  assert.ok(deployed.workerId, "the deployed worker has not enrolled; the control would be vacuous");

  const observation = step(querySpineWorkerDriven({ jobId: harnessDriven.ids.jobId }), "control rows");
  assert.equal(observation.ok, true, `control row probe: ${truncate(observation)}`);
  // Non-vacuity, asserted rather than assumed: the attempt this control judges really was driven
  // to terminal, by a worker that is NOT the deployed one.
  assert.ok(observation.events.length > 0, "the control attempt carries no events — it would red for the wrong reason");
  assert.notEqual(harnessDriven.ids.workerId, deployed.workerId, "the control's worker must not BE the deployed worker");

  const violations = evaluateWorkerDrivenJourney({
    declaredExecutor: "worker",
    deployedWorkerId: deployed.workerId,
    deployedTargetId: SPINE_DEPLOYED_TARGET_ID,
    observation,
  });
  evidence.verdicts.workerDrivenControl = violations;
  const codes = violations.map((v) => v.code).sort();
  assert.ok(codes.includes("worker_driven:events_not_deployed_worker"),
    `the control did not red on the events arm: ${formatViolations(violations)}`);
  assert.ok(codes.includes("worker_driven:lease_not_deployed_worker"),
    `the control did not red on the lease arm: ${formatViolations(violations)}`);
});

// ── 2c. DEP-019: the deployed worker is offered NOTHING of another tenant's ──

test("m1-spine: the deployed worker is offered no work for tenant B or the control tenant", { skip: SKIP }, () => {
  const deployed = step(queryDeployedWorker({}), "deployed worker");
  assert.equal(deployed.ok, true, `deployed worker probe: ${truncate(deployed)}`);
  const [A, B] = M1_SPINE_TENANTS.enabled;
  const C = M1_SPINE_TENANTS.control;
  // Its target belongs to A's Organization, so B's and C's attempts can never be placed on it.
  // Asserted as a ROW fact rather than a poll: the deployed worker polls continuously, and a
  // "we saw no offer" observation cannot tell refusal from timing.
  const foreign = step(queryForeignPlacementOnDeployedTarget({
    targetId: SPINE_DEPLOYED_TARGET_ID,
    ownOrganizationId: A.organizationId,
    otherOrganizationIds: [B.organizationId, C.organizationId],
  }), "foreign placement probe");
  assert.equal(foreign.ok, true, `foreign placement probe: ${truncate(foreign)}`);
  evidence.workerDrivenIsolation = foreign;
  assert.equal(foreign.foreignAttemptsOnDeployedTarget, 0,
    `${foreign.foreignAttemptsOnDeployedTarget} attempt(s) of another tenant are placed on the deployed worker's target`);
  assert.equal(foreign.targetOrganizationId, A.organizationId, "the deployed worker's target belongs to tenant A");
  // The positive control: A's OWN attempts ARE placed there, so the zero above is isolation and
  // not an empty table.
  assert.ok(foreign.ownAttemptsOnDeployedTarget > 0,
    "no attempt of the owning tenant is placed on the deployed target either — the zero above proves nothing");
});

// ── 2a. hostile cross-tenant cases (F10: denied, not merely empty) ───────────

test("m1-spine: tenant B cannot write to, acknowledge or read tenant A's attempt", { skip: SKIP }, () => {
  const [A, B] = M1_SPINE_TENANTS.enabled;
  const victim = leased.get(A.key);
  const attacker = leased.get(B.key);
  assert.ok(victim && attacker, "both enabled tenants must have run before the isolation case");

  // A FRESH attempt of tenant A, leased by a fresh A worker, so the hostile writes are aimed at a
  // LIVE fence rather than at an attempt the ingest would refuse anyway for being terminal.
  const ids = { ...newScenarioIds(), issueId: randomUUID(), runId: randomUUID() };
  const worker = enrollWorker(A, ids);
  const job = step(seedSpineJob({
    tenant: A, issueId: ids.issueId, runId: ids.runId, jobId: ids.jobId, attemptId: ids.attemptId,
    placement: { targetId: ids.targetId, registeredProfileHash: worker.target.registeredProfileHash, providerDigest: worker.target.providerDigest },
  }), "isolation job");
  assert.equal(job.ok, true, `isolation job seed: ${truncate(job)}`);
  const polled = step(poll({ session: worker.session, workerId: ids.workerId, targetId: ids.targetId, deviceKey: worker.deviceKey }), "isolation poll");
  assert.equal(polled.body.outcome, "offer", `isolation poll must offer A's job: ${truncate(polled.body)}`);
  const offer = polled.body.body;
  const acked = step(ack({
    session: worker.session, workerId: ids.workerId, jobId: ids.jobId, attempt: offer.job.attempt,
    leaseId: offer.leaseId, fenceToken: offer.fenceToken, deviceKey: worker.deviceKey,
  }), "isolation ack");
  assert.equal(acked.body.outcome, "acknowledged", `isolation ack: ${truncate(acked.body)}`);

  // (1) SAME-TENANT POSITIVE CONTROL FIRST. A's own worker uploads a usage event onto its own live
  //     lease and it is accepted — so everything the hostile attempts below are denied for is
  //     demonstrably possible on this exact attempt, with this exact batch shape.
  const ownEvents = [makeEvent(ids, A, offer, {
    eventType: "usage", seq: 1,
    payload: { inputTokens: 1_000, outputTokens: 1_000, cachedInputTokens: 0, runtimeMillis: 1 },
  })];
  const ownDigested = step(computeEventDigests({ events: ownEvents }), "isolation own digests");
  assert.equal(ownDigested.ok, true, `isolation own digests: ${truncate(ownDigested)}`);
  const ownBatch = { ...batchIdentity(ids, A, offer), events: ownDigested.events };
  const ownUpload = step(uploadEvents({ session: worker.session, deviceKey: worker.deviceKey, batch: ownBatch }), "isolation own upload");

  const before = step(querySpineAttempt({ organizationId: A.organizationId, jobId: ids.jobId }), "isolation rows before");
  assert.equal(before.ok, true, `isolation rows before: ${truncate(before)}`);

  // (2) HOSTILE WRITE. Tenant B's real worker session and device key, naming A's Organization,
  //     Company, job, lease and fence — a `usage` event, the very thing this profile prices. A
  //     distinct seq, so a denial can never be a sequence clash with the control above.
  // ★ The batch carries the ATTACKER's worker id with the VICTIM's Organization, Company, job,
  // lease and fence (Codex P1, PR #566). Using A's worker id would have been refused for an
  // identity mismatch between the session and the batch — a real check, but not the TENANT
  // boundary — so removing the cross-tenant check would have left this case green.
  const hostileIds = { ...ids, workerId: attacker.ids.workerId };
  const hostileEvents = [makeEvent(hostileIds, A, offer, {
    eventType: "usage", seq: 2,
    payload: { inputTokens: 999_999, outputTokens: 999_999, cachedInputTokens: 0, runtimeMillis: 1 },
  })];
  const hostileDigested = step(computeEventDigests({ events: hostileEvents }), "isolation hostile digests");
  const hostileBatch = { ...batchIdentity(hostileIds, A, offer), events: hostileDigested.events };
  const hostileUpload = step(uploadEvents({ session: attacker.session, deviceKey: attacker.deviceKey, batch: hostileBatch }), "isolation hostile upload");

  // (3) HOSTILE ACK of A's lease by B's worker.
  const hostileAck = step(ack({
    session: attacker.session, workerId: attacker.ids.workerId, jobId: ids.jobId, attempt: offer.job.attempt,
    leaseId: offer.leaseId, fenceToken: offer.fenceToken, deviceKey: attacker.deviceKey,
  }), "isolation hostile ack");

  // (4) HOSTILE READ through the non-owner `aoa_app` pool under RLS, with its own control.
  const foreignRead = step(queryJobEventsAsApp({ jobId: ids.jobId, scopeOrganizationId: B.organizationId }), "isolation foreign read");
  const ownRead = step(queryJobEventsAsApp({ jobId: ids.jobId, scopeOrganizationId: A.organizationId }), "isolation own read");

  const after = step(querySpineAttempt({ organizationId: A.organizationId, jobId: ids.jobId }), "isolation rows after");
  const observation = {
    hostileEventUpload: { status: hostileUpload.status, ackStatus: hostileUpload.body?.ack?.status ?? null, code: hostileUpload.body?.code ?? null },
    ownEventUpload: { status: ownUpload.status, ackStatus: ownUpload.body?.ack?.status ?? null, code: ownUpload.body?.code ?? null },
    hostileAck: { status: hostileAck.status, outcome: hostileAck.body?.outcome ?? null, code: hostileAck.body?.code ?? null },
    foreignScopeEventCount: foreignRead.total,
    ownScopeEventCount: ownRead.total,
    costRowsBeforeHostile: before.costRows.length,
    costRowsAfterHostile: after.costRows.length,
    usageEventsBeforeHostile: before.usageEvents.length,
    usageEventsAfterHostile: after.usageEvents.length,
  };
  evidence.isolation = {
    victim: A.key, attacker: B.key, jobId: ids.jobId, ...observation,
    hostileUploadBody: hostileUpload.body, hostileAckBody: hostileAck.body,
    costRowsAfter: after.costRows.map((r) => ({ companyId: r.companyId, agentId: r.agentId, costCents: r.costCents })),
  };
  const violations = evaluateCrossTenantIsolation(observation);
  evidence.verdicts.isolation = violations;
  assert.deepEqual(violations, [], `cross-tenant isolation violations:
${formatViolations(violations)}`);
});

// ── 3. the control tenant ────────────────────────────────────────────────────

test("m1-spine: the control tenant is refused distributed execution on every replica and stays legacy", { skip: SKIP }, () => {
  const control = M1_SPINE_TENANTS.control;
  const [positiveTenant] = M1_SPINE_TENANTS.enabled;
  const ids = newScenarioIds();
  const record = { placements: [], positiveControlPlacement: null, jobIds: [] };
  evidence.control = record;

  const org = step(seedSpineOrganization({ tenant: control, model: M1_SPINE_AGENT_MODEL, adapterType: M1_SPINE_AGENT_ADAPTER_TYPE }), "control org");
  assert.equal(org.ok, true, `control org seed: ${truncate(org)}`);
  const worker = enrollWorker(control, ids);

  // One UNPLACED control attempt per replica, each decided by that replica's real placement service.
  for (const replica of M1_SPINE_CONTROL_PLANE_REPLICAS) {
    const jobId = randomUUID();
    const attemptId = randomUUID();
    record.jobIds.push(jobId);
    const job = step(seedSpineJob({ tenant: control, issueId: randomUUID(), runId: randomUUID(), jobId, attemptId, placement: null }), `control job ${replica}`);
    assert.equal(job.ok, true, `control job seed (${replica}): ${truncate(job)}`);
    const placed = step(placeSpineAttemptOnReplica({ replica, tenant: control, jobId, attemptId }), `control placement ${replica}`);
    assert.equal(placed.ok, true, `control placement on ${replica} threw: ${truncate(placed)}`);
    record.placements.push({ replica, jobId, ...placed.decision });
  }

  // Positive control: the SAME service, on an ENABLED tenant's unplaced attempt.
  {
    const orgA = step(seedSpineOrganization({ tenant: positiveTenant, model: M1_SPINE_AGENT_MODEL, adapterType: M1_SPINE_AGENT_ADAPTER_TYPE }), "positive-control org");
    assert.equal(orgA.ok, true, `positive-control org seed: ${truncate(orgA)}`);
    const jobId = randomUUID();
    const attemptId = randomUUID();
    const job = step(seedSpineJob({ tenant: positiveTenant, issueId: randomUUID(), runId: randomUUID(), jobId, attemptId, placement: null }), "positive-control job");
    assert.equal(job.ok, true, `positive-control job seed: ${truncate(job)}`);
    const replica = M1_SPINE_CONTROL_PLANE_REPLICAS[0];
    const placed = step(placeSpineAttemptOnReplica({ replica, tenant: positiveTenant, jobId, attemptId }), "positive-control placement");
    record.positiveControlPlacement = placed.ok
      ? { replica, tenant: positiveTenant.key, jobId, ...placed.decision }
      : { replica, tenant: positiveTenant.key, jobId, error: placed.error ?? "unknown" };
  }

  // The control tenant's own worker is offered nothing.
  const polled = step(poll({ session: worker.session, workerId: ids.workerId, targetId: ids.targetId, deviceKey: worker.deviceKey }), "control poll");
  assert.equal(polled.status, 200, `control poll: ${truncate(polled.body)}`);
  record.pollOutcome = polled.body.outcome;

  const counts = step(querySpineControl({ organizationId: control.organizationId, companyId: control.companyId, jobIds: record.jobIds }), "control counts");
  assert.equal(counts.ok, true, `control counts: ${truncate(counts)}`);
  Object.assign(record, { counts });

  const violations = evaluateControlTenant({
    tenant: control,
    observation: {
      placements: record.placements,
      persistedAttempts: counts.attempts,
      positiveControlPlacement: record.positiveControlPlacement,
      pollOutcome: record.pollOutcome,
      jobEvents: counts.jobEvents,
      costRowsForCompany: counts.costRows,
      receipts: counts.receipts,
    },
  });
  if (counts.leases !== 0) violations.push({ code: "control:has_leases", message: `control tenant has ${counts.leases} leases` });
  evidence.verdicts.control = violations;
  assert.deepEqual(violations, [], `control tenant violations:\n${formatViolations(violations)}`);
});

// ── 4. the rollback rehearsal (MIG-009), criterion 6 ─────────────────────────
//
// LAST in the file on purpose: the drain cancels every NON-TERMINAL distributed attempt across
// every admitted Organization, so anything it ran before would be cancelled out from under the
// case that owns it. The journey attempts above are already terminal, which is what makes them the
// selectivity control here.

test("m1-spine: the MIG-009 drain CLI rolls back live distributed work, per tenant and attributed", { skip: SKIP }, () => {
  const operator = `m1-spine-${randomUUID().slice(0, 8)}`;
  const drainable = [];
  for (const tenant of M1_SPINE_TENANTS.enabled) {
    const ids = { ...newScenarioIds(), issueId: randomUUID(), runId: randomUUID() };
    const worker = enrollWorker(tenant, ids);
    const job = step(seedSpineJob({
      tenant, issueId: ids.issueId, runId: ids.runId, jobId: ids.jobId, attemptId: ids.attemptId,
      placement: { targetId: ids.targetId, registeredProfileHash: worker.target.registeredProfileHash, providerDigest: worker.target.providerDigest },
    }), `${tenant.key} drainable job`);
    assert.equal(job.ok, true, `${tenant.key} drainable job seed: ${truncate(job)}`);
    drainable.push({
      tenantKey: tenant.key, organizationId: tenant.organizationId, companyId: tenant.companyId,
      jobId: ids.jobId, attemptId: ids.attemptId,
    });
  }

  // The census of everything the drain will touch, taken BEFORE it runs: the two jobs seeded above,
  // the isolation case's LEASED attempt, the enabled-placement probe, and the control tenant's
  // legacy attempt. Judging only the seeded pair would let a drain that skipped a branch pass.
  const organizationIds = [...M1_SPINE_TENANTS.enabled.map((t) => t.organizationId), M1_SPINE_TENANTS.control.organizationId];
  const census = step(queryDrainCandidates({ organizationIds }), "drain candidates");
  assert.equal(census.ok, true, `drain candidate census: ${truncate(census)}`);
  assert.ok(census.candidates.length >= drainable.length, `the census must see at least the seeded jobs: ${truncate(census.candidates)}`);

  const drain = runDistributedDrainCli({ operator });
  const terminalJobIds = M1_SPINE_TENANTS.enabled
    .map((t) => evidence.enabled[t.key]?.jobId)
    .filter((jobId) => typeof jobId === "string");
  const auditJobIds = [...new Set([
    ...drainable.map((d) => d.jobId),
    ...census.candidates.map((c) => c.jobId),
    ...terminalJobIds,
  ])];
  const audit = step(queryDrainAudit({ jobIds: auditJobIds }), "drain audit");
  assert.equal(audit.ok, true, `drain audit probe: ${truncate(audit)}`);

  evidence.rollbackRehearsal = {
    operator,
    exitCode: drain.status,
    reportLines: drain.lines,
    stderr: drain.stderr.slice(0, 2000),
    drainable,
    preDrainCandidates: census.candidates,
    terminalJobIds,
    audit: audit.audit,
    attempts: audit.attempts,
    commands: audit.commands,
  };

  const violations = evaluateRollbackRehearsal({
    exitCode: drain.status,
    expectedActorId: `operator-cli:${operator}`,
    drainableJobs: drainable,
    auditRows: audit.audit,
    terminalJobIds,
    attempts: audit.attempts,
    preDrainCandidates: census.candidates,
    commands: audit.commands,
  });
  evidence.verdicts.rollbackRehearsal = violations;
  assert.deepEqual(violations, [], `rollback rehearsal violations:\n${formatViolations(violations)}\n--- CLI stdout ---\n${truncate(drain.stdout, 4000)}\n--- CLI stderr ---\n${truncate(drain.stderr, 2000)}`);
});
