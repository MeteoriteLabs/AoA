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
  evaluateUsageCardinality,
  evaluateControlTenant,
  evaluateCrossTenantIsolation,
  evaluateEnvProbeObservability,
  evaluateRollbackRehearsal,
  DRAIN_AUDIT_ACTION,
  DRAIN_REASON,
  ENV_PROBE_LOG_PREFIX,
  // DEP-019 — the worker-driven arm, the env-probe verdict and the deployed worker's constants.
  M1_SPINE_DEPLOYED_TARGET_ID,
  M1_SPINE_EXECUTOR_MODES,
  M1_SPINE_WORKER_DRIVEN_MARKER,
  // DEP-019 follow-up (Codex, PR #579) — the worker-specific cost/audit failure marker.
  M1_SPINE_WORKER_COST_MARKER,
  evaluateWorkerDrivenJourney,
  evaluateSpineEnvProbe,
} from "../m1-spine-assertions.mjs";
// The SHARED expected class list, so the probe fixtures below cannot drift from the worker's own.
import { ENV_PROBE_EXPECTED_CLASSES } from "../m1-shipped-boot.mjs";

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
        { id: startedActivityId, action: "job.attempt_started", companyId: tenant.companyId, organizationId: null, detailsOrganizationId: tenant.organizationId, actorType: "system", actorId: "worker:33333333-3333-4333-8333-333333333333" },
        { id: terminalActivityId, action: "job.attempt_terminal", companyId: tenant.companyId, organizationId: null, detailsOrganizationId: tenant.organizationId, actorType: "system", actorId: "worker:33333333-3333-4333-8333-333333333333" },
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

test("an audit row recording ANOTHER Organization is refused, even with the right Company (Codex P2)", () => {
  const obs = goodEnabled(A).observation;
  const v = evaluateEnabledTenantSpine(goodEnabled(A, {
    activity: [obs.activity[0], { ...obs.activity[1], detailsOrganizationId: B.organizationId }],
  }));
  assert.ok(codes(v).includes("audit:wrong_organization"));
  assert.ok(!codes(v).includes("audit:wrong_company"), "the Company is still right — only the Organization moved");
});

test("a ledger without exactly one attempt_started and one terminal is refused, not skipped (Codex P2)", () => {
  const obs = goodEnabled(A).observation;
  const extraTerminal = evaluateEnabledTenantSpine(goodEnabled(A, {
    events: [...obs.events, { eventId: "77777777-7777-4777-8777-777777777777", eventType: "terminal" }],
  }));
  assert.ok(codes(extraTerminal).includes("audit:audited_event_cardinality"));
  const noStart = evaluateEnabledTenantSpine(goodEnabled(A, { events: obs.events.filter((e) => e.eventType !== "attempt_started") }));
  assert.ok(codes(noStart).includes("audit:audited_event_cardinality"));
  // TWO terminals and no start is still two audited events — a length check alone would pass it.
  const twoTerminals = evaluateEnabledTenantSpine(goodEnabled(A, {
    events: [{ eventId: "aaaaaaa2-0000-4000-8000-00000000000a", eventType: "terminal" }, ...obs.events.filter((e) => e.eventType === "terminal")],
  }));
  assert.ok(codes(twoTerminals).includes("audit:audited_event_cardinality"));
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
      // One persisted attempt per placement decision above.
      persistedAttempts: [
        { jobId: "0c000000-0000-4000-8000-00000000000c", disposition: "legacy", mode: "legacy", leaseEligible: false, reasonCode: "organization_disabled" },
        { jobId: "0c000000-0000-4000-8000-00000000000d", disposition: "legacy", mode: "legacy", leaseEligible: false, reasonCode: "organization_disabled" },
      ],
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

test("a control tenant whose STORED placement is leasable, or wrongly reasoned, is refused (Codex P2)", () => {
  const stored = goodControl().observation.persistedAttempts[0];
  for (const patch of [
    { disposition: "selected" },
    { mode: "active" },
    { leaseEligible: true },
  ]) {
    const v = evaluateControlTenant(goodControl({ persistedAttempts: [{ ...stored, ...patch }, goodControl().observation.persistedAttempts[1]] }));
    assert.ok(codes(v).includes("control:persisted_not_legacy"), JSON.stringify(patch));
  }
  assert.ok(codes(evaluateControlTenant(goodControl({ persistedAttempts: [{ ...stored, reasonCode: "no_eligible_target" }, goodControl().observation.persistedAttempts[1]] })))
    .includes("control:persisted_wrong_reason"));
  assert.ok(codes(evaluateControlTenant(goodControl({ persistedAttempts: [] })))
    .includes("control:persisted_missing"));
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
  const staleGoodReasonCurrentBad = goodRehearsal({ commands: [
    { jobId: "d0000000-0000-4000-8000-00000000000d", attemptId: "d1000000-0000-4000-8000-00000000000d", leaseId: "09090909-0000-4000-8000-000000000009", commandKind: "cancel", reason: DRAIN_REASON },
    { jobId: "d0000000-0000-4000-8000-00000000000d", attemptId: "d1000000-0000-4000-8000-00000000000d", leaseId: "f1000000-0000-4000-8000-00000000000f", commandKind: "cancel", reason: "something_else" },
  ] });
  assert.ok(evaluateRollbackRehearsal(staleGoodReasonCurrentBad).map((x) => x.code).includes("rollback:command_wrong_reason"),
    "a correctly-reasoned STALE command must not excuse the current lease's wrong reason");
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

// ── the KEYED lane's half of WRK-018 acceptance 1 (DEP-015) ──────────────────
//
// The same `evaluateUsageCardinality` the spine calls above is what the keyed shipped-boot
// driver calls (scripts/m1-shipped-boot/journey.mjs). The spine hands it `expectedUnits` (the
// reference provider's canned units); the keyed lane hands it `storedUsage`, the run's
// `heartbeat_runs.usage_json`, which `createCanaryRunProjector` derives from the same event.
// These cases pin that second shape, including the positive control the ticket names: a
// duplicate or replayed usage event for the attempt turns the assertion RED.

const KEYED_EVENT_ID = "77777777-7777-4777-8777-777777777777";

function keyedObservation(tenant = A, overrides = {}) {
  return {
    tenant,
    observation: {
      usageEvents: [{
        eventId: KEYED_EVENT_ID,
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        payload: { inputTokens: 4211, outputTokens: 188, cachedInputTokens: 0, runtimeMillis: 61234 },
      }],
      storedUsage: { inputTokens: 4211, outputTokens: 188, costUsd: null, durationMs: 61234 },
      ...overrides,
    },
  };
}

test("keyed shape: exactly one accepted usage event whose numbers are the run's stored usage passes", () => {
  assert.deepEqual(evaluateUsageCardinality(keyedObservation()), []);
});

test("POSITIVE CONTROL (keyed): a DUPLICATE or replayed usage event for the attempt is refused", () => {
  const base = keyedObservation().observation.usageEvents[0];
  // A replay: the SAME event id delivered twice, and a duplicate: a second event id. Both are
  // two accepted rows for one attempt, and a stored `usage_json` alone cannot tell either from one.
  for (const second of [{ ...base }, { ...base, eventId: "88888888-8888-4888-8888-888888888888" }]) {
    const v = evaluateUsageCardinality(keyedObservation(A, { usageEvents: [base, second] }));
    assert.ok(codes(v).includes("usage:not_exactly_one"), JSON.stringify(v));
    assert.ok(v.every((x) => x.message.includes(M1_SPINE_USAGE_MARKER)));
  }
});

test("keyed shape: ZERO accepted usage events is refused, distinctly from a duplicate", () => {
  const v = evaluateUsageCardinality(keyedObservation(A, { usageEvents: [] }));
  assert.ok(codes(v).includes("usage:no_usage_event"));
  assert.ok(!codes(v).includes("usage:not_exactly_one"));
});

test("keyed shape (F10): a SECOND Organization's usage never counts toward the first tenant's one", () => {
  const foreign = {
    eventId: KEYED_EVENT_ID,
    organizationId: B.organizationId,
    companyId: B.companyId,
    payload: { inputTokens: 4211, outputTokens: 188, cachedInputTokens: 0, runtimeMillis: 61234 },
  };
  // Tenant B's event alone, judged for tenant A: it is not A's, and A therefore has none of its own.
  const v = evaluateUsageCardinality(keyedObservation(A, { usageEvents: [foreign] }));
  assert.ok(codes(v).includes("usage:wrong_tenant"), JSON.stringify(v));
  // And it cannot be used to satisfy A's cardinality either: A's own event plus B's is two.
  const both = evaluateUsageCardinality(keyedObservation(A, { usageEvents: [keyedObservation().observation.usageEvents[0], foreign] }));
  assert.ok(codes(both).includes("usage:not_exactly_one"));
  assert.ok(codes(both).includes("usage:wrong_tenant"));
});

test("keyed shape: stored usage that is not the accepted event's numbers is refused", () => {
  for (const stored of [
    { inputTokens: 4210, outputTokens: 188, durationMs: 61234 },
    { inputTokens: 4211, outputTokens: 189, durationMs: 61234 },
    { inputTokens: 4211, outputTokens: 188, durationMs: 999 },
  ]) {
    const v = evaluateUsageCardinality(keyedObservation(A, { storedUsage: stored }));
    assert.ok(codes(v).includes("usage:stored_differs_from_event"), JSON.stringify(stored));
  }
});

test("keyed shape: an event with NO runtimeMillis leaves the wall-clock duration alone (the projector's fallback)", () => {
  // `canary-terminal-projection.ts` falls back to the run's wall clock when the event reports no
  // runtime, so requiring equality there would red a correct projection.
  const v = evaluateUsageCardinality(keyedObservation(A, {
    usageEvents: [{
      eventId: KEYED_EVENT_ID,
      organizationId: A.organizationId,
      companyId: A.companyId,
      payload: { inputTokens: 4211, outputTokens: 188, cachedInputTokens: 0, runtimeMillis: null },
    }],
    storedUsage: { inputTokens: 4211, outputTokens: 188, durationMs: 61234 },
  }));
  assert.deepEqual(v, []);
});

test("keyed shape: an accepted usage event with NO stored usage_json is refused", () => {
  const v = evaluateUsageCardinality(keyedObservation(A, { storedUsage: null }));
  assert.ok(codes(v).includes("usage:no_stored_usage"), JSON.stringify(v));
});

test("the spine and the keyed lane share ONE implementation — neither re-implements the rule", () => {
  const journey = readFileSync(path.join(repoRoot, "scripts", "m1-shipped-boot", "journey.mjs"), "utf8");
  assert.match(journey, /evaluateUsageCardinality\(\{/, "the keyed driver must CALL the shared verdict");
  assert.match(journey, /from "\.\.\/lib\/m1-spine-assertions\.mjs"/);
  for (const code of ["usage:not_exactly_one", "usage:no_usage_event", "usage:wrong_tenant"]) {
    assert.ok(!journey.includes(code), `the keyed driver must not re-implement ${code}`);
  }
});

// ── DEP-019: the worker-driven verdict, the env probe, and the override posture ──
//
// The `M1-D1-SPINE` gate says "one separately deployed worker". `DEP-016` satisfied that as a
// TOPOLOGY while the harness performed the journey. These cases pin the verdict that makes it a
// JOURNEY claim — and, more importantly, pin that it CANNOT pass on a harness-driven attempt,
// because a claim that cannot fail is not evidence.

const DEPLOYED = "df013cec-4be6-4e1e-b2a5-378c7e886364";
const OTHER = "11111111-2222-4333-8444-555555555555";

/** The shape the live profile reads out of `job_events` / `leases` for the worker-driven case,
 * with the values a real GREEN run produced on the D1 stack. */
function greenObservation() {
  return {
    attemptStatus: "succeeded",
    attemptTargetId: M1_SPINE_DEPLOYED_TARGET_ID,
    leaseWorkerIds: [DEPLOYED],
    events: [
      { eventType: "attempt_started", workerId: DEPLOYED },
      { eventType: "log", workerId: DEPLOYED },
      { eventType: "usage", workerId: DEPLOYED },
      { eventType: "terminal", workerId: DEPLOYED },
    ],
  };
}

const workerDriven = (overrides = {}, declaredExecutor = "worker") =>
  evaluateWorkerDrivenJourney({
    declaredExecutor,
    deployedWorkerId: DEPLOYED,
    deployedTargetId: M1_SPINE_DEPLOYED_TARGET_ID,
    observation: { ...greenObservation(), ...overrides },
    ...(overrides.__deployedWorkerId !== undefined ? { deployedWorkerId: overrides.__deployedWorkerId } : {}),
  });


test("worker-driven: the ZERO-VIOLATION anchor — a real green run passes", () => {
  assert.deepEqual(workerDriven(), []);
});

test("worker-driven: every violation carries the marker, so the lane's control can grep its arm", () => {
  const v = workerDriven({ attemptStatus: "failed" });
  assert.ok(v.length > 0);
  for (const one of v) assert.ok(one.message.includes(M1_SPINE_WORKER_DRIVEN_MARKER), one.message);
});

test("worker-driven: ★ an event produced by ANOTHER worker reds — the not-the-executor case", () => {
  const o = greenObservation();
  o.events[2] = { eventType: "usage", workerId: OTHER };
  assert.deepEqual(codes(workerDriven(o)), ["worker_driven:events_not_deployed_worker"]);
});

test("worker-driven: ★★★ a WHOLLY harness-driven attempt reds on both the events and the lease", () => {
  // This is the acceptance-2 control in its purest form: the same journey, the same rows, but
  // produced by a harness-minted worker. If this ever passes, "worker-driven" means nothing.
  const v = workerDriven({
    leaseWorkerIds: [OTHER],
    events: greenObservation().events.map((e) => ({ ...e, workerId: OTHER })),
  });
  assert.deepEqual(codes(v), ["worker_driven:events_not_deployed_worker", "worker_driven:lease_not_deployed_worker"]);
});

test("worker-driven: a lease taken by a second worker reds even when the events look right", () => {
  assert.deepEqual(codes(workerDriven({ leaseWorkerIds: [DEPLOYED, OTHER] })), ["worker_driven:lease_not_deployed_worker"]);
});

test("worker-driven: no lease at all reds", () => {
  assert.deepEqual(codes(workerDriven({ leaseWorkerIds: [] })), ["worker_driven:no_lease"]);
});

test("worker-driven: no events at all reds, and names the missing ones", () => {
  assert.deepEqual(codes(workerDriven({ events: [] })), [
    "worker_driven:missing_event",
    "worker_driven:missing_event",
    "worker_driven:no_events",
  ]);
});

test("worker-driven: a missing terminal reds (a run that never durably ended is not a journey)", () => {
  const o = greenObservation();
  o.events = o.events.filter((e) => e.eventType !== "terminal");
  assert.deepEqual(codes(workerDriven(o)), ["worker_driven:missing_event"]);
});

test("worker-driven: ★ a MISSING usage event does NOT red — that is the cost verdict's job", () => {
  // The usage-suppressed control must go red for exactly ONE reason. If this verdict also
  // required `usage`, the control would red twice and stop isolating the thing it exists for.
  const o = greenObservation();
  o.events = o.events.filter((e) => e.eventType !== "usage");
  assert.deepEqual(workerDriven(o), []);
});

test("worker-driven: an attempt placed on ANOTHER target reds", () => {
  assert.deepEqual(codes(workerDriven({ attemptTargetId: "99999999-9999-4999-8999-999999999999" })), [
    "worker_driven:target_mismatch",
  ]);
});

test("worker-driven: a non-succeeded attempt reds", () => {
  assert.deepEqual(codes(workerDriven({ attemptStatus: "failed" })), ["worker_driven:attempt_not_succeeded"]);
  assert.deepEqual(codes(workerDriven({ attemptStatus: "pending" })), ["worker_driven:attempt_not_succeeded"]);
});

test("worker-driven: NO deployed worker id is a violation, never a vacuous pass", () => {
  const v = evaluateWorkerDrivenJourney({
    declaredExecutor: "worker",
    deployedWorkerId: "",
    deployedTargetId: M1_SPINE_DEPLOYED_TARGET_ID,
    observation: greenObservation(),
  });
  assert.deepEqual(codes(v), ["worker_driven:no_deployed_worker"]);
});

test("worker-driven: an unknown executor mode is refused", () => {
  const v = evaluateWorkerDrivenJourney({
    declaredExecutor: "magic",
    deployedWorkerId: DEPLOYED,
    deployedTargetId: M1_SPINE_DEPLOYED_TARGET_ID,
    observation: greenObservation(),
  });
  assert.deepEqual(codes(v), ["worker_driven:unknown_executor_mode"]);
  assert.deepEqual([...M1_SPINE_EXECUTOR_MODES], ["worker", "harness"]);
});

test("worker-driven: the HARNESS control passes when the attempt really was harness-driven", () => {
  const v = evaluateWorkerDrivenJourney({
    declaredExecutor: "harness",
    deployedWorkerId: DEPLOYED,
    deployedTargetId: M1_SPINE_DEPLOYED_TARGET_ID,
    observation: {
      ...greenObservation(),
      leaseWorkerIds: [OTHER],
      events: greenObservation().events.map((e) => ({ ...e, workerId: OTHER })),
    },
  });
  assert.deepEqual(v, []);
});

test("worker-driven: ★ the HARNESS control REDS if the attempt was in fact worker-driven", () => {
  // The other direction of the tripwire: once the lane is genuinely worker-driven, a control that
  // forgot to switch executors would otherwise pass and be reported as a control.
  const v = evaluateWorkerDrivenJourney({
    declaredExecutor: "harness",
    deployedWorkerId: DEPLOYED,
    deployedTargetId: M1_SPINE_DEPLOYED_TARGET_ID,
    observation: greenObservation(),
  });
  assert.deepEqual(codes(v), ["worker_driven:control_was_actually_worker_driven"]);
});

// ── the env probe (DEP-016 acceptance item 6, closed positively) ─────────────

/** A clean summary in the shape `evaluateEnvProbeEvidence` judges, built from the SHARED expected
 * class list so it cannot drift from the worker's own. */
function cleanProbeSummary() {
  return {
    probe: "dep017-env-absence/v1",
    verdict: "absent",
    clean: { checked: [...ENV_PROBE_EXPECTED_CLASSES], present: [], presentNames: [], metadata: { attempted: false } },
    plantedControl: { red: true },
  };
}
const probeLog = (summary) => [`${ENV_PROBE_LOG_PREFIX}${JSON.stringify(summary)}`];

test("env probe: a clean summary passes, and it is the SHARED verdict that judges it", () => {
  assert.deepEqual(evaluateSpineEnvProbe({ logMessages: probeLog(cleanProbeSummary()) }), []);
});

test("env probe: ★ NO summary reds — a probe that did not run must never read as a pass", () => {
  const v = evaluateSpineEnvProbe({ logMessages: [] });
  assert.equal(v.length, 1);
  assert.equal(v[0].code, "criterion5:env_probe");
  assert.match(v[0].message, /did not run/);
});

test("env probe: a summary reporting a PRESENT credential class reds", () => {
  const s = cleanProbeSummary();
  s.clean.present = ["datastore_credential"];
  assert.ok(evaluateSpineEnvProbe({ logMessages: probeLog(s) }).length > 0);
});

test("env probe: ★ a BLIND probe reds — the planted control must have turned red", () => {
  const s = cleanProbeSummary();
  s.plantedControl = { red: false };
  const v = evaluateSpineEnvProbe({ logMessages: probeLog(s) });
  assert.ok(v.some((one) => /planted-canary control did not turn red/.test(one.message)), JSON.stringify(v));
});

test("env probe: an unreadable summary reds", () => {
  assert.ok(evaluateSpineEnvProbe({ logMessages: [`${ENV_PROBE_LOG_PREFIX}{not json`] }).length > 0);
});

// ── the override's worker-driven posture ────────────────────────────────────

const OVERRIDE_PATH = new URL("../../../docker/d1/m1-spine.override.yml", import.meta.url);
const overrideText = () => readFileSync(OVERRIDE_PATH, "utf8");

test("override: the COMMITTED file has zero violations (the anchor)", () => {
  assert.deepEqual(evaluateSpineOverrideText(overrideText()), []);
});

test("override: ★ dropping dispatch from the deployed worker reds", () => {
  const broken = overrideText().replace('AOA_WORKER_DISPATCH_ENABLED: "1"', 'AOA_WORKER_DISPATCH_ENABLED: "0"');
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:dispatch_not_armed"));
});

test("override: ★ dropping the DEP-017 probe reds (acceptance item 6 cannot be dropped quietly)", () => {
  const broken = overrideText().replace('AOA_WORKER_ENV_PROBE: "1"', 'AOA_WORKER_ENV_PROBE: "0"');
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:probe_not_armed"));
});

test("override: dropping the event outbox reds", () => {
  const broken = overrideText().replace(/^\s*AOA_WORKER_EVENT_OUTBOX_PATH:.*$/m, "");
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:no_event_outbox"));
});

test("override: leaving the worker on a boot root that injects NO provider reds", () => {
  const broken = overrideText().replace(
    '["node", "/worker-net-app/dist/bin/networked-host.js"]',
    '["node", "dist/bin/container-host.js"]',
  );
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:worker_not_networked_boot_root"));
});

test("override: ★ arming dispatch on a SECOND service reds — M1-D1-SPINE is ONE deployed worker", () => {
  const broken = overrideText().replace(
    "  worker-a:\n    profiles:",
    '  worker-a:\n    environment:\n      AOA_WORKER_DISPATCH_ENABLED: "1"\n    profiles:',
  );
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:dispatch_armed_beyond_the_deployed_worker"));
});

test("override: ★★★ arming the wire WITHOUT the control-plane public key reds (an ungated provider)", () => {
  const broken = overrideText().replace(/^\s*AOA_FAKE_PROVIDER_CONTROL_PLANE_PUBLIC_KEY_FILE:.*$/m, "");
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:wire_ungated"));
});

test("override: not arming the wire at all reds", () => {
  const broken = overrideText().replace(/^\s*AOA_FAKE_PROVIDER_WIRE_PORT:.*$/m, "");
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:wire_not_armed"));
});

test("override: ★ a worker pointed at a port the provider does not serve reds", () => {
  const broken = overrideText().replace('AOA_WORKER_PROVIDER_URL: "http://fake-provider:8082"', 'AOA_WORKER_PROVIDER_URL: "http://fake-provider:8080"');
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:provider_url_not_the_wire"));
});

test("override: ★ dropping the capability MINT key reds (every run would die no_run_capability)", () => {
  const broken = overrideText().replace(/^\s*AOA_CONTROL_PLANE_SIGNING_KEY_FILE:.*$/m, "");
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:mint_key_not_configured"));
});

test("override: ★ a seed that authorizes a DIFFERENT ticket than the worker presents reds", () => {
  const broken = overrideText().replace(
    './docker/d1/m1-spine-worker.enrollment-ticket:/seed-enrolment-ticket:ro',
    './docker/d1/worker-b.enrollment-ticket:/seed-enrolment-ticket:ro',
  );
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:enrolment_seed_mismatch"));
});

test("override: ★★★ committed key material reds, in both shapes", () => {
  const pem = overrideText().replace(
    'AOA_CONTROL_PLANE_SIGNING_KEY_FILE: "/keys/control-plane-signing-key.pem"',
    'AOA_CONTROL_PLANE_SIGNING_KEY_FILE: "/keys/k.pem"\n      X_KEY: "-----BEGIN PRIVATE KEY-----"',
  );
  assert.ok(codes(evaluateSpineOverrideText(pem)).includes("override:committed_key_material"));
  const literal = overrideText().replace(
    /AOA_SECRETS_MASTER_KEY: "\$\{[^}]*\}"/,
    'AOA_SECRETS_MASTER_KEY: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
  );
  assert.ok(codes(evaluateSpineOverrideText(literal)).includes("override:committed_key_material"));
});

test("override: the DEP-016 clauses still hold (this ticket extends them, it does not fork them)", () => {
  const broken = overrideText().replace(/^  worker-a:\n    profiles: \[[^\]]+\]$/m, "  worker-a:\n    environment: {}");
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:worker_a_not_excluded"));
});

// ── DEP-019, ruled round: the key boundary and the measured-runtime arm ──────

test("override: ★★★ mounting the runtime-keys DIRECTORY reds — the provider must not hold the private key", () => {
  const broken = overrideText().replace(
    "./docker/d1/runtime-keys/control-plane-public-key.pem:/keys/control-plane-public-key.pem:ro",
    "./docker/d1/runtime-keys:/keys:ro",
  );
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:key_directory_mounted"));
});

test("override: ★ the PRIVATE half bound into the reference provider reds", () => {
  const broken = overrideText().replace(
    "./docker/d1/runtime-keys/control-plane-public-key.pem:/keys/control-plane-public-key.pem:ro",
    "./docker/d1/runtime-keys/control-plane-signing-key.pem:/keys/control-plane-signing-key.pem:ro",
  );
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:wrong_key_half"));
});

test("override: the PUBLIC half bound into the control plane reds too (the boundary is two-sided)", () => {
  const broken = overrideText().replace(
    "./docker/d1/runtime-keys/control-plane-signing-key.pem:/keys/control-plane-signing-key.pem:ro",
    "./docker/d1/runtime-keys/control-plane-public-key.pem:/keys/control-plane-public-key.pem:ro",
  );
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:wrong_key_half"));
});

test("override: a key mounted into ANY other service reds", () => {
  const nl = String.fromCharCode(10);
  const broken = overrideText().replace(
    `  worker-b:${nl}`,
    `  worker-b:${nl}    volumes:${nl}      - "./docker/d1/runtime-keys/control-plane-signing-key.pem:/keys/k.pem:ro"${nl}`,
  );
  assert.ok(codes(evaluateSpineOverrideText(broken)).includes("override:key_mounted_into_unexpected_service"));
});

// ── the measuredRuntimeMillis arm (DEP-019 13.1) ─────────────────────────────

const usageEvent = (payload) => ({ organizationId: A.organizationId, companyId: A.companyId, payload });

test("usage: the WORKER-DRIVEN arm pins the three token counts and lets the duration be measured", () => {
  // The worker takes runtimeMillis from the SUPERVISOR'S clock, so it is an observation; the token
  // counts are still the canned ones, exactly.
  const measured = { ...M1_SPINE_CANNED_UNITS, runtimeMillis: 8123 };
  assert.deepEqual(
    evaluateUsageCardinality({
      tenant: A,
      observation: { usageEvents: [usageEvent(measured)], expectedUnits: measured, measuredRuntimeMillis: true },
    }),
    [],
  );
});

test("usage: ★ the worker-driven arm still reds when a TOKEN count drifts from the canned units", () => {
  const drifted = { ...M1_SPINE_CANNED_UNITS, inputTokens: 1, runtimeMillis: 8123 };
  const v = evaluateUsageCardinality({
    tenant: A,
    observation: { usageEvents: [usageEvent(drifted)], expectedUnits: drifted, measuredRuntimeMillis: true },
  });
  assert.ok(codes(v).includes("usage:units_not_canned"), JSON.stringify(v));
});

test("usage: ★ a missing or negative measured duration reds — the observer must have measured one", () => {
  for (const runtimeMillis of [undefined, -1, "soon"]) {
    const units = { ...M1_SPINE_CANNED_UNITS, runtimeMillis };
    const v = evaluateUsageCardinality({
      tenant: A,
      observation: { usageEvents: [usageEvent(units)], expectedUnits: units, measuredRuntimeMillis: true },
    });
    assert.ok(codes(v).includes("usage:runtime_not_measured"), `${JSON.stringify(runtimeMillis)}: ${JSON.stringify(v)}`);
  }
});

test("usage: WITHOUT the arm the duration is still pinned (the harness path is unchanged)", () => {
  const measured = { ...M1_SPINE_CANNED_UNITS, runtimeMillis: 8123 };
  const v = evaluateUsageCardinality({
    tenant: A,
    observation: { usageEvents: [usageEvent(measured)], expectedUnits: measured },
  });
  assert.ok(codes(v).includes("usage:units_not_canned"), JSON.stringify(v));
});

// ── DEP-019 follow-up: the WORKER-SPECIFIC failure marker ────────────────────
//
// Codex on PR #579, UPHELD: the usage-suppressed lane control grepped `[m1-spine:cost]`, which
// `violation()` attaches to EVERY `cost:` code — and `evaluateEnabledTenantSpine` runs on the
// harness attempts of the profile's §2 as well as on its `EXECUTOR === "worker"` block. So deleting
// the whole worker-only cost/audit verdict left the control red, marked and reporting success.
// These cases hold the three properties that close it: the marker exists and is distinct, the
// HARNESS path cannot mint it, and the literal the workflow greps is the constant.

test("worker marker: it is DISTINCT from the cost and usage markers, in both directions", () => {
  for (const other of [M1_SPINE_COST_MARKER, M1_SPINE_USAGE_MARKER, M1_SPINE_WORKER_DRIVEN_MARKER]) {
    assert.notEqual(M1_SPINE_WORKER_COST_MARKER, other);
    // `grep -F` on either literal must never be satisfied by the other, or the two controls
    // collapse back into one.
    assert.ok(!M1_SPINE_WORKER_COST_MARKER.includes(other), `${other} is a substring of the worker marker`);
    assert.ok(!other.includes(M1_SPINE_WORKER_COST_MARKER), `the worker marker is a substring of ${other}`);
  }
});

test("worker marker: a worker-driven observation carries it on EVERY violation", () => {
  // The usage-suppressed state, declared worker-driven: what the lane's control must see.
  const v = evaluateEnabledTenantSpine(goodEnabled(A, { workerDriven: true, costRows: [], costReceipts: [], usageEvents: [] }));
  assert.ok(v.length > 0, "non-vacuity: the fixture really does violate something");
  assert.ok(codes(v).includes("cost:no_cost_row"), JSON.stringify(codes(v)));
  assert.ok(codes(v).includes("usage:no_usage_event"), JSON.stringify(codes(v)));
  for (const x of v) {
    assert.ok(x.message.includes(M1_SPINE_WORKER_COST_MARKER), `${x.code} lacks the worker marker`);
  }
  // The pre-existing markers are NOT displaced — the lane requires BOTH reasons.
  assert.ok(v.some((x) => x.message.includes(M1_SPINE_COST_MARKER)));
  assert.ok(v.some((x) => x.message.includes(M1_SPINE_USAGE_MARKER)));
});

test("worker marker: ★ the HARNESS path CANNOT produce it, however broken the attempt is", () => {
  // Every arm of the verdict violated at once, with no `workerDriven` declaration (the §2 shape)
  // and with an explicit `false`. Both must be entirely free of the worker marker, or the lane's
  // control is satisfied by harness activity again and item 1 just renamed the defect.
  const wrecked = {
    attemptStatus: "failed",
    events: [],
    usageEvents: [],
    costRows: [],
    costReceipts: [],
    activity: [],
    auditReceipts: [],
  };
  for (const workerDriven of [undefined, false]) {
    const observation = workerDriven === undefined ? wrecked : { ...wrecked, workerDriven };
    const v = evaluateEnabledTenantSpine({ tenant: A, observation });
    assert.ok(v.length > 0, "non-vacuity: the harness fixture really does violate something");
    assert.ok(v.some((x) => x.message.includes(M1_SPINE_COST_MARKER)), "it still reds on the cost marker");
    for (const x of v) {
      assert.ok(
        !x.message.includes(M1_SPINE_WORKER_COST_MARKER),
        `workerDriven=${JSON.stringify(workerDriven)}: ${x.code} minted the worker marker on the harness path`,
      );
    }
  }
});

test("worker marker: a MALFORMED declaration fails closed — it reds, and without the marker", () => {
  for (const bad of ["worker", 1, "true", {}]) {
    const v = evaluateEnabledTenantSpine(goodEnabled(A, { workerDriven: bad }));
    assert.ok(codes(v).includes("journey:worker_driven_flag_invalid"), `${JSON.stringify(bad)}: ${JSON.stringify(codes(v))}`);
    for (const x of v) {
      assert.ok(!x.message.includes(M1_SPINE_WORKER_COST_MARKER), `${JSON.stringify(bad)} minted the marker`);
    }
  }
});

test("worker marker: the PROFILE declares it exactly once, inside the EXECUTOR === \"worker\" block", () => {
  const profile = readFileSync(path.join(repoRoot, "tests", "d1", "m1-spine.test.mjs"), "utf8");
  const declarations = [...profile.matchAll(/workerDriven:\s*true/g)];
  assert.equal(declarations.length, 1, `the profile carries ${declarations.length} \`workerDriven: true\` declarations, expected exactly 1`);
  const at = declarations[0].index;
  const guard = profile.lastIndexOf('if (EXECUTOR === "worker") {', at);
  assert.ok(guard !== -1, "the declaration is not preceded by an `EXECUTOR === \"worker\"` guard");
  // …and no `}` at that guard's own indentation closes it before the declaration, i.e. the
  // declaration really is INSIDE the block rather than after it.
  assert.ok(!profile.slice(guard, at).includes("\n  }\n"), "the EXECUTOR block closes before the declaration");
  // The harness path's own call site must come BEFORE that guard, so it is a different call.
  assert.ok(profile.indexOf("evaluateEnabledTenantSpine({") < guard, "the harness call site is not distinct from the worker-driven one");
});

test("worker marker: the d1 lane's usage-suppressed control greps BOTH literals", () => {
  const workflow = readFileSync(path.join(repoRoot, ".github", "workflows", "d1-merge-train.yml"), "utf8");
  const start = workflow.indexOf("POSITIVE CONTROL — with usage suppressed, the profile MUST go red");
  assert.ok(start !== -1, "the usage-suppressed control step is gone");
  const end = workflow.indexOf("- name:", start);
  const step = workflow.slice(start, end === -1 ? undefined : end);
  // Pinned as the CONSTANT, not as a hand-written literal: the grep site and the code that mints
  // the marker cannot drift apart without this test going red.
  assert.ok(step.includes(`grep -F '${M1_SPINE_COST_MARKER}'`), "the step no longer greps the cost marker");
  assert.ok(step.includes(`grep -F '${M1_SPINE_WORKER_COST_MARKER}'`), "the step does not grep the WORKER-specific marker");
});
