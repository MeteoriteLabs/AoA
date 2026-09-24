// -----------------------------------------------------------------------------
// DEP-022 — the `M1a-D2-MECHANISM` cross-tenant, cost, legacy-table and lease-binding drivers,
// on the SHIPPED BOOT lane.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
// The E5 exit-gate audit `a2` (`docs/replatform/epics/E5-workspaces-secrets/qa/
// 2026-09-24-d0-e5-exit-gate-audit-7be35ae6b771-a2.md`, `Result: fail`) failed criterion 7's R5 on
// one measured sentence: the profile *"declares nine `d2m.tenant.cross.*` cases and every one is
// `pending`"*. `DEP-020` added the lane's fault-matrix step, and it files rows for the three cases
// the journey itself observes — the two per-tenant journeys and the control tenant's refusal. The
// other twenty had no driver at all.
//
// ── WHAT IT DOES NOT DO: REINVENT THE DRIVERS ────────────────────────────────
// Every injection below is the D1 lane's own, from `tests/d1/lib/e6f-harness.mjs`, running against
// the SHIPPED control plane instead of the D1 one. DEP-022 made the harness's stack binding a
// parameter (`composeBaseArgs()` / `HTTP_SERVICE`, default-identical, positive control in
// `scripts/lib/__tests__/e6f-harness-binding.test.mjs`); this module is the caller that points it
// at `docker-compose.staging.yml` + the m1-boot overlay. Writing a second set of drivers would
// have given this gate a different set of injections from the ones the D1 record names, which is
// how two lanes come to disagree about what "the same case" means.
//
// ── THE PROPERTY, RULING F10 ─────────────────────────────────────────────────
// ★ DENIED, NOT MERELY EMPTY. Every case here carries a SAME-TENANT POSITIVE CONTROL on the same
// request path, and the control is asserted FIRST. This lane has already shipped the failure it
// guards against: `resolveExecutionSecretHttp` failed `safeParse` on every resolve, so a
// cross-tenant denial "passed" while nothing worked at all. A denial that cannot be told apart
// from a broken surface proves nothing, so a failing control fails the phase BEFORE the denial is
// even classified.
//
// ── THE SUPPRESSION CONTROL ──────────────────────────────────────────────────
// With `suppressInjection`, every hostile arm is performed by the VICTIM's own identity (or, for
// the read probes, under the victim's own tenant scope). The controls still pass, the classifiers
// still run, and every row records `injectionFired: false` — so the phase MUST go red, and it
// prints `[cross-tenant:evidence] injection_did_not_fire case=…` per row so the lane's control can
// prove it went red for the injection reason and not for a bring-up failure. This mirrors
// `AOA_M1_FAULT_MATRIX_SUPPRESS_INJECTION` on `d1-merge-train.yml`.
//
// ── ORDER IS LOAD-BEARING ────────────────────────────────────────────────────
// Each `bringUpLeasedAttempt` enrols a fresh worker on a FRESH target, so it does not advance any
// existing target's generation (`advanceTargetGeneration` is keyed on `executionTargetId`, and it
// only fires when an ALREADY-BOUND worker re-enrols — `server/src/services/worker-enrollment.ts`).
// The lease-binding case nonetheless runs LAST, after every case that reuses the victim attempt,
// because that is the ordering `DEP-018`'s D1 file arrived at after run 35933605253 and there is
// no reason for the two lanes to differ.
//
// ★ AND IT RUNS AFTER `dispatch`, deliberately. The tenants' REAL deployed workers have finished
// by then, so nothing this phase seeds can compete with the journey for an offer.
// -----------------------------------------------------------------------------

import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  EXPECTED_FOREIGN_ACK_CODE,
  EXPECTED_FOREIGN_ACK_STATUS,
  evaluateCrossTenantIsolation,
  formatViolations as formatIsolationViolations,
} from "../lib/m1-spine-assertions.mjs";

/** Rows whose injection never fired print this so the lane's suppression control can prove the
 * red came from the injection and not from a bring-up failure. */
export const CROSS_TENANT_EVIDENCE_MARKER = "[cross-tenant:evidence]";

/** The pricing facts `resolveAuthoritativeRate` needs on the victim's agent, mirrored from
 * `scripts/lib/m1-spine-assertions.mjs` rather than re-chosen: the two lanes must price the same
 * way or their cost rows are not comparable. */
const AGENT_MODEL = "claude-sonnet-4-6";

/** The refusal a foreign worker gets on the fenced worker-control surface. Pinned rather than
 * "anything non-200": a `malformed` is a PROTOCOL refusal that never reaches the tenant boundary,
 * and a 500 proves no enforcement whatever. IMPORTED from `scripts/lib/m1-spine-assertions.mjs`,
 * not re-chosen — a copy is a thing that drifts. */
const FOREIGN_STATUS = EXPECTED_FOREIGN_ACK_STATUS;
const FOREIGN_CODE = EXPECTED_FOREIGN_ACK_CODE;

/** The phase's own refusal. It CARRIES the rows it had gathered, because the verdict that throws
 * is the LAST thing the driver does and the caller must still retain that evidence.
 *
 * ★ WITHOUT THIS THE SUPPRESSED BUNDLE WOULD BE EMPTY, and the per-case suppression check
 * (`scripts/check-cross-tenant-suppression.mjs`) would have had nothing to read — a control whose
 * evidence file is written but carries no cases. Found while fixing Codex's round-4 finding, which
 * asked for that check; writing the check is what made the empty bundle visible. */
class CrossTenantError extends Error {
  constructor(message, { rows = [], detail = {} } = {}) {
    super(message);
    this.rows = rows;
    this.detail = detail;
  }
}

/**
 * ★ THE CALLER-SIDE REDACTION BOUNDARY (self-audit family 1, found on MY OWN diff before the first
 * push — E.1(a): the first place to look for a class you can name is the code you just wrote).
 *
 * THE CLASS: *a failure path that puts a raw container stream into a durable record, on a call
 * whose stream may carry a redeemed credential.* This module mints credential-shaped canaries and
 * then asks the control plane to REDEEM one — the owner's resolve is the positive control, so it
 * SUCCEEDS and the reply carries the value. Every `fail()` below was about to embed
 * `truncate(res.stdout)` from that very call into an error message that `journey.mjs` writes into
 * `cross-tenant-observations.json` and tees into the job log. `journey.mjs`'s own `redactSecrets`
 * could not have caught it: it knows the JOB secrets, and these values are minted here.
 *
 * So the boundary is enforced where the values exist. Everything this module mints is registered,
 * and `fail()` scrubs. Longest-first, so a value containing another is not partly revealed by the
 * shorter replacement running first.
 *
 * THE DUAL (E.1b), searched and reported even though it found nothing here: a SUCCESS path that
 * records the same stream. Every `record(…)` detail below carries narrowed facts only —
 * `responseFacts` (status/outcome/code/reason), counts and ids — never a body or a stream.
 */
const minted = new Set();

/** Register a value this module minted, so no failure path can publish it. */
function mint(value) {
  if (typeof value === "string" && value.length >= 8) minted.add(value);
  return value;
}

function scrub(text) {
  return [...minted].sort((a, b) => b.length - a.length)
    .reduce((acc, v) => acc.split(v).join("[REDACTED]"), String(text ?? ""));
}

function fail(message, carry) {
  throw new CrossTenantError(scrub(message), carry);
}

function truncate(value, max = 2000) {
  const text = scrub(typeof value === "string" ? value : JSON.stringify(value));
  return text && text.length > max ? `${text.slice(0, max)}… [+${text.length - max} chars]` : text;
}

/** A worker-control response, NARROWED. Never the whole body: these are hostile responses, so
 * today they are denial envelopes — but the moment one is NOT, which is the exact regression these
 * cases exist to catch, a granted transfer body carries a PRESIGNED URL with signed credentials,
 * and this bundle is uploaded as a CI artifact. (The same reasoning, and the same four fields, as
 * `responseFacts` in `tests/d1/m1-fault-matrix.test.mjs`.) */
function responseFacts(r) {
  return {
    status: r?.status ?? null,
    outcome: r?.body?.outcome ?? null,
    code: r?.body?.code ?? null,
    reason: r?.body?.reason ?? null,
  };
}

/**
 * Run every `M1a-D2-MECHANISM` case this lane can drive and return their evidence rows.
 *
 * @param {object} opts
 * @param {object} opts.tenants         `state.tenants` — `{ a, b, c }`, each `{ role,
 *                                      organizationId, companyId, agentId }`.
 * @param {(sqlText: string, params: unknown[]) => any[]} opts.ownerSql  the driver's owner-DSN
 *                                      query helper (`journey.mjs`), used only to make the
 *                                      victim's agent priceable.
 * @param {boolean} opts.suppressInjection
 * @param {(line: string) => void} opts.log
 * @returns {Promise<{rows: object[], detail: object, suppressInjection: boolean}>}
 */
export async function runCrossTenantCases({ tenants, ownerSql, suppressInjection = false, log = console.log }) {
  const H = await import(harnessUrl());

  const A = { key: "a", ...tenants.a };
  const B = { key: "b", ...tenants.b };
  if (A.role !== "enabled" || B.role !== "enabled") {
    fail(`the cross-tenant phase needs TWO enabled tenants (F10); got a=${A.role} b=${B.role}`);
  }
  if (A.organizationId === B.organizationId) fail("tenants a and b share an Organization — there is no boundary to test");

  const rows = [];
  const detail = {};
  const record = (caseId, row, d) => {
    rows.push({ case: caseId, ...row });
    if (d !== undefined) detail[caseId] = d;
  };

  /** Unwrap a dexec result or fail with the raw container output. */
  const step = (res, label) => {
    if (res?.result === null || res?.result === undefined) {
      fail(`${label}: no result parsed (exit=${res?.status ?? "?"})\n--- stdout ---\n${truncate(res?.stdout)}\n--- stderr ---\n${truncate(res?.stderr, 1500)}`);
    }
    return res.result;
  };

  // ── 0. make the victim's agent PRICEABLE ───────────────────────────────────
  // The shipped journey creates each tenant's agent through the API with no model in
  // `adapter_config`, and `resolveAuthoritativeRate` prices a `task_run` off exactly that field.
  // Without it the cost case's positive control (`ownCents > 0`) could never pass, and the case
  // would be permanently red for a reason that says nothing about tenancy. Set IF ABSENT, so a
  // journey that already chose a model keeps it.
  for (const t of [A, B]) {
    ownerSql(
      `UPDATE agents SET adapter_config = jsonb_set(coalesce(adapter_config, '{}'::jsonb), '{model}', to_jsonb($2::text), true)
        WHERE id = $1 AND coalesce(adapter_config->>'model', '') = ''`,
      [t.agentId, AGENT_MODEL],
    );
  }
  const models = ownerSql(`SELECT id, adapter_config->>'model' AS model FROM agents WHERE id = ANY($1::uuid[])`, [[A.agentId, B.agentId]]);
  detail.agentModels = models;
  if (models.some((r) => !r.model)) fail(`an enabled tenant's agent still has no adapter_config.model: ${truncate(models)}`);

  // ── 1. the two live, fenced attempts every hostile case needs ──────────────
  const bringUp = (tenant, { doAck = true } = {}) => {
    const ids = { ...H.newScenarioIds(), issueId: randomUUID(), runId: randomUUID() };
    const deviceKey = H.generateDeviceKey();
    const code = H.newEnrollmentCode();
    const target = step(H.seedSpineTarget({
      tenant, slug: ids.slug, targetId: ids.targetId, code,
      // NEVER the canary slug: that is the slug the shipped journey's REAL workers are enrolled
      // on, and `seedSpineTarget` RETIRES the previous holder of the slug it is given.
      targetSlug: `d2m-xtenant-${ids.slug}`,
    }), `${tenant.key} target`);
    if (target.ok !== true) fail(`${tenant.key} target seed: ${truncate(target)}`);
    const enrolled = step(H.enroll({
      code: code.code,
      hello: H.buildWorkerHello({ workerId: ids.workerId, targetId: ids.targetId }),
      deviceKey,
    }), `${tenant.key} enroll`);
    if (enrolled.status !== 200) fail(`${tenant.key} enroll: ${truncate(enrolled.body)}`);
    const live = step(H.stampWorkerLiveness({ workerId: ids.workerId, targetId: ids.targetId }), `${tenant.key} liveness`);
    if (live.workerUpdated !== 1) fail(`${tenant.key} liveness: ${truncate(live)}`);
    const job = step(H.seedSpineJob({
      tenant, issueId: ids.issueId, runId: ids.runId, jobId: ids.jobId, attemptId: ids.attemptId,
      placement: { targetId: ids.targetId, registeredProfileHash: target.registeredProfileHash, providerDigest: target.providerDigest },
    }), `${tenant.key} job`);
    if (job.ok !== true) fail(`${tenant.key} job seed: ${truncate(job)}`);
    const polled = step(H.poll({ session: enrolled.session, workerId: ids.workerId, targetId: ids.targetId, deviceKey }), `${tenant.key} poll`);
    if (polled.body?.outcome !== "offer") fail(`${tenant.key} must be offered its own job: ${truncate(polled.body)}`);
    const offer = polled.body.body;
    if (offer.job.jobId !== ids.jobId) fail(`${tenant.key} was offered another job: ${truncate(offer.job)}`);
    if (doAck) {
      const acked = step(H.ack({
        session: enrolled.session, workerId: ids.workerId, jobId: ids.jobId, attempt: offer.job.attempt,
        leaseId: offer.leaseId, fenceToken: offer.fenceToken, deviceKey,
      }), `${tenant.key} ack`);
      if (acked.body?.outcome !== "acknowledged") fail(`${tenant.key} ack: ${truncate(acked.body)}`);
    }
    return { tenant, ids, offer, session: enrolled.session, deviceKey };
  };

  const victim = bringUp(A);
  const attacker = bringUp(B);
  const hostile = attacker;
  const injected = !suppressInjection;

  // ★★★ HOW SUPPRESSION WORKS, and why it is a SKIP rather than a SUBSTITUTION (Codex P1 on
  // PR #600, round 3 — the finding was right, and the defect was one I introduced in round 2).
  //
  // The first design made the "attacker" BE the victim when suppressed. That is destructive: the
  // suppressed cancel would have cancelled the victim's own attempt, and every later case would
  // then have failed on `attempt_terminal` — an early refusal, BEFORE the verdict loop emits the
  // `injection_did_not_fire` markers the workflow's control step greps for. The control this file
  // exists to provide could never have passed. *A control that cannot pass is the same class as a
  // check that cannot fail.*
  //
  // So suppression SKIPS the hostile act. `hostileOrSkip` returns a sentinel that no classifier
  // reads as a denial, the fixture is left untouched, every case still records and classifies, and
  // every row carries `injectionFired: false`. The phase then reds in the ONE place that emits the
  // markers first: the verdict at the end.
  const SKIPPED = Object.freeze({ status: 0, body: null, suppressed: true });
  const hostileOrSkip = (fn, label) => (injected ? step(fn(), label) : SKIPPED);
  // The read probes' foreign scope, likewise: `null` is not `0`, so no classifier reads it as a
  // denial, and nothing is queried under a scope that would make a suppressed run look clean.
  const foreignOrg = injected ? B.organizationId : null;
  // The identity the in-container probes are actually given. Resolved ONCE, here, so that what was
  // SENT can be observed at the recording site rather than re-derived from the flag.
  const probeAttacker = injected
    ? { organizationId: B.organizationId, companyId: B.companyId }
    : { organizationId: A.organizationId, companyId: A.companyId };

  // ★★★ `injectionFired` IS AN OBSERVATION, NEVER THE FLAG (Codex P1 on PR #600, round 5, and the
  // finding was right — it caught the round-4 control being TAUTOLOGICAL).
  //
  // Every row used to AND its observation with `injected`, which is
  // exactly `!suppressInjection`. So if a regression made `hostileOrSkip` execute the request WITH
  // suppression on, the request would fire and every row would still record `false` — and
  // `scripts/check-cross-tenant-suppression.mjs`, the control added in round 4 to catch exactly
  // that, would accept all fourteen. A control whose input is the flag it is checking is not a
  // control.
  //
  // So the flag is gone from every `injectionFired`. Each one now reads a fact about what the
  // system DID: a real HTTP status (the skip sentinel carries `status: 0`), a numeric row count
  // (a skipped read carries `null`), or — for the in-container probes, which always run — whether
  // the identity actually handed to them differs from the victim's.
  const probeIdentityWasForeign = probeAttacker.organizationId !== A.organizationId
    && probeAttacker.companyId !== A.companyId;
  /** A fenced worker-control call FIRED iff it came back with a real HTTP status. */
  const httpFired = (r) => typeof r?.status === "number" && r.status !== 0;
  /** Violations of the SHARED isolation verdict, deferred to the final verdict so the markers are
   * emitted before anything throws. */
  const deferred = [];
  detail.fixture = {
    victimJobId: victim.ids.jobId, attackerJobId: attacker.ids.jobId,
    victimWorkerId: victim.ids.workerId, attackerWorkerId: attacker.ids.workerId,
    suppressInjection,
  };

  const makeEvent = (ids, tenant, offer, { eventType, seq, payload }) => ({
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
  });
  const batchIdentity = (ids, tenant, offer) => ({
    protocolVersion: 1,
    organizationId: tenant.organizationId,
    companyId: tenant.companyId,
    workerId: ids.workerId,
    jobId: ids.jobId,
    attempt: offer.job.attempt,
    leaseId: offer.leaseId,
    fenceToken: offer.fenceToken,
  });

  // ── 2. events + read ───────────────────────────────────────────────────────
  // POSITIVE CONTROL FIRST. The owner's own usage batch is what later gives the cost case a real
  // charge to read, so it is load-bearing twice.
  //
  // ★★★ `attempt_started` IS LOAD-BEARING FOR THE `activity_log` ARM, and its absence is the
  // measured cause of E6-F031 — the `{"own":0,"foreign":0,"unscoped":0,"ownActions":[]}` that
  // reded this phase byte-identically on runs 36047740323 and 36051455003.
  //
  // E3-D-AUDIT-SET (`server/src/services/job-accepted-activity-audit.ts`,
  // `ACCEPTED_ACTIVITY_AUDIT_ACTIONS`) is CLOSED at `attempt_started` and `terminal`. `usage` is
  // deliberately NOT audited to `activity_log` — it has its own durable record (the `cost_events`
  // row plus its `authoritative_cost` receipt). So a batch carrying only `usage` writes a cost row
  // and NO activity row, which is exactly the asymmetry the two runs observed: the `cost_events`
  // arm passed on this very batch while the `activity_log` arm saw nothing at all.
  //
  // ★ WHY THE CASE MUST EARN THE ROW RATHER THAN BORROW ONE. The D1 twin
  // (`tests/d1/m1-fault-matrix.test.mjs`) reads `journeyA.ids.jobId` — the REAL journey's job,
  // whose attempt ran `attempt_started`/`terminal` through the ingest. This lane's port passed its
  // OWN raw-SQL-seeded fixture job (`seedSpineJob` inserts `issues`/`jobs`/`job_attempts`
  // directly), and the shipped lane never retains the journey's job id in `state`. Submitting the
  // audited event here is STRONGER than plumbing the journey's id through: the arm then certifies
  // the live JOB-017 audit write on the fence it owns, instead of depending on a row another phase
  // happened to leave behind. `terminal` is deliberately NOT used — it would end the attempt and
  // every later arm needs this fence live; `attempt_started` drives leased→running and keeps it.
  //
  // Sequence numbers shift accordingly (usage 1→2, hostile 2→3). They must stay DISTINCT: a
  // duplicate seq is rejected by the ingest as a replay, which would make the hostile refusal
  // indistinguishable from a tenant denial — the DEP-016 lesson this file already carries.
  const ownEvents = [makeEvent(victim.ids, A, victim.offer, {
    eventType: "attempt_started", seq: 1,
    payload: { sandboxId: `d2m-xtenant-${victim.ids.jobId}` },
  }), makeEvent(victim.ids, A, victim.offer, {
    eventType: "usage", seq: 2,
    payload: { inputTokens: 1_000, outputTokens: 1_000, cachedInputTokens: 0, runtimeMillis: 1 },
  })];
  const ownDigested = step(H.computeEventDigests({ events: ownEvents }), "own digests");
  const ownUpload = step(H.uploadEvents({
    session: victim.session, deviceKey: victim.deviceKey,
    batch: { ...batchIdentity(victim.ids, A, victim.offer), events: ownDigested.events },
  }), "own upload");
  if (!(ownUpload.status === 200 && ownUpload.body?.ack?.status === "accepted")) {
    fail(`the owner's own event upload must be ACCEPTED, else every denial below is indistinguishable from a broken ingest: ${truncate(ownUpload.body)}`);
  }

  const before = step(H.querySpineAttempt({ organizationId: A.organizationId, jobId: victim.ids.jobId }), "rows before");

  // HOSTILE: the attacker's session and device key, the ATTACKER's worker id with the VICTIM's
  // Organization, Company, job, lease and fence — so a refusal cannot be the session-vs-batch
  // identity check (the DEP-016 lesson).
  const hostileIds = { ...victim.ids, workerId: hostile.ids.workerId };
  const hostileEvents = [makeEvent(hostileIds, A, victim.offer, {
    eventType: "usage", seq: 3,
    payload: { inputTokens: 999_999, outputTokens: 999_999, cachedInputTokens: 0, runtimeMillis: 1 },
  })];
  const hostileUpload = hostileOrSkip(() => {
    const hostileDigested = step(H.computeEventDigests({ events: hostileEvents }), "hostile digests");
    return H.uploadEvents({
      session: hostile.session, deviceKey: hostile.deviceKey,
      batch: { ...batchIdentity(hostileIds, A, victim.offer), events: hostileDigested.events },
    });
  }, "hostile upload");

  // HOSTILE ACK of A's lease by B's worker — the second half of the same surface, and one the
  // event-upload arm alone does not reach.
  const hostileAck = hostileOrSkip(() => H.ack({
    session: hostile.session, workerId: hostile.ids.workerId, jobId: victim.ids.jobId,
    attempt: victim.offer.job.attempt, leaseId: victim.offer.leaseId, fenceToken: victim.offer.fenceToken,
    deviceKey: hostile.deviceKey,
  }), "hostile ack");

  const foreignRead = injected
    ? step(H.queryJobEventsAsApp({ jobId: victim.ids.jobId, scopeOrganizationId: foreignOrg }), "foreign read")
    : { ok: true, total: null, suppressed: true };
  const ownRead = step(H.queryJobEventsAsApp({ jobId: victim.ids.jobId, scopeOrganizationId: A.organizationId }), "own read");
  if (!(ownRead.total > 0)) {
    fail(`the owner's own tenant scope must SEE its own events, else a zero foreign count proves nothing: ${truncate(ownRead)}`);
  }
  const afterRows = step(H.querySpineAttempt({ organizationId: A.organizationId, jobId: victim.ids.jobId }), "rows after");

  // ★★★ THE VERDICT IS DEP-016's OWN, REUSED RATHER THAN RESTATED (Codex P1 on PR #600, round 2,
  // and the finding was right). The first version classified this case on
  // `status !== 200 || ack !== "accepted"` — under which a 500, a transport-shaped failure or a
  // malformed 200 all read as a DENIAL while proving no enforcement whatever. That is the exact
  // trap `evaluateCrossTenantIsolation` already carries a comment about, from its own Codex P2 on
  // PR #566. A second predicate for the same injection is a thing that drifts from the first, so
  // there is now only one: `scripts/lib/m1-spine-assertions.mjs`, shared by both lanes. It pins the
  // upload refusal AND the ack refusal to their exact status+code, requires the owner's own upload
  // to be accepted, requires the foreign scope to read zero and the owner's to read more, and
  // requires the hostile batch to have minted no usage event and no cost row.
  const observation = {
    hostileEventUpload: {
      status: hostileUpload.status,
      ackStatus: hostileUpload.body?.ack?.status ?? null,
      code: hostileUpload.body?.code ?? null,
    },
    ownEventUpload: {
      status: ownUpload.status,
      ackStatus: ownUpload.body?.ack?.status ?? null,
      code: ownUpload.body?.code ?? null,
    },
    hostileAck: { status: hostileAck.status, outcome: hostileAck.body?.outcome ?? null, code: hostileAck.body?.code ?? null },
    foreignScopeEventCount: foreignRead.total,
    ownScopeEventCount: ownRead.total,
    costRowsBeforeHostile: before.costRows.length,
    costRowsAfterHostile: afterRows.costRows.length,
    usageEventsBeforeHostile: before.usageEvents.length,
    usageEventsAfterHostile: afterRows.usageEvents.length,
  };
  const isolationViolations = evaluateCrossTenantIsolation(observation);

  record("d2m.tenant.cross.events", {
    injectionFired: httpFired(hostileUpload),
    observedClassification: isolationViolations.some((v) => v.code.startsWith("isolation:foreign_event") || v.code === "isolation:own_event_denied")
      ? "not_denied" : "denied_with_same_tenant_positive_control",
    positiveControlPassed: ownUpload.status === 200 && ownUpload.body?.ack?.status === "accepted",
  }, {
    hostileUpload: observation.hostileEventUpload,
    ownUpload: observation.ownEventUpload,
    hostileAck: observation.hostileAck,
    expectedForeignRefusal: { status: FOREIGN_STATUS, code: FOREIGN_CODE },
    usageEventsBeforeHostile: observation.usageEventsBeforeHostile,
    usageEventsAfterHostile: observation.usageEventsAfterHostile,
    costRowsBeforeHostile: observation.costRowsBeforeHostile,
    costRowsAfterHostile: observation.costRowsAfterHostile,
    violations: isolationViolations,
  });

  record("d2m.tenant.cross.read", {
    injectionFired: foreignRead.ok !== false && typeof foreignRead.total === "number",
    observedClassification: foreignRead.total === 0 ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed: ownRead.total > 0,
  }, { foreignScopeEventCount: foreignRead.total, ownScopeEventCount: ownRead.total, foreignScopeOrganizationId: foreignOrg });

  // The FULL verdict is asserted, not only the two codes the row above classifies on: a foreign
  // ACK that was accepted, or a cost row minted by the hostile batch, are isolation failures that
  // no `cross.events` classification names.
  // DEFERRED, never thrown here (Codex P1, round 3): the verdict at the end of this function is the
  // ONE place that emits the per-case markers before it fails, and the workflow's suppression
  // control greps for them.
  if (injected && isolationViolations.length > 0) deferred.push(...isolationViolations);

  // ── 3. lease renew ─────────────────────────────────────────────────────────
  const ownRenew = step(H.leaseRenew({
    session: victim.session, workerId: victim.ids.workerId, jobId: victim.ids.jobId,
    attempt: victim.offer.job.attempt, leaseId: victim.offer.leaseId, fenceToken: victim.offer.fenceToken,
    deviceKey: victim.deviceKey,
  }), "own renew");
  if (!(ownRenew.status === 200 && ownRenew.body?.outcome === "renewed")) {
    fail(`the owner's own renew must be RENEWED, else the denial proves nothing: ${truncate(ownRenew.body)}`);
  }
  const hostileRenew = hostileOrSkip(() => H.leaseRenew({
    session: hostile.session, workerId: hostile.ids.workerId, jobId: victim.ids.jobId,
    attempt: victim.offer.job.attempt, leaseId: victim.offer.leaseId, fenceToken: victim.offer.fenceToken,
    deviceKey: hostile.deviceKey,
  }), "hostile renew");
  record("d2m.tenant.cross.lease", {
    injectionFired: httpFired(hostileRenew),
    observedClassification: hostileRenew.status === FOREIGN_STATUS && hostileRenew.body?.code === FOREIGN_CODE
      ? "denied_with_same_tenant_positive_control" : "not_denied",
    // Re-derived, never hardcoded `true`: the assertion above is what STOPS a failing control, but
    // the ROW must carry the measurement, or a later edit that loosened the assertion would ship a
    // control fact nothing computed.
    positiveControlPassed: ownRenew.status === 200 && ownRenew.body?.outcome === "renewed",
  }, { hostile: responseFacts(hostileRenew), own: responseFacts(ownRenew), expected: { status: FOREIGN_STATUS, code: FOREIGN_CODE } });

  // ── 4. cancel ──────────────────────────────────────────────────────────────
  // The hostile call goes through the PRODUCTION reconciliation service under the attacker's
  // Organization and Company against the victim's job. The control uses a THROWAWAY job of A's
  // own — never the victim's, whose live lease the later cases still need.
  // ★ THE DESTRUCTIVE ONE. Suppressed, this must NOT run at all: performed by the owner it would
  // cancel the victim's own attempt, and every later case would then fail on `attempt_terminal`.
  const hostileCancel = injected
    ? step(H.requestCancellationInContainer({
      organizationId: B.organizationId, companyId: B.companyId, jobId: victim.ids.jobId,
      reason: "d2m-cross-tenant-hostile",
    }), "hostile cancel")
    : { ok: null, outcome: null, suppressed: true };
  const sacrifice = bringUp(A, { doAck: false });
  const ownCancel = step(H.requestCancellationInContainer({
    organizationId: A.organizationId, companyId: A.companyId, jobId: sacrifice.ids.jobId,
    reason: "d2m-cross-tenant-positive-control",
  }), "own cancel");
  const cancelState = step(H.queryJobAttemptsAndCommands({ jobIds: [victim.ids.jobId, sacrifice.ids.jobId] }), "cancel state");
  const victimAttempts = cancelState.attempts.filter((a) => a.jobId === victim.ids.jobId);
  const ownAttempts = cancelState.attempts.filter((a) => a.jobId === sacrifice.ids.jobId);
  const victimUntouched = victimAttempts.every((a) => a.status !== "cancelled" && a.status !== "cancel_requested");
  const ownCancelled = ownAttempts.some((a) => a.status === "cancelled" || a.status === "cancel_requested");
  if (!(ownCancel.ok === true && ownCancelled)) {
    fail(`the owner's own cancel must take effect, else the foreign refusal proves nothing: ${truncate({ ownCancel, ownAttempts })}`);
  }
  record("d2m.tenant.cross.cancel", {
    injectionFired: hostileCancel.ok === true || typeof hostileCancel.error === "string",
    observedClassification: victimUntouched && hostileCancel.ok === true && hostileCancel.outcome?.status === "not_found"
      ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed: ownCancel.ok === true && ownCancelled,
  }, {
    hostileOutcome: hostileCancel.ok ? hostileCancel.outcome : { error: hostileCancel.error ?? null },
    ownOutcome: ownCancel.ok ? ownCancel.outcome : { error: ownCancel.error ?? null },
    victimAttempts, ownAttempts,
  });

  // ── 5. secrets ─────────────────────────────────────────────────────────────
  // ★ WHAT THIS GATE ADDS OVER THE D1 MIRROR. On D1 the fixture handle is UNRESOLVABLE (that lane
  // configures no broker that could return a value), so its own record concedes the route arm
  // *"carries NO positive control of its own: a `resolved` reply needs a real credential, which
  // is the KEYED gate's case (`d2m.tenant.cross.secrets`)"*. Here the handle is written through
  // the server's OWN `secretService`, so the owner's redemption really resolves and the route arm
  // finally has the control the D1 case could not have. The RLS row pair is kept as the second,
  // independent arm — its denial is mutation-sensitive to the policy rather than to the fence.
  const secretNonce = randomBytes(6).toString("hex");
  const secretHandleId = randomUUID();
  const seededSecret = step(H.seedResolvableProviderSecretHandle({
    organizationId: A.organizationId, companyId: A.companyId, jobId: victim.ids.jobId,
    handleId: secretHandleId,
    secretName: `provider:d2m-xtenant-${secretNonce}`,
    // Credential-shaped, per-call unique, and NEVER reported, recorded or asserted on.
    value: mint(`d2m-${randomBytes(24).toString("hex")}`),
  }), "seed resolvable handle");
  if (seededSecret.ok !== true) fail(`resolvable handle seed: ${truncate(seededSecret)}`);

  const ownResolve = step(H.resolveExecutionSecretHttp({
    session: victim.session, workerId: victim.ids.workerId, jobId: victim.ids.jobId,
    attempt: victim.offer.job.attempt, leaseId: victim.offer.leaseId, fenceToken: victim.offer.fenceToken,
    handleId: secretHandleId, deviceKey: victim.deviceKey,
  }), "own resolve");
  const hostileResolve = hostileOrSkip(() => H.resolveExecutionSecretHttp({
    session: hostile.session, workerId: hostile.ids.workerId, jobId: victim.ids.jobId,
    attempt: victim.offer.job.attempt, leaseId: victim.offer.leaseId, fenceToken: victim.offer.fenceToken,
    handleId: secretHandleId, deviceKey: hostile.deviceKey,
  }), "hostile resolve");
  const foreignHandleRows = injected
    ? step(H.queryScopedRowsAsApp({ table: "job_secret_handles", jobId: victim.ids.jobId, scopeOrganizationId: foreignOrg }), "foreign handle read")
    : { ok: true, total: null, suppressed: true };
  const ownHandleRows = step(H.queryScopedRowsAsApp({ table: "job_secret_handles", jobId: victim.ids.jobId, scopeOrganizationId: A.organizationId }), "own handle read");
  const ownResolved = ownResolve.status === 200 && ownResolve.body?.outcome === "resolved";
  if (!ownResolved) {
    fail(`the owner's own redemption must RESOLVE on this gate, else the foreign refusal is indistinguishable from "no redemption works here": ${truncate(responseFacts(ownResolve))}`);
  }
  if (!(ownHandleRows.total > 0)) fail(`the owner's own scope must see its handle: ${truncate(ownHandleRows)}`);
  const secretsDenied = hostileResolve.status === 200 && hostileResolve.body?.outcome === "denied" && foreignHandleRows.total === 0;
  record("d2m.tenant.cross.secrets", {
    injectionFired: httpFired(hostileResolve),
    observedClassification: secretsDenied ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed: ownResolved && ownHandleRows.total > 0,
  }, {
    handleId: secretHandleId,
    hostile: responseFacts(hostileResolve), own: responseFacts(ownResolve),
    foreignScopedRows: foreignHandleRows.total, ownScopedRows: ownHandleRows.total,
    note: "BOTH arms are classified here, unlike the D1 mirror: the route arm has a real positive control because this gate's handle resolves, and the RLS row arm is independent of the fence.",
  });

  // ── 6. staged inputs + outputs ─────────────────────────────────────────────
  const artifactId = randomUUID();
  const attempt = victim.offer.job.attempt;
  const objectKey = H.attemptObjectKey({
    organizationId: A.organizationId, jobId: victim.ids.jobId, attempt,
    suffix: `output/d2m-xtenant-${randomBytes(4).toString("hex")}.bin`,
  });
  const bodyBytes = Buffer.from(`d2m cross-tenant ${randomUUID()}`, "utf8");
  const sha256Hex = createHash("sha256").update(bodyBytes).digest("hex");
  const victimFence = {
    workerId: victim.ids.workerId, jobId: victim.ids.jobId, attempt,
    leaseId: victim.offer.leaseId, fenceToken: victim.offer.fenceToken,
  };

  // HOSTILE FIRST on the grant: it is a MINT, and the owner's must be the one that stands.
  const hostileGrant = hostileOrSkip(() => H.artifactTransferGrant({
    session: hostile.session, operation: "upload", ...victimFence, workerId: hostile.ids.workerId,
    artifactId, expectedObjectKey: objectKey, expectedSha256: sha256Hex, maxBytes: bodyBytes.length,
    deviceKey: hostile.deviceKey,
  }), "hostile grant");
  const ownGrant = step(H.artifactTransferGrant({
    session: victim.session, operation: "upload", ...victimFence,
    artifactId, expectedObjectKey: objectKey, expectedSha256: sha256Hex, maxBytes: bodyBytes.length,
    deviceKey: victim.deviceKey,
  }), "own grant");
  if (ownGrant.body?.outcome !== "upload_granted") {
    fail(`the owner's own transfer grant must succeed: ${truncate(responseFacts(ownGrant))}`);
  }
  const put = step(H.putPresignedBytes({ url: ownGrant.body.grant.url, bodyBase64: bodyBytes.toString("base64") }), "put bytes");
  if (!(put.status === 200 || put.status === 204)) fail(`presigned PUT: ${put.status} ${truncate(put.body)}`);
  const manifest = {
    protocolVersion: 1,
    organizationId: A.organizationId, companyId: A.companyId, jobId: victim.ids.jobId, attempt,
    artifactId, objectKey, sha256: sha256Hex, sizeBytes: bodyBytes.length,
    contentType: "application/octet-stream", kind: "log", sensitivity: "restricted", retention: "run",
    // REQUIRED by the frozen manifest schema; omitting it answers `malformed` at the protocol
    // layer, which never reaches the fence or the tenant check.
    createdAt: new Date().toISOString(),
  };
  const hostileCommit = hostileOrSkip(() => H.artifactCommit({
    session: hostile.session, ...victimFence, workerId: hostile.ids.workerId, manifest, deviceKey: hostile.deviceKey,
  }), "hostile commit");
  const ownCommit = step(H.artifactCommit({
    session: victim.session, ...victimFence, manifest, deviceKey: victim.deviceKey,
  }), "own commit");
  if (ownCommit.body?.outcome !== "committed") fail(`the owner's own commit must succeed: ${truncate(responseFacts(ownCommit))}`);
  record("d2m.tenant.cross.outputs", {
    injectionFired: httpFired(hostileCommit),
    observedClassification: hostileCommit.status === FOREIGN_STATUS && hostileCommit.body?.code === FOREIGN_CODE
      ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed: ownCommit.body?.outcome === "committed",
  }, { hostile: responseFacts(hostileCommit), own: responseFacts(ownCommit) });

  // ── staged_inputs: the DOWNLOAD grant, on the now-COMMITTED artifact ───────
  // ★ THE CLASS (Codex P1 on PR #600, and the finding was right): *a surface certified through ONE
  // operation of a route that has TWO, each with its own tenant-scoped lookup.* The upload arm
  // above is a fence check over a key PREFIX; production staged-input resolution asks for a
  // `download` grant on an ALREADY-COMMITTED artifact, and that branch has its own tenant-scoped
  // `repos.jobArtifacts.findCommitted` and the tree's ONLY production `presignGet` call site
  // (`server/src/services/artifact-transfer-grant.ts`). A regression in EITHER would have left this
  // newly-required case green. So the classified arm is the download pair, on the artifact the
  // commit above just made real; the upload pair is kept as a recorded second observation.
  //
  // THE TWIN, fixed in the same PR rather than left standing: `d1.tenant.cross.staged_inputs`
  // certified the same surface the same one-sided way (`tests/d1/m1-fault-matrix.test.mjs`).
  const hostileDownload = hostileOrSkip(() => H.artifactTransferGrant({
    session: hostile.session, operation: "download", ...victimFence, workerId: hostile.ids.workerId,
    artifactId, expectedObjectKey: objectKey, expectedSha256: sha256Hex, maxBytes: bodyBytes.length,
    deviceKey: hostile.deviceKey,
  }), "hostile download grant");
  const ownDownload = step(H.artifactTransferGrant({
    session: victim.session, operation: "download", ...victimFence,
    artifactId, expectedObjectKey: objectKey, expectedSha256: sha256Hex, maxBytes: bodyBytes.length,
    deviceKey: victim.deviceKey,
  }), "own download grant");
  if (ownDownload.body?.outcome !== "download_granted") {
    fail(`the owner's own DOWNLOAD grant on its own committed artifact must succeed, else the foreign refusal proves nothing: ${truncate(responseFacts(ownDownload))}`);
  }
  record("d2m.tenant.cross.staged_inputs", {
    injectionFired: httpFired(hostileDownload),
    observedClassification: hostileDownload.status === FOREIGN_STATUS && hostileDownload.body?.code === FOREIGN_CODE
      ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed: ownDownload.body?.outcome === "download_granted",
  }, {
    hostileDownload: responseFacts(hostileDownload), ownDownload: responseFacts(ownDownload),
    uploadArmRecordedNotClassified: { hostile: responseFacts(hostileGrant), own: responseFacts(ownGrant) },
    note: "CLASSIFIED on the DOWNLOAD pair, over the committed artifact, because that is the branch production staged-input resolution takes and it carries its own tenant-scoped findCommitted and the tree's only presignGet. The upload pair is a second observation, not the control.",
  });

  // ── 7. cost rows, and the four legacy no-RLS tables ────────────────────────
  // ONE probe, three arms per table: the owner's own read through the PRODUCTION reader, the
  // attacker's identical read, and the SAME read with the tenant predicate REMOVED. The third is
  // the anti-vacuity control — without it `foreign === 0` is equally explained by an empty table.
  const legacy = step(H.probeLegacyTableIsolation({
    owner: {
      organizationId: A.organizationId, companyId: A.companyId, agentId: A.agentId,
      issueId: victim.ids.issueId, jobId: victim.ids.jobId, credentialId: randomUUID(),
    },
    // Suppressed, the "attacker" IS the owner, so every foreign read returns the owner's rows and
    // the case classifies `not_filtered` — never `filtered`, which is what a suppressed run must
    // not be able to claim.
    attacker: probeAttacker,
  }), "legacy tables");
  if (legacy.ok !== true) fail(`legacy-table probe: ${truncate(legacy)}`);
  detail.legacyTables = legacy.tables;

  for (const table of ["cost_events", "activity_log", "task_outputs", "provider_credentials"]) {
    const t = legacy.tables[table];
    if (!t) fail(`the legacy probe reported no ${table}`);
    if (!(t.own > 0)) fail(`${table}: the owner's own read must return its row: ${truncate(t)}`);
    if (!(t.unscoped > 0)) fail(`${table}: the predicate-removed read must return the row, or a zero foreign count proves nothing: ${truncate(t)}`);
    record(`d2m.tenant.legacy.${table}`, {
      injectionFired: probeIdentityWasForeign && typeof t.foreign === "number" && typeof t.own === "number" && typeof t.unscoped === "number",
      observedClassification: t.foreign === 0 && t.own > 0 ? "filtered_by_query_predicate_not_rls" : "not_filtered",
      positiveControlPassed: t.own > 0,
      antiVacuityObservedForeignRow: t.unscoped > 0,
    }, t);
  }

  const cost = legacy.tables.cost_events;
  if (!(cost.ownCents > 0)) fail(`the owner's own cost read must return a REAL charge, else the foreign zero proves nothing: ${truncate(cost)}`);
  record("d2m.tenant.cross.cost_rows", {
    injectionFired: probeIdentityWasForeign && typeof cost.foreign === "number",
    observedClassification: cost.foreign === 0 ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed: cost.own > 0 && cost.ownCents > 0,
  }, cost);

  // ── 8. tool calls ──────────────────────────────────────────────────────────
  const localRunId = randomUUID();
  const distributedRunId = randomUUID();
  const seededRuns = step(H.seedToolSurfaceRuns({
    companyId: A.companyId, agentId: A.agentId,
    localRunId, distributedRunId, jobId: victim.ids.jobId, attemptId: victim.ids.attemptId,
  }), "seed tool-surface runs");
  if (seededRuns.ok !== true) fail(`tool-surface run seed: ${truncate(seededRuns)}`);
  const toolProbe = step(H.probeToolSurfaceAtUse({
    victim: { companyId: A.companyId }, attacker: { companyId: probeAttacker.companyId },
    localRunId, distributedRunId,
  }), "tool surface");
  if (toolProbe.ok !== true) fail(`tool-surface probe: ${truncate(toolProbe)}`);
  if (toolProbe.own !== "admit") {
    fail(`the SAME resolver on the SAME run under the OWN Company must ADMIT, else the deny proves nothing: ${truncate(toolProbe)}`);
  }
  record("d2m.tenant.cross.tool_calls", {
    injectionFired: probeIdentityWasForeign && typeof toolProbe.cross === "string",
    observedClassification: toolProbe.cross === "deny" ? "denied_with_same_tenant_positive_control" : "not_denied",
    positiveControlPassed: toolProbe.own === "admit",
  }, {
    cross: toolProbe.cross, own: toolProbe.own,
    crossDistributed: toolProbe.crossDistributed, ownDistributed: toolProbe.distributed,
    localRunId, distributedRunId,
    note: "cross and own are the SAME LOCAL run id under different Companies, so they differ only in the fact under test; the distributed arms record the M1a freeze posture and are not the control.",
  });

  // ── 9. E5 clause 4 — redemption on a DIFFERENT lease ───────────────────────
  // LAST, and on TWO FRESH attempts of the SAME tenant, so the only thing that differs between
  // the control and the injected arm is WHICH LEASE is presented. A cross-tenant pair would be
  // testing tenancy (already case 5); this is the lease binding itself.
  const own = bringUp(A);
  const other = bringUp(A);
  const leaseNonce = randomBytes(6).toString("hex");
  const redeemable = (name) => {
    const id = randomUUID();
    const seeded = step(H.seedResolvableProviderSecretHandle({
      organizationId: A.organizationId, companyId: A.companyId, jobId: own.ids.jobId, handleId: id,
      secretName: `provider:d2m-wrong-lease-${name}-${leaseNonce}`,
      value: mint(`d2m-${randomBytes(24).toString("hex")}`),
    }), `redeemable handle ${name}`);
    if (seeded.ok !== true) fail(`redeemable handle seed: ${truncate(seeded)}`);
    return id;
  };
  const wrongLeaseHandle = redeemable("injected");
  const controlHandle = redeemable("control");
  const resolveOn = (leaseId, fenceToken, handleId, label) => step(H.resolveExecutionSecretHttp({
    session: own.session, workerId: own.ids.workerId, jobId: own.ids.jobId,
    attempt: own.offer.job.attempt, leaseId, fenceToken, handleId, deviceKey: own.deviceKey,
  }), label);

  const leaseControl = resolveOn(own.offer.leaseId, own.offer.fenceToken, controlHandle, "own-lease control resolve");
  const leaseControlResolved = leaseControl.status === 200 && leaseControl.body?.outcome === "resolved";
  if (!leaseControlResolved) {
    fail(`the own-lease control must RESOLVE, else the wrong-lease refusal proves nothing: ${truncate(responseFacts(leaseControl))}`);
  }
  // Suppressed, the arm presents its OWN lease, so it resolves and the row records
  // `injectionFired: false` — exactly what the lane's suppression control requires.
  const presentedLeaseId = suppressInjection ? own.offer.leaseId : other.offer.leaseId;
  const presentedFence = suppressInjection ? own.offer.fenceToken : other.offer.fenceToken;
  const wrong = resolveOn(presentedLeaseId, presentedFence, wrongLeaseHandle, "wrong-lease resolve");
  const denials = step(H.querySecretResolveDenials({
    organizationId: A.organizationId, jobId: own.ids.jobId, handleId: wrongLeaseHandle,
  }), "denial audit");
  record("d2m.credential.wrong_lease_redemption_refused", {
    // The injection IS the substitution: presenting a lease that is not this attempt's.
    injectionFired: presentedLeaseId !== own.offer.leaseId,
    observedClassification: leaseControlResolved && wrong.status === 200 && wrong.body?.outcome === "denied"
      ? "redemption_refused_on_foreign_lease_with_own_lease_control" : "not_refused",
    positiveControlPassed: leaseControlResolved,
  }, {
    control: responseFacts(leaseControl),
    wrongLease: responseFacts(wrong),
    presentedAnotherAttemptsLease: presentedLeaseId !== own.offer.leaseId,
    // ★ The classification is the PAIR, not the reason. The route deliberately is not an oracle
    // for which lease exists, so a wrong-lease presentation may come back `stale_fence` or reach
    // the catch-all `malformed`. What is mutation-sensitive is that the IDENTICAL request with
    // the correct lease resolves.
    durableDenialReasons: denials.ok ? denials.reasons : { error: denials.error ?? null },
  });

  // ── the phase's own verdict ────────────────────────────────────────────────
  const unfired = rows.filter((r) => r.injectionFired !== true);
  const notDenied = rows.filter((r) => /^(not_denied|not_refused|not_filtered)$/.test(String(r.observedClassification)));
  const noControl = rows.filter((r) => r.positiveControlPassed !== true);
  for (const r of unfired) log(`${CROSS_TENANT_EVIDENCE_MARKER} injection_did_not_fire case=${r.case}`);
  for (const r of notDenied) log(`${CROSS_TENANT_EVIDENCE_MARKER} not_denied case=${r.case}`);
  for (const r of noControl) log(`${CROSS_TENANT_EVIDENCE_MARKER} positive_control_failed case=${r.case}`);
  for (const v of deferred) log(`${CROSS_TENANT_EVIDENCE_MARKER} ${v.code} ${v.message}`);
  if (unfired.length > 0 || notDenied.length > 0 || noControl.length > 0 || deferred.length > 0) {
    fail(
      `the cross-tenant phase refuses its own observations: ` +
      `${unfired.length} injection(s) did not fire, ${notDenied.length} not denied, ` +
      `${noControl.length} without a positive control, ${deferred.length} shared-verdict violation(s)` +
      (deferred.length > 0 ? `\n${formatIsolationViolations(deferred)}` : ""),
      // The rows ride ALONG with the refusal: on the suppressed run this IS the evidence.
      { rows, detail },
    );
  }
  log(`cross-tenant: ${rows.length} case(s) driven, every injection fired, every same-tenant control passed`);
  return { rows, detail, suppressInjection };
}

/** The D1 harness, resolved relative to THIS file. Imported lazily, inside the call, because its
 * stack binding is read from `process.env` at module load and the driver sets that binding
 * immediately before calling in. */
function harnessUrl() {
  return new URL("../../tests/d1/lib/e6f-harness.mjs", import.meta.url).href;
}

export { CrossTenantError };
