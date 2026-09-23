// DEP-016 — self-test for the m1-spine profile's verdict functions (pure, no Docker, no PG).
//
//   node --test scripts/lib/__tests__/m1-spine-assertions.test.mjs
//
// The LIVE profile (tests/d1/m1-spine.test.mjs) gathers rows from a real D1 stack and hands them
// to these functions; this file proves each function can say NO. Every verdict has a passing
// anchor (zero violations on a well-formed observation) and at least one defect fixture that
// flips exactly one fact and must produce the named violation. A verdict function that returned
// [] for everything would pass the live run and fail here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  M1_SPINE_TENANTS,
  M1_SPINE_ROLLOUT_ENV_VALUE,
  M1_SPINE_COST_MARKER,
  M1_SPINE_AGENT_MODEL,
  M1_SPINE_AGENT_ADAPTER_TYPE,
  M1_SPINE_RATE_VERSION,
  M1_SPINE_CANNED_UNITS,
  M1_SPINE_EXPECTED_COST_CENTS,
  M1_SPINE_USAGE_MARKER,
  evaluateSpineOverrideText,
  evaluateReplicaRollout,
  evaluateEnabledTenantSpine,
  evaluateControlTenant,
  evaluateCrossTenantIsolation,
  evaluateEnvProbeObservability,
  evaluateRollbackRehearsal,
  DRAIN_AUDIT_ACTION,
  DRAIN_REASON,
  ENV_PROBE_LOG_PREFIX,
} from "../m1-spine-assertions.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const [A, B] = M1_SPINE_TENANTS.enabled;
const C = M1_SPINE_TENANTS.control;

const codes = (violations) => violations.map((v) => v.code).sort();

// ── the tenant set ──────────────────────────────────────────────────────────

test("the tenant set is three DISTINCT Organizations: two enabled, one control (F10)", () => {
  assert.equal(M1_SPINE_TENANTS.enabled.length, 2);
  const orgs = new Set([A.organizationId, B.organizationId, C.organizationId]);
  const companies = new Set([A.companyId, B.companyId, C.companyId]);
  assert.equal(orgs.size, 3, "three distinct Organizations");
  assert.equal(companies.size, 3, "three distinct Companies");
  const parsed = JSON.parse(M1_SPINE_ROLLOUT_ENV_VALUE);
  assert.deepEqual(Object.keys(parsed.organizations).sort(), [A.organizationId, B.organizationId].sort());
  assert.ok(!(C.organizationId in parsed.organizations), "the control Organization is ABSENT from the map");
});

// ── the committed override file ─────────────────────────────────────────────

test("the committed m1-spine override has zero violations (anchor)", () => {
  const text = readFileSync(path.join(repoRoot, "docker", "d1", "m1-spine.override.yml"), "utf8");
  assert.deepEqual(evaluateSpineOverrideText(text), []);
});

test("an override that sets the rollout on only ONE replica is refused", () => {
  const text = readFileSync(path.join(repoRoot, "docker", "d1", "m1-spine.override.yml"), "utf8");
  const firstAt = text.indexOf(M1_SPINE_ROLLOUT_ENV_VALUE);
  const oneReplica = text.slice(0, firstAt) + "{}" + text.slice(firstAt + M1_SPINE_ROLLOUT_ENV_VALUE.length);
  assert.ok(codes(evaluateSpineOverrideText(oneReplica)).includes("override:rollout_not_on_every_replica"));
});

test("BOTH assignments under ONE replica is refused — the count is per block (Codex P2)", () => {
  const text = readFileSync(path.join(repoRoot, "docker", "d1", "m1-spine.override.yml"), "utf8");
  const assignment = `      AOA_DISTRIBUTED_EXECUTION_ROLLOUT: '${M1_SPINE_ROLLOUT_ENV_VALUE}'`;
  // Move control-plane-b's assignment into control-plane's block: the file still contains two
  // matching assignments and both service headers, which a file-wide count would accept.
  const moved = text.replace(`${assignment}\n`, `${assignment}\n${assignment}\n`).replace(new RegExp(`\n${assignment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\s\\S]*${assignment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`), "");
  assert.equal((moved.match(/AOA_DISTRIBUTED_EXECUTION_ROLLOUT:/g) ?? []).length, 2, "the fixture keeps two assignments");
  assert.ok(codes(evaluateSpineOverrideText(moved)).includes("override:rollout_not_on_every_replica"));
});

test("an override that arms the crew switch is refused", () => {
  const text = readFileSync(path.join(repoRoot, "docker", "d1", "m1-spine.override.yml"), "utf8");
  const armed = text.replace("  control-plane:\n    environment:\n", "  control-plane:\n    environment:\n      AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED: \"true\"\n");
  assert.notEqual(armed, text, "fixture must actually inject the flag");
  assert.ok(codes(evaluateSpineOverrideText(armed)).includes("override:crew_switch_present"));
});

test("an override that keeps worker-a in the default profile is refused (one-worker topology)", () => {
  const text = readFileSync(path.join(repoRoot, "docker", "d1", "m1-spine.override.yml"), "utf8");
  const twoWorker = text.replace(/  worker-a:\n    profiles: \[[^\]]*\]\n/, "");
  assert.notEqual(twoWorker, text, "fixture must actually remove the profile");
  assert.ok(codes(evaluateSpineOverrideText(twoWorker)).includes("override:worker_a_not_excluded"));
});

// ── per-replica rollout + crew switch ───────────────────────────────────────

function goodReplica(overrides = {}) {
  return {
    replica: "control-plane",
    rolloutRaw: M1_SPINE_ROLLOUT_ENV_VALUE,
    deploymentEnabled: true,
    resolved: { [A.organizationId]: "canary", [B.organizationId]: "canary", [C.organizationId]: "off" },
    crewRaw: null,
    crewEnabled: false,
    toolSurfaceRaw: null,
    toolSurfaceArmed: false,
    organizationToolSurface: { [A.organizationId]: false, [B.organizationId]: false, [C.organizationId]: false },
    ...overrides,
  };
}

test("a replica with the declared tenant set and the crew switch off has zero violations (anchor)", () => {
  assert.deepEqual(evaluateReplicaRollout(goodReplica()), []);
});

test("a replica whose rollout differs from the declared value is refused", () => {
  const v = evaluateReplicaRollout(goodReplica({ rolloutRaw: "{}" }));
  assert.ok(codes(v).includes("rollout:value_mismatch"));
});

test("a replica on which the CONTROL tenant resolves to anything but off is refused", () => {
  const v = evaluateReplicaRollout(goodReplica({
    resolved: { [A.organizationId]: "canary", [B.organizationId]: "canary", [C.organizationId]: "canary" },
  }));
  assert.ok(codes(v).includes("rollout:control_not_off"));
});

test("a replica on which an ENABLED tenant resolves to off is refused", () => {
  const v = evaluateReplicaRollout(goodReplica({
    resolved: { [A.organizationId]: "off", [B.organizationId]: "canary", [C.organizationId]: "off" },
  }));
  assert.ok(codes(v).includes("rollout:enabled_tenant_not_canary"));
});

test("a replica with the crew switch ON, or set to an unparseable value, is refused", () => {
  assert.ok(codes(evaluateReplicaRollout(goodReplica({ crewRaw: "true", crewEnabled: true }))).includes("crew:switch_on"));
  assert.ok(codes(evaluateReplicaRollout(goodReplica({ crewRaw: "maybe", crewEnabled: null }))).includes("crew:switch_unparseable"));
  // A false spelling is OFF, which is allowed.
  assert.deepEqual(evaluateReplicaRollout(goodReplica({ crewRaw: "false", crewEnabled: false })), []);
});

test("a replica with the TOOL SURFACE armed, unparseable, or opted in per-Organization is refused (M1a freeze)", () => {
  assert.ok(codes(evaluateReplicaRollout(goodReplica({ toolSurfaceRaw: "per-organization", toolSurfaceArmed: true }))).includes("tools:deployment_armed"));
  assert.ok(codes(evaluateReplicaRollout(goodReplica({ toolSurfaceRaw: "true", toolSurfaceArmed: null }))).includes("tools:flag_unparseable"));
  assert.ok(codes(evaluateReplicaRollout(goodReplica({
    organizationToolSurface: { [A.organizationId]: true, [B.organizationId]: false, [C.organizationId]: false },
  }))).includes("tools:organization_opted_in"));
});

test("a replica with the deployment flag off is refused (the profile would run nothing distributed)", () => {
  assert.ok(codes(evaluateReplicaRollout(goodReplica({ deploymentEnabled: false }))).includes("rollout:deployment_disabled"));
});

// ── an enabled tenant's journey: cost + receipt + audit ─────────────────────

function goodEnabled(tenant = A, overrides = {}) {
  const usageEventId = "11111111-1111-4111-8111-111111111111";
  const startedEventId = "55555555-5555-4555-8555-555555555555";
  const costRowId = "aaaaaaa1-0000-4000-8000-00000000000a";
  const startedActivityId = "bbbbbbb1-0000-4000-8000-00000000000b";
  const terminalActivityId = "ccccccc1-0000-4000-8000-00000000000c";
  const terminalEventId = "66666666-6666-4666-8666-666666666666";
  return {
    tenant,
    observation: {
      acceptedThroughSeq: 3,
      events: [
        { eventId: startedEventId, eventType: "attempt_started" },
        { eventId: usageEventId, eventType: "usage" },
        { eventId: terminalEventId, eventType: "terminal" },
      ],
      attemptStatus: "succeeded",
      expectedUnits: { inputTokens: 120000, outputTokens: 30000, cachedInputTokens: 0, runtimeMillis: 4200 },
      usageEvents: [{
        eventId: usageEventId,
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        payload: { inputTokens: 120000, outputTokens: 30000, cachedInputTokens: 0, runtimeMillis: 4200 },
      }],
      expectedActorId: "worker:33333333-3333-4333-8333-333333333333",
      costRows: [{
        id: costRowId,
        companyId: tenant.companyId,
        agentId: tenant.agentId,
        costCents: 81,
        provider: M1_SPINE_AGENT_ADAPTER_TYPE,
        model: M1_SPINE_AGENT_MODEL,
        rateId: M1_SPINE_AGENT_MODEL,
        rateVersion: M1_SPINE_RATE_VERSION,
        inputTokens: 120000,
        outputTokens: 30000,
        cachedInputTokens: 0,
        sourceIdempotencyKey: `cost:${tenant.companyId}:${usageEventId}`,
      }],
      costReceipts: [{
        status: "applied",
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        sourceIdentity: `cost:${tenant.companyId}:${usageEventId}`,
        aggregateKind: "cost_events",
        targetAggregateId: costRowId,
      }],
      activity: [
        { id: startedActivityId, action: "job.attempt_started", companyId: tenant.companyId, actorType: "system", actorId: "worker:33333333-3333-4333-8333-333333333333" },
        { id: terminalActivityId, action: "job.attempt_terminal", companyId: tenant.companyId, actorType: "system", actorId: "worker:33333333-3333-4333-8333-333333333333" },
      ],
      auditReceipts: [
        { status: "applied", organizationId: tenant.organizationId, companyId: tenant.companyId, sourceIdentity: `activity:${tenant.companyId}:${startedEventId}`, aggregateKind: "activity_log", targetAggregateId: startedActivityId },
        { status: "applied", organizationId: tenant.organizationId, companyId: tenant.companyId, sourceIdentity: `activity:${tenant.companyId}:${terminalEventId}`, aggregateKind: "activity_log", targetAggregateId: terminalActivityId },
      ],
      ...overrides,
    },
  };
}

test("a well-formed enabled-tenant observation has zero violations (anchor)", () => {
  assert.deepEqual(evaluateEnabledTenantSpine(goodEnabled(A)), []);
  assert.deepEqual(evaluateEnabledTenantSpine(goodEnabled(B)), []);
});

test("NO cost row (the usage-suppressed positive control's state) is a cost violation carrying the marker", () => {
  const v = evaluateEnabledTenantSpine(goodEnabled(A, { costRows: [], costReceipts: [] }));
  assert.ok(codes(v).includes("cost:no_cost_row"));
  assert.ok(codes(v).includes("cost:receipt_missing"));
  for (const violation of v.filter((x) => x.code.startsWith("cost:"))) {
    assert.ok(violation.message.includes(M1_SPINE_COST_MARKER), "every cost violation carries the grep marker");
  }
});

test("the expected charge is DERIVED, and equals 81 cents for the canned units at rate version 1", () => {
  assert.equal(M1_SPINE_EXPECTED_COST_CENTS, 81);
  assert.deepEqual(M1_SPINE_CANNED_UNITS, { inputTokens: 120000, outputTokens: 30000, cachedInputTokens: 0, runtimeMillis: 4200 });
});

test("a POSITIVE charge of the wrong AMOUNT is refused (Codex)", () => {
  const obs = goodEnabled(A).observation;
  for (const cents of [1, 80, 82, 810]) {
    const v = evaluateEnabledTenantSpine(goodEnabled(A, { costRows: [{ ...obs.costRows[0], costCents: cents }] }));
    assert.ok(codes(v).includes("cost:unexpected_amount"), `${cents} cents must red`);
    assert.ok(!codes(v).includes("cost:zero_cost"), "it is still positive — that is the point");
  }
});

test("units that are not the canned ones are refused, so the amount expectation cannot detach", () => {
  const v = evaluateEnabledTenantSpine(goodEnabled(A, {
    expectedUnits: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, runtimeMillis: 1 },
  }));
  assert.ok(codes(v).includes("usage:units_not_canned"));
});

test("a ZERO-cost row is refused", () => {
  const obs = goodEnabled(A).observation;
  const v = evaluateEnabledTenantSpine(goodEnabled(A, { costRows: [{ ...obs.costRows[0], costCents: 0 }] }));
  assert.ok(codes(v).includes("cost:zero_cost"));
});

test("TWO cost rows for one attempt are refused (exactly one)", () => {
  const obs = goodEnabled(A).observation;
  const v = evaluateEnabledTenantSpine(goodEnabled(A, { costRows: [obs.costRows[0], obs.costRows[0]] }));
  assert.ok(codes(v).includes("cost:not_exactly_one"));
});

test("a cost row attributed to ANOTHER tenant's Company is refused (F10 attribution)", () => {
  const obs = goodEnabled(A).observation;
  const v = evaluateEnabledTenantSpine(goodEnabled(A, { costRows: [{ ...obs.costRows[0], companyId: B.companyId }] }));
  assert.ok(codes(v).includes("cost:wrong_company"));
});

test("a pending, duplicated or foreign authoritative_cost receipt is refused", () => {
  const ok = goodEnabled(A).observation.costReceipts[0];
  assert.ok(codes(evaluateEnabledTenantSpine(goodEnabled(A, { costReceipts: [{ ...ok, status: "pending" }] }))).includes("cost:receipt_not_applied"));
  assert.ok(codes(evaluateEnabledTenantSpine(goodEnabled(A, { costReceipts: [ok, ok] }))).includes("cost:receipt_not_exactly_one"));
  assert.ok(codes(evaluateEnabledTenantSpine(goodEnabled(A, { costReceipts: [{ ...ok, organizationId: B.organizationId }] }))).includes("cost:receipt_wrong_tenant"));
});

test("an authoritative_cost receipt bound to a DIFFERENT event, or the wrong aggregate, is refused (Codex P2)", () => {
  const ok = goodEnabled(A).observation.costReceipts[0];
  const otherEvent = evaluateEnabledTenantSpine(goodEnabled(A, {
    costReceipts: [{ ...ok, sourceIdentity: `cost:${A.companyId}:99999999-9999-4999-8999-999999999999` }],
  }));
  assert.ok(codes(otherEvent).includes("cost:receipt_not_keyed_to_event"));
  const wrongAggregate = evaluateEnabledTenantSpine(goodEnabled(A, { costReceipts: [{ ...ok, aggregateKind: "activity_log" }] }));
  assert.ok(codes(wrongAggregate).includes("cost:receipt_wrong_aggregate"));
});

test("a missing, duplicated or foreign audit row is refused (JOB-017 named set)", () => {
  const obs = goodEnabled(A).observation;
  assert.ok(codes(evaluateEnabledTenantSpine(goodEnabled(A, { activity: [obs.activity[1]] }))).includes("audit:missing_attempt_started"));
  assert.ok(codes(evaluateEnabledTenantSpine(goodEnabled(A, { activity: [obs.activity[0]] }))).includes("audit:missing_attempt_terminal"));
  assert.ok(codes(evaluateEnabledTenantSpine(goodEnabled(A, { activity: [...obs.activity, obs.activity[0]] }))).includes("audit:duplicate_attempt_started"));
  assert.ok(codes(evaluateEnabledTenantSpine(goodEnabled(A, {
    activity: [obs.activity[0], { ...obs.activity[1], companyId: B.companyId }],
  }))).includes("audit:wrong_company"));
});

// ── usage cardinality: the WRK-018 acceptance-1 collection point ────────────

test("a DUPLICATE accepted usage event is refused — exactly one, never >= 1", () => {
  const obs = goodEnabled(A).observation;
  const duplicate = { ...obs.usageEvents[0], eventId: "22222222-2222-4222-8222-222222222222" };
  const v = evaluateEnabledTenantSpine(goodEnabled(A, { usageEvents: [obs.usageEvents[0], duplicate] }));
  assert.ok(codes(v).includes("usage:not_exactly_one"));
  for (const violation of v.filter((x) => x.code.startsWith("usage:"))) {
    assert.ok(violation.message.includes(M1_SPINE_USAGE_MARKER), "every usage violation carries the grep marker");
  }
});

test("ZERO accepted usage events is refused, and distinctly from a duplicate", () => {
  const v = evaluateEnabledTenantSpine(goodEnabled(A, { usageEvents: [], costRows: [], costReceipts: [] }));
  assert.ok(codes(v).includes("usage:no_usage_event"));
  assert.ok(!codes(v).includes("usage:not_exactly_one"));
});

test("a usage event of ANOTHER Organization never counts toward this tenant's one (F10)", () => {
  const obs = goodEnabled(A).observation;
  const foreign = { ...obs.usageEvents[0], organizationId: B.organizationId, companyId: B.companyId };
  const v = evaluateEnabledTenantSpine(goodEnabled(A, { usageEvents: [foreign] }));
  assert.ok(codes(v).includes("usage:wrong_tenant"));
});

test("stored usage units that differ from the ones the provider reported are refused", () => {
  const obs = goodEnabled(A).observation;
  const tampered = { ...obs.usageEvents[0], payload: { ...obs.usageEvents[0].payload, outputTokens: 1 } };
  const v = evaluateEnabledTenantSpine(goodEnabled(A, { usageEvents: [tampered] }));
  assert.ok(codes(v).includes("usage:units_differ"));
});

test("a cost row whose tokens or key are not the accepted usage event's is refused", () => {
  const obs = goodEnabled(A).observation;
  const wrongTokens = evaluateEnabledTenantSpine(goodEnabled(A, { costRows: [{ ...obs.costRows[0], outputTokens: 7 }] }));
  assert.ok(codes(wrongTokens).includes("usage:row_units_differ"));
  const wrongKey = evaluateEnabledTenantSpine(goodEnabled(A, {
    costRows: [{ ...obs.costRows[0], sourceIdempotencyKey: `cost:${A.companyId}:99999999-9999-4999-8999-999999999999` }],
  }));
  assert.ok(codes(wrongKey).includes("usage:row_not_keyed_to_event"));
});

test("a POSITIVE charge priced from another model, provider or rate version is refused (Codex P2)", () => {
  const obs = goodEnabled(A).observation;
  for (const [field, value] of [["model", "claude-opus-4-6"], ["provider", "openai"], ["rateId", "gpt-4o"], ["rateVersion", 2]]) {
    const v = evaluateEnabledTenantSpine(goodEnabled(A, { costRows: [{ ...obs.costRows[0], [field]: value }] }));
    assert.ok(codes(v).includes("cost:wrong_rate_metadata"), `${field} must be checked`);
    assert.ok(!codes(v).includes("cost:zero_cost"), "the charge is still positive — that is the point");
  }
});

test("a cost row rolled up to ANOTHER agent of the same Company is refused (Codex P2)", () => {
  const obs = goodEnabled(A).observation;
  const v = evaluateEnabledTenantSpine(goodEnabled(A, { costRows: [{ ...obs.costRows[0], agentId: B.agentId }] }));
  assert.ok(codes(v).includes("cost:wrong_agent"));
  assert.ok(!codes(v).includes("cost:wrong_company"), "the Company is still right — only the agent moved");
});

test("an audit row naming a DIFFERENT worker, or a non-system actor, is refused (Codex P2)", () => {
  const obs = goodEnabled(A).observation;
  const otherWorker = evaluateEnabledTenantSpine(goodEnabled(A, {
    activity: [obs.activity[0], { ...obs.activity[1], actorId: "worker:44444444-4444-4444-8444-444444444444" }],
  }));
  assert.ok(codes(otherWorker).includes("audit:wrong_actor"));
  const wrongType = evaluateEnabledTenantSpine(goodEnabled(A, {
    activity: [obs.activity[0], { ...obs.activity[1], actorType: "user" }],
  }));
  assert.ok(codes(wrongType).includes("audit:wrong_actor"));
});

test("activity_audit receipts keyed to the WRONG events, or the wrong aggregate, are refused (Codex P2)", () => {
  const obs = goodEnabled(A).observation;
  const strayIdentity = evaluateEnabledTenantSpine(goodEnabled(A, {
    auditReceipts: [obs.auditReceipts[0], { ...obs.auditReceipts[1], sourceIdentity: `activity:${A.companyId}:88888888-8888-4888-8888-888888888888` }],
  }));
  assert.ok(codes(strayIdentity).includes("audit:receipt_not_keyed_to_events"));
  const wrongAggregate = evaluateEnabledTenantSpine(goodEnabled(A, {
    auditReceipts: [obs.auditReceipts[0], { ...obs.auditReceipts[1], aggregateKind: "cost_events" }],
  }));
  assert.ok(codes(wrongAggregate).includes("audit:receipt_wrong_aggregate"));
});

test("a receipt whose TARGET is an unrelated row is refused (Codex P2)", () => {
  const obs = goodEnabled(A).observation;
  const costTarget = evaluateEnabledTenantSpine(goodEnabled(A, {
    costReceipts: [{ ...obs.costReceipts[0], targetAggregateId: "ddddddd1-0000-4000-8000-00000000000d" }],
  }));
  assert.ok(codes(costTarget).includes("cost:receipt_target_mismatch"));
  const auditTarget = evaluateEnabledTenantSpine(goodEnabled(A, {
    auditReceipts: [obs.auditReceipts[0], { ...obs.auditReceipts[1], targetAggregateId: "ddddddd1-0000-4000-8000-00000000000d" }],
  }));
  assert.ok(codes(auditTarget).includes("audit:receipt_target_mismatch"));
});

test("SWAPPED audit receipt targets are refused — set equality would have passed them (Codex)", () => {
  const obs = goodEnabled(A).observation;
  const swapped = [
    { ...obs.auditReceipts[0], targetAggregateId: obs.auditReceipts[1].targetAggregateId },
    { ...obs.auditReceipts[1], targetAggregateId: obs.auditReceipts[0].targetAggregateId },
  ];
  // The two sets are identical — only the pairing moved.
  assert.deepEqual(
    swapped.map((r) => r.targetAggregateId).sort(),
    obs.auditReceipts.map((r) => r.targetAggregateId).sort(),
  );
  const v = evaluateEnabledTenantSpine(goodEnabled(A, { auditReceipts: swapped }));
  assert.ok(codes(v).includes("audit:receipt_target_mismatch"));
});

test("a journey the ingest did not fully accept is refused before cost is judged", () => {
  const v = evaluateEnabledTenantSpine(goodEnabled(A, { attemptStatus: "running" }));
  assert.ok(codes(v).includes("journey:attempt_not_succeeded"));
});

// ── hostile cross-tenant isolation (F10) ────────────────────────────────────

function goodIsolation(overrides = {}) {
  return {
    hostileEventUpload: { status: 401, ackStatus: null, code: "unauthorized" },
    ownEventUpload: { status: 200, ackStatus: "accepted" },
    hostileAck: { status: 409, outcome: null, code: "stale_fence" },
    foreignScopeEventCount: 0,
    ownScopeEventCount: 3,
    costRowsBeforeHostile: 1,
    costRowsAfterHostile: 1,
    usageEventsBeforeHostile: 1,
    usageEventsAfterHostile: 1,
    ...overrides,
  };
}

test("a denied hostile pair with its same-tenant control has zero violations (anchor)", () => {
  assert.deepEqual(evaluateCrossTenantIsolation(goodIsolation()), []);
});

test("a foreign worker whose event upload is ACCEPTED is refused", () => {
  const v = evaluateCrossTenantIsolation(goodIsolation({ hostileEventUpload: { status: 200, ackStatus: "accepted" } }));
  assert.ok(v.map((x) => x.code).includes("isolation:foreign_event_accepted"));
});

test("a denial whose SAME-TENANT control also failed proves nothing and is refused", () => {
  const v = evaluateCrossTenantIsolation(goodIsolation({ ownEventUpload: { status: 409, ackStatus: null } }));
  assert.ok(v.map((x) => x.code).includes("isolation:own_event_denied"));
});

test("a hostile request that merely FAILED is not a denial (Codex P2)", () => {
  for (const upload of [
    { status: 500, ackStatus: null, code: "internal_unavailable" },
    { status: 0, ackStatus: null, code: null },
    { status: 401, ackStatus: null, code: "malformed" },
  ]) {
    assert.ok(
      evaluateCrossTenantIsolation(goodIsolation({ hostileEventUpload: upload })).map((x) => x.code)
        .includes("isolation:foreign_event_not_denied"),
      JSON.stringify(upload),
    );
  }
  assert.ok(
    evaluateCrossTenantIsolation(goodIsolation({ hostileAck: { status: 500, outcome: null, code: null } }))
      .map((x) => x.code).includes("isolation:foreign_ack_not_denied"),
  );
});

test("a foreign worker acknowledging another tenant's lease is refused", () => {
  const v = evaluateCrossTenantIsolation(goodIsolation({ hostileAck: { status: 200, outcome: "acknowledged" } }));
  assert.ok(v.map((x) => x.code).includes("isolation:foreign_ack_accepted"));
});

test("a foreign tenant scope that can READ the victim's events is refused, and an empty own-scope read voids it", () => {
  assert.ok(evaluateCrossTenantIsolation(goodIsolation({ foreignScopeEventCount: 3 })).map((x) => x.code)
    .includes("isolation:foreign_scope_reads_events"));
  assert.ok(evaluateCrossTenantIsolation(goodIsolation({ ownScopeEventCount: 0 })).map((x) => x.code)
    .includes("isolation:own_scope_reads_nothing"));
});

test("hostile traffic that changed the victim's cost rows or usage events is refused", () => {
  assert.ok(evaluateCrossTenantIsolation(goodIsolation({ costRowsAfterHostile: 2 })).map((x) => x.code)
    .includes("isolation:cost_moved"));
  assert.ok(evaluateCrossTenantIsolation(goodIsolation({ usageEventsAfterHostile: 2 })).map((x) => x.code)
    .includes("isolation:usage_moved"));
});

// ── criterion 5: the DEP-017 env probe is NOT observed on this lane ─────────

test("recording criterion 5 as unobserved, with no probe summary on the attempt, has zero violations (anchor)", () => {
  assert.deepEqual(evaluateEnvProbeObservability({ declaredObserved: false, logMessages: ["hello", "world"] }), []);
});

test("a probe summary on the attempt while the record says unobserved is refused (the tripwire)", () => {
  const v = evaluateEnvProbeObservability({
    declaredObserved: false,
    logMessages: [`${ENV_PROBE_LOG_PREFIX}{"verdict":"absent"}`],
  });
  assert.ok(v.map((x) => x.code).includes("criterion5:probe_emitted_but_recorded_unobserved"));
});

test("CLAIMING criterion 5 without a summary is refused", () => {
  const v = evaluateEnvProbeObservability({ declaredObserved: true, logMessages: [] });
  assert.ok(v.map((x) => x.code).includes("criterion5:claimed_without_summary"));
});

// ── the control tenant ──────────────────────────────────────────────────────

function goodControl(overrides = {}) {
  return {
    tenant: C,
    observation: {
      placements: [
        { replica: "control-plane", disposition: "legacy", leaseEligible: false, reasonCode: "organization_disabled" },
        { replica: "control-plane-b", disposition: "legacy", leaseEligible: false, reasonCode: "organization_disabled" },
      ], // a superset is allowed; the RUNNING control plane's placement is what is required
      positiveControlPlacement: { replica: "control-plane", tenant: "A", disposition: "selected", mode: "active", leaseEligible: true, reasonCode: "target_selected" },
      pollOutcome: "no_work",
      jobEvents: 0,
      costRowsForCompany: 0,
      receipts: 0,
      ...overrides,
    },
  };
}

test("a refused control tenant has zero violations (anchor)", () => {
  assert.deepEqual(evaluateControlTenant(goodControl()), []);
});

test("a control tenant placed distributed on ANY replica is refused", () => {
  const v = evaluateControlTenant(goodControl({
    placements: [
      { replica: "control-plane", disposition: "legacy", leaseEligible: false, reasonCode: "organization_disabled" },
      { replica: "control-plane-b", disposition: "selected", leaseEligible: true, reasonCode: "target_selected" },
    ],
  }));
  assert.ok(codes(v).includes("control:placed_distributed"));
});

test("a control tenant refused for the WRONG reason is refused (it must be the rollout)", () => {
  const v = evaluateControlTenant(goodControl({
    placements: [
      { replica: "control-plane", disposition: "legacy", leaseEligible: false, reasonCode: "deployment_disabled" },
      { replica: "control-plane-b", disposition: "legacy", leaseEligible: false, reasonCode: "organization_disabled" },
    ],
  }));
  assert.ok(codes(v).includes("control:wrong_reason"));
});

test("a positive control that is legacy, queued, failed or not lease-eligible is refused (Codex P1)", () => {
  for (const pc of [
    { disposition: "legacy", mode: "legacy", leaseEligible: false, reasonCode: "organization_disabled" },
    { disposition: "queued", mode: "active", leaseEligible: false, reasonCode: "no_eligible_target" },
    { disposition: "failed", mode: "active", leaseEligible: false, reasonCode: "invalid_placement_input" },
    { disposition: "selected", mode: "active", leaseEligible: false, reasonCode: "target_selected" },
  ]) {
    const v = evaluateControlTenant(goodControl({ positiveControlPlacement: { replica: "control-plane", tenant: "A", ...pc } }));
    assert.ok(codes(v).includes("control:positive_control_not_selected"), JSON.stringify(pc));
  }
});

test("a positive-control placement that ERRORED is not a decision, and voids the refusal", () => {
  const v = evaluateControlTenant(goodControl({ positiveControlPlacement: { replica: "control-plane", tenant: "A", error: "connection refused" } }));
  assert.ok(codes(v).includes("control:positive_control_not_selected"));
});

test("a control tenant that was offered work, or that has events, cost or receipts, is refused", () => {
  assert.ok(codes(evaluateControlTenant(goodControl({ pollOutcome: "offer" }))).includes("control:offered_work"));
  assert.ok(codes(evaluateControlTenant(goodControl({ jobEvents: 1 }))).includes("control:has_job_events"));
  assert.ok(codes(evaluateControlTenant(goodControl({ costRowsForCompany: 1 }))).includes("control:has_cost_rows"));
  assert.ok(codes(evaluateControlTenant(goodControl({ receipts: 1 }))).includes("control:has_receipts"));
});

test("a control observation missing the RUNNING control plane's placement is refused", () => {
  // The spine runs ONE control plane (Codex P1, PR #566), so the requirement is "the running one",
  // not "two". A placement observed only on a replica the profile does not start proves nothing.
  const v = evaluateControlTenant(goodControl({ placements: [goodControl().observation.placements[1]] }));
  assert.ok(codes(v).includes("control:not_every_replica"));
});

// ── the rollback rehearsal (MIG-009) ────────────────────────────────────────

function goodRehearsal(overrides = {}) {
  const drainableJobs = [
    { tenantKey: "A", organizationId: A.organizationId, companyId: A.companyId, jobId: "a0000000-0000-4000-8000-00000000000a", attemptId: "a1000000-0000-4000-8000-00000000000a" },
    { tenantKey: "B", organizationId: B.organizationId, companyId: B.companyId, jobId: "b0000000-0000-4000-8000-00000000000b", attemptId: "b1000000-0000-4000-8000-00000000000b" },
  ];
  return {
    exitCode: 0,
    expectedActorId: "operator-cli:m1-spine-1234abcd",
    drainableJobs,
    auditRows: [...drainableJobs, { jobId: "d0000000-0000-4000-8000-00000000000d", organizationId: A.organizationId, companyId: A.companyId }].map((job) => ({
      action: DRAIN_AUDIT_ACTION,
      entityId: job.jobId,
      organizationId: null,
      detailsOrganizationId: job.organizationId,
      companyId: job.companyId,
      actorType: "system",
      actorId: "operator-cli:m1-spine-1234abcd",
      detailsReason: DRAIN_REASON,
    })),
    terminalJobIds: ["c0000000-0000-4000-8000-00000000000c"],
    preDrainCandidates: [
      ...drainableJobs.map((job) => ({ ...job, activeLeases: 0, disposition: "selected" })),
      { jobId: "d0000000-0000-4000-8000-00000000000d", attemptId: "d1000000-0000-4000-8000-00000000000d", organizationId: A.organizationId, companyId: A.companyId, activeLeases: 1, activeLeaseId: "f1000000-0000-4000-8000-00000000000f", disposition: "selected" },
    ],
    attempts: [
      ...drainableJobs.map((job) => ({ attemptId: job.attemptId, jobId: job.jobId, status: "cancelled" })),
      { attemptId: "d1000000-0000-4000-8000-00000000000d", jobId: "d0000000-0000-4000-8000-00000000000d", status: "cancel_requested" },
      { attemptId: "c1000000-0000-4000-8000-00000000000c", jobId: "c0000000-0000-4000-8000-00000000000c", status: "succeeded" },
    ],
    commands: [{ jobId: "d0000000-0000-4000-8000-00000000000d", attemptId: "d1000000-0000-4000-8000-00000000000d", leaseId: "f1000000-0000-4000-8000-00000000000f", commandKind: "cancel", reason: DRAIN_REASON }],
    ...overrides,
  };
}

test("a clean, attributed, selective drain has zero violations (anchor)", () => {
  assert.deepEqual(evaluateRollbackRehearsal(goodRehearsal()), []);
});

test("a drain CLI that did not exit 0 is refused", () => {
  assert.ok(evaluateRollbackRehearsal(goodRehearsal({ exitCode: 1 })).map((x) => x.code).includes("rollback:cli_failed"));
});

test("a drained job with no audit row, or two, is refused (the audit is the rehearsal's evidence)", () => {
  const none = goodRehearsal({ auditRows: [goodRehearsal().auditRows[0]] });
  assert.ok(evaluateRollbackRehearsal(none).map((x) => x.code).includes("rollback:no_audit_row"));
  const twice = goodRehearsal();
  twice.auditRows = [...twice.auditRows, twice.auditRows[0]];
  assert.ok(evaluateRollbackRehearsal(twice).map((x) => x.code).includes("rollback:no_audit_row"));
});

test("a drain audit row naming another tenant, or a different operator, is refused", () => {
  const foreign = goodRehearsal();
  foreign.auditRows[1] = { ...foreign.auditRows[1], companyId: A.companyId, detailsOrganizationId: A.organizationId };
  assert.ok(evaluateRollbackRehearsal(foreign).map((x) => x.code).includes("rollback:audit_wrong_tenant"));
  const impostor = goodRehearsal();
  impostor.auditRows[0] = { ...impostor.auditRows[0], actorId: "operator-cli:someone-else" };
  assert.ok(evaluateRollbackRehearsal(impostor).map((x) => x.code).includes("rollback:audit_wrong_actor"));
});

test("a drain whose audit row exists but whose attempt did NOT move is refused (Codex P1)", () => {
  const rehearsal = goodRehearsal();
  rehearsal.attempts = [{ ...rehearsal.attempts[0], status: "pending" }, ...rehearsal.attempts.slice(1)];
  const v = evaluateRollbackRehearsal(rehearsal).map((x) => x.code);
  assert.ok(v.includes("rollback:attempt_not_cancelled"));
  assert.ok(!v.includes("rollback:no_audit_row"), "the audit row is there — it is the EFFECT that is missing");
});

test("a drain that moved an already-terminal attempt is refused", () => {
  const rehearsal = goodRehearsal();
  rehearsal.attempts = rehearsal.attempts.map((a) => (a.status === "succeeded" ? { ...a, status: "cancelled" } : a));
  assert.ok(evaluateRollbackRehearsal(rehearsal).map((x) => x.code).includes("rollback:terminal_attempt_moved"));
});

test("the two branches differ, and each is pinned: unleased -> cancelled, leased -> cancel_requested + a cancel command", () => {
  const leasedAsCancelled = goodRehearsal();
  leasedAsCancelled.attempts = leasedAsCancelled.attempts.map((a) => (a.jobId === "d0000000-0000-4000-8000-00000000000d" ? { ...a, status: "cancelled" } : a));
  assert.ok(evaluateRollbackRehearsal(leasedAsCancelled).map((x) => x.code).includes("rollback:candidate_not_cancelled"),
    "a leased attempt jumping straight to cancelled skips its lease holder");
  const noCommand = goodRehearsal({ commands: [] });
  assert.ok(evaluateRollbackRehearsal(noCommand).map((x) => x.code).includes("rollback:leased_candidate_no_command"));
  const wrongReason = goodRehearsal({ commands: [{ jobId: "d0000000-0000-4000-8000-00000000000d", attemptId: "d1000000-0000-4000-8000-00000000000d", leaseId: "f1000000-0000-4000-8000-00000000000f", commandKind: "cancel", reason: "something_else" }] });
  const staleLease = goodRehearsal({ commands: [{ jobId: "d0000000-0000-4000-8000-00000000000d", attemptId: "d1000000-0000-4000-8000-00000000000d", leaseId: "09090909-0000-4000-8000-000000000009", commandKind: "cancel", reason: DRAIN_REASON }] });
  assert.ok(evaluateRollbackRehearsal(staleLease).map((x) => x.code).includes("rollback:command_wrong_lease"),
    "a command on a PREVIOUS lease of the same attempt must not satisfy the current holder");
  const staleCommand = goodRehearsal({ commands: [{ jobId: "d0000000-0000-4000-8000-00000000000d", attemptId: "99999999-0000-4000-8000-000000000099", leaseId: "f1000000-0000-4000-8000-00000000000f", commandKind: "cancel", reason: DRAIN_REASON }] });
  assert.ok(evaluateRollbackRehearsal(staleCommand).map((x) => x.code).includes("rollback:leased_candidate_no_command"),
    "a command of ANOTHER attempt of the same job must not satisfy this one");
  assert.ok(evaluateRollbackRehearsal(wrongReason).map((x) => x.code).includes("rollback:command_wrong_reason"));
  const strayCommand = goodRehearsal();
  strayCommand.commands = [...strayCommand.commands, { jobId: strayCommand.drainableJobs[0].jobId, attemptId: strayCommand.drainableJobs[0].attemptId, leaseId: null, commandKind: "cancel", reason: DRAIN_REASON }];
  assert.ok(evaluateRollbackRehearsal(strayCommand).map((x) => x.code).includes("rollback:unleased_candidate_has_command"));
});

test("a LEASED attempt the drain left running is refused, even when the seeded pair moved (Codex P1)", () => {
  const rehearsal = goodRehearsal();
  rehearsal.attempts = rehearsal.attempts.map((a) => (a.jobId === "d0000000-0000-4000-8000-00000000000d" ? { ...a, status: "running" } : a));
  const v = evaluateRollbackRehearsal(rehearsal).map((x) => x.code);
  assert.ok(v.includes("rollback:candidate_not_cancelled"));
  assert.ok(!v.includes("rollback:attempt_not_cancelled"), "the seeded pair DID move — that is the point");
});

test("a census attempt with no drain audit row, or one naming another tenant, is refused", () => {
  const missing = goodRehearsal();
  missing.auditRows = missing.auditRows.filter((r) => r.entityId !== "d0000000-0000-4000-8000-00000000000d");
  assert.ok(evaluateRollbackRehearsal(missing).map((x) => x.code).includes("rollback:candidate_no_audit_row"));
  const foreign = goodRehearsal();
  foreign.auditRows = foreign.auditRows.map((r) => (r.entityId === "d0000000-0000-4000-8000-00000000000d"
    ? { ...r, companyId: B.companyId, detailsOrganizationId: B.organizationId } : r));
  assert.ok(evaluateRollbackRehearsal(foreign).map((x) => x.code).includes("rollback:candidate_audit_wrong_tenant"));
});

test("a SIBLING attempt of the same job left running is refused — state is keyed per attempt (Codex P1)", () => {
  const rehearsal = goodRehearsal();
  const drained = rehearsal.preDrainCandidates[0];
  const sibling = { ...drained, attemptId: "e1000000-0000-4000-8000-00000000000e" };
  rehearsal.preDrainCandidates = [...rehearsal.preDrainCandidates, sibling];
  // The job already shows a `cancelled` attempt, so a job-keyed map would find it and pass.
  rehearsal.attempts = [...rehearsal.attempts, { attemptId: sibling.attemptId, jobId: sibling.jobId, status: "running" }];
  assert.ok(evaluateRollbackRehearsal(rehearsal).map((x) => x.code).includes("rollback:candidate_not_cancelled"));
});

test("a drain audit row that records no reason, or another one, is refused (Codex P2)", () => {
  for (const reason of [null, "some_other_reason"]) {
    const rehearsal = goodRehearsal();
    rehearsal.auditRows = rehearsal.auditRows.map((r, i) => (i === 0 ? { ...r, detailsReason: reason } : r));
    assert.ok(evaluateRollbackRehearsal(rehearsal).map((x) => x.code).includes("rollback:audit_wrong_reason"), JSON.stringify(reason));
  }
});

test("a NON-system actor on a census candidate's audit row is refused (Codex P2)", () => {
  const rehearsal = goodRehearsal();
  rehearsal.auditRows = rehearsal.auditRows.map((r) => (r.entityId === "d0000000-0000-4000-8000-00000000000d"
    ? { ...r, actorType: "user" } : r));
  const v = evaluateRollbackRehearsal(rehearsal).map((x) => x.code);
  assert.ok(v.includes("rollback:audit_wrong_actor") || v.includes("rollback:candidate_no_audit_row"),
    `a user-actor row must not satisfy a candidate: ${JSON.stringify(v)}`);
});

test("a drain that also cancelled an already-terminal attempt is refused (it must be selective)", () => {
  const indiscriminate = goodRehearsal();
  indiscriminate.auditRows = [...indiscriminate.auditRows, {
    action: DRAIN_AUDIT_ACTION, entityId: indiscriminate.terminalJobIds[0],
    organizationId: A.organizationId, companyId: A.companyId,
    actorType: "system", actorId: indiscriminate.expectedActorId,
  }];
  assert.ok(evaluateRollbackRehearsal(indiscriminate).map((x) => x.code).includes("rollback:drained_a_terminal_attempt"));
});
