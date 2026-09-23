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

// === the pre-upload leak scan (ruled in under F2 after the distinct review) =================

import { scanEvidenceForSecrets } from "../m1-shipped-boot.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CANARY = "m1-leak-canary-7f3a9c2e5b1d";
const SECRETS = { AOA_M1_TRUTH_SHARED_SECRET: CANARY, OTHER: "another-secret-value-123" };

test("leak scan: clean evidence has no findings (the baseline)", () => {
  assert.deepEqual(scanEvidenceForSecrets([{ name: "logs.txt", text: "all [REDACTED] and fine" }], SECRETS), []);
});

test("POSITIVE CONTROL: a planted canary in an evidence file is found, by file and secret NAME", () => {
  const findings = scanEvidenceForSecrets([{ name: "logs-control-plane.txt", text: `boot ok token=${CANARY} done` }], SECRETS);
  assert.deepEqual(findings, [{ file: "logs-control-plane.txt", secret: "AOA_M1_TRUTH_SHARED_SECRET", form: "raw" }]);
  assert.ok(!JSON.stringify(findings).includes(CANARY), "the finding must never carry the value");
});

test("leak scan: the base64 and base64url forms are found too", () => {
  const b64 = Buffer.from(CANARY).toString("base64");
  const b64url = Buffer.from("x?>~" + CANARY).toString("base64url"); // a value whose url form differs
  const secrets = { S1: CANARY, S2: "x?>~" + CANARY };
  const found = scanEvidenceForSecrets(
    [{ name: "a.json", text: `{"blob":"${b64}"}` }, { name: "b.txt", text: `q=${b64url}` }],
    secrets,
  );
  assert.ok(found.some((f) => f.file === "a.json" && f.secret === "S1" && f.form === "base64"), JSON.stringify(found));
  assert.ok(found.some((f) => f.file === "b.txt" && f.secret === "S2" && f.form === "base64url"), JSON.stringify(found));
});

test("leak scan: values shorter than 8 characters are not scanned (they would match by accident)", () => {
  assert.deepEqual(scanEvidenceForSecrets([{ name: "x", text: "abc" }], { SHORT: "abc" }), []);
});

// The PHASE, end to end: `journey.mjs leak-scan` over a planted evidence dir fails the run, names
// the file and the secret, never prints the value, and deletes the bundle so nothing is uploaded.
const journey = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "m1-shipped-boot", "journey.mjs");

function runLeakScan(evidenceText) {
  const out = mkdtempSync(path.join(tmpdir(), "m1-leak-"));
  mkdirSync(path.join(out, "evidence", "nested"), { recursive: true });
  writeFileSync(path.join(out, "evidence", "nested", "logs-worker.txt"), evidenceText);
  writeFileSync(path.join(out, "state.json"), JSON.stringify({ out, redact: Object.values(SECRETS), secrets: SECRETS }));
  const res = spawnSync(process.execPath, [journey, "leak-scan", "--out", out], { encoding: "utf8" });
  const evidenceSurvived = existsSync(path.join(out, "evidence"));
  rmSync(out, { recursive: true, force: true });
  return { res, evidenceSurvived };
}

test("POSITIVE CONTROL (phase): a planted canary fails the run, names file + secret, never the value, and deletes the bundle", () => {
  const { res, evidenceSurvived } = runLeakScan(`line\nleaked ${CANARY}\n`);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  const output = `${res.stdout}${res.stderr}`;
  assert.match(output, /evidence file 'nested\/logs-worker\.txt' contains job secret 'AOA_M1_TRUTH_SHARED_SECRET'/);
  assert.ok(!output.includes(CANARY), "the scan's own output must never print the secret");
  assert.equal(evidenceSurvived, false, "a leaking bundle must not survive to the upload step");
});

test("leak scan (phase): clean evidence passes and the bundle is kept", () => {
  const { res, evidenceSurvived } = runLeakScan("line\nall [REDACTED]\n");
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /scanned for 2 named job secret\(s\).*clean/);
  assert.equal(evidenceSurvived, true);
});

// === provider-sandbox evidence (runbook §11) — keyed run 35613849443 ========================
//
// That run's enabled tenants both reached verifierExit=0, and the lane still failed. Its own
// `/sandboxId=/` filter could never match the worker's pino JSON. These cases pin the parser, the
// E2B id shape (every test double's hyphenated id is rejected) and the lease scoping.

import { extractSandboxEvidence, parseSandboxLogLine, E2B_SANDBOX_ID_SHAPE } from "../m1-shipped-boot.mjs";

// A REDACTED minimal fixture of the three worker logs in run 35613849443's evidence bundle
// (`m1-shipped-boot-keyed-35613849443`, logs-m1-worker-{a,b,c}.txt). Each line is replayed with
// its compose prefix and `--timestamps` stamp intact. Kept: level, time, msg, leaseId, sandboxId,
// providerOpId, cleanupStatus. Dropped: resourceLabelsHash, and the workerId / targetId /
// deviceThumbprint of the enrolment lines. The two sandbox ids are real, already-destroyed E2B
// sandboxes (`cleanupStatus: success`). They are not credentials.
const RUN_35613849443 = {
  a: [
    'm1-worker-a-1  | 2026-09-21T14:50:20.038698833Z {"level":30,"time":1790002220037,"msg":"worker-daemon starting"}',
    'm1-worker-a-1  | 2026-09-21T14:50:20.451377245Z {"level":30,"time":1790002220440,"msg":"worker-daemon session acquired"}',
    'm1-worker-a-1  | 2026-09-21T14:50:21.034490472Z {"level":30,"time":1790002221034,"msg":"worker-daemon dispatch COMPOSED; heartbeat seeded; leasing through the poll loop"}',
    'm1-worker-a-1  | 2026-09-21T14:50:56.557961137Z {"level":30,"time":1790002256557,"leaseId":"84b237c8-0228-427c-8bf4-08e68e7e04f8","sandboxId":"ir2yj6bc4zh81x258k47b","providerOpId":"e2b-destroy-7","cleanupStatus":"success","msg":"supervisor: run complete"}',
  ].join("\n"),
  b: [
    'm1-worker-b-1  | 2026-09-21T14:50:20.040000000Z {"level":30,"time":1790002220040,"msg":"worker-daemon starting"}',
    'm1-worker-b-1  | 2026-09-21T14:51:32.325974615Z {"level":30,"time":1790002292325,"leaseId":"2d3d4984-cb59-43ef-bb5b-22e1db4282a6","sandboxId":"i1pbzfz6n7y4wb3q5k616","providerOpId":"e2b-destroy-14","cleanupStatus":"success","msg":"supervisor: run complete"}',
  ].join("\n"),
  c: [
    'm1-worker-c-1  | 2026-09-21T14:50:20.027900470Z {"level":30,"time":1790002220027,"msg":"worker-daemon starting"}',
    'm1-worker-c-1  | 2026-09-21T14:50:20.387957981Z {"level":30,"time":1790002220387,"msg":"worker-daemon enrolled"}',
    'm1-worker-c-1  | 2026-09-21T14:50:21.000000000Z {"level":30,"time":1790002221000,"msg":"worker-daemon dispatch COMPOSED; heartbeat seeded; leasing through the poll loop"}',
  ].join("\n"),
};
// Each enabled tenant's leases, i.e. what the lane reads from `leases.attempt_id` for its run.
// In the bundle, the control plane that acked each lease is the one that tenant's worker talks
// to: A's lease on `control-plane`, B's on `control-plane-b`.
const LEASES = {
  a: ["84b237c8-0228-427c-8bf4-08e68e7e04f8"],
  b: ["2d3d4984-cb59-43ef-bb5b-22e1db4282a6"],
  c: [],
};

test("POSITIVE CONTROL: replaying run 35613849443's three worker logs gives >=1 for a and b, 0 for c", () => {
  const a = extractSandboxEvidence(RUN_35613849443.a, { leaseIds: LEASES.a });
  const b = extractSandboxEvidence(RUN_35613849443.b, { leaseIds: LEASES.b });
  const c = extractSandboxEvidence(RUN_35613849443.c, { leaseIds: LEASES.c });
  assert.deepEqual(a.sandboxIds, ["ir2yj6bc4zh81x258k47b"]);
  assert.deepEqual(b.sandboxIds, ["i1pbzfz6n7y4wb3q5k616"]);
  assert.equal(c.count, 0);
});

test("the ORIGINAL filter (/sandboxId=/) finds nothing in the same logs — the defect, pinned", () => {
  for (const key of ["a", "b"]) {
    assert.equal(RUN_35613849443[key].split("\n").filter((l) => /sandboxId=/.test(l)).length, 0);
  }
});

test("the real JSON line counts; the sandboxId= text form counts too", () => {
  assert.deepEqual(parseSandboxLogLine(RUN_35613849443.a.split("\n")[3]), {
    sandboxId: "ir2yj6bc4zh81x258k47b",
    leaseId: "84b237c8-0228-427c-8bf4-08e68e7e04f8",
  });
  const text = extractSandboxEvidence("supervisor: run complete sandboxId=ir2yj6bc4zh81x258k47b cleanupStatus=success");
  assert.equal(text.count, 1, "a text-form line with no lease id is scoped by the tenant's own worker");
});

test("REJECT: every test double's sandbox id (fake provider `<providerId>-res-<n>`, mock transport `sbx-000001`)", () => {
  for (const fake of ["fake-provider-res-1", "d1-fake-res-12", "sbx-000001"]) {
    assert.equal(E2B_SANDBOX_ID_SHAPE.test(fake), false, fake);
    const line = JSON.stringify({ level: 30, leaseId: LEASES.a[0], sandboxId: fake, msg: "supervisor: run complete" });
    const evidence = extractSandboxEvidence(`m1-worker-a-1  | ${line}`, { leaseIds: LEASES.a });
    assert.equal(evidence.count, 0, fake);
    assert.equal(evidence.rejected.shape, 1, fake);
  }
});

test("REJECT: a line with no sandboxId, and a sandboxId that is not a string", () => {
  assert.equal(parseSandboxLogLine('{"level":30,"leaseId":"x","msg":"supervisor: run complete"}'), null);
  assert.equal(extractSandboxEvidence('{"sandboxId":12345678901234567890}').count, 0);
  assert.equal(extractSandboxEvidence("").count, 0);
});

test("REJECT: a real-shaped sandbox on ANOTHER run's lease (tenant/run scoping by lease)", () => {
  // Tenant B's line replayed against tenant A's leases: right shape, wrong lease.
  const cross = extractSandboxEvidence(RUN_35613849443.b, { leaseIds: LEASES.a });
  assert.equal(cross.count, 0);
  assert.equal(cross.rejected.foreignLease, 1);
  // With no lease known for the run, a lease-bearing line cannot be attributed to it.
  assert.equal(extractSandboxEvidence(RUN_35613849443.a, { leaseIds: [] }).count, 0);
});
// -----------------------------------------------------------------------------
// DEP-017 — the live env-absence probe's evidence, as the journey judges it per enabled tenant.
// The probe itself (the in-sandbox bytes, the planted control, the fail-closed supervisor step) is
// tested in packages/worker-daemon/src/__tests__/env-probe.test.ts; this pins the READ side.
// -----------------------------------------------------------------------------

import { readFileSync as readFileSyncDep017 } from "node:fs";
import {
  ENV_PROBE_LOG_PREFIX,
  ENV_PROBE_CANARY_MARKER,
  ENV_PROBE_EXPECTED_CLASSES,
  plantedTenantCanary,
  extractEnvProbeSummary,
  evaluateEnvProbeEvidence,
} from "../m1-shipped-boot.mjs";

const DEP017_ORG = "00000000-0000-4000-8000-00000000d0a1";
const cleanSummary = () => ({
  probe: "dep017-env-absence/v1",
  verdict: "absent",
  clean: {
    checked: [...ENV_PROBE_EXPECTED_CLASSES],
    present: [],
    presentNames: [],
    allowedPresent: ["ANTHROPIC_API_KEY"],
    allowedMismatch: [],
    redeemedNames: ["ANTHROPIC_API_KEY"],
    metadata: { attempted: true, target: "169.254.169.254", reachable: true, httpStatus: 200 },
  },
  plantedControl: { planted: [{ name: "DATABASE_URL", expectClass: "datastore_credential", satisfied: true }], detected: ["cross_tenant_credential", "datastore_credential"], red: true },
});

test("DEP-017: the lane's constants MIRROR the worker's (the probe's log prefix and canary marker)", () => {
  const src = readFileSyncDep017(new URL("../../../packages/worker-daemon/src/supervisor/env-probe.ts", import.meta.url), "utf8");
  assert.ok(src.includes(`export const ENV_PROBE_LOG_PREFIX = ${JSON.stringify(ENV_PROBE_LOG_PREFIX)};`), "log prefix drifted");
  assert.ok(src.includes(`export const ENV_PROBE_CANARY_MARKER = ${JSON.stringify(ENV_PROBE_CANARY_MARKER)};`), "canary marker drifted");
  // The class mirror, extracted from the daemon's own table + its four derived-class constants.
  const table = src.slice(src.indexOf("export const ENV_PROBE_CREDENTIAL_CLASSES"), src.indexOf("/** Classes the probe derives from a VALUE"));
  const fromSource = [...table.matchAll(/class: "([a-z_]+)"/g)].map((m) => m[1]);
  for (const constant of ["ENV_PROBE_UNCLASSIFIED", "crossTenant:", "ENV_PROBE_VALUE_MISMATCH", "ENV_PROBE_UNREDEEMED"]) {
    const m = new RegExp(`${constant}\\s*=?\\s*"([a-z_]+)"`).exec(src);
    assert.ok(m, `could not read ${constant} from the daemon source`);
    fromSource.push(m[1]);
  }
  assert.deepEqual([...fromSource].sort(), [...ENV_PROBE_EXPECTED_CLASSES].sort(), "the lane's expected class list drifted from the daemon's");
});

test("DEP-017: a clean probe summary passes, and the metadata residual is RECORDED, not judged", () => {
  const r = evaluateEnvProbeEvidence(cleanSummary());
  assert.equal(r.pass, true, r.reasons.join("; "));
  // IMDS answered — and the tenant still passes: an observation, never an egress claim.
  assert.equal(r.observed.de08MetadataResidual.reachable, true);
  assert.equal(r.observed.de08MetadataResidual.httpStatus, 200);
  assert.match(r.observed.de08MetadataResidual.note, /not enforced/);
});

test("DEP-017 POSITIVE CONTROL: no probe summary on an enabled tenant's attempt FAILS (a probe that did not run)", () => {
  const r = evaluateEnvProbeEvidence(extractEnvProbeSummary(["some other log line"]));
  assert.equal(r.pass, false);
  assert.match(r.reasons[0], /did not run/);
});

test("DEP-017 POSITIVE CONTROL: a present credential class FAILS and is named (names only)", () => {
  const s = cleanSummary();
  s.verdict = "present";
  s.clean.present = ["cross_tenant_credential"];
  s.clean.presentNames = ["ANTHROPIC_API_KEY"];
  const r = evaluateEnvProbeEvidence(s);
  assert.equal(r.pass, false);
  assert.ok(r.reasons.some((x) => /PRESENT.*cross_tenant_credential.*ANTHROPIC_API_KEY/.test(x)), r.reasons.join("; "));
});

test("DEP-017 POSITIVE CONTROL: a blind probe (planted control not red) FAILS", () => {
  const s = cleanSummary();
  s.plantedControl.red = false;
  assert.equal(evaluateEnvProbeEvidence(s).pass, false);
});

test("DEP-017 POSITIVE CONTROL: a report missing ANY expected class FAILS (a partial taxonomy is not the taxonomy)", () => {
  for (const dropped of ["cross_tenant_credential", "secrets_master_key", "provider_credential_value_mismatch"]) {
    const s = cleanSummary();
    s.clean.checked = ENV_PROBE_EXPECTED_CLASSES.filter((c) => c !== dropped);
    const r = evaluateEnvProbeEvidence(s);
    assert.equal(r.pass, false, dropped);
    assert.ok(r.reasons.some((x) => x.includes(dropped)), r.reasons.join("; "));
  }
});

test("DEP-017: extractEnvProbeSummary reads the LAST summary; an unreadable one fails", () => {
  const a = { ...cleanSummary(), verdict: "present" };
  const b = cleanSummary();
  assert.equal(extractEnvProbeSummary([`${ENV_PROBE_LOG_PREFIX}${JSON.stringify(a)}`, "x", `${ENV_PROBE_LOG_PREFIX}${JSON.stringify(b)}`]).verdict, "absent");
  const bad = extractEnvProbeSummary([`${ENV_PROBE_LOG_PREFIX}{not json`]);
  assert.equal(evaluateEnvProbeEvidence(bad).pass, false);
});

test("DEP-017: plantedTenantCanary carries the marker + Organization, and refuses a weak tail", () => {
  const c = plantedTenantCanary(DEP017_ORG, "model_provider", "AbCdEfGhIjKlMnOpQrSt");
  assert.equal(c, `${ENV_PROBE_CANARY_MARKER}${DEP017_ORG}.model_provider.AbCdEfGhIjKlMnOpQrSt`);
  assert.throws(() => plantedTenantCanary(DEP017_ORG, "model_provider", "short"));
  assert.throws(() => plantedTenantCanary("not-an-org", "model_provider", "AbCdEfGhIjKlMnOpQrSt"));
});

test("DEP-017 POSITIVE CONTROL: an UNEXPECTED checked class FAILS too (set equality, both directions)", () => {
  const s = cleanSummary();
  s.clean.checked = [...ENV_PROBE_EXPECTED_CLASSES, "some_class_the_lane_does_not_know"];
  const r = evaluateEnvProbeEvidence(s);
  assert.equal(r.pass, false);
  assert.ok(r.reasons.some((x) => x.includes("some_class_the_lane_does_not_know")), r.reasons.join("; "));
});

// === the LOG surface (review batch 3A, PR #569) =============================================
//
// PR #569 MEASURED run 35619555883: across the complete job log (2347 lines) and all 20 evidence
// files there were zero hits for `BEGIN PUBLIC KEY`, the ed25519 SPKI prefix `MCowBQYDK2VwAyEA`,
// the PKCS#8 prefix `MC4CAQAwBQYDK2VwBCIEI`, and no `PRIVATE KEY`. Acceptance 2 held on both
// surfaces for that run. What was missing was the CONTROL: the scan walked only the evidence
// directory, nothing emitted `::add-mask::`, and only the PRIVATE half was registered.

import {
  scanForKeyMaterial,
  KEY_MATERIAL_MARKERS,
  MASK_DIRECTIVE_PREFIX,
} from "../m1-shipped-boot.mjs";

const PRIVATE_PEM = [
  "-----BEGIN PRIVATE KEY-----",
  "MC4CAQAwBQYDK2VwBCIEIGHhTESTTESTTESTTESTTESTTESTTESTTESTTESTTEST",
  "-----END PRIVATE KEY-----",
].join("\n");
const PUBLIC_PEM = [
  "-----BEGIN PUBLIC KEY-----",
  "MCowBQYDK2VwAyEATESTTESTTESTTESTTESTTESTTESTTESTTESTTESTTEST",
  "-----END PUBLIC KEY-----",
].join("\n");

test("key material is found by SHAPE, on either surface, and reported by marker + line only", () => {
  const { findings } = scanForKeyMaterial([
    { name: "job-log.txt", text: `boot ok\n${PRIVATE_PEM}\nnext line` },
    { name: "logs-control-plane.txt", text: `x\n${PUBLIC_PEM}` },
  ]);
  const markers = findings.map((f) => f.marker).sort();
  assert.deepEqual(markers, ["ed25519_pkcs8_der", "ed25519_spki_der", "pem_private", "pem_public"].sort());
  assert.ok(findings.every((f) => typeof f.line === "number" && f.line > 0));
  // The finding must not carry the material itself.
  const serialized = JSON.stringify(findings);
  assert.ok(!serialized.includes("MCowBQYDK2VwAyEA") && !serialized.includes("MC4CAQAwBQYDK2VwBCIEI"));
});

test("a clean log is clean, and the DER prefixes alone (no PEM armour) are still found", () => {
  assert.deepEqual(scanForKeyMaterial([{ name: "job-log.txt", text: "all [REDACTED]\nfine\n" }]).findings, []);
  const bare = scanForKeyMaterial([{ name: "job-log.txt", text: "key=MCowBQYDK2VwAyEAabc" }]).findings;
  assert.deepEqual(bare.map((f) => f.marker), ["ed25519_spki_der"]);
  assert.equal(KEY_MATERIAL_MARKERS.length, 4);
});

test("the ::add-mask:: directive line is skipped and COUNTED — the exception cannot hide an unbounded number", () => {
  const text = `${MASK_DIRECTIVE_PREFIX}${PRIVATE_PEM.split("\n")[1]}\nsafe line\n`;
  const skipped = scanForKeyMaterial([{ name: "job-log.txt", text }]);
  assert.deepEqual(skipped.findings, []);
  assert.equal(skipped.maskDirectiveLines, 1);
  // And with the exception off, the same line IS key material — so the skip is what excuses it,
  // not an inability to see it.
  const strict = scanForKeyMaterial([{ name: "job-log.txt", text }], { skipMaskDirectives: false });
  assert.deepEqual(strict.findings.map((f) => f.marker), ["ed25519_pkcs8_der"]);
});

// The PHASE, end to end, over a planted JOB LOG.
function runLeakScanOverLog(logText, extraSecrets = {}) {
  const out = mkdtempSync(path.join(tmpdir(), "m1-logscan-"));
  mkdirSync(path.join(out, "evidence"), { recursive: true });
  writeFileSync(path.join(out, "evidence", "journey.json"), '{"passed":true}\n');
  writeFileSync(path.join(out, "job-log.txt"), logText);
  const secrets = { ...SECRETS, ...extraSecrets };
  writeFileSync(path.join(out, "state.json"), JSON.stringify({ out, redact: Object.values(secrets), secrets }));
  const res = spawnSync(process.execPath, [journey, "leak-scan", "--out", out], { encoding: "utf8" });
  const survived = { evidence: existsSync(path.join(out, "evidence")), log: existsSync(path.join(out, "job-log.txt")) };
  rmSync(out, { recursive: true, force: true });
  return { res, survived };
}

test("POSITIVE CONTROL (phase): a PEM planted in the JOB LOG reds the scan and deletes both surfaces", () => {
  const { res, survived } = runLeakScanOverLog(`starting\n${PRIVATE_PEM}\ndone\n`);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  const output = `${res.stdout}${res.stderr}`;
  assert.match(output, /job log file 'job-log\.txt' line \d+ carries key material \(pem_private\)/);
  assert.ok(!output.includes("MC4CAQAwBQYDK2VwBCIEI"), "the scan's output must never carry the material");
  assert.deepEqual(survived, { evidence: false, log: false });
});

test("POSITIVE CONTROL (phase): a REGISTERED secret planted in the job log reds it, by NAME", () => {
  const { res } = runLeakScanOverLog(`boot ok token=${CANARY}\n`);
  assert.equal(res.status, 1);
  assert.match(`${res.stdout}${res.stderr}`, /job log file 'job-log\.txt' contains job secret 'AOA_M1_TRUTH_SHARED_SECRET'/);
  assert.ok(!`${res.stdout}${res.stderr}`.includes(CANARY));
});

test("POSITIVE CONTROL (phase): the PUBLIC half, registered, is caught on the log surface too", () => {
  const publicBody = PUBLIC_PEM.split("\n")[1];
  const { res } = runLeakScanOverLog(`cp pubkey ${publicBody}\n`, { CONTROL_PLANE_PUBLIC_KEY_BODY: publicBody });
  assert.equal(res.status, 1);
  const output = `${res.stdout}${res.stderr}`;
  assert.match(output, /contains job secret 'CONTROL_PLANE_PUBLIC_KEY_BODY'|carries key material \(ed25519_spki_der\)/);
  assert.ok(!output.includes(publicBody));
});

test("leak scan (phase): a clean job log passes, is counted, and both surfaces survive", () => {
  const { res, survived } = runLeakScanOverLog("boot ok\nall [REDACTED]\n");
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /1 job-log file\(s\) scanned/);
  assert.match(res.stdout, /key-material shapes: clean/);
  assert.deepEqual(survived, { evidence: true, log: true });
});

test("leak scan (phase): with no job log at all, the evidence scan still runs (no silent skip)", () => {
  const out = mkdtempSync(path.join(tmpdir(), "m1-logscan-none-"));
  mkdirSync(path.join(out, "evidence"), { recursive: true });
  writeFileSync(path.join(out, "evidence", "logs.txt"), "clean\n");
  writeFileSync(path.join(out, "state.json"), JSON.stringify({ out, redact: Object.values(SECRETS), secrets: SECRETS }));
  const res = spawnSync(process.execPath, [journey, "leak-scan", "--out", out], { encoding: "utf8" });
  rmSync(out, { recursive: true, force: true });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /0 job-log file\(s\) scanned/);
});

// The two registrations the control depends on, asserted against the driver's source: a masking
// call that is not made, or a half that is not registered, is exactly the gap PR #569 measured.
test("the driver MASKS every registered secret and registers BOTH halves of BOTH keys", () => {
  const driver = readFileSync(journey, "utf8");
  assert.match(driver, /for \(const directive of maskDirectivesFor\(value\)\) console\.log\(directive\);/, "trackSecret must emit ::add-mask:: for every registered secret");
  assert.match(driver, /process\.env\.GITHUB_ACTIONS === "true"/, "the directive is emitted only inside Actions");
  for (const name of [
    "CONTROL_PLANE_SIGNING_KEY_PEM",
    "CONTROL_PLANE_SIGNING_KEY_BODY",
    "CONTROL_PLANE_PUBLIC_KEY_PEM",
    "CONTROL_PLANE_PUBLIC_KEY_BODY",
  ]) {
    assert.ok(driver.includes(`trackSecret(state, "${name}"`), `the driver must register ${name}`);
  }
  // And the log surface must be read by the scan, not only the evidence directory.
  assert.match(driver, /jobLogPath\(state\)/);
});

// === Codex P1s on PR #574: the mask must not PUBLISH what it masks, and must not red the scan ===

import { maskDirectivesFor, stripMaskDirectives } from "../m1-shipped-boot.mjs";

test("POSITIVE CONTROL: a multi-line PEM is NEVER emitted in one directive (a command ends at the newline)", () => {
  const directives = maskDirectivesFor(PRIVATE_PEM);
  assert.equal(directives.length, 3, JSON.stringify(directives));
  for (const directive of directives) {
    assert.ok(directive.startsWith(MASK_DIRECTIVE_PREFIX));
    assert.ok(!directive.includes("\n"), "a directive carrying a newline would PRINT everything after it");
  }
  // Every line of the key is registered — including the body, which is the material itself.
  assert.ok(directives.some((d) => d.includes("MC4CAQAwBQYDK2VwBCIEI")));
});

test("maskDirectivesFor: a single-line value is one directive; short or repeated parts are dropped", () => {
  assert.deepEqual(maskDirectivesFor("a-long-enough-secret"), [`${MASK_DIRECTIVE_PREFIX}a-long-enough-secret`]);
  assert.deepEqual(maskDirectivesFor("short"), []);
  assert.deepEqual(maskDirectivesFor("dupe-value\ndupe-value"), [`${MASK_DIRECTIVE_PREFIX}dupe-value`]);
  assert.deepEqual(maskDirectivesFor(""), []);
});

test("POSITIVE CONTROL: the driver's OWN mask directives in the captured log do NOT red the scan", () => {
  // Every registered secret is printed as a directive and teed verbatim. Before the strip, each was
  // a guaranteed raw match, so every keyed run would have failed its own leak scan (Codex P1).
  const directives = [...maskDirectivesFor(CANARY), ...maskDirectivesFor(PRIVATE_PEM)].join("\n");
  const { res } = runLeakScanOverLog(`starting\n${directives}\ndone\n`);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /4 ::add-mask:: directive line\(s\) stripped/);
});

test("the strip is EXACT: the same secret on an ordinary line still reds, in the same log", () => {
  const { res } = runLeakScanOverLog(`${maskDirectivesFor(CANARY)[0]}\nleaked ${CANARY}\n`);
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(`${res.stdout}${res.stderr}`, /contains job secret 'AOA_M1_TRUTH_SHARED_SECRET'/);
});

test("stripMaskDirectives removes only whole directive lines, and counts them", () => {
  const { text, removed } = stripMaskDirectives("keep\n::add-mask::secretvalue\nkeep2\n");
  assert.equal(removed, 1);
  assert.equal(text, "keep\nkeep2\n");
  // A line that merely MENTIONS the prefix mid-line is not a directive and is kept.
  assert.equal(stripMaskDirectives("we emit ::add-mask::x here").removed, 0);
});

test("the driver emits directives through the shared helper, never ad hoc", () => {
  const driver = readFileSync(journey, "utf8");
  assert.match(driver, /for \(const directive of maskDirectivesFor\(value\)\) console\.log\(directive\);/);
  assert.match(driver, /stripMaskDirectives\(rawLog\)/);
});

// === Codex P1/P2 (second round, PR #574): publish redacted, capture raw ======================

import { redactKeyMaterialLine, createLineRedactor, stripLogPrefix, base64Payload } from "../m1-shipped-boot.mjs";

test("POSITIVE CONTROL: an UNREGISTERED key is redacted on its way to the published log", () => {
  // Masking covers only registered values. This is the re-run / operator-key case: nothing knows
  // these bytes, and a published Actions log cannot be retracted.
  for (const line of PRIVATE_PEM.split("\n").concat(PUBLIC_PEM.split("\n"))) {
    const out = redactKeyMaterialLine(line);
    // The BEGIN armour and the DER-prefixed body are what carry (or announce) the key; a bare
    // `-----END …-----` footer carries nothing and is left readable.
    if (/BEGIN|MCow|MC4C/.test(line)) {
      assert.match(out, /^\[REDACTED: key material \((pem_private|pem_public|ed25519_spki_der|ed25519_pkcs8_der)\)/, line);
      assert.ok(!out.includes(line), "the redacted form must not carry the line");
    }
  }
  assert.equal(redactKeyMaterialLine("boot ok, nothing to hide"), "boot ok, nothing to hide");
  // A masking directive passes through: it IS the mechanism, and GitHub renders it as ***.
  const directive = maskDirectivesFor(CANARY)[0];
  assert.equal(redactKeyMaterialLine(directive), directive);
});

test("the log filter CAPTURES raw and PUBLISHES redacted (end to end)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "m1-filter-"));
  const capture = path.join(dir, "nested", "job-log.txt");
  const filter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "m1-shipped-boot", "log-filter.mjs");
  const input = `starting\n${PRIVATE_PEM}\n${maskDirectivesFor(CANARY)[0]}\ndone\n`;
  const res = spawnSync(process.execPath, [filter, capture], { input, encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  // Published: no key material, but the run is still readable and the directive survives.
  assert.ok(!res.stdout.includes("MC4CAQAwBQYDK2VwBCIEI"), res.stdout);
  // A PEM is redacted as a BLOCK now (armour AND body), not line-by-line: see the re-wrapped-PEM
  // control below.
  assert.match(res.stdout, /\[REDACTED: key material \(pem_block\)/);
  assert.match(res.stdout, /starting/);
  assert.ok(res.stdout.includes(maskDirectivesFor(CANARY)[0]));
  // Captured: the RAW bytes, so the leak scan can still judge them.
  const captured = readFileSync(capture, "utf8");
  assert.ok(captured.includes("MC4CAQAwBQYDK2VwBCIEI"), "the capture must keep the raw line for the scan");
  rmSync(dir, { recursive: true, force: true });
});

test("POSITIVE CONTROL (P2): an unregistered key on an ::add-mask:: line in EVIDENCE is still caught", () => {
  // An uploaded artifact does not interpret workflow commands, so the directive exception must not
  // apply there. The same line in the JOB LOG is stripped (that surface is rendered by GitHub).
  const out = mkdtempSync(path.join(tmpdir(), "m1-evidence-directive-"));
  mkdirSync(path.join(out, "evidence"), { recursive: true });
  writeFileSync(path.join(out, "evidence", "verifier-a.txt"), `${MASK_DIRECTIVE_PREFIX}${PRIVATE_PEM.split("\n")[1]}\n`);
  writeFileSync(path.join(out, "state.json"), JSON.stringify({ out, redact: Object.values(SECRETS), secrets: SECRETS }));
  const res = spawnSync(process.execPath, [journey, "leak-scan", "--out", out], { encoding: "utf8" });
  rmSync(out, { recursive: true, force: true });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(`${res.stdout}${res.stderr}`, /evidence file 'verifier-a\.txt' line 1 carries key material \(ed25519_pkcs8_der\)/);
});

test("POSITIVE CONTROL: the log filter FAILS CLOSED when the capture cannot be written (Codex P1)", () => {
  // A capture that silently failed would leave the pipeline green while the leak scan read an
  // absent job log as clean — coverage claimed, not had. The parent here is a FILE, so the
  // append cannot succeed.
  const dir = mkdtempSync(path.join(tmpdir(), "m1-filter-fail-"));
  const blocker = path.join(dir, "blocker");
  writeFileSync(blocker, "not a directory\n");
  const filter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "m1-shipped-boot", "log-filter.mjs");
  const res = spawnSync(process.execPath, [filter, path.join(blocker, "job-log.txt")], { input: "a line\n", encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  assert.notEqual(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.match(`${res.stdout}${res.stderr}`, /log-filter: the job-log capture failed/);
});

test("POSITIVE CONTROL: a PER-LINE capture failure also fails closed (not only the startup mkdir)", () => {
  // The capture PATH is an existing directory: `mkdir -p` of its parent succeeds, so the startup
  // arm passes and the failure lands on the append — the arm a surviving mutation showed was
  // otherwise untested.
  const dir = mkdtempSync(path.join(tmpdir(), "m1-filter-line-"));
  const capture = path.join(dir, "capture-dir");
  mkdirSync(capture);
  const filter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "m1-shipped-boot", "log-filter.mjs");
  const res = spawnSync(process.execPath, [filter, capture], { input: "a line\n", encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  assert.notEqual(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.match(`${res.stdout}${res.stderr}`, /log-filter: the job-log capture failed/);
});

test("POSITIVE CONTROL: a RE-WRAPPED PEM is redacted as a BLOCK, body and all (Codex P1)", () => {
  // Node accepts a PEM wrapped at any width. Re-wrapped, the DER prefix is split, so no
  // continuation line matches a marker: per-line redaction would publish the key body while
  // redacting only its BEGIN armour.
  const rewrapped = [
    "-----BEGIN PRIVATE KEY-----",
    "MC4CAQAwBQYD",
    "K2VwBCIEIGHhTESTTESTTESTTESTTESTTEST",
    "-----END PRIVATE KEY-----",
  ];
  const redact = createLineRedactor();
  const published = ["before", ...rewrapped, "after"].map(redact);
  assert.deepEqual([published[0], published.at(-1)], ["before", "after"], "ordinary lines are untouched");
  for (const line of published.slice(1, -1)) {
    assert.match(line, /^\[REDACTED: key material \(pem_block\)/);
  }
  // Per-line redaction alone would have forwarded the two body fragments.
  assert.equal(redactKeyMaterialLine(rewrapped[1]), rewrapped[1]);
  assert.equal(redactKeyMaterialLine(rewrapped[2]), rewrapped[2]);
});

test("the block redactor closes on END, survives a single-line PEM, and fails closed on an unterminated one", () => {
  const redact = createLineRedactor();
  redact("-----BEGIN PUBLIC KEY-----");
  redact("MCowBQYDK2VwAyEA…");
  assert.match(redact("-----END PUBLIC KEY-----"), /pem_block/);
  assert.equal(redact("back to ordinary output"), "back to ordinary output");
  const single = createLineRedactor();
  assert.match(single("-----BEGIN PUBLIC KEY-----MCowBQYD-----END PUBLIC KEY-----"), /pem_block/);
  assert.equal(single("still ordinary"), "still ordinary", "a single-line PEM must not latch the block open");
  const truncated = createLineRedactor();
  truncated("-----BEGIN PRIVATE KEY-----");
  assert.match(truncated("MC4CAQAwBQYD"), /pem_block/);
  assert.match(truncated("anything after an unterminated block"), /pem_block/, "a truncated key is still a key");
});

test("the log filter publishes NO part of a re-wrapped PEM, and still captures it raw", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "m1-filter-block-"));
  const capture = path.join(dir, "job-log.txt");
  const filter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "m1-shipped-boot", "log-filter.mjs");
  const body = "K2VwBCIEIGHhTESTTESTTESTTESTTESTTEST";
  const input = `starting\n-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYD\n${body}\n-----END PRIVATE KEY-----\ndone\n`;
  const res = spawnSync(process.execPath, [filter, capture], { input, encoding: "utf8" });
  const captured = readFileSync(capture, "utf8");
  rmSync(dir, { recursive: true, force: true });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!res.stdout.includes(body) && !res.stdout.includes("MC4CAQAwBQYD"), res.stdout);
  assert.ok(captured.includes(body), "the capture keeps the raw block for the leak scan");
});

test("POSITIVE CONTROL: UNARMOURED DER wrapped across lines is redacted on the completing line (Codex P1)", () => {
  // No `BEGIN` armour, so nothing latches a block, and neither fragment carries the whole prefix.
  const wrapped = ["MC4CAQAwBQYD", "K2VwBCIEIGHhSECRETSECRETSECRETSECRETSECRET"];
  assert.equal(redactKeyMaterialLine(wrapped[0]), wrapped[0], 'neither fragment matches on its own');
  assert.equal(redactKeyMaterialLine(wrapped[1]), wrapped[1]);
  const redact = createLineRedactor();
  const published = wrapped.map(redact);
  assert.match(published[1], /\[REDACTED: key material \(ed25519_pkcs8_der, wrapped\)/);
  assert.equal(redact('ordinary output resumes'), 'ordinary output resumes');
});

test("POSITIVE CONTROL: a long base64 RUN is redacted, so a wrapped key BODY never publishes", () => {
  const redact = createLineRedactor();
  const body = 'GHh' + 'SECRETb64'.repeat(6);
  assert.ok(body.length >= 40);
  assert.match(redact(body), /\[REDACTED: key material \(base64_run\)/);
  // Ordinary prose and short tokens survive: the lane must stay readable.
  for (const keep of ['reconcile: 3 Organizations', 'sha256:abc123', 'run 8dc34e90 ok']) {
    assert.equal(redact(keep), keep);
  }
});

test("the SCAN joins lines too: a wrapped DER value in evidence is found, at the completing line", () => {
  const text = ['noise', 'MC4CAQAwBQYD', 'K2VwBCIEIGHh', 'noise'].join('\n');
  const { findings } = scanForKeyMaterial([{ name: 'e.txt', text }], { skipMaskDirectives: false });
  assert.equal(findings.length, 1, JSON.stringify(findings));
  assert.deepEqual(
    { marker: findings[0].marker, line: findings[0].line, wrapped: findings[0].wrapped },
    { marker: 'ed25519_pkcs8_der', line: 3, wrapped: true },
  );
  // POSITIVE CONTROL that this is not an always-find: unrelated adjacent lines stay clean.
  const clean = scanForKeyMaterial([{ name: 'e.txt', text: 'hello\nworld' }], { skipMaskDirectives: false });
  assert.deepEqual(clean.findings, []);
});

test("POSITIVE CONTROL: a failed capture leaves a DURABLE marker, and the leak scan REFUSES on it", () => {
  const out = mkdtempSync(path.join(tmpdir(), 'm1-capture-marker-'));
  mkdirSync(path.join(out, 'evidence'), { recursive: true });
  writeFileSync(path.join(out, 'evidence', 'verifier-a.txt'), 'clean\n');
  writeFileSync(path.join(out, 'job-log.txt'), 'a truncated but clean-looking log\n');
  writeFileSync(path.join(out, 'job-log.txt.capture-failed'), 'append: ENOSPC\n');
  writeFileSync(path.join(out, 'state.json'), JSON.stringify({ out, redact: [], secrets: {} }));
  const res = spawnSync(process.execPath, [journey, 'leak-scan', '--out', out], { encoding: 'utf8' });
  const gone = !existsSync(path.join(out, 'evidence'));
  rmSync(out, { recursive: true, force: true });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(`${res.stdout}${res.stderr}`, /capture FAILED during this run/);
  assert.ok(gone, 'the bundle the scan could not judge must not survive to be uploaded');
});

test("POSITIVE CONTROL: the filter WRITES that marker when the capture cannot be appended", () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'm1-marker-write-'));
  const capture = path.join(dir, 'job-log.txt');
  mkdirSync(capture);  // a DIRECTORY where the capture file belongs: every append fails
  const filter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'm1-shipped-boot', 'log-filter.mjs');
  const res = spawnSync(process.execPath, [filter, capture], { input: 'one line\n', encoding: 'utf8' });
  const marked = existsSync(`${capture}.capture-failed`);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(res.status, 1, res.stdout);
  assert.ok(marked, 'the failure must outlive the step that saw it');
});

test("POSITIVE CONTROL: a DER prefix LATCHES — a 12-char wrap publishes NO body line (Codex P1)", () => {
  // Codex's case: an unarmoured PKCS#8 export wrapped into 12-character lines. Every continuation
  // line is far under the 40-character base64-run threshold, so only the latch can catch them.
  const key = 'MC4CAQAwBQYDK2VwBCIEIG' + 'HhSeedBytes'.repeat(4) + 'ZZ';
  const wrapped = key.match(/.{1,12}/g);
  assert.ok(wrapped.length > 4);
  const redact = createLineRedactor();
  const published = wrapped.map(redact);
  // Line 1 is the first 12 characters of the FIXED algorithm header and carries no key bytes;
  // it is unavoidable, because nothing has matched yet. Line 2 COMPLETES the prefix when joined,
  // and from there the latch must hold: no line of the SEED may ever be published.
  assert.equal(published[0], wrapped[0]);
  assert.ok(!key.slice(21).startsWith(wrapped[0]), 'line 1 must be header, not seed');
  for (let i = 1; i < wrapped.length; i += 1) {
    assert.match(published[i], /\[REDACTED: key material /, `line ${i + 1} (${published[i]}) published raw`);
  }
  // The block ends at the first line that is not a bare base64 wrap — output resumes.
  assert.equal(redact('reconcile: 3 Organizations'), 'reconcile: 3 Organizations');
  assert.equal(redact('MC4CAQAwBQYD'.slice(0, 4)), 'MC4C', 'a short token after the block is not key material');
});

test("the DER latch does not swallow ordinary output, and a PEM hit does not open one", () => {
  const redact = createLineRedactor();
  assert.match(redact('key=MCowBQYDK2VwAyEAabc'), /ed25519_spki_der/);
  // A line with spaces is prose: the block ends there, and the NEXT line is published.
  assert.equal(redact('boot-core: 2 replicas up'), 'boot-core: 2 replicas up');
  assert.equal(redact('awaiting workers'), 'awaiting workers');
  const pem = createLineRedactor();
  assert.match(pem('-----BEGIN PUBLIC KEY-----MCowBQYD-----END PUBLIC KEY-----'), /pem_block/);
  assert.equal(pem('plainword'), 'plainword', 'a closed single-line PEM opens no DER block');
});

test("POSITIVE CONTROL: an 8-char wrap spans the prefix over THREE lines and is still caught (Codex P1)", () => {
  // The prefix is 21 characters; at width 8 no single line, and no two adjacent lines, hold it.
  const key = 'MC4CAQAwBQYDK2VwBCIEIG' + 'HhSeedBytes'.repeat(5);
  const wrapped = key.match(/.{1,8}/g);
  const redact = createLineRedactor();
  const published = wrapped.map(redact);
  // Line 3 is where the prefix COMPLETES; from there nothing may be published.
  for (let i = 2; i < wrapped.length; i += 1) {
    assert.match(published[i], /\[REDACTED: key material /, `line ${i + 1} (${published[i]}) published raw`);
  }
  // The scan sees it too, and reports it at the completing line.
  const { findings } = scanForKeyMaterial([{ name: 'job-log.txt', text: wrapped.join('\n') }], { skipMaskDirectives: false });
  assert.ok(findings.length >= 1, 'the scan must find a prefix spread over three lines');
  assert.equal(findings[0].marker, 'ed25519_pkcs8_der');
  assert.equal(findings[0].wrapped, true);
});

test("POSITIVE CONTROL: the FINAL short continuation of a wrap is redacted too (Codex P2)", () => {
  // A real Node PKCS#8 export is 64 base64 characters; at width 12 the last line is 4 characters.
  const key = 'MC4CAQAwBQYDK2VwBCIEIG' + 'A'.repeat(42);
  assert.equal(key.length, 64);
  const wrapped = key.match(/.{1,12}/g);
  assert.equal(wrapped.at(-1).length, 4, 'the tail must be shorter than any length floor');
  const published = wrapped.map(createLineRedactor());
  assert.match(published.at(-1), /\[REDACTED: key material \(der_block\)/);
});

test("POSITIVE CONTROL: a COMPOSE-PREFIXED wrap still joins — `svc | ` is not payload (Codex P1)", () => {
  // This lane's own collector runs `docker compose logs`, so every worker line arrives prefixed.
  const key = 'MC4CAQAwBQYDK2VwBCIEIG' + 'HhSeedBytes'.repeat(4);
  // Both orders: `compose logs --timestamps` puts the timestamp AFTER the service (Codex P1).
  for (const prefix of ['m1-worker-a  | ', '2026-09-23T09:26:17.468Z m1-worker-a | ', 'm1-worker-a-1  | 2026-09-21T14:50:20.038698833Z ']) {
    const wrapped = key.match(/.{1,8}/g).map((frag) => prefix + frag);
    const redact = createLineRedactor();
    const published = wrapped.map(redact);
    for (let i = 2; i < wrapped.length; i += 1) {
      assert.match(published[i], /\[REDACTED: key material /, `${prefix}line ${i + 1}: ${published[i]}`);
    }
    const { findings } = scanForKeyMaterial([{ name: 'logs-m1-worker-a.txt', text: wrapped.join('\n') }], { skipMaskDirectives: false });
    assert.ok(findings.length >= 1, `${prefix}: the scan must see through the log prefix`);
    assert.equal(findings[0].marker, 'ed25519_pkcs8_der');
  }
});

test("stripLogPrefix removes a service prefix and NOTHING else (it must not eat ordinary output)", () => {
  assert.equal(stripLogPrefix('m1-worker-a  | hello'), 'hello');
  assert.equal(stripLogPrefix('2026-09-23T09:26:17.468Z cp-a | hello'), 'hello');
  // The real shape this lane collects: `docker compose logs --timestamps`.
  assert.equal(stripLogPrefix('m1-worker-a-1  | 2026-09-21T14:50:20.038698833Z {"msg":"x"}'), '{"msg":"x"}');
  for (const keep of ['reconcile: 3 Organizations', 'MC4CAQAwBQYD', '']) {
    assert.equal(stripLogPrefix(keep), keep, keep);
  }
  // A pipe in PROSE is over-stripped, and that is safe by construction: the stripped form is only
  // what the line is JUDGED by. What gets published is the line itself.
  assert.equal(stripLogPrefix('a | b | c is prose'), 'b | c is prose');
  assert.equal(createLineRedactor()('a | b | c is prose'), 'a | b | c is prose');
});

test("POSITIVE CONTROL: a key framed in ONE JSON record joins — quotes, braces and escapes are not payload (Codex P1)", () => {
  const key = 'MC4CAQAwBQYDK2VwBCIEIG' + 'HhSeedBytes'.repeat(4);
  const escaped = key.match(/.{1,8}/g).join('\\n');
  const one = `m1-worker-a-1  | 2026-09-21T14:50:20.038698833Z {"level":30,"pem":"${escaped}"}`;
  assert.match(createLineRedactor()(one), /\[REDACTED: key material /, 'a framed record must not publish');
  const { findings } = scanForKeyMaterial([{ name: 'logs-m1-worker-a.txt', text: one }], { skipMaskDirectives: false });
  assert.equal(findings.length >= 1, true);
  assert.equal(findings[0].marker, 'ed25519_pkcs8_der');
});

test("KNOWN LIMIT: one fragment PER JSON record does not join — the other keys sit between them (E6-F026)", () => {
  // Each record contributes its own field names between the fragments, so no normalisation short
  // of parsing every record can make the prefix contiguous. Pinned so the limit is VISIBLE and
  // cannot be mistaken for coverage; filed as E6-F026.
  const key = 'MC4CAQAwBQYDK2VwBCIEIG' + 'HhSeedBytes'.repeat(4);
  const records = key.match(/.{1,8}/g).map((frag, i) =>
    `m1-worker-a-1  | 2026-09-21T14:50:2${i}.000000000Z {"level":30,"frag":"${frag}"}`);
  const published = records.map(createLineRedactor());
  assert.deepEqual(published, records, 'today these publish — that is the finding, not a pass');
  const { findings } = scanForKeyMaterial([{ name: 'logs.txt', text: records.join('\n') }], { skipMaskDirectives: false });
  assert.deepEqual(findings, [], 'and the scan does not see it either');
});

test("base64Payload keeps only base64, and the framing it drops never changes what is PUBLISHED", () => {
  assert.equal(base64Payload('{"k":"MC4CAQAw\\nBQYDK2Vw"}'), 'kMC4CAQAwBQYDK2Vw');
  assert.equal(base64Payload(''), '');
  const ordinary = 'm1-worker-a-1  | 2026-09-21T14:50:56.557961137Z {"sandboxId":"ir2yj6bc4zh81x258k47b","msg":"supervisor: run complete"}';
  assert.equal(createLineRedactor()(ordinary), ordinary, 'the lane reads its own sandbox evidence from these lines');
});

test("POSITIVE CONTROL: an ABSENT job log fails the scan IN CI, and is merely nothing to scan outside it (Codex P2)", () => {
  const make = () => {
    const out = mkdtempSync(path.join(tmpdir(), 'm1-nolog-'));
    mkdirSync(path.join(out, 'evidence'), { recursive: true });
    writeFileSync(path.join(out, 'evidence', 'verifier-a.txt'), 'clean\n');
    writeFileSync(path.join(out, 'state.json'), JSON.stringify({ out, redact: [], secrets: {} }));
    return out;  // …and NO job-log.txt: the capture never happened, or was removed.
  };
  const inCi = make();
  const ci = spawnSync(process.execPath, [journey, 'leak-scan', '--out', inCi], {
    encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' },
  });
  const bundleGone = !existsSync(path.join(inCi, 'evidence'));
  rmSync(inCi, { recursive: true, force: true });
  assert.equal(ci.status, 1, ci.stdout + ci.stderr);
  assert.match(`${ci.stdout}${ci.stderr}`, /job log is ABSENT/);
  assert.ok(bundleGone, 'a bundle whose log surface was never captured must not survive to upload');

  const local = make();
  const env = { ...process.env };
  delete env.GITHUB_ACTIONS;
  const off = spawnSync(process.execPath, [journey, 'leak-scan', '--out', local], { encoding: 'utf8', env });
  rmSync(local, { recursive: true, force: true });
  assert.equal(off.status, 0, off.stdout + off.stderr);  // a by-hand phase run tees nothing
});

test("POSITIVE CONTROL: a filter KILLED mid-stream leaves an unmatched OPEN, and the scan refuses (Codex P1)", () => {
  // A filter that dies without reaching captureFailed (OOM/SIGKILL) writes no marker, and the NEXT
  // phase appends after the hole — so neither the step outcomes nor the log content show it.
  const out = mkdtempSync(path.join(tmpdir(), 'm1-truncated-'));
  mkdirSync(path.join(out, 'evidence'), { recursive: true });
  writeFileSync(path.join(out, 'evidence', 'verifier-a.txt'), 'clean\n');
  writeFileSync(
    path.join(out, 'job-log.txt'),
    ['[log-filter] opened', 'prepare ok', '[log-filter] closed',
     '[log-filter] opened', 'boot-core …',                      // killed here: no closed
     '[log-filter] opened', 'seed ok', '[log-filter] closed'].join('\n') + '\n',
  );
  writeFileSync(path.join(out, 'state.json'), JSON.stringify({ out, redact: [], secrets: {} }));
  const res = spawnSync(process.execPath, [journey, 'leak-scan', '--out', out], {
    encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' },
  });
  const gone = !existsSync(path.join(out, 'evidence'));
  rmSync(out, { recursive: true, force: true });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(`${res.stdout}${res.stderr}`, /TRUNCATED — 3 capture\(s\) opened but 2 closed/);
  assert.ok(gone, 'a bundle whose log has a hole must not survive to upload');
});

test("POSITIVE CONTROL: a BALANCED log passes, and the filter brackets itself end to end", () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'm1-sentinel-'));
  const capture = path.join(dir, 'job-log.txt');
  const filter = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'm1-shipped-boot', 'log-filter.mjs');
  for (const phase of ['one', 'two']) {
    const r = spawnSync(process.execPath, [filter, capture], { input: `${phase} ok\n`, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes('[log-filter]'), 'the sentinels are CAPTURE-only; they never publish');
  }
  const text = readFileSync(capture, 'utf8');
  assert.equal((text.match(/^\[log-filter] opened$/gm) ?? []).length, 2);
  assert.equal((text.match(/^\[log-filter] closed$/gm) ?? []).length, 2);

  const out = mkdtempSync(path.join(tmpdir(), 'm1-balanced-'));
  mkdirSync(path.join(out, 'evidence'), { recursive: true });
  writeFileSync(path.join(out, 'evidence', 'verifier-a.txt'), 'clean\n');
  writeFileSync(path.join(out, 'job-log.txt'), text);
  writeFileSync(path.join(out, 'state.json'), JSON.stringify({ out, redact: [], secrets: {} }));
  const res = spawnSync(process.execPath, [journey, 'leak-scan', '--out', out], {
    encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true' },
  });
  rmSync(out, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(res.status, 0, res.stdout + res.stderr);  // not an always-deny
});
