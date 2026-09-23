// -----------------------------------------------------------------------------
// DEP-018 — the campaign fault matrix verdicts' self-test (pure node; runs in `policy`).
//
//   node --test scripts/check-campaign-fault-matrix.test.mjs
//
// Every test here is a POSITIVE CONTROL: it flips exactly ONE fact and requires the named
// violation code. A checker whose reds are not demonstrated is a check that evaluates nothing,
// which is the failure class DEP-018 exists to stop — so the anchor cases (a complete
// declaration, a complete bundle) are asserted to produce ZERO violations first, and every
// mutation after them is measured against that same anchor.
//
// The COMMITTED declaration is also checked here, so a real edit to `tests/d1/fault-matrix.json`
// that drops a surface, a legacy table or a required family reds in `policy` on the PR, not on
// the merge train.
// -----------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FAULT_MATRIX_PATH,
  FAULT_MATRIX_SCHEMA_VERSION,
  GATE_PROFILES,
  REQUIRED_FAMILIES,
  REQUIRED_TENANT_SURFACES,
  REQUIRED_LEGACY_TABLES,
  MIN_ENABLED_TENANT_JOURNEYS,
  evaluateFaultMatrixDeclaration,
  evaluateFaultMatrixEvidence,
  formatViolations,
} from "./lib/campaign-fault-matrix.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const codes = (violations) => violations.map((v) => v.code).sort();
const has = (violations, code) => violations.some((v) => v.code === code);

/** A minimal but COMPLETE profile: every required family, and the whole F10 tenant matrix. */
function completeProfile(profile) {
  const cases = [];
  const push = (id, family, extra = {}) => cases.push({
    case: `${profile}.${id}`,
    family,
    injection: { mechanism: `mechanism.${id}`, observedBy: `observer.${id}` },
    expectedClassification: `classification.${id}`,
    evidence: "required",
    ...extra,
  });
  for (const family of REQUIRED_FAMILIES[profile]) {
    if (family === "tenant") continue;
    push(family, family);
  }
  for (let i = 0; i < MIN_ENABLED_TENANT_JOURNEYS; i += 1) {
    push(`journey.${i}`, "tenant", { tenantCase: { kind: "per_tenant_journey", tenant: `T${i}` } });
  }
  for (const surface of REQUIRED_TENANT_SURFACES) {
    push(`cross.${surface}`, "tenant", { tenantCase: { kind: "cross_tenant_denial", surface, positiveControl: true } });
  }
  push("control", "tenant", { tenantCase: { kind: "control_tenant_refused" } });
  for (const table of REQUIRED_LEGACY_TABLES) {
    push(`legacy.${table}`, "tenant", {
      tenantCase: {
        kind: "legacy_table_isolation",
        table,
        positiveControl: true,
        antiVacuityControl: true,
        productionPath: `server/src/services/x.ts readerFor_${table}`,
      },
    });
  }
  return { profile, cases };
}

const anchor = () => ({
  schemaVersion: FAULT_MATRIX_SCHEMA_VERSION,
  profiles: GATE_PROFILES.map(completeProfile),
});

/** Deep clone + locate one case by suffix, so a mutation names what it changes. */
function mutate(fn) {
  const m = JSON.parse(JSON.stringify(anchor()));
  fn(m, {
    profile: (name) => m.profiles.find((p) => p.profile === name),
    caseIn: (name, suffix) => m.profiles.find((p) => p.profile === name).cases.find((c) => c.case.endsWith(suffix)),
  });
  return m;
}

// ── the anchor ───────────────────────────────────────────────────────────────

test("DEP-018 declaration: a complete matrix produces ZERO violations (the anchor)", () => {
  const violations = evaluateFaultMatrixDeclaration(anchor());
  assert.deepEqual(violations, [], `the anchor must be clean:\n${formatViolations(violations)}`);
});

// ── structural reds ──────────────────────────────────────────────────────────

test("DEP-018 declaration: a non-object, a wrong schemaVersion and a missing profiles array red", () => {
  assert.ok(has(evaluateFaultMatrixDeclaration(null), "declaration:not_an_object"));
  assert.ok(has(evaluateFaultMatrixDeclaration([]), "declaration:not_an_object"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { m.schemaVersion = 99; })), "declaration:schema_version"));
  assert.ok(has(evaluateFaultMatrixDeclaration({ schemaVersion: FAULT_MATRIX_SCHEMA_VERSION }), "declaration:no_profiles"));
});

test("DEP-018 declaration: a MISSING gate profile reds — a fault matrix that skips a gate is not a campaign matrix", () => {
  for (const profile of GATE_PROFILES) {
    const m = mutate((mm) => { mm.profiles = mm.profiles.filter((p) => p.profile !== profile); });
    const violations = evaluateFaultMatrixDeclaration(m);
    assert.ok(has(violations, "declaration:profile_missing"), `${profile} removed must red: ${codes(violations)}`);
  }
});

test("DEP-018 declaration: an unknown profile, a duplicate profile and a caseless profile red", () => {
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { m.profiles[0].profile = "M9-NOT-A-GATE"; })), "declaration:unknown_profile"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { m.profiles[1].profile = m.profiles[0].profile; })), "declaration:duplicate_profile"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { m.profiles[0].cases = []; })), "declaration:profile_has_no_cases"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { m.profiles[0] = "not an object"; })), "declaration:profile_not_an_object"));
});

test("DEP-018 declaration: a case without an id, a duplicate id, or that is not an object reds", () => {
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { delete m.profiles[0].cases[0].case; })), "declaration:case_missing_id"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { m.profiles[0].cases[1].case = m.profiles[0].cases[0].case; })), "declaration:duplicate_case_id"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { m.profiles[0].cases.push("nope"); })), "declaration:case_not_an_object"));
});

// ── the injection is what makes a case a case ────────────────────────────────

test("DEP-018 declaration: a case with no injection, no mechanism, or NO OBSERVER reds", () => {
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { delete m.profiles[0].cases[0].injection; })), "declaration:case_missing_injection"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { m.profiles[0].cases[0].injection.mechanism = "  "; })), "declaration:injection_missing_mechanism"));
  // The observer is the load-bearing half: without it, "fired" would be the harness asserting
  // its own intent rather than a probe deciding.
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { delete m.profiles[0].cases[0].injection.observedBy; })), "declaration:injection_missing_observer"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { delete m.profiles[0].cases[0].expectedClassification; })), "declaration:case_missing_classification"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { m.profiles[0].cases[0].family = "not_a_family"; })), "declaration:unknown_family"));
});

// ── pending is allowed, but never unowned and never unexplained ──────────────

test("DEP-018 declaration: a pending case needs a kind, a reason and an OWNER", () => {
  const pend = (extra) => mutate((m) => { Object.assign(m.profiles[0].cases[0], { evidence: "pending", ...extra }); });
  assert.ok(has(evaluateFaultMatrixDeclaration(pend({ pendingReason: "r", pendingOwner: "o" })), "declaration:pending_missing_kind"));
  assert.ok(has(evaluateFaultMatrixDeclaration(pend({ pendingKind: "keyed", pendingOwner: "o" })), "declaration:pending_missing_reason"));
  assert.ok(has(evaluateFaultMatrixDeclaration(pend({ pendingKind: "keyed", pendingReason: "r" })), "declaration:pending_missing_owner"));
  assert.ok(has(evaluateFaultMatrixDeclaration(pend({ pendingKind: "guesswork", pendingReason: "r", pendingOwner: "o" })), "declaration:pending_missing_kind"));
  // …and a fully declared pending case is clean.
  assert.deepEqual(
    evaluateFaultMatrixDeclaration(pend({ pendingKind: "keyed", pendingReason: "r", pendingOwner: "o" })),
    [],
  );
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { m.profiles[0].cases[0].evidence = "maybe"; })), "declaration:unknown_evidence_mode"));
});

// ── the F10 tenant matrix, in EVERY profile ──────────────────────────────────

test("DEP-018 declaration: dropping ANY of the nine cross-tenant surfaces reds, one code per surface", () => {
  for (const surface of REQUIRED_TENANT_SURFACES) {
    const m = mutate((mm) => {
      const p = mm.profiles[0];
      p.cases = p.cases.filter((c) => !(c.tenantCase?.kind === "cross_tenant_denial" && c.tenantCase.surface === surface));
    });
    const violations = evaluateFaultMatrixDeclaration(m);
    assert.ok(
      violations.some((v) => v.code === "declaration:tenant_matrix_surface_missing" && v.message.includes(surface)),
      `dropping ${surface} must red: ${codes(violations)}`,
    );
  }
});

test("DEP-018 declaration: dropping ANY of the four no-RLS legacy tables reds (E2-D03)", () => {
  for (const table of REQUIRED_LEGACY_TABLES) {
    const m = mutate((mm) => {
      const p = mm.profiles[0];
      p.cases = p.cases.filter((c) => !(c.tenantCase?.kind === "legacy_table_isolation" && c.tenantCase.table === table));
    });
    const violations = evaluateFaultMatrixDeclaration(m);
    assert.ok(
      violations.some((v) => v.code === "declaration:tenant_matrix_legacy_table_missing" && v.message.includes(table)),
      `dropping ${table} must red: ${codes(violations)}`,
    );
  }
});

test("DEP-018 declaration: too few per-tenant journeys, and a missing control tenant, red", () => {
  const fewer = mutate((m) => {
    const p = m.profiles[0];
    const journeys = p.cases.filter((c) => c.tenantCase?.kind === "per_tenant_journey");
    p.cases = p.cases.filter((c) => c !== journeys[0]);
  });
  assert.ok(has(evaluateFaultMatrixDeclaration(fewer), "declaration:tenant_matrix_journeys"));
  const noControl = mutate((m) => {
    const p = m.profiles[0];
    p.cases = p.cases.filter((c) => c.tenantCase?.kind !== "control_tenant_refused");
  });
  assert.ok(has(evaluateFaultMatrixDeclaration(noControl), "declaration:tenant_matrix_control_missing"));
});

test("DEP-018 declaration: a denial without a positive control reds — 'denied' would not be distinguishable from 'nothing works'", () => {
  const m = mutate((mm, at) => { at.caseIn(GATE_PROFILES[0], "cross.read").tenantCase.positiveControl = false; });
  assert.ok(has(evaluateFaultMatrixDeclaration(m), "declaration:denial_without_positive_control"));
});

test("DEP-018 declaration: a legacy-table case needs BOTH controls and a named production path", () => {
  const drop = (field) => mutate((mm, at) => { delete at.caseIn(GATE_PROFILES[0], "legacy.cost_events").tenantCase[field]; });
  assert.ok(has(evaluateFaultMatrixDeclaration(drop("positiveControl")), "declaration:legacy_without_positive_control"));
  assert.ok(has(evaluateFaultMatrixDeclaration(drop("antiVacuityControl")), "declaration:legacy_without_anti_vacuity"));
  // "through the production query path the distributed path uses … not a hand-written test query"
  assert.ok(has(evaluateFaultMatrixDeclaration(drop("productionPath")), "declaration:legacy_without_production_path"));
});

test("DEP-018 declaration: malformed tenant cases red", () => {
  // `.control`, not `control`: `…fault_control` also ends with "control", and matching it
  // instead made this assertion measure a non-tenant case (caught by the first RED run).
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m, at) => { delete at.caseIn(GATE_PROFILES[0], ".control").tenantCase; })), "declaration:tenant_case_missing"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m, at) => { at.caseIn(GATE_PROFILES[0], ".control").tenantCase.kind = "vibes"; })), "declaration:tenant_case_unknown_kind"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m, at) => { at.caseIn(GATE_PROFILES[0], "cross.read").tenantCase.surface = "telepathy"; })), "declaration:unknown_tenant_surface"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m, at) => { at.caseIn(GATE_PROFILES[0], "legacy.cost_events").tenantCase.table = "secrets"; })), "declaration:unknown_legacy_table"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m, at) => { delete at.caseIn(GATE_PROFILES[0], "journey.0").tenantCase.tenant; })), "declaration:journey_missing_tenant"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m) => { m.profiles[0].cases[0].tenantCase = { kind: "control_tenant_refused" }; })), "declaration:tenant_case_on_non_tenant"));
});

test("DEP-018 declaration: dropping a required FAMILY reds, per profile", () => {
  for (const profile of GATE_PROFILES) {
    for (const family of REQUIRED_FAMILIES[profile]) {
      if (family === "tenant") continue;
      const m = mutate((mm) => {
        const p = mm.profiles.find((x) => x.profile === profile);
        p.cases = p.cases.filter((c) => c.family !== family);
      });
      const violations = evaluateFaultMatrixDeclaration(m);
      assert.ok(
        violations.some((v) => v.code === "declaration:required_family_missing" && v.message.includes(family) && v.message.includes(profile)),
        `${profile} without ${family} must red: ${codes(violations)}`,
      );
    }
  }
});

// ── the evidence half ────────────────────────────────────────────────────────

function completeBundle(profile) {
  const m = anchor();
  const entry = m.profiles.find((p) => p.profile === profile);
  return {
    matrix: m,
    bundle: {
      profile,
      cases: entry.cases.map((c) => ({
        case: c.case,
        injectionFired: true,
        observedClassification: c.expectedClassification,
        ...(c.tenantCase?.kind === "cross_tenant_denial" ? { positiveControlPassed: true } : {}),
        ...(c.tenantCase?.kind === "legacy_table_isolation"
          ? { positiveControlPassed: true, antiVacuityObservedForeignRow: true }
          : {}),
      })),
    },
  };
}

test("DEP-018 evidence: a complete bundle produces ZERO violations and reports the profile COMPLETE (the anchor)", () => {
  const { matrix, bundle } = completeBundle(GATE_PROFILES[0]);
  const { violations, summary } = evaluateFaultMatrixEvidence(matrix, bundle);
  assert.deepEqual(violations, [], `the bundle anchor must be clean:\n${formatViolations(violations)}`);
  assert.equal(summary.complete, true);
  assert.equal(summary.pending, 0);
  assert.equal(summary.fired, summary.required);
  assert.ok(summary.required > 0, "the anchor must actually assert something");
});

test("DEP-018 evidence: an injection that DID NOT FIRE is a failure, not a pass (acceptance 1)", () => {
  for (const value of [false, null, undefined, "yes", 1]) {
    const { matrix, bundle } = completeBundle(GATE_PROFILES[0]);
    if (value === undefined) delete bundle.cases[0].injectionFired;
    else bundle.cases[0].injectionFired = value;
    const { violations } = evaluateFaultMatrixEvidence(matrix, bundle);
    assert.ok(has(violations, "evidence:injection_did_not_fire"), `injectionFired=${JSON.stringify(value)} must red: ${codes(violations)}`);
  }
});

test("DEP-018 evidence: a declared case with no evidence row, and an UNDECLARED case, both red (acceptance 4)", () => {
  const missing = completeBundle(GATE_PROFILES[0]);
  missing.bundle.cases.shift();
  assert.ok(has(evaluateFaultMatrixEvidence(missing.matrix, missing.bundle).violations, "evidence:case_not_run"));

  const extra = completeBundle(GATE_PROFILES[0]);
  extra.bundle.cases.push({ case: "never.declared", injectionFired: true, observedClassification: "x" });
  assert.ok(has(evaluateFaultMatrixEvidence(extra.matrix, extra.bundle).violations, "evidence:undeclared_case"));
});

test("DEP-018 evidence: a classification that does not match the declared one reds", () => {
  const { matrix, bundle } = completeBundle(GATE_PROFILES[0]);
  bundle.cases[0].observedClassification = "something-else";
  assert.ok(has(evaluateFaultMatrixEvidence(matrix, bundle).violations, "evidence:classification_mismatch"));
});

test("DEP-018 evidence: a cross-tenant denial with no passing positive control reds", () => {
  const { matrix, bundle } = completeBundle(GATE_PROFILES[0]);
  const row = bundle.cases.find((c) => c.case.endsWith("cross.events"));
  row.positiveControlPassed = false;
  assert.ok(has(evaluateFaultMatrixEvidence(matrix, bundle).violations, "evidence:positive_control_missing"));
});

test("DEP-018 evidence: a legacy-table case whose predicate-removed read did NOT return the foreign row reds", () => {
  const { matrix, bundle } = completeBundle(GATE_PROFILES[0]);
  const row = bundle.cases.find((c) => c.case.endsWith("legacy.activity_log"));
  row.antiVacuityObservedForeignRow = false;
  const { violations } = evaluateFaultMatrixEvidence(matrix, bundle);
  assert.ok(has(violations, "evidence:anti_vacuity_missing"), codes(violations).join(","));
});

test("DEP-018 evidence: a PENDING case is never counted as a pass, and a pending case that reported evidence reds", () => {
  const { matrix, bundle } = completeBundle(GATE_PROFILES[0]);
  const entry = matrix.profiles.find((p) => p.profile === GATE_PROFILES[0]);
  Object.assign(entry.cases[0], { evidence: "pending", pendingKind: "keyed", pendingReason: "F8", pendingOwner: "planning session" });

  // The bundle still reports it → stale declaration, refused.
  assert.ok(has(evaluateFaultMatrixEvidence(matrix, bundle).violations, "evidence:pending_case_reported"));

  // With the row removed the bundle is clean, but the profile is INCOMPLETE — never a pass.
  bundle.cases = bundle.cases.filter((c) => c.case !== entry.cases[0].case);
  const { violations, summary } = evaluateFaultMatrixEvidence(matrix, bundle);
  assert.deepEqual(violations, [], formatViolations(violations));
  assert.equal(summary.pending, 1);
  assert.equal(summary.complete, false, "a profile with a pending case must never report COMPLETE");
});

test("DEP-018 evidence: an unreadable bundle, an undeclared profile, a missing cases array and a duplicate row red", () => {
  const m = anchor();
  assert.ok(has(evaluateFaultMatrixEvidence(m, null).violations, "evidence:bundle_unreadable"));
  assert.ok(has(evaluateFaultMatrixEvidence(m, { profile: "M9-NOT-A-GATE", cases: [] }).violations, "evidence:undeclared_profile"));
  assert.ok(has(evaluateFaultMatrixEvidence(m, { profile: GATE_PROFILES[0] }).violations, "evidence:bundle_has_no_cases"));
  const dup = completeBundle(GATE_PROFILES[0]);
  dup.bundle.cases.push({ ...dup.bundle.cases[0] });
  assert.ok(has(evaluateFaultMatrixEvidence(dup.matrix, dup.bundle).violations, "evidence:duplicate_row"));
  const bad = completeBundle(GATE_PROFILES[0]);
  bad.bundle.cases.push({ injectionFired: true });
  assert.ok(has(evaluateFaultMatrixEvidence(bad.matrix, bad.bundle).violations, "evidence:row_unreadable"));
});

// ── the COMMITTED declaration ────────────────────────────────────────────────

test("DEP-018: the committed tests/d1/fault-matrix.json satisfies every declaration invariant", () => {
  const matrix = JSON.parse(readFileSync(path.join(repoRoot, FAULT_MATRIX_PATH), "utf8"));
  const violations = evaluateFaultMatrixDeclaration(matrix);
  assert.deepEqual(violations, [], `${FAULT_MATRIX_PATH}:\n${formatViolations(violations)}`);
  // Non-vacuity: the file must actually declare the keyless profile's cases, not merely parse.
  const spine = matrix.profiles.find((p) => p.profile === "M1-D1-SPINE");
  assert.ok(spine, "the committed matrix must declare M1-D1-SPINE");
  const required = spine.cases.filter((c) => c.evidence === "required");
  assert.ok(required.length >= 20, `M1-D1-SPINE must declare a real case list, saw ${required.length} required cases`);
});
