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
  M1_SPINE_USAGE_MARKER,
  evaluateSpineOverrideText,
  evaluateReplicaRollout,
  evaluateEnabledTenantSpine,
  evaluateControlTenant,
  evaluateCrossTenantIsolation,
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
    hostileEventUpload: { status: 403, ackStatus: null },
    ownEventUpload: { status: 200, ackStatus: "accepted" },
    hostileAck: { status: 403, outcome: null },
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

// ── the control tenant ──────────────────────────────────────────────────────

function goodControl(overrides = {}) {
  return {
    tenant: C,
    observation: {
      placements: [
        { replica: "control-plane", disposition: "legacy", leaseEligible: false, reasonCode: "organization_disabled" },
        { replica: "control-plane-b", disposition: "legacy", leaseEligible: false, reasonCode: "organization_disabled" },
      ],
      positiveControlPlacement: { replica: "control-plane", tenant: "A", disposition: "failed", mode: "active", reasonCode: "invalid_placement_input" },
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

test("a positive-control placement that is ALSO legacy voids the refusal (it proves nothing)", () => {
  const v = evaluateControlTenant(goodControl({
    positiveControlPlacement: { replica: "control-plane", tenant: "A", disposition: "legacy", reasonCode: "organization_disabled" },
  }));
  assert.ok(codes(v).includes("control:positive_control_also_legacy"));
});

test("a positive-control placement that ERRORED is not a decision, and voids the refusal", () => {
  const v = evaluateControlTenant(goodControl({ positiveControlPlacement: { replica: "control-plane", tenant: "A", error: "connection refused" } }));
  assert.ok(codes(v).includes("control:positive_control_also_legacy"));
});

test("a control tenant that was offered work, or that has events, cost or receipts, is refused", () => {
  assert.ok(codes(evaluateControlTenant(goodControl({ pollOutcome: "offer" }))).includes("control:offered_work"));
  assert.ok(codes(evaluateControlTenant(goodControl({ jobEvents: 1 }))).includes("control:has_job_events"));
  assert.ok(codes(evaluateControlTenant(goodControl({ costRowsForCompany: 1 }))).includes("control:has_cost_rows"));
  assert.ok(codes(evaluateControlTenant(goodControl({ receipts: 1 }))).includes("control:has_receipts"));
});

test("a control observation with fewer than two replica placements is refused (every replica)", () => {
  const v = evaluateControlTenant(goodControl({ placements: [goodControl().observation.placements[0]] }));
  assert.ok(codes(v).includes("control:not_every_replica"));
});
