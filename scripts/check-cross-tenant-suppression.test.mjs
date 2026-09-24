// -----------------------------------------------------------------------------
// DEP-022 — the reds of `scripts/check-cross-tenant-suppression.mjs`.
//
// One red fixture per violation, so a checker that stopped refusing anything reds here. This is
// the check that answers Codex's round-4 finding: the workflow's two greps accept "at least one
// `injection_did_not_fire`", which is the same defect as "at least one test ran".
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FAULT_MATRIX_PATH } from "./lib/campaign-fault-matrix.mjs";
import { JOURNEY_OWNED_CASES, driverOwnedRequiredCases, evaluateSuppressedRun } from "./lib/d2m-cross-tenant.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const matrix = JSON.parse(readFileSync(path.join(repoRoot, FAULT_MATRIX_PATH), "utf8"));

/** A bundle in which every declared driver-owned case correctly did NOT fire. */
function cleanBundle() {
  return {
    suppressInjection: true,
    cases: driverOwnedRequiredCases(matrix).map((id) => ({ case: id, injectionFired: false })),
  };
}

test("GREEN: every driver-owned required case present with injectionFired=false", () => {
  const { violations, summary } = evaluateSuppressedRun(matrix, cleanBundle());
  assert.deepEqual(violations, []);
  assert.equal(summary.unfired, summary.expected);
  assert.ok(summary.expected >= 14, `expected at least 14 driver-owned cases, saw ${summary.expected}`);
});

test("RED: ONE case missing — the exact defect the two greps could not see", () => {
  const b = cleanBundle();
  const dropped = b.cases.pop().case;
  const { violations } = evaluateSuppressedRun(matrix, b);
  assert.equal(violations.length, 1, violations.join("\n"));
  assert.match(violations[0], new RegExp(`^case ${dropped.replace(/\./g, "\\.")} `));
  assert.match(violations[0], /non-vacuity is not demonstrated/);
});

test("RED: ONE case still FIRED during suppression — its hostile arm is not under the switch", () => {
  const b = cleanBundle();
  b.cases[0].injectionFired = true;
  const { violations } = evaluateSuppressedRun(matrix, b);
  assert.equal(violations.length, 1, violations.join("\n"));
  assert.match(violations[0], /injectionFired=true/);
});

test("RED: a row with a missing injectionFired is not silently treated as false", () => {
  const b = cleanBundle();
  delete b.cases[1].injectionFired;
  const { violations } = evaluateSuppressedRun(matrix, b);
  assert.equal(violations.length, 1, violations.join("\n"));
  assert.match(violations[0], /injectionFired=null/);
});

test("RED: the GRADED bundle passed by mistake — it would satisfy nothing this check asks", () => {
  const b = cleanBundle();
  b.suppressInjection = false;
  const { violations } = evaluateSuppressedRun(matrix, b);
  assert.ok(violations.some((v) => /judges the SUPPRESSED run/.test(v)), violations.join("\n"));
});

test("RED: a duplicate row", () => {
  const b = cleanBundle();
  b.cases.push({ ...b.cases[0] });
  const { violations } = evaluateSuppressedRun(matrix, b);
  assert.ok(violations.some((v) => /appears twice/.test(v)), violations.join("\n"));
});

test("RED: an unreadable bundle fails CLOSED, it is not 'nothing to check'", () => {
  for (const bad of [null, undefined, "", 42]) {
    const { violations } = evaluateSuppressedRun(matrix, bad);
    assert.ok(violations.length > 0, `bundle ${JSON.stringify(bad)} must be refused`);
  }
});

test("NON-VACUITY: a declaration with no driver-owned required case refuses itself", () => {
  const empty = { profiles: [{ profile: "M1a-D2-MECHANISM", cases: [{ case: "d2m.tenant.journey.A", evidence: "required" }] }] };
  const { violations } = evaluateSuppressedRun(empty, { suppressInjection: true, cases: [] });
  assert.ok(violations.some((v) => /evaluated nothing/.test(v)), violations.join("\n"));
});

test("the journey-owned cases are EXCLUDED, and they are still declared required", () => {
  const owned = driverOwnedRequiredCases(matrix);
  for (const id of JOURNEY_OWNED_CASES) {
    assert.ok(!owned.includes(id), `${id} is the journey's, not the cross-tenant driver's`);
  }
  const profile = matrix.profiles.find((p) => p.profile === "M1a-D2-MECHANISM");
  for (const id of JOURNEY_OWNED_CASES) {
    const c = profile.cases.find((x) => x.case === id);
    assert.ok(c && c.evidence === "required", `${id} must still be declared required, or the exclusion hides a gap`);
  }
});

test("the workflow's control step actually CALLS this checker", () => {
  const wf = readFileSync(path.join(repoRoot, ".github", "workflows", "m1-shipped-boot.yml"), "utf8");
  assert.ok(wf.includes("scripts/check-cross-tenant-suppression.mjs"),
    "the suppression positive-control step must run the per-case checker, not only grep for one marker");
  assert.ok(wf.includes("cross-tenant-suppressed.json"),
    "the checker must be pointed at the suppressed bundle");
});
