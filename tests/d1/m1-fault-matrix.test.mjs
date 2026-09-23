// -----------------------------------------------------------------------------
// DEP-018 — the `M1-D1-SPINE` campaign FAULT MATRIX (LIVE; Docker + the D1 stack brought up
// WITH the DEP-016 one-worker override). The injection harness the declared matrix
// (`tests/d1/fault-matrix.json`) is evidenced from.
//
//   docker compose -f docker-compose.d1.yml -f docker/d1/m1-spine.override.yml up -d --wait
//   AOA_D1_LIVE=1 AOA_D1_CAMPAIGN=m1-fault-matrix node --test --test-concurrency=1 \
//     tests/d1/m1-fault-matrix.test.mjs
//
// Without AOA_D1_LIVE=1 every case SKIPS (never faked). With AOA_D1_LIVE=1 but a different
// campaign it REFUSES to run: the F10 tenant set only exists in the override's environment.
//
// ── WHAT MAKES THIS A MATRIX AND NOT A TEST FILE ─────────────────────────────
// Every case here is DECLARED first, in `tests/d1/fault-matrix.json`, with its injection, the
// probe that decides whether the injection FIRED, and the classification the campaign expects.
// This file's job is to fire each one and record what was observed; the last case feeds the whole
// bundle back through `evaluateFaultMatrixEvidence`, so a case that silently did not inject
// fails the run rather than passing quietly (E6 plan §4c DEP-018, acceptance 1). An undeclared
// case fails too — the harness cannot grow a case nobody wrote an expected classification for.
//
// ── ORDER IS LOAD-BEARING ────────────────────────────────────────────────────
// The campaign is serial (`--test-concurrency=1`) over ONE shared stack, so the file runs:
//   1. the two per-tenant journeys — they are what MAKES the cost and audit rows the legacy-table
//      cases then read;
//   2. the cross-tenant surfaces, against a FRESH live-fenced attempt of tenant A;
//   3. the legacy-table isolation cases, over the journeys' rows;
//   4. the control tenant and the tool surface;
//   5. the destructive faults — cancellation, provider failure, the object-store toxic, the
//      orphan sweep, the link cut, the control-plane restart, and LAST the control-plane →
//      postgres cut, which severs the stack's own database link and is therefore the one case
//      that must have nothing after it.
//
// ── REUSE, NOT A SECOND IMPLEMENTATION ───────────────────────────────────────
// The per-tenant journey verdict, the control-tenant verdict and the hostile-isolation verdict
// are DEP-016's (`scripts/lib/m1-spine-assertions.mjs`), called here rather than restated. A
// second implementation of "this tenant's journey was priced once and audited" would drift from
// the spine profile's, and both would claim to prove the same thing.
// -----------------------------------------------------------------------------

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
  seedScenario,
  seedSpineOrganization,
  seedSpineTarget,
  seedSpineJob,
  placeSpineAttemptOnReplica,
  querySpineAttempt,
  querySpineControl,
  setProxyEnabled,
  setToxiproxyToxic,
  removeToxiproxyToxic,
  probeProxyReachable,
  expireLeaseDeadlines,
  reapOrganization,
  attemptObjectKey,
  artifactTransferGrant,
  artifactCommit,
  putPresignedBytes,
  putPresignedBytesAllowError,
  artifactObjectExists,
  provisionArtifactBucket,
  queryJobArtifact,
  ageArtifactGrantIntent,
  // DEP-018 additions
  composeServiceRuntime,
  restartComposeService,
  tcpProbeFromTestRunner,
  leaseRenew,
  resolveExecutionSecretHttp,
  seedExecutionSecretHandle,
  queryScopedRowsAsApp,
  requestCancellationInContainer,
  queryJobAttemptsAndCommands,
  probeLegacyTableIsolation,
  probeToolSurfaceAtUse,
  seedToolSurfaceRuns,
} from "./lib/e6f-harness.mjs";
import {
  M1_SPINE_TENANTS,
  M1_SPINE_AGENT_MODEL,
  M1_SPINE_AGENT_ADAPTER_TYPE,
  M1_SPINE_CANARY_TARGET_SLUG,
  M1_SPINE_CONTROL_PLANE_REPLICAS,
  EXPECTED_FOREIGN_ACK_STATUS,
  EXPECTED_FOREIGN_ACK_CODE,
  evaluateEnabledTenantSpine,
  evaluateControlTenant,
  evaluateCrossTenantIsolation,
  formatViolations as formatSpineViolations,
} from "../../scripts/lib/m1-spine-assertions.mjs";
import {
  evaluateFaultMatrixDeclaration,
  evaluateFaultMatrixEvidence,
  formatViolations,
} from "../../scripts/lib/campaign-fault-matrix.mjs";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MATRIX = JSON.parse(readFileSync(path.join(repoRoot, "tests/d1/fault-matrix.json"), "utf8"));
const PROFILE = "M1-D1-SPINE";

const CAMPAIGN = process.env.AOA_D1_CAMPAIGN ?? "";
const EVIDENCE_DIR = process.env.AOA_M1_FAULT_MATRIX_EVIDENCE_DIR ?? "";
/** The workflow's own POSITIVE CONTROL for this harness: with `=1` the injections are NOT
 * performed, while every case still records and classifies. A matrix that still passed then
 * would be measuring nothing, so the lane runs exactly that and fails if it passes. */
const SUPPRESS_INJECTION = process.env.AOA_M1_FAULT_MATRIX_SUPPRESS_INJECTION === "1";
const FIXTURE_ID = "batch-success";
const BUCKET = "aoa-artifacts";

if (LIVE && CAMPAIGN !== "m1-fault-matrix") {
  throw new Error(
    "tests/d1/m1-fault-matrix.test.mjs needs AOA_D1_CAMPAIGN=m1-fault-matrix and the one-worker " +
      `override (docker/d1/m1-spine.override.yml); got AOA_D1_CAMPAIGN=${JSON.stringify(CAMPAIGN)}`,
  );
}

// The declaration must be sound before a single injection runs: firing cases against a matrix
// that does not itself satisfy the checker would produce evidence nobody can consume.
{
  const declarationViolations = evaluateFaultMatrixDeclaration(MATRIX);
  if (declarationViolations.length > 0) {
    throw new Error(`tests/d1/fault-matrix.json is not a valid declaration:\n${formatViolations(declarationViolations)}`);
  }
}

const bundle = {
  profile: PROFILE,
  ticket: "DEP-018",
  suppressInjection: SUPPRESS_INJECTION,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  tenants: {
    enabled: M1_SPINE_TENANTS.enabled.map((t) => ({ key: t.key, organizationId: t.organizationId, companyId: t.companyId })),
    control: { key: M1_SPINE_TENANTS.control.key, organizationId: M1_SPINE_TENANTS.control.organizationId },
  },
  cases: [],
  detail: {},
};

/** Record ONE declared case's evidence row. `observedClassification` is what the campaign
 * compares with the declaration; `detail` is kept beside the bundle for the reader. */
function record(caseId, { injectionFired, observedClassification, positiveControlPassed, antiVacuityObservedForeignRow, detail }) {
  const row = { case: caseId, injectionFired: injectionFired === true, observedClassification: observedClassification ?? null };
  if (positiveControlPassed !== undefined) row.positiveControlPassed = positiveControlPassed === true;
  if (antiVacuityObservedForeignRow !== undefined) row.antiVacuityObservedForeignRow = antiVacuityObservedForeignRow === true;
  bundle.cases.push(row);
  if (detail !== undefined) bundle.detail[caseId] = detail;
  return row;
}

after(() => {
  bundle.finishedAt = new Date().toISOString();
  if (!EVIDENCE_DIR) return;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, "m1-fault-matrix-evidence.json"), `${JSON.stringify(bundle, null, 2)}\n`);
});

function truncate(value, max = 4000) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text && text.length > max ? `${text.slice(0, max)}… [+${text.length - max} chars]` : text;
}

/** Parse a step's __E6F_RESULT__ or fail with the raw container output. */
function step(res, label) {
  assert.ok(
    res.result !== null && res.result !== undefined,
    `${label}: no result parsed (exit=${res.status}${res.error ? ` error=${res.error}` : ""})\n` +
      `--- stdout ---\n${truncate(res.stdout)}\n--- stderr ---\n${truncate(res.stderr, 2000)}`,
  );
  return res.result;
}

/** Sleep-free polling: a fixed sleep is either flaky or slow (the e6f-14 idiom). */
function waitFor(probe, predicate, { attempts = 30, everyMs = 1000 } = {}) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    last = probe();
    if (predicate(last)) return { ok: true, last, polls: i + 1 };
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, everyMs);
  }
  return { ok: false, last, polls: attempts };
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

function enrollWorker(tenant, ids, { canarySlug = false } = {}) {
  const deviceKey = generateDeviceKey();
  const code = newEnrollmentCode();
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
  const live = step(stampWorkerLiveness({ workerId: ids.workerId, targetId: ids.targetId }), `${tenant.key} liveness`);
  assert.equal(live.workerUpdated, 1, `${tenant.key} liveness: ${truncate(live)}`);
  return { deviceKey, session: enrolled.session, target };
}

/** Enroll a worker, seed a PLACED job for it, poll and (optionally) ack: the live-fenced attempt
 * every hostile case needs. */
function bringUpLeasedAttempt(tenant, { canarySlug = false, doAck = true } = {}) {
  const ids = { ...newScenarioIds(), issueId: randomUUID(), runId: randomUUID() };
  const worker = enrollWorker(tenant, ids, { canarySlug });
  const job = step(seedSpineJob({
    tenant, issueId: ids.issueId, runId: ids.runId, jobId: ids.jobId, attemptId: ids.attemptId,
    placement: { targetId: ids.targetId, registeredProfileHash: worker.target.registeredProfileHash, providerDigest: worker.target.providerDigest },
  }), `${tenant.key} job`);
  assert.equal(job.ok, true, `${tenant.key} job seed: ${truncate(job)}`);
  const polled = step(poll({ session: worker.session, workerId: ids.workerId, targetId: ids.targetId, deviceKey: worker.deviceKey }), `${tenant.key} poll`);
  assert.equal(polled.body.outcome, "offer", `${tenant.key} must be offered its own job: ${truncate(polled.body)}`);
  const offer = polled.body.body;
  assert.equal(offer.job.jobId, ids.jobId, `${tenant.key} offer names its own job`);
  if (doAck) {
    const acked = step(ack({
      session: worker.session, workerId: ids.workerId, jobId: ids.jobId, attempt: offer.job.attempt,
      leaseId: offer.leaseId, fenceToken: offer.fenceToken, deviceKey: worker.deviceKey,
    }), `${tenant.key} ack`);
    assert.equal(acked.body.outcome, "acknowledged", `${tenant.key} ack: ${truncate(acked.body)}`);
  }
  return { tenant, ids, offer, ...worker };
}

/** A leased attempt in a FRESH, hermetic scenario Organization — the E6F-03 substrate, not the
 * F10 tenant set. Used only by the cleanup case, whose trigger is per-Organization and
 * interval-gated (see that case's comment for why that matters). */
function bringUpFreshScenarioAttempt() {
  const ids = newScenarioIds();
  const deviceKey = generateDeviceKey();
  const code = newEnrollmentCode();
  const seed = step(seedScenario({ ids, code }), "fresh scenario seed");
  assert.equal(seed.ok, true, `fresh scenario seed: ${truncate(seed)}`);
  const enrolled = step(enroll({ code: code.code, hello: buildWorkerHello({ workerId: ids.workerId, targetId: ids.targetId }), deviceKey }), "fresh enroll");
  assert.equal(enrolled.status, 200, `fresh enroll: ${truncate(enrolled.body)}`);
  const live = step(stampWorkerLiveness({ workerId: ids.workerId, targetId: ids.targetId }), "fresh liveness");
  assert.equal(live.workerUpdated, 1, `fresh liveness: ${truncate(live)}`);
  const polled = step(poll({ session: enrolled.session, workerId: ids.workerId, targetId: ids.targetId, deviceKey }), "fresh poll");
  assert.equal(polled.body.outcome, "offer", `fresh poll must offer: ${truncate(polled.body)}`);
  const offer = polled.body.body;
  const acked = step(ack({
    session: enrolled.session, workerId: ids.workerId, jobId: ids.jobId, attempt: offer.job.attempt,
    leaseId: offer.leaseId, fenceToken: offer.fenceToken, deviceKey,
  }), "fresh ack");
  assert.equal(acked.body.outcome, "acknowledged", `fresh ack: ${truncate(acked.body)}`);
  return { ids, offer, session: enrolled.session, deviceKey };
}

/** Run the reference provider for one attempt. `deadlineMs: 0` makes it report `timedOut` — the
 * provider-failure injection this lane has without changing the provider (fake-driver.ts,
 * `execute`: `const timedOut = args.deadlineMs === 0`). */
function runReferenceProvider(label, { deadlineMs } = {}) {
  const providerId = `m1fm-${label}-${randomBytes(3).toString("hex")}`;
  const scripted = step(containerFetch("test-runner", {
    url: `${FAKE_PROVIDER_CTL_URL}/script`, method: "POST", body: { providerId, fixtureId: FIXTURE_ID },
  }), `${label} fake script`);
  assert.equal(scripted.status, 200, `${label} fake /script: ${truncate(scripted.body)}`);
  const created = step(containerFetch("test-runner", {
    url: `${FAKE_PROVIDER_API_URL}/invoke`, method: "POST", body: { providerId, op: "create", args: {} },
  }), `${label} fake create`);
  assert.equal(created.status, 200, `${label} fake create: ${truncate(created.body)}`);
  const resourceId = created.body.result.resource.resourceId;
  const executed = step(containerFetch("test-runner", {
    url: `${FAKE_PROVIDER_API_URL}/invoke`, method: "POST",
    body: { providerId, op: "execute", args: { resourceId, ...(deadlineMs !== undefined ? { deadlineMs } : {}) } },
  }), `${label} fake execute`);
  assert.equal(executed.status, 200, `${label} fake execute: ${truncate(executed.body)}`);
  return { providerId, resourceId, result: executed.body.result };
}

/** The leased attempts kept for the hostile cases. */
const leased = new Map();
/** The journeys' ids, used by the legacy-table cases. */
const journeys = new Map();

// ═══ 1. the two per-tenant journeys (F10) ════════════════════════════════════

for (const tenant of M1_SPINE_TENANTS.enabled) {
  test(`fault-matrix: tenant ${tenant.key} — the journey is priced once and audited (F10 per-tenant correctness)`, { skip: SKIP }, () => {
    const caseId = `d1.tenant.journey.${tenant.key}`;
    const org = step(seedSpineOrganization({ tenant, model: M1_SPINE_AGENT_MODEL, adapterType: M1_SPINE_AGENT_ADAPTER_TYPE }), `${tenant.key} org`);
    assert.equal(org.ok, true, `${tenant.key} org seed: ${truncate(org)}`);

    const live = bringUpLeasedAttempt(tenant, { canarySlug: true });
    const { ids, offer } = live;
    const executed = runReferenceProvider(`journey-${tenant.key.toLowerCase()}`);
    const usage = executed.result.usage ?? null;

    const events = [makeEvent(ids, tenant, offer, { eventType: "attempt_started", seq: 1, payload: { sandboxId: executed.resourceId } })];
    if (usage !== null) events.push(makeEvent(ids, tenant, offer, { eventType: "usage", seq: 2, payload: usage }));
    events.push(makeEvent(ids, tenant, offer, {
      eventType: "terminal", seq: events.length + 1,
      payload: { status: "succeeded", exitCode: 0, errorCode: null, errorMessage: null },
    }));
    const digested = step(computeEventDigests({ events }), `${tenant.key} digests`);
    assert.equal(digested.ok, true, `${tenant.key} digests: ${truncate(digested)}`);
    const uploaded = step(uploadEvents({
      session: live.session, deviceKey: live.deviceKey,
      batch: { ...batchIdentity(ids, tenant, offer), events: digested.events },
    }), `${tenant.key} events`);

    // THE INJECTION for this case is the handed-off journey itself; it FIRED iff the REAL fenced
    // ingest accepted the batch through its last seq.
    const injectionFired = uploaded.status === 200 &&
      uploaded.body?.ack?.status === "accepted" &&
      uploaded.body?.ack?.acceptedThroughSeq === events.length;

    const rows = step(querySpineAttempt({ organizationId: tenant.organizationId, jobId: ids.jobId }), `${tenant.key} rows`);
    assert.equal(rows.ok, true, `${tenant.key} row probe: ${truncate(rows)}`);
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

    journeys.set(tenant.key, { ids, costRows: rows.costRows.length, activity: rows.activity.length });
    record(caseId, {
      injectionFired,
      observedClassification: violations.length === 0 ? "journey_priced_once_and_audited" : "journey_violations",
      detail: {
        jobId: ids.jobId, acceptedThroughSeq: uploaded.body?.ack?.acceptedThroughSeq ?? null,
        attemptStatus: rows.attemptStatus, costRows: rows.costRows.length, activity: rows.activity.map((a) => a.action),
        violations,
      },
    });

    assert.equal(injectionFired, true, `${tenant.key}: the journey's ingest did not accept the batch: ${truncate(uploaded.body)}`);
    assert.deepEqual(violations, [], `tenant ${tenant.key} journey violations:\n${formatSpineViolations(violations)}`);
  });
}

// ═══ 2. the cross-tenant surfaces (F10 isolation) ════════════════════════════

test("fault-matrix: cross-tenant events + read — denied, with a same-tenant positive control", { skip: SKIP }, () => {
  const [A, B] = M1_SPINE_TENANTS.enabled;
  const victim = bringUpLeasedAttempt(A);
  const attacker = bringUpLeasedAttempt(B);
  leased.set("victim", victim);
  leased.set("attacker", attacker);

  // (1) SAME-TENANT POSITIVE CONTROL FIRST: A's own worker uploads onto its own live lease.
  const ownEvents = [makeEvent(victim.ids, A, victim.offer, {
    eventType: "usage", seq: 1,
    payload: { inputTokens: 1_000, outputTokens: 1_000, cachedInputTokens: 0, runtimeMillis: 1 },
  })];
  const ownDigested = step(computeEventDigests({ events: ownEvents }), "own digests");
  const ownUpload = step(uploadEvents({
    session: victim.session, deviceKey: victim.deviceKey,
    batch: { ...batchIdentity(victim.ids, A, victim.offer), events: ownDigested.events },
  }), "own upload");

  const before = step(querySpineAttempt({ organizationId: A.organizationId, jobId: victim.ids.jobId }), "rows before");

  // (2) HOSTILE WRITE: B's session + device key, the ATTACKER's worker id with the VICTIM's
  //     Organization, Company, job, lease and fence — so the refusal cannot be the
  //     session-vs-batch identity check (the DEP-016 lesson).
  const hostileIds = { ...victim.ids, workerId: attacker.ids.workerId };
  const hostileEvents = [makeEvent(hostileIds, A, victim.offer, {
    eventType: "usage", seq: 2,
    payload: { inputTokens: 999_999, outputTokens: 999_999, cachedInputTokens: 0, runtimeMillis: 1 },
  })];
  const hostileDigested = step(computeEventDigests({ events: hostileEvents }), "hostile digests");
  const hostileUpload = step(uploadEvents({
    session: attacker.session, deviceKey: attacker.deviceKey,
    batch: { ...batchIdentity(hostileIds, A, victim.offer), events: hostileDigested.events },
  }), "hostile upload");

  // (3) HOSTILE ACK of A's lease by B's worker.
  const hostileAck = step(ack({
    session: attacker.session, workerId: attacker.ids.workerId, jobId: victim.ids.jobId,
    attempt: victim.offer.job.attempt, leaseId: victim.offer.leaseId, fenceToken: victim.offer.fenceToken,
    deviceKey: attacker.deviceKey,
  }), "hostile ack");

  // (4) HOSTILE READ through the non-owner aoa_app pool under RLS, with its own control.
  const foreignRead = step(queryJobEventsAsApp({ jobId: victim.ids.jobId, scopeOrganizationId: B.organizationId }), "foreign read");
  const ownRead = step(queryJobEventsAsApp({ jobId: victim.ids.jobId, scopeOrganizationId: A.organizationId }), "own read");

  const afterRows = step(querySpineAttempt({ organizationId: A.organizationId, jobId: victim.ids.jobId }), "rows after");
  const observation = {
    hostileEventUpload: { status: hostileUpload.status, ackStatus: hostileUpload.body?.ack?.status ?? null, code: hostileUpload.body?.code ?? null },
    ownEventUpload: { status: ownUpload.status, ackStatus: ownUpload.body?.ack?.status ?? null, code: ownUpload.body?.code ?? null },
    hostileAck: { status: hostileAck.status, outcome: hostileAck.body?.outcome ?? null, code: hostileAck.body?.code ?? null },
    foreignScopeEventCount: foreignRead.total,
    ownScopeEventCount: ownRead.total,
    costRowsBeforeHostile: before.costRows.length,
    costRowsAfterHostile: afterRows.costRows.length,
    usageEventsBeforeHostile: before.usageEvents.length,
    usageEventsAfterHostile: afterRows.usageEvents.length,
  };
  // DEP-016's verdict, reused rather than restated.
  const violations = evaluateCrossTenantIsolation(observation);

  record("d1.tenant.cross.events", {
    injectionFired: typeof hostileUpload.status === "number" && hostileUpload.status !== 0,
    observedClassification: violations.some((v) => v.code.startsWith("isolation:foreign_event") || v.code === "isolation:own_event_denied")
      ? "not_denied" : "denied_with_same_tenant_positive_control",
    positiveControlPassed: ownUpload.status === 200 && ownUpload.body?.ack?.status === "accepted",
    detail: { hostileUpload: observation.hostileEventUpload, ownUpload: observation.ownEventUpload, hostileAck: observation.hostileAck },
  });
  record("d1.tenant.cross.read", {
    injectionFired: foreignRead.ok !== false && typeof foreignRead.total === "number",
    observedClassification: foreignRead.total === 0 ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed: ownRead.total > 0,
    detail: { foreignScopeEventCount: foreignRead.total, ownScopeEventCount: ownRead.total },
  });

  assert.deepEqual(violations, [], `cross-tenant isolation violations:\n${formatSpineViolations(violations)}`);
});

test("fault-matrix: cross-tenant lease renew — denied, with a same-tenant positive control", { skip: SKIP }, () => {
  const victim = leased.get("victim");
  const attacker = leased.get("attacker");
  assert.ok(victim && attacker, "the isolation case must have run first");

  // POSITIVE CONTROL FIRST: A's own worker renews its own live lease.
  const own = step(leaseRenew({
    session: victim.session, workerId: victim.ids.workerId, jobId: victim.ids.jobId,
    attempt: victim.offer.job.attempt, leaseId: victim.offer.leaseId, fenceToken: victim.offer.fenceToken,
    deviceKey: victim.deviceKey,
  }), "own renew");

  // HOSTILE: B's session + device key + B's worker id, against A's lease and fence.
  const hostile = step(leaseRenew({
    session: attacker.session, workerId: attacker.ids.workerId, jobId: victim.ids.jobId,
    attempt: victim.offer.job.attempt, leaseId: victim.offer.leaseId, fenceToken: victim.offer.fenceToken,
    deviceKey: attacker.deviceKey,
  }), "hostile renew");

  const positiveControlPassed = own.status === 200 && own.body?.outcome === "renewed";
  // ★ The EXACT refusal, not merely a non-success. Measured live: the worker-control surface
  // answers a foreign worker presenting another tenant's lease with `409 stale_fence`
  // (`resolveWorkerFenceContext` looks the lease up BY the presented identity and finds no row of
  // this worker's). Accepting "anything that is not 200" would also accept a `malformed` — a
  // PROTOCOL refusal that never reaches the tenant boundary at all — or a 500, which proves no
  // enforcement whatever. That is the same trap this file's orphan case fell into on its first run.
  const denied = hostile.status === EXPECTED_FOREIGN_ACK_STATUS && hostile.body?.code === EXPECTED_FOREIGN_ACK_CODE;
  record("d1.tenant.cross.lease", {
    injectionFired: typeof hostile.status === "number" && hostile.status !== 0,
    observedClassification: denied ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed,
    detail: { hostile: { status: hostile.status, body: hostile.body }, own: { status: own.status, outcome: own.body?.outcome ?? null } },
  });
  assert.equal(positiveControlPassed, true, `the owner's own renew must be RENEWED, else the denial proves nothing: ${truncate(own.body)}`);
  assert.equal(denied, true, `a foreign worker's renew must be denied ${EXPECTED_FOREIGN_ACK_STATUS} ${EXPECTED_FOREIGN_ACK_CODE}: ${truncate(hostile.body)}`);
});

test("fault-matrix: cross-tenant cancel — denied, with a same-tenant positive control", { skip: SKIP }, () => {
  const [A, B] = M1_SPINE_TENANTS.enabled;
  const victim = leased.get("victim");
  assert.ok(victim, "the isolation case must have run first");

  // HOSTILE: the PRODUCTION reconciliation service, under B's Organization and Company, against
  // A's job. `runInTenant` sets B's tenant GUC, and the repository predicates name B's ids.
  const hostile = step(requestCancellationInContainer({
    organizationId: B.organizationId, companyId: B.companyId, jobId: victim.ids.jobId,
    reason: "m1-fault-matrix-hostile",
  }), "hostile cancel");

  // POSITIVE CONTROL: the SAME service, on a THROWAWAY job of A's own (never the victim's, whose
  // live lease later cases depend on).
  const sacrifice = bringUpLeasedAttempt(A, { doAck: false });
  const own = step(requestCancellationInContainer({
    organizationId: A.organizationId, companyId: A.companyId, jobId: sacrifice.ids.jobId,
    reason: "m1-fault-matrix-positive-control",
  }), "own cancel");

  const state = step(queryJobAttemptsAndCommands({ jobIds: [victim.ids.jobId, sacrifice.ids.jobId] }), "cancel state");
  const victimAttempts = state.attempts.filter((a) => a.jobId === victim.ids.jobId);
  const ownAttempts = state.attempts.filter((a) => a.jobId === sacrifice.ids.jobId);
  const victimUntouched = victimAttempts.every((a) => a.status !== "cancelled" && a.status !== "cancel_requested");
  const ownCancelled = ownAttempts.some((a) => a.status === "cancelled" || a.status === "cancel_requested");
  // And the service SAID so: measured live, the foreign call returns `not_found` while the owner's
  // returns `queued` with a real command. Requiring the outcome as well as the row state means a
  // future refusal that silently became a no-op success could not pass.
  const hostileRefused = hostile.ok === true && hostile.outcome?.status === "not_found";

  record("d1.tenant.cross.cancel", {
    injectionFired: hostile.ok === true || typeof hostile.error === "string",
    observedClassification: victimUntouched && hostileRefused ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed: own.ok === true && ownCancelled,
    detail: {
      hostileOutcome: hostile.ok ? hostile.outcome : { error: hostile.error, code: hostile.code },
      ownOutcome: own.ok ? own.outcome : { error: own.error, code: own.code },
      victimAttempts, ownAttempts,
    },
  });
  assert.equal(ownCancelled, true, `the owner's own cancel must take effect: ${truncate(own)}`);
  assert.equal(victimUntouched, true, `a foreign tenant's cancel must not touch the victim's attempt: ${truncate(victimAttempts)}`);
  assert.equal(hostileRefused, true, `the production service must REFUSE the foreign cancel with not_found: ${truncate(hostile)}`);
});

test("fault-matrix: cross-tenant secrets — denied at the fence and invisible under RLS, with controls", { skip: SKIP }, () => {
  const [A, B] = M1_SPINE_TENANTS.enabled;
  const victim = leased.get("victim");
  const attacker = leased.get("attacker");
  assert.ok(victim && attacker, "the isolation case must have run first");

  const handleId = randomUUID();
  const seeded = step(seedExecutionSecretHandle({
    organizationId: A.organizationId, jobId: victim.ids.jobId, handleId,
  }), "seed handle");
  assert.equal(seeded.ok, true, `handle seed: ${truncate(seeded)}`);

  // (a) THE FENCED ROUTE. ★ MEASURED on this file's first live run, and it bounds the claim: the
  //     route collapses EVERY refusal — the foreign fence and the broker's inability to resolve a
  //     fixture handle alike — to `{outcome:"denied", reason:"malformed"}`, deliberately, so it
  //     cannot be an oracle for which worker, lease or handle exists (`worker-control.ts`, the
  //     resolve route's catch-all `denyMalformed`). So the HTTP arm proves REFUSAL and nothing
  //     finer, and it carries NO positive control of its own: a `resolved` reply needs a real
  //     credential, which is the KEYED gate's case (`d2m.tenant.cross.secrets`).
  //     The denial with a control is therefore arm (b).
  const ownResolve = step(resolveExecutionSecretHttp({
    session: victim.session, workerId: victim.ids.workerId, jobId: victim.ids.jobId,
    attempt: victim.offer.job.attempt, leaseId: victim.offer.leaseId, fenceToken: victim.offer.fenceToken,
    handleId, deviceKey: victim.deviceKey,
  }), "own resolve");
  const hostileResolve = step(resolveExecutionSecretHttp({
    session: attacker.session, workerId: attacker.ids.workerId, jobId: victim.ids.jobId,
    attempt: victim.offer.job.attempt, leaseId: victim.offer.leaseId, fenceToken: victim.offer.fenceToken,
    handleId, deviceKey: attacker.deviceKey,
  }), "hostile resolve");

  // (b) THE DURABLE ROW. `job_secret_handles` is an RLS table (TENANT_RLS_TABLES), so the foreign
  //     tenant scope must see NONE of it, with the owner's own scope as the control.
  const foreignRows = step(queryScopedRowsAsApp({ table: "job_secret_handles", jobId: victim.ids.jobId, scopeOrganizationId: B.organizationId }), "foreign handle read");
  const ownRows = step(queryScopedRowsAsApp({ table: "job_secret_handles", jobId: victim.ids.jobId, scopeOrganizationId: A.organizationId }), "own handle read");

  const hostileReason = hostileResolve.body?.reason ?? null;
  const ownReason = ownResolve.body?.reason ?? null;
  const routeRefused = hostileResolve.status === 200 && hostileResolve.body?.outcome === "denied";
  // The DENIAL with its control is the durable-row arm: `job_secret_handles` carries FORCED RLS
  // (`TENANT_RLS_TABLES`), so the foreign tenant scope must see none of it while the owner's own
  // scope sees it — a denial and a same-tenant success on the same pool, the same table and the
  // same row.
  const rowDenied = foreignRows.total === 0;
  const positiveControlPassed = ownRows.total > 0;

  record("d1.tenant.cross.secrets", {
    injectionFired: typeof hostileResolve.status === "number" && hostileResolve.status !== 0,
    observedClassification: routeRefused && rowDenied ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed,
    detail: {
      handleId,
      hostile: { status: hostileResolve.status, outcome: hostileResolve.body?.outcome ?? null, reason: hostileReason },
      own: { status: ownResolve.status, outcome: ownResolve.body?.outcome ?? null, reason: ownReason },
      foreignScopedRows: foreignRows.total, ownScopedRows: ownRows.total,
      note: "the fenced route collapses every refusal to denied/malformed by design, so the HTTP arm proves refusal only; the denial's positive control is the RLS row read",
    },
  });
  assert.equal(ownRows.total > 0, true, `the owner's own scope must see its handle, else the 0 below is not isolation: ${truncate(ownRows)}`);
  assert.equal(foreignRows.total, 0, `a foreign tenant scope must see NO handle of another tenant: ${truncate(foreignRows)}`);
  assert.equal(routeRefused, true, `the foreign resolve must be REFUSED by the fenced route: ${truncate(hostileResolve.body)}`);
});

test("fault-matrix: cross-tenant staged inputs + outputs — denied, with same-tenant positive controls", { skip: SKIP }, () => {
  const victim = leased.get("victim");
  const attacker = leased.get("attacker");
  const [A] = M1_SPINE_TENANTS.enabled;
  assert.ok(victim && attacker, "the isolation case must have run first");

  const provisioned = step(provisionArtifactBucket({ bucket: BUCKET }), "provision bucket");
  assert.equal(provisioned.ok, true, `bucket: ${truncate(provisioned)}`);

  const artifactId = randomUUID();
  const attempt = victim.offer.job.attempt;
  const objectKey = attemptObjectKey({
    organizationId: A.organizationId, jobId: victim.ids.jobId, attempt,
    suffix: `output/xtenant-${randomBytes(4).toString("hex")}.bin`,
  });
  const bodyBytes = Buffer.from(`m1-fault-matrix ${randomUUID()}`, "utf8");
  const sha256Hex = createHash("sha256").update(bodyBytes).digest("hex");
  const victimFence = {
    workerId: victim.ids.workerId, jobId: victim.ids.jobId, attempt,
    leaseId: victim.offer.leaseId, fenceToken: victim.offer.fenceToken,
  };

  // ── staged_inputs: the transfer-grant surface ──
  // HOSTILE FIRST here (the grant is a mint; the owner's must be the one that stands).
  const hostileGrant = step(artifactTransferGrant({
    session: attacker.session, operation: "upload",
    ...victimFence, workerId: attacker.ids.workerId,
    artifactId, expectedObjectKey: objectKey, expectedSha256: sha256Hex, maxBytes: bodyBytes.length,
    deviceKey: attacker.deviceKey,
  }), "hostile grant");
  const ownGrant = step(artifactTransferGrant({
    session: victim.session, operation: "upload", ...victimFence,
    artifactId, expectedObjectKey: objectKey, expectedSha256: sha256Hex, maxBytes: bodyBytes.length,
    deviceKey: victim.deviceKey,
  }), "own grant");

  // Pinned, for the same reason as the lease surface above.
  const grantDenied = hostileGrant.status === EXPECTED_FOREIGN_ACK_STATUS && hostileGrant.body?.code === EXPECTED_FOREIGN_ACK_CODE;
  const grantControl = ownGrant.body?.outcome === "upload_granted";
  record("d1.tenant.cross.staged_inputs", {
    injectionFired: typeof hostileGrant.status === "number" && hostileGrant.status !== 0,
    observedClassification: grantDenied ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed: grantControl,
    detail: { hostile: { status: hostileGrant.status, body: hostileGrant.body }, own: { status: ownGrant.status, outcome: ownGrant.body?.outcome ?? null } },
  });
  assert.equal(grantControl, true, `the owner's own grant must succeed: ${truncate(ownGrant.body)}`);
  assert.equal(grantDenied, true, `a foreign worker's transfer grant must be denied ${EXPECTED_FOREIGN_ACK_STATUS} ${EXPECTED_FOREIGN_ACK_CODE}: ${truncate(hostileGrant.body)}`);

  // ── outputs: the artifact-commit surface ──
  const put = step(putPresignedBytes({ url: ownGrant.body.grant.url, bodyBase64: bodyBytes.toString("base64") }), "put bytes");
  assert.ok(put.status === 200 || put.status === 204, `presigned PUT: ${put.status} ${truncate(put.body)}`);
  const manifest = {
    protocolVersion: 1,
    organizationId: A.organizationId, companyId: A.companyId, jobId: victim.ids.jobId, attempt,
    artifactId, objectKey, sha256: sha256Hex, sizeBytes: bodyBytes.length,
    contentType: "application/octet-stream", kind: "log", sensitivity: "restricted", retention: "run",
    // REQUIRED by the frozen manifest schema; omitting it answers `malformed` at the protocol
    // layer, which never reaches the fence or tenant check (the e6f-14 lesson, measured again here
    // on the first live run of this file).
    createdAt: new Date().toISOString(),
  };
  const hostileCommit = step(artifactCommit({
    session: attacker.session, ...victimFence, workerId: attacker.ids.workerId, manifest, deviceKey: attacker.deviceKey,
  }), "hostile commit");
  const ownCommit = step(artifactCommit({
    session: victim.session, ...victimFence, manifest, deviceKey: victim.deviceKey,
  }), "own commit");

  const commitDenied = hostileCommit.status === EXPECTED_FOREIGN_ACK_STATUS && hostileCommit.body?.code === EXPECTED_FOREIGN_ACK_CODE;
  const commitControl = ownCommit.body?.outcome === "committed";
  record("d1.tenant.cross.outputs", {
    injectionFired: typeof hostileCommit.status === "number" && hostileCommit.status !== 0,
    observedClassification: commitDenied ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed: commitControl,
    detail: { hostile: { status: hostileCommit.status, body: hostileCommit.body }, own: { status: ownCommit.status, outcome: ownCommit.body?.outcome ?? null } },
  });
  assert.equal(commitControl, true, `the owner's own commit must succeed: ${truncate(ownCommit.body)}`);
  assert.equal(commitDenied, true, `a foreign worker's commit must be denied ${EXPECTED_FOREIGN_ACK_STATUS} ${EXPECTED_FOREIGN_ACK_CODE}: ${truncate(hostileCommit.body)}`);
});

// ═══ 3. acceptance 5 — the four legacy tables (granted, NO RLS) ══════════════

test("fault-matrix: the four legacy no-RLS tables are filtered by the query predicate, with positive and anti-vacuity controls", { skip: SKIP }, () => {
  const [A, B] = M1_SPINE_TENANTS.enabled;
  const journeyA = journeys.get(A.key);
  assert.ok(journeyA, "tenant A's journey must have run — it is what wrote the cost and audit rows");

  const probe = step(probeLegacyTableIsolation({
    owner: {
      organizationId: A.organizationId, companyId: A.companyId, agentId: A.agentId,
      issueId: journeyA.ids.issueId, jobId: journeyA.ids.jobId, credentialId: randomUUID(),
    },
    attacker: { organizationId: B.organizationId, companyId: B.companyId },
  }), "legacy tables");
  assert.equal(probe.ok, true, `legacy-table probe: ${truncate(probe)}`);

  bundle.detail.legacyTables = probe.tables;
  for (const table of ["cost_events", "activity_log", "task_outputs", "provider_credentials"]) {
    const t = probe.tables[table];
    assert.ok(t, `the probe must report ${table}`);
    const filtered = t.foreign === 0 && t.own > 0;
    record(`d1.tenant.legacy.${table}`, {
      injectionFired: typeof t.foreign === "number" && typeof t.own === "number" && typeof t.unscoped === "number",
      observedClassification: filtered ? "filtered_by_query_predicate_not_rls" : "not_filtered",
      positiveControlPassed: t.own > 0,
      // The anti-vacuity control: the SAME read with the tenant predicate REMOVED must return the
      // owner's row. Without it, `foreign === 0` is equally explained by an empty table.
      antiVacuityObservedForeignRow: t.unscoped > 0,
      detail: t,
    });
    assert.equal(t.own > 0, true, `${table}: the owner's own read must return its row: ${truncate(t)}`);
    assert.equal(t.unscoped > 0, true, `${table}: the predicate-removed read must return the row, or the 0 below proves nothing: ${truncate(t)}`);
    assert.equal(t.foreign, 0, `${table}: the foreign tenant's read must return none: ${truncate(t)}`);
  }

  // The M1 plan's ninth cross-tenant surface — "A cannot … see B's … cost rows" — IS this
  // `cost_events` read: the attacker's own request through the PRODUCTION reader returns none of
  // the owner's charges while the owner's own returns them. Recorded as its own case rather than
  // folded into the legacy one, because the two answer different questions: the surface case is
  // F10 isolation, the legacy case is "and the boundary here is a query predicate, not RLS".
  const cost = probe.tables.cost_events;
  record("d1.tenant.cross.cost_rows", {
    injectionFired: typeof cost.foreign === "number",
    observedClassification: cost.foreign === 0 ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed: cost.own > 0 && cost.ownCents > 0,
    detail: cost,
  });
  assert.ok(cost.ownCents > 0, `the owner's own cost read must return a real charge: ${truncate(cost)}`);
});

// ═══ 4. the control tenant and the tool surface ══════════════════════════════

test("fault-matrix: the control tenant is refused distributed execution and stays legacy", { skip: SKIP }, () => {
  const control = M1_SPINE_TENANTS.control;
  const [positiveTenant] = M1_SPINE_TENANTS.enabled;
  const ids = newScenarioIds();
  const org = step(seedSpineOrganization({ tenant: control, model: M1_SPINE_AGENT_MODEL, adapterType: M1_SPINE_AGENT_ADAPTER_TYPE }), "control org");
  assert.equal(org.ok, true, `control org seed: ${truncate(org)}`);
  const worker = enrollWorker(control, ids);

  const placements = [];
  const jobIds = [];
  for (const replica of M1_SPINE_CONTROL_PLANE_REPLICAS) {
    const jobId = randomUUID();
    const attemptId = randomUUID();
    jobIds.push(jobId);
    const job = step(seedSpineJob({ tenant: control, issueId: randomUUID(), runId: randomUUID(), jobId, attemptId, placement: null }), `control job ${replica}`);
    assert.equal(job.ok, true, `control job seed: ${truncate(job)}`);
    const placed = step(placeSpineAttemptOnReplica({ replica, tenant: control, jobId, attemptId }), `control placement ${replica}`);
    assert.equal(placed.ok, true, `control placement threw: ${truncate(placed)}`);
    placements.push({ replica, jobId, ...placed.decision });
  }

  // The positive control: the SAME production placement service, on an ENABLED tenant.
  const pcJobId = randomUUID();
  const pcAttemptId = randomUUID();
  const pcJob = step(seedSpineJob({ tenant: positiveTenant, issueId: randomUUID(), runId: randomUUID(), jobId: pcJobId, attemptId: pcAttemptId, placement: null }), "positive-control job");
  assert.equal(pcJob.ok, true, `positive-control job seed: ${truncate(pcJob)}`);
  const pcPlaced = step(placeSpineAttemptOnReplica({ replica: M1_SPINE_CONTROL_PLANE_REPLICAS[0], tenant: positiveTenant, jobId: pcJobId, attemptId: pcAttemptId }), "positive-control placement");

  const polled = step(poll({ session: worker.session, workerId: ids.workerId, targetId: ids.targetId, deviceKey: worker.deviceKey }), "control poll");
  const counts = step(querySpineControl({ organizationId: control.organizationId, companyId: control.companyId, jobIds }), "control counts");
  assert.equal(counts.ok, true, `control counts: ${truncate(counts)}`);

  // DEP-016's verdict, reused.
  const violations = evaluateControlTenant({
    tenant: control,
    observation: {
      placements,
      persistedAttempts: counts.attempts,
      positiveControlPlacement: pcPlaced.ok ? { ...pcPlaced.decision } : { error: pcPlaced.error ?? "unknown" },
      pollOutcome: polled.body?.outcome ?? null,
      jobEvents: counts.jobEvents,
      costRowsForCompany: counts.costRows,
      receipts: counts.receipts,
    },
  });
  record("d1.tenant.control_refused", {
    injectionFired: placements.length === M1_SPINE_CONTROL_PLANE_REPLICAS.length && placements.every((p) => typeof p.disposition === "string"),
    observedClassification: violations.length === 0 ? "legacy_for_organization_disabled" : "control_violations",
    detail: { placements, positiveControl: pcPlaced.ok ? pcPlaced.decision : pcPlaced, pollOutcome: polled.body?.outcome ?? null, counts, violations },
  });
  assert.deepEqual(violations, [], `control tenant violations:\n${formatSpineViolations(violations)}`);
});

test("fault-matrix: cross-tenant tool calls — denied by the per-Organization tool-surface gate, with an admit control", { skip: SKIP }, () => {
  const [A, B] = M1_SPINE_TENANTS.enabled;
  const journeyA = journeys.get(A.key);
  assert.ok(journeyA, "tenant A's journey must have run");

  const localRunId = randomUUID();
  const distributedRunId = randomUUID();
  const seeded = step(seedToolSurfaceRuns({
    companyId: A.companyId, agentId: A.agentId,
    localRunId, distributedRunId, jobId: journeyA.ids.jobId, attemptId: journeyA.ids.attemptId,
  }), "seed tool-surface runs");
  assert.equal(seeded.ok, true, `tool-surface run seed: ${truncate(seeded)}`);

  const probe = step(probeToolSurfaceAtUse({
    victim: { companyId: A.companyId }, attacker: { companyId: B.companyId },
    localRunId, distributedRunId,
  }), "tool surface");
  assert.equal(probe.ok, true, `tool-surface probe: ${truncate(probe)}`);

  // `admit` is demonstrably REACHABLE through this same resolver (A's own LOCAL run under A's own
  // Company), so the cross-tenant `deny` is the company-mismatch arm's work and not "the resolver
  // denies everything" — which it would otherwise look like on M1a, where the distributed tool
  // surface is disarmed for every tenant by the freeze checklist.
  record("d1.tenant.cross.tool_calls", {
    injectionFired: typeof probe.cross === "string",
    observedClassification: probe.cross === "deny" ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed: probe.own === "admit",
    detail: { cross: probe.cross, ownLocal: probe.own, ownDistributed: probe.distributed, localRunId, distributedRunId },
  });
  assert.equal(probe.own, "admit", `the same resolver must ADMIT the owner's own run, else the deny proves nothing: ${truncate(probe)}`);
  assert.equal(probe.cross, "deny", `a foreign Company presenting another tenant's run id must be DENIED: ${truncate(probe)}`);
  assert.equal(probe.distributed, "deny", `M1a freeze: a distributed run's tool surface is not armed for any tenant: ${truncate(probe)}`);
});

// ═══ 5. cancellation ═════════════════════════════════════════════════════════

test("fault-matrix: cancelling an UNLEASED attempt cancels it directly", { skip: SKIP }, () => {
  const [A] = M1_SPINE_TENANTS.enabled;
  const ids = { ...newScenarioIds(), issueId: randomUUID(), runId: randomUUID() };
  const worker = enrollWorker(A, ids);
  const job = step(seedSpineJob({
    tenant: A, issueId: ids.issueId, runId: ids.runId, jobId: ids.jobId, attemptId: ids.attemptId,
    placement: { targetId: ids.targetId, registeredProfileHash: worker.target.registeredProfileHash, providerDigest: worker.target.providerDigest },
  }), "unleased job");
  assert.equal(job.ok, true, `unleased job seed: ${truncate(job)}`);

  const before = step(queryJobAttemptsAndCommands({ jobIds: [ids.jobId] }), "before cancel");
  const beforeStatus = before.attempts.find((a) => a.attemptId === ids.attemptId)?.status ?? null;

  const outcome = SUPPRESS_INJECTION
    ? { ok: false, error: "injection suppressed" }
    : step(requestCancellationInContainer({
      organizationId: A.organizationId, companyId: A.companyId, jobId: ids.jobId, reason: "m1-fault-matrix-unleased",
    }), "cancel unleased");

  const afterState = step(queryJobAttemptsAndCommands({ jobIds: [ids.jobId] }), "after cancel");
  const afterStatus = afterState.attempts.find((a) => a.attemptId === ids.attemptId)?.status ?? null;
  const commands = afterState.commands.filter((c) => c.attemptId === ids.attemptId && c.commandKind === "cancel");

  record("d1.cancel.unleased_attempt", {
    injectionFired: beforeStatus !== null && afterStatus !== beforeStatus,
    observedClassification: afterStatus === "cancelled" && commands.length === 0
      ? "cancelled_directly_without_command"
      : `attempt_${String(afterStatus)}_with_${commands.length}_command(s)`,
    detail: { jobId: ids.jobId, beforeStatus, afterStatus, commands, outcome: outcome.ok ? outcome.outcome : outcome },
  });
  assert.equal(afterStatus, "cancelled", `an UNLEASED attempt is cancelled outright: ${truncate(afterState.attempts)}`);
  assert.equal(commands.length, 0, `an unleased attempt needs no control command: ${truncate(commands)}`);
});

test("fault-matrix: cancelling a LEASED attempt requests cancellation and fences a cancel command", { skip: SKIP }, () => {
  const [A] = M1_SPINE_TENANTS.enabled;
  const live = bringUpLeasedAttempt(A);
  const before = step(queryJobAttemptsAndCommands({ jobIds: [live.ids.jobId] }), "before cancel");
  const beforeStatus = before.attempts.find((a) => a.attemptId === live.ids.attemptId)?.status ?? null;

  const outcome = SUPPRESS_INJECTION
    ? { ok: false, error: "injection suppressed" }
    : step(requestCancellationInContainer({
      organizationId: A.organizationId, companyId: A.companyId, jobId: live.ids.jobId, reason: "m1-fault-matrix-leased",
    }), "cancel leased");

  const afterState = step(queryJobAttemptsAndCommands({ jobIds: [live.ids.jobId] }), "after cancel");
  const afterStatus = afterState.attempts.find((a) => a.attemptId === live.ids.attemptId)?.status ?? null;
  const commands = afterState.commands.filter((c) => c.attemptId === live.ids.attemptId && c.commandKind === "cancel");
  // The command must bind the CURRENT lease: a command on a superseded lease leaves the actual
  // holder untold while the status still reads `cancel_requested` (the DEP-016 lesson).
  const boundToLease = commands.some((c) => c.leaseId === live.offer.leaseId);

  record("d1.cancel.leased_attempt", {
    injectionFired: beforeStatus !== null && (afterStatus !== beforeStatus || commands.length > 0),
    observedClassification: afterStatus === "cancel_requested" && boundToLease
      ? "cancel_requested_with_fenced_command"
      : `attempt_${String(afterStatus)}_command_bound_${boundToLease}`,
    detail: { jobId: live.ids.jobId, leaseId: live.offer.leaseId, beforeStatus, afterStatus, commands, outcome: outcome.ok ? outcome.outcome : outcome },
  });
  assert.equal(afterStatus, "cancel_requested", `a LEASED attempt goes to cancel_requested: ${truncate(afterState.attempts)}`);
  assert.equal(boundToLease, true, `the cancel command must target the attempt's ACTIVE lease: ${truncate(commands)}`);
});

// ═══ 6. provider failure ═════════════════════════════════════════════════════

test("fault-matrix: a provider execute that exceeds its deadline lands as a classified FAILED terminal", { skip: SKIP }, () => {
  const [A] = M1_SPINE_TENANTS.enabled;
  const live = bringUpLeasedAttempt(A);
  // THE INJECTION: `deadlineMs: 0` makes the reference provider report `timedOut` and the terminal
  // state `expired` (fake-driver.ts `execute`). The worker forwards what the provider reported.
  const executed = SUPPRESS_INJECTION
    ? runReferenceProvider("provider-fail")
    : runReferenceProvider("provider-fail", { deadlineMs: 0 });
  const timedOut = executed.result.timedOut === true && executed.result.terminalState === "expired";

  const events = [
    makeEvent(live.ids, A, live.offer, { eventType: "attempt_started", seq: 1, payload: { sandboxId: executed.resourceId } }),
    makeEvent(live.ids, A, live.offer, {
      eventType: "terminal", seq: 2,
      payload: { status: "failed", exitCode: null, errorCode: "provider_timeout", errorMessage: "reference provider reported timedOut" },
    }),
  ];
  const digested = step(computeEventDigests({ events }), "provider-failure digests");
  const uploaded = step(uploadEvents({
    session: live.session, deviceKey: live.deviceKey,
    batch: { ...batchIdentity(live.ids, A, live.offer), events: digested.events },
  }), "provider-failure events");
  assert.equal(uploaded.status, 200, `provider-failure upload: ${truncate(uploaded.body)}`);

  const state = step(queryJobAttemptsAndCommands({ jobIds: [live.ids.jobId] }), "provider-failure state");
  const status = state.attempts.find((a) => a.attemptId === live.ids.attemptId)?.status ?? null;

  record("d1.provider.execute_deadline_exceeded", {
    injectionFired: timedOut,
    observedClassification: status === "failed" ? "attempt_terminal_failed_and_classified" : `attempt_${String(status)}`,
    detail: { providerResult: executed.result, attemptStatus: status, attempts: state.attempts },
  });
  assert.equal(timedOut, true, `the provider must report timedOut — the injection: ${truncate(executed.result)}`);
  assert.equal(status, "failed", `the attempt must terminate FAILED: ${truncate(state.attempts)}`);
});

// ═══ 7. the object store: a truncating toxic, and the orphan sweep ══════════

test("fault-matrix: a truncating toxic on worker-to-minio makes the fenced commit refuse an unverifiable object", { skip: SKIP }, () => {
  const [A] = M1_SPINE_TENANTS.enabled;
  const live = bringUpLeasedAttempt(A);
  step(provisionArtifactBucket({ bucket: BUCKET }), "provision bucket");

  const artifactId = randomUUID();
  const attempt = live.offer.job.attempt;
  const objectKey = attemptObjectKey({
    organizationId: A.organizationId, jobId: live.ids.jobId, attempt,
    suffix: `output/truncated-${randomBytes(4).toString("hex")}.bin`,
  });
  const bodyBytes = Buffer.from(randomBytes(4096));
  const sha256Hex = createHash("sha256").update(bodyBytes).digest("hex");
  const fence = { workerId: live.ids.workerId, jobId: live.ids.jobId, attempt, leaseId: live.offer.leaseId, fenceToken: live.offer.fenceToken };

  const grant = step(artifactTransferGrant({
    session: live.session, operation: "upload", ...fence, artifactId,
    expectedObjectKey: objectKey, expectedSha256: sha256Hex, maxBytes: bodyBytes.length, deviceKey: live.deviceKey,
  }), "toxic grant");
  assert.equal(grant.body.outcome, "upload_granted", `grant: ${truncate(grant.body)}`);

  const toxicName = `m1fm-limit-${randomBytes(3).toString("hex")}`;
  let injected = false;
  let put = null;
  try {
    if (!SUPPRESS_INJECTION) {
      const set = step(setToxiproxyToxic({
        proxy: "worker-to-minio",
        toxic: { name: toxicName, type: "limit_data", stream: "upstream", attributes: { bytes: 64 } },
      }), "set toxic");
      injected = set.ok === true;
      assert.equal(injected, true, `the limit_data toxic must be installed: ${truncate(set.body)}`);
    }
    put = step(putPresignedBytesAllowError({ url: grant.body.grant.url, bodyBase64: bodyBytes.toString("base64") }), "throttled put");
  } finally {
    const removed = removeToxiproxyToxic({ proxy: "worker-to-minio", name: toxicName });
    if (!removed?.result?.ok) {
      console.error(`m1-fault-matrix: FAILED to remove the worker-to-minio toxic ${toxicName}; later serial cases may be affected: ${JSON.stringify(removed?.result ?? removed)}`);
    }
  }

  // The toxic FIRED iff the PUT could not complete normally: either the connection was severed
  // (`threw`) or the store refused the short body (non-2xx). BOTH leave the store without a
  // committable object, which is the invariant under test.
  const putBlocked = put.threw === true || !(put.status === 200 || put.status === 204);

  const manifest = {
    protocolVersion: 1,
    organizationId: A.organizationId, companyId: A.companyId, jobId: live.ids.jobId, attempt,
    artifactId, objectKey, sha256: sha256Hex, sizeBytes: bodyBytes.length,
    contentType: "application/octet-stream", kind: "log", sensitivity: "restricted", retention: "run",
    createdAt: new Date().toISOString(),
  };
  const commit = step(artifactCommit({ session: live.session, ...fence, manifest, deviceKey: live.deviceKey }), "toxic commit");
  const refused = commit.body?.outcome !== "committed";

  record("d1.fault.object_store.truncated_upload", {
    injectionFired: putBlocked,
    observedClassification: refused ? "fenced_commit_refuses_unverifiable_object" : "committed",
    detail: { toxicName, put: { threw: put.threw ?? false, status: put.status ?? null }, commit: { status: commit.status, body: commit.body } },
  });
  assert.equal(putBlocked, true, `the truncating toxic must block the PUT — the injection: ${truncate(put)}`);
  assert.equal(refused, true, `the fenced commit must refuse an unverifiable object: ${truncate(commit.body)}`);
});

test("fault-matrix: a fence lost mid-flight makes the commit refuse and the orphan object is swept", { skip: SKIP }, () => {
  // ★ A FRESH Organization, not one of the F10 tenants — MEASURED on this file's second live run.
  // The sweep trigger is per-ORGANIZATION and interval-gated (`shouldRunSweep`,
  // `server/src/services/artifact-sweep-trigger.ts`: "a busy org must not starve a quiet one"), and
  // the cross-tenant OUTPUTS case a few tests earlier already commits under tenant A — so an
  // orphan raised under A in the same run would wait out that interval and the case would fail for
  // a reason that says nothing about the cleanup path. Cleanup is not a tenancy claim, so the case
  // seeds its own scenario, exactly as `e6f-14-orphan-sweep` does.
  const live = bringUpFreshScenarioAttempt();
  step(provisionArtifactBucket({ bucket: BUCKET }), "provision bucket");

  const artifactId = randomUUID();
  const attempt = live.offer.job.attempt;
  const objectKey = attemptObjectKey({
    organizationId: live.ids.orgId, jobId: live.ids.jobId, attempt,
    suffix: `output/orphan-${randomBytes(4).toString("hex")}.bin`,
  });
  const bodyBytes = Buffer.from(`m1-fault-matrix orphan ${randomUUID()}`, "utf8");
  const sha256Hex = createHash("sha256").update(bodyBytes).digest("hex");
  const fence = { workerId: live.ids.workerId, jobId: live.ids.jobId, attempt, leaseId: live.offer.leaseId, fenceToken: live.offer.fenceToken };

  const grant = step(artifactTransferGrant({
    session: live.session, operation: "upload", ...fence, artifactId,
    expectedObjectKey: objectKey, expectedSha256: sha256Hex, maxBytes: bodyBytes.length, deviceKey: live.deviceKey,
  }), "orphan grant");
  assert.equal(grant.body.outcome, "upload_granted", `grant: ${truncate(grant.body)}`);
  const put = step(putPresignedBytes({ url: grant.body.grant.url, bodyBase64: bodyBytes.toString("base64") }), "orphan put");
  assert.ok(put.status === 200 || put.status === 204, `orphan PUT: ${put.status}`);
  const present = step(artifactObjectExists({ objectKey }), "orphan present");
  assert.equal(present.exists, true, `the object must exist before the sweep: ${truncate(present)}`);

  const aged = step(ageArtifactGrantIntent({ organizationId: live.ids.orgId, jobId: live.ids.jobId, identifier: artifactId, secondsAgo: 120 }), "age intent");
  assert.equal(aged.rows.length, 1, `ageing must move exactly the granted intent: ${truncate(aged)}`);

  // THE INJECTION: present a NON-CURRENT fence on the commit — exactly what a superseded worker's
  // fence looks like. (Back-dating the lease deadlines instead does NOT refuse: the reaper is what
  // converts an overdue lease into a terminal one. That was e6f-14's own first, wrong, attempt.)
  const staleFence = SUPPRESS_INJECTION ? fence.fenceToken : randomBytes(32).toString("base64url");
  const manifest = {
    protocolVersion: 1,
    organizationId: live.ids.orgId, companyId: live.ids.companyId, jobId: live.ids.jobId, attempt,
    artifactId, objectKey, sha256: sha256Hex, sizeBytes: bodyBytes.length,
    contentType: "application/octet-stream", kind: "log", sensitivity: "restricted", retention: "run",
    createdAt: new Date().toISOString(),
  };
  const commit = step(artifactCommit({
    session: live.session, ...fence, fenceToken: staleFence, manifest, deviceKey: live.deviceKey,
  }), "orphan commit");
  // ★ A stale fence is refused at the AUTH layer, not as a `rejected` OUTCOME:
  // `resolveWorkerFenceContext` looks the lease up BY the presented fence token, so a superseded
  // fence finds no row and the route renders a top-level DENIAL envelope. Asserting merely "not
  // committed" would also accept a `malformed` — a PROTOCOL refusal that never reaches the fence
  // check, which is exactly what this file's first live run produced.
  const refused = commit.body?.code === "stale_fence" && commit.body?.outcome === undefined;

  const gone = waitFor(
    () => step(artifactObjectExists({ objectKey }), "orphan exists"),
    (last) => last.exists === false,
    { attempts: 20, everyMs: 500 },
  );

  record("d1.cleanup.orphan_object_swept", {
    injectionFired: refused && staleFence !== fence.fenceToken,
    observedClassification: gone.ok ? "uncommitted_object_deleted" : "object_retained",
    detail: { objectKey, commit: { status: commit.status, outcome: commit.body?.outcome ?? null, code: commit.body?.code ?? null }, polls: gone.polls },
  });
  assert.equal(refused, true, `the commit under a stale fence must be DENIED stale_fence at the auth layer: ${truncate(commit.body)}`);
  assert.equal(gone.ok, true, `the uncommitted object must be swept: ${truncate(gone.last)}`);
});

// ═══ 8. the link cut and the reaper ══════════════════════════════════════════

test("fault-matrix: cutting worker-to-control-plane reclaims the lease and refuses the late ack", { skip: SKIP }, () => {
  const [A] = M1_SPINE_TENANTS.enabled;
  const live = bringUpLeasedAttempt(A, { doAck: false });
  let cut = false;
  let cutProbe = null;
  let restoreProbe = null;
  try {
    if (!SUPPRESS_INJECTION) {
      const disabled = step(setProxyEnabled({ proxy: "worker-to-control-plane", enabled: false }), "cut link");
      assert.equal(disabled.ok, true, `the link cut must succeed: ${truncate(disabled.body)}`);
      cut = true;
      // OBSERVABLE: a probe THROUGH the listen port is refused — the link is genuinely severed.
      cutProbe = step(probeProxyReachable({ proxy: "worker-to-control-plane" }), "cut probe");
    }

    // The worker never delivered its ack: back-date ONLY ack_deadline (the offered case).
    const expired = step(expireLeaseDeadlines({ leaseId: live.offer.leaseId, ackDeadlineIntervalSec: 2 }), "back-date ack");
    assert.equal(expired.ok, true, `back-date: ${truncate(expired)}`);
    assert.equal(expired.updated, 1, `exactly one lease back-dated: ${truncate(expired)}`);
    // The reap reaches control-plane:3100 DIRECTLY, so the cut never blocks it.
    step(reapOrganization({ organizationId: A.organizationId }), "reap");
    const converged = waitFor(
      () => step(queryJobAttemptsAndCommands({ jobIds: [live.ids.jobId] }), "converge"),
      (last) => last.leases.some((l) => l.id === live.offer.leaseId && l.status === "expired"),
      { attempts: 20, everyMs: 500 },
    );

    if (cut) {
      const restored = step(setProxyEnabled({ proxy: "worker-to-control-plane", enabled: true }), "restore link");
      assert.equal(restored.ok, true, `the link must be restored: ${truncate(restored.body)}`);
      cut = false;
      restoreProbe = step(probeProxyReachable({ proxy: "worker-to-control-plane" }), "restore probe");
    }

    const lateAck = step(ack({
      session: live.session, workerId: live.ids.workerId, jobId: live.ids.jobId,
      attempt: live.offer.job.attempt, leaseId: live.offer.leaseId, fenceToken: live.offer.fenceToken,
      deviceKey: live.deviceKey,
    }), "late ack");
    const lateAckRefused = lateAck.status !== 200;

    const injectionFired = SUPPRESS_INJECTION
      ? false
      : cutProbe?.reachable === false && restoreProbe?.reachable === true;
    record("d1.fault.link_cut.worker_to_control_plane", {
      injectionFired,
      observedClassification: converged.ok && lateAckRefused ? "lease_reclaimed_and_late_ack_refused" : "not_reclaimed",
      detail: {
        cutProbe, restoreProbe,
        leases: converged.last?.leases ?? null,
        attempts: converged.last?.attempts ?? null,
        lateAck: { status: lateAck.status, code: lateAck.body?.code ?? null },
      },
    });
    assert.equal(injectionFired, true, `the cut must be OBSERVED severed and restored: cut=${truncate(cutProbe)} restore=${truncate(restoreProbe)}`);
    assert.equal(converged.ok, true, `the lease must be reclaimed: ${truncate(converged.last?.leases)}`);
    assert.equal(lateAckRefused, true, `the disconnected worker's late ack must be refused: ${truncate(lateAck.body)}`);
  } finally {
    if (cut) {
      const r = setProxyEnabled({ proxy: "worker-to-control-plane", enabled: true });
      if (!r?.result?.ok) console.error(`m1-fault-matrix: FAILED to restore worker-to-control-plane: ${JSON.stringify(r?.result ?? r)}`);
    }
  }
});

test("fault-matrix: an expired lease is reaped into a single-winner retry", { skip: SKIP }, () => {
  const [A] = M1_SPINE_TENANTS.enabled;
  const live = bringUpLeasedAttempt(A);
  // THE INJECTION: back-date the durable deadline row (the only deterministic, sleep-free lever —
  // the control plane's sole time source is the server's clock, re-read per locked mutation).
  const expired = SUPPRESS_INJECTION
    ? { ok: true, updated: 0 }
    : step(expireLeaseDeadlines({ leaseId: live.offer.leaseId, ackDeadlineIntervalSec: 2, expiresAtIntervalSec: 1 }), "back-date");
  step(reapOrganization({ organizationId: A.organizationId }), "reap");

  const converged = waitFor(
    () => step(queryJobAttemptsAndCommands({ jobIds: [live.ids.jobId] }), "converge"),
    (last) => last.attempts.length === 2 && last.attempts.some((a) => a.status === "pending" && a.attemptNumber === 2),
    { attempts: 20, everyMs: 500 },
  );
  const attempts = converged.last?.attempts ?? [];
  const singleWinner = attempts.length === 2 &&
    attempts.find((a) => a.attemptNumber === 1)?.status === "expired" &&
    attempts.find((a) => a.attemptNumber === 2)?.status === "pending";

  record("d1.reconcile.expired_lease_reaped", {
    injectionFired: expired.updated === 1,
    observedClassification: singleWinner ? "single_winner_retry_minted" : "not_converged",
    detail: { backDated: expired.updated ?? 0, attempts, leases: converged.last?.leases ?? null },
  });
  assert.equal(expired.updated, 1, `the deadline row must be moved — the injection: ${truncate(expired)}`);
  assert.equal(singleWinner, true, `attempt 1 expired + exactly one pending retry: ${truncate(attempts)}`);
});

// ═══ 9. the restarts (last: they disturb the whole stack) ════════════════════

test("fault-matrix: restarting the control plane leaves the durable lease state intact", { skip: SKIP }, () => {
  const [A] = M1_SPINE_TENANTS.enabled;
  const live = bringUpLeasedAttempt(A);
  const before = composeServiceRuntime("control-plane");
  assert.equal(before.ok, true, `control-plane runtime before: ${truncate(before)}`);
  const stateBefore = step(queryJobAttemptsAndCommands({ jobIds: [live.ids.jobId] }), "state before restart");

  if (!SUPPRESS_INJECTION) {
    const restarted = restartComposeService("control-plane");
    assert.equal(restarted.ok, true, `restart: ${truncate(restarted.stderr)}`);
  }

  const healthy = waitFor(
    () => composeServiceRuntime("control-plane"),
    (last) => last.ok && last.running && (last.health === "healthy" || last.health === "<no value>"),
    { attempts: 60, everyMs: 2000 },
  );
  const afterRuntime = healthy.last;
  // THE OBSERVATION: `StartedAt` advanced. A restart that did not happen leaves it unchanged, so
  // this case cannot pass without the injection firing.
  const restartObserved = Boolean(before.startedAt) && Boolean(afterRuntime?.startedAt) &&
    Date.parse(afterRuntime.startedAt) > Date.parse(before.startedAt);

  const stateAfter = waitFor(
    () => queryJobAttemptsAndCommands({ jobIds: [live.ids.jobId] }).result,
    (last) => last && last.ok === true,
    { attempts: 30, everyMs: 2000 },
  );
  const survived = stateAfter.ok &&
    JSON.stringify(stateAfter.last.attempts) === JSON.stringify(stateBefore.attempts) &&
    stateAfter.last.leases.some((l) => l.id === live.offer.leaseId);

  record("d1.restart.control_plane_process", {
    injectionFired: restartObserved,
    observedClassification: survived ? "durable_lease_state_survives_restart" : "state_changed_across_restart",
    detail: {
      startedAtBefore: before.startedAt, startedAtAfter: afterRuntime?.startedAt ?? null,
      health: afterRuntime?.health ?? null,
      attemptsBefore: stateBefore.attempts, attemptsAfter: stateAfter.last?.attempts ?? null,
    },
  });
  assert.equal(restartObserved, true, `the control plane must actually have restarted — the injection: before=${before.startedAt} after=${afterRuntime?.startedAt}`);
  assert.equal(survived, true, `the durable attempt and lease state must survive the restart: ${truncate(stateAfter.last)}`);
});

test("fault-matrix: cutting control-plane-to-postgres severs the stack's own database link, and it recovers", { skip: SKIP }, () => {
  // LAST in the file on purpose: this cut takes the control plane's ONLY database link down, so
  // anything after it would fail for a reason that says nothing about itself.
  const [A] = M1_SPINE_TENANTS.enabled;
  let cut = false;
  let cutProbe = null;
  let restoreProbe = null;
  let pollDuringCut = null;
  try {
    const healthyBefore = step(tcpProbeFromTestRunner({ host: "toxiproxy", port: 15432 }), "db probe before");
    assert.equal(healthyBefore.connected, true, `the database link must be up before the cut: ${truncate(healthyBefore)}`);

    if (!SUPPRESS_INJECTION) {
      const disabled = step(setProxyEnabled({ proxy: "control-plane-to-postgres", enabled: false }), "cut db link");
      assert.equal(disabled.ok, true, `the db cut must succeed: ${truncate(disabled.body)}`);
      cut = true;
      // OBSERVABLE: a raw TCP connect to the listen port is refused. `probeProxyReachable` cannot
      // serve here — it speaks HTTP, and this link carries the PostgreSQL wire protocol.
      cutProbe = step(tcpProbeFromTestRunner({ host: "toxiproxy", port: 15432 }), "db probe during cut");
      // The control plane must FAIL CLOSED rather than answer a fabricated offer. A poll needs the
      // database for every step of the authority check, so it cannot succeed while the link is down.
      const ids = newScenarioIds();
      pollDuringCut = poll({
        session: "not-a-session", workerId: ids.workerId, targetId: ids.targetId, deviceKey: generateDeviceKey(),
      }).result ?? { status: 0, body: null };
    }

    if (cut) {
      const restored = step(setProxyEnabled({ proxy: "control-plane-to-postgres", enabled: true }), "restore db link");
      assert.equal(restored.ok, true, `the db link must be restored: ${truncate(restored.body)}`);
      cut = false;
    }
    restoreProbe = step(tcpProbeFromTestRunner({ host: "toxiproxy", port: 15432 }), "db probe after restore");

    // Recovery is part of the claim: a cut that left the stack permanently broken is not a fault
    // control, it is a wrecking ball. The control plane must serve a real query again.
    const recovered = waitFor(
      () => queryJobAttemptsAndCommands({ jobIds: [journeys.get(A.key)?.ids.jobId ?? randomUUID()] }).result,
      (last) => last && last.ok === true,
      { attempts: 30, everyMs: 2000 },
    );

    const injectionFired = SUPPRESS_INJECTION
      ? false
      : cutProbe?.connected === false && restoreProbe?.connected === true;
    record("d1.fault.link_cut.control_plane_to_postgres", {
      injectionFired,
      observedClassification: recovered.ok ? "database_link_severed_and_restored" : "not_recovered",
      detail: {
        cutProbe, restoreProbe,
        pollDuringCut: pollDuringCut ? { status: pollDuringCut.status } : null,
        recoveryPolls: recovered.polls,
      },
    });
    assert.equal(injectionFired, true, `the database link must be OBSERVED severed and restored: cut=${truncate(cutProbe)} restore=${truncate(restoreProbe)}`);
    assert.equal(recovered.ok, true, `the control plane must serve queries again after the restore: ${truncate(recovered.last)}`);
  } finally {
    if (cut) {
      const r = setProxyEnabled({ proxy: "control-plane-to-postgres", enabled: true });
      if (!r?.result?.ok) console.error(`m1-fault-matrix: FAILED to restore control-plane-to-postgres: ${JSON.stringify(r?.result ?? r)}`);
    }
  }
});

// ═══ 10. the matrix's own verdict ════════════════════════════════════════════

test("fault-matrix: every DECLARED case fired its injection and was classified as declared", { skip: SKIP }, () => {
  const { violations, summary } = evaluateFaultMatrixEvidence(MATRIX, bundle);
  bundle.summary = summary;
  // This is the case that makes the file a MATRIX: a declared case that silently did not inject,
  // a classification that does not match, a missing positive control, a missing anti-vacuity
  // control, or a case the harness ran without declaring — each fails HERE, even though every
  // individual case above may have passed.
  assert.deepEqual(violations, [], `fault-matrix evidence violations:\n${formatViolations(violations)}\n${JSON.stringify(summary)}`);
  assert.equal(summary.fired, summary.required, `every required case must have fired: ${JSON.stringify(summary)}`);
  assert.ok(summary.required >= 20, `the profile must assert a real case list, saw ${summary.required}`);
});
