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
  M1_SPINE_USAGE_MARKER,
  evaluateSpineOverrideText,
  evaluateReplicaRollout,
  evaluateEnabledTenantSpine,
  evaluateControlTenant,
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

test("a replica with the deployment flag off is refused (the profile would run nothing distributed)", () => {
  assert.ok(codes(evaluateReplicaRollout(goodReplica({ deploymentEnabled: false }))).includes("rollout:deployment_disabled"));
});

// ── an enabled tenant's journey: cost + receipt + audit ─────────────────────

function goodEnabled(tenant = A, overrides = {}) {
  const usageEventId = "11111111-1111-4111-8111-111111111111";
  return {
    tenant,
    observation: {
      acceptedThroughSeq: 3,
      jobEventTypes: ["attempt_started", "usage", "terminal"],
      attemptStatus: "succeeded",
      expectedUnits: { inputTokens: 120000, outputTokens: 30000, cachedInputTokens: 0, runtimeMillis: 4200 },
      usageEvents: [{
        eventId: usageEventId,
        organizationId: tenant.organizationId,
        companyId: tenant.companyId,
        payload: { inputTokens: 120000, outputTokens: 30000, cachedInputTokens: 0, runtimeMillis: 4200 },
      }],
      costRows: [{
        companyId: tenant.companyId,
        costCents: 81,
        inputTokens: 120000,
        outputTokens: 30000,
        cachedInputTokens: 0,
        sourceIdempotencyKey: `cost:${tenant.companyId}:${usageEventId}`,
      }],
      costReceipts: [{ status: "applied", organizationId: tenant.organizationId, companyId: tenant.companyId }],
      activity: [
        { action: "job.attempt_started", companyId: tenant.companyId },
        { action: "job.attempt_terminal", companyId: tenant.companyId },
      ],
      auditReceipts: [
        { status: "applied", organizationId: tenant.organizationId, companyId: tenant.companyId },
        { status: "applied", organizationId: tenant.organizationId, companyId: tenant.companyId },
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

test("a journey the ingest did not fully accept is refused before cost is judged", () => {
  const v = evaluateEnabledTenantSpine(goodEnabled(A, { attemptStatus: "running" }));
  assert.ok(codes(v).includes("journey:attempt_not_succeeded"));
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
