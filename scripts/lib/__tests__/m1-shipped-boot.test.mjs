// -----------------------------------------------------------------------------
// DEP-015 — the shipped CI boot lane's PURE decisions (node:test; no Docker, no key).
//
//   node --test scripts/lib/__tests__/m1-shipped-boot.test.mjs
//
// The lane (.github/workflows/m1-shipped-boot.yml) is dispatch-only and keyed, so none of
// its live assertions can run on a PR. What CAN run is every decision it makes: the F10
// tenant set, the must-be-off switches, the ticket, the verdict parse and the per-tenant
// pass/fail. Each is pinned here with the REDS that make it a check — a tenant set with the
// control included, a crew switch on, a control run that went distributed.
// -----------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRolloutPolicy,
  evaluateTenantRollout,
  parseRolloutBoolean,
  evaluateMustBeOffFlags,
  envLinesToMap,
  encodeEnrollmentTicket,
  providerConstraintProfileUnsigned,
  registeredTargetProfile,
  parseVerifierVerdict,
  classifyTenantOutcome,
  redactSecrets,
  extractRolloutResolution,
  CANARY_EXECUTION_TARGET_SLUG,
} from "../m1-shipped-boot.mjs";

const A = "0febb760-5562-4289-a76a-f2f63139ee2d";
const B = "1b3c5d7e-9f01-4a23-8b45-6789abcdef01";
const C = "2c4e6a80-1a2b-4c3d-9e4f-5a6b7c8d9e0f";
const tenants = { enabled: [A, B], control: C };

// === the F10 tenant set =================================================================

test("buildRolloutPolicy seeds every enabled Organization canary/batch/task_run and nothing else", () => {
  const parsed = JSON.parse(buildRolloutPolicy([A, B]));
  assert.deepEqual(Object.keys(parsed.organizations).sort(), [A, B].sort());
  for (const id of [A, B]) {
    assert.deepEqual(parsed.organizations[id], { mode: "canary", workloads: ["batch"], sources: ["task_run"] });
  }
});

test("the policy the lane builds satisfies the tenant-set check (the green baseline)", () => {
  assert.deepEqual(evaluateTenantRollout(buildRolloutPolicy([A, B]), tenants).violations, []);
});

test("REJECT: the control Organization present in the rollout (the control would not be a control)", () => {
  const { violations } = evaluateTenantRollout(buildRolloutPolicy([A, B, C]), tenants);
  assert.ok(violations.some((x) => /control Organization .* is PRESENT/.test(x)), violations.join("\n"));
});

test("REJECT: fewer than two enabled Organizations (single-tenant is overruled by F10)", () => {
  const { violations } = evaluateTenantRollout(buildRolloutPolicy([A]), { enabled: [A], control: C });
  assert.ok(violations.some((x) => /at least 2 enabled/.test(x)), violations.join("\n"));
});

test("REJECT: no control Organization declared", () => {
  const { violations } = evaluateTenantRollout(buildRolloutPolicy([A, B]), { enabled: [A, B] });
  assert.ok(violations.some((x) => /needs a control Organization/.test(x)), violations.join("\n"));
});

test("REJECT: an enabled Organization missing from the rollout, or not in canary (SK-2)", () => {
  const onlyA = evaluateTenantRollout(buildRolloutPolicy([A]), tenants).violations;
  assert.ok(onlyA.some((x) => x.includes(`${B} is absent`)), onlyA.join("\n"));
  const active = JSON.stringify({ organizations: { [A]: { mode: "active", workloads: ["batch"] }, [B]: { mode: "canary", workloads: ["batch"] } } });
  const v = evaluateTenantRollout(active, tenants).violations;
  assert.ok(v.some((x) => x.includes(`${A} is in mode "active"`)), v.join("\n"));
});

test("REJECT: an enabled Organization without the batch workload or the task_run source", () => {
  const value = JSON.stringify({ organizations: {
    [A]: { mode: "canary", workloads: ["service"] },
    [B]: { mode: "canary", workloads: ["batch"], sources: ["crew_run"] },
  } });
  const v = evaluateTenantRollout(value, tenants).violations;
  assert.ok(v.some((x) => x.includes(`${A} does not enable the "batch" workload`)), v.join("\n"));
  assert.ok(v.some((x) => x.includes(`${B} does not enable the "task_run" source`)), v.join("\n"));
});

test("REJECT: an undeclared Organization in the rollout, and malformed/empty values", () => {
  const extra = "3d5f7b91-2b3c-4d4e-8f50-6b7c8d9e0f1a";
  const v = evaluateTenantRollout(buildRolloutPolicy([A, B, extra]), tenants).violations;
  assert.ok(v.some((x) => x.includes(`undeclared Organization ${extra}`)), v.join("\n"));
  assert.ok(evaluateTenantRollout("not json", tenants).violations.some((x) => /not valid JSON/.test(x)));
  assert.ok(evaluateTenantRollout("", tenants).violations.some((x) => /not valid JSON/.test(x)));
  assert.ok(evaluateTenantRollout("{}", tenants).violations.some((x) => /no `organizations`/.test(x)));
});

// === the must-be-off switches (S0-8 + the M1a freeze checklist) ===========================

test("parseRolloutBoolean mirrors parseBooleanEnv: blank=off, the four truthy words, the four falsy words, else throw", () => {
  for (const off of [undefined, "", "  ", "0", "false", "FALSE", "no", "off"]) assert.equal(parseRolloutBoolean("X", off), false, String(off));
  for (const on of ["1", "true", "Yes", " on "]) assert.equal(parseRolloutBoolean("X", on), true, on);
  assert.throws(() => parseRolloutBoolean("X", "enabled"), /not a boolean flag/);
});

test("evaluateMustBeOffFlags: false/unset passes; the crew switch or the tool surface ON reds", () => {
  assert.deepEqual(evaluateMustBeOffFlags({ AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED: "false" }).violations, []);
  assert.deepEqual(evaluateMustBeOffFlags({}).violations, []);
  const crew = evaluateMustBeOffFlags({ AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED: "true" }).violations;
  assert.ok(crew.some((x) => /AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED is ON/.test(x)), crew.join("\n"));
  const tools = evaluateMustBeOffFlags({ AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED: "1" }).violations;
  assert.ok(tools.some((x) => /AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED is ON/.test(x)), tools.join("\n"));
  const junk = evaluateMustBeOffFlags({ AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED: "maybe" }).violations;
  assert.ok(junk.some((x) => /unparseable/.test(x)), junk.join("\n"));
});

test("envLinesToMap reads `docker inspect` Env lines, keeping '=' inside values", () => {
  const map = envLinesToMap(`A=1\nAOA_DISTRIBUTED_EXECUTION_ROLLOUT={"organizations":{"x":{"mode":"canary"}}}\nB=x=y\n`);
  assert.equal(map.A, "1");
  assert.equal(map.B, "x=y");
  assert.equal(JSON.parse(map.AOA_DISTRIBUTED_EXECUTION_ROLLOUT).organizations.x.mode, "canary");
});

// === enrolment ================================================================================

test("encodeEnrollmentTicket emits the daemon's exact aoa_tkt_ shape (fixed key order, base64url)", () => {
  const code = "aoa_enr_ABCDEFGHIJKLMNOPQRSTUVWX.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
  const ticket = encodeEnrollmentTicket({ targetId: A, code });
  assert.match(ticket, /^aoa_tkt_[A-Za-z0-9_-]+$/);
  const body = Buffer.from(ticket.slice("aoa_tkt_".length), "base64url").toString("utf8");
  assert.equal(body, JSON.stringify({ v: 1, targetId: A, code }));
});

test("REJECT: a raw code, a non-UUID target, or a non-aoa_enr_ code never becomes a ticket (SK-6)", () => {
  const code = "aoa_enr_ABCDEFGHIJKLMNOPQRSTUVWX.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
  assert.throws(() => encodeEnrollmentTicket({ targetId: "not-a-uuid", code }), /targetId/);
  assert.throws(() => encodeEnrollmentTicket({ targetId: A, code: "aoa_enr_short.x" }), /code/);
  assert.throws(() => encodeEnrollmentTicket({ targetId: A, code: "raw-secret" }), /code/);
});

// === the ratified profile =====================================================================

test("the provider profile lists all eight core operations and the transfer_allowed locality", () => {
  const p = providerConstraintProfileUnsigned();
  assert.deepEqual(p.supportedOperations, ["create", "execute", "cancel", "kill", "destroy", "list", "inspect", "reconcile_cleanup"]);
  assert.ok(p.localityTags.includes("transfer_allowed"));
  assert.equal("digest" in p, false, "the digest is computed in-container with the server's canonicalizer, never here");
});

test("the registered profile is organization_dedicated, matches the row, and references the provider digest", () => {
  const provider = { ...providerConstraintProfileUnsigned(), digest: "d".repeat(64) };
  const profile = registeredTargetProfile({ targetId: B, organizationId: A, provider, deviceGeneration: 1, policyHash: "a".repeat(64) });
  assert.equal(profile.targetClass, "organization_dedicated");
  assert.equal(profile.scope, "organization");
  assert.equal(profile.organizationId, A);
  assert.equal(profile.targetId, B);
  assert.equal(profile.credentialCeiling, "none");
  assert.deepEqual(profile.providerConstraints, { profileId: provider.profileId, version: 1, digest: "d".repeat(64) });
  assert.equal(CANARY_EXECUTION_TARGET_SLUG, "aoa-canary-e2b");
});

// === the verdict + the per-tenant outcome ===================================================

test("parseVerifierVerdict reads the verdict-json line and nothing else", () => {
  const out = "PASS (mechanism)\n  clause 1 ok\n\nverdict-json: {\"ok\":true,\"capabilityProven\":false}\n";
  assert.deepEqual(parseVerifierVerdict(out), { ok: true, capabilityProven: false });
  assert.equal(parseVerifierVerdict("no verdict here"), null);
  assert.equal(parseVerifierVerdict("verdict-json: {broken"), null);
});

const distributedRun = { execution_owner: "distributed", distributed_job_id: "j", distributed_attempt_id: "a", status: "failed" };
const legacyRun = { execution_owner: null, distributed_job_id: null, distributed_attempt_id: null, status: "failed" };

test("an ENABLED tenant passes on a corroborated distributed run; capabilityProven=false is acceptable (M1a)", () => {
  const out = classifyTenantOutcome({
    role: "enabled", run: distributedRun, verifierExit: 0, verdict: { ok: true, capabilityProven: false },
    rolloutResolution: { rolloutState: "canary", rolloutOrganizationId: A },
  });
  assert.deepEqual(out, { pass: true, reasons: [] });
});

test("REJECT (enabled): a legacy run, a verifier FAIL, or a missing verdict", () => {
  const legacy = classifyTenantOutcome({ role: "enabled", run: legacyRun, verifierExit: 1, verdict: { ok: false } });
  assert.equal(legacy.pass, false);
  assert.ok(legacy.reasons.some((x) => /not "distributed"/.test(x)), legacy.reasons.join("\n"));
  const failed = classifyTenantOutcome({ role: "enabled", run: distributedRun, verifierExit: 1, verdict: { ok: false } });
  assert.ok(failed.reasons.some((x) => /verifier exited 1/.test(x)), failed.reasons.join("\n"));
  const none = classifyTenantOutcome({ role: "enabled", run: distributedRun, verifierExit: 0, verdict: null });
  assert.ok(none.reasons.some((x) => /verdict-json is missing/.test(x)), none.reasons.join("\n"));
  assert.equal(classifyTenantOutcome({ role: "enabled", run: null }).pass, false);
});

const offResolution = { rolloutState: "off", rolloutOrganizationId: C };

test("the CONTROL tenant passes only when its run stayed legacy, its Organization has zero jobs, and the rollout resolved OFF", () => {
  assert.deepEqual(
    classifyTenantOutcome({ role: "control", run: legacyRun, jobsForOrganization: 0, rolloutResolution: offResolution }),
    { pass: true, reasons: [] },
  );
});

test("REJECT (control): legacy for the WRONG reason — no rollout record, or a canary resolution", () => {
  const none = classifyTenantOutcome({ role: "control", run: legacyRun, jobsForOrganization: 0, rolloutResolution: null });
  assert.equal(none.pass, false);
  assert.ok(none.reasons.some((x) => /did not log rolloutState "off"/.test(x)), none.reasons.join("\n"));
  const canary = classifyTenantOutcome({ role: "control", run: legacyRun, jobsForOrganization: 0, rolloutResolution: { rolloutState: "canary" } });
  assert.equal(canary.pass, false, "a control the rollout ENABLED that fell back to legacy is not a refusal by the rollout");
});

test("REJECT (enabled): the control plane resolved an enabled tenant's run as anything but canary", () => {
  const out = classifyTenantOutcome({
    role: "enabled", run: distributedRun, verifierExit: 0, verdict: { ok: true }, rolloutResolution: { rolloutState: "off" },
  });
  assert.equal(out.pass, false);
  assert.ok(out.reasons.some((x) => /logged rolloutState "off" for an enabled/.test(x)), out.reasons.join("\n"));
});

// The two logger formats, as the control plane actually prints them (the pretty block is copied
// from a local keyless rehearsal of this lane, ANSI colour codes included).
const PRETTY_LOG = [
  "[10:47:44] \u001b[32mINFO\u001b[39m: \u001b[36m[CLI-006] rollout resolved\u001b[39m",
  "    \u001b[35mrunId\u001b[39m: \"a2f04738-505f-4cde-b8af-dccac68d4b11\"",
  "    \u001b[35missueId\u001b[39m: \"fdf18f47-9b6a-4caa-b0e0-6fa29cedf5ae\"",
  "    \u001b[35mrolloutHookPresent\u001b[39m: true",
  "    \u001b[35mrolloutState\u001b[39m: \"off\"",
  `    \u001b[35mrolloutOrganizationId\u001b[39m: "${C}"`,
  "[10:47:45] \u001b[32mINFO\u001b[39m: something else",
].join("\n");

test("extractRolloutResolution reads the pretty (ANSI, multi-line) logger block for the named run only", () => {
  assert.deepEqual(extractRolloutResolution(PRETTY_LOG, "a2f04738-505f-4cde-b8af-dccac68d4b11"), { rolloutState: "off", rolloutOrganizationId: C });
  assert.equal(extractRolloutResolution(PRETTY_LOG, "00000000-0000-4000-8000-000000000000"), null, "another run's record must not be read");
});

test("extractRolloutResolution reads the block through `docker compose logs`' container prefix", () => {
  const prefixed = PRETTY_LOG.split("\n").map((l) => `control-plane-1  | ${l}`).join("\n");
  assert.deepEqual(extractRolloutResolution(prefixed, "a2f04738-505f-4cde-b8af-dccac68d4b11"), { rolloutState: "off", rolloutOrganizationId: C });
});

test("extractRolloutResolution reads the one-line JSON logger format", () => {
  const json = JSON.stringify({ level: 30, msg: "[CLI-006] rollout resolved", runId: "r-1", rolloutState: "canary", rolloutOrganizationId: A });
  assert.deepEqual(extractRolloutResolution(`noise\n${json}\n`, "r-1"), { rolloutState: "canary", rolloutOrganizationId: A });
  assert.equal(extractRolloutResolution("", "r-1"), null);
});

test("REJECT (control): a control run that went distributed, or a control Organization with any job", () => {
  const went = classifyTenantOutcome({ role: "control", run: distributedRun, jobsForOrganization: 1 });
  assert.equal(went.pass, false);
  assert.ok(went.reasons.some((x) => /control run has execution_owner "distributed"/.test(x)), went.reasons.join("\n"));
  assert.ok(went.reasons.some((x) => /has 1 distributed job/.test(x)), went.reasons.join("\n"));
  const jobOnly = classifyTenantOutcome({ role: "control", run: legacyRun, jobsForOrganization: 2 });
  assert.equal(jobOnly.pass, false, "a job with no owner flip is still a control that was not refused");
});

// === redaction ==============================================================================

test("redactSecrets removes every occurrence of every secret and ignores short/empty ones", () => {
  const text = "key=sk-ant-api03-SECRETVALUE and again sk-ant-api03-SECRETVALUE; pw=abc";
  const out = redactSecrets(text, ["sk-ant-api03-SECRETVALUE", "abc", "", undefined]);
  assert.equal(out, "key=[REDACTED] and again [REDACTED]; pw=abc");
});
