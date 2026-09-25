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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FAULT_MATRIX_PATH,
  FAULT_MATRIX_SCHEMA_VERSION,
  GATE_PROFILES,
  REQUIRED_FAMILIES,
  REQUIRED_TENANT_SURFACES,
  REQUIRED_LEGACY_TABLES,
  REQUIRED_CREDENTIAL_REFUSAL_KINDS,
  REQUIRED_REDACTION_STREAMS,
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
    // ADDED 2026-09-24 with the clause-4 and clause-5 floors: `credential` and `redaction` now
    // carry a required SHAPE, so the anchor has to satisfy it or every later mutation would be
    // measured against an already-red baseline.
    if (family === "credential") continue;
    if (family === "redaction") {
      push("redaction.canary", "redaction", {
        redactionCase: {
          plantedCanary: true,
          scrubberMarkerControl: true,
          streams: [...REQUIRED_REDACTION_STREAMS],
          producer: "server/src/services/x.ts synthesiseRunSecrets",
          // DEP-026 — the case must say WHERE its withheld-plant control lives, because the row
          // field the grader can see (`positiveControlPassed`) only exists for an IN-RUN arm.
          suppressedArm: { scope: "in_run" },
        },
      });
      continue;
    }
    push(family, family);
  }
  if (REQUIRED_FAMILIES[profile].includes("credential")) {
    for (const kind of REQUIRED_CREDENTIAL_REFUSAL_KINDS) {
      push(`credential.${kind}`, "credential", { credentialCase: { kind, positiveControl: true } });
    }
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

test("DEP-018 declaration: two journeys for the SAME tenant do not satisfy F10 (Codex P2, PR #573)", () => {
  // Counting LABELS rather than distinct tenants let a matrix declare tenant A twice and omit
  // tenant B while still reporting two journeys — i.e. certify a profile that leaves an enabled
  // tenant unproven, which is the one claim F10 exists to make.
  const m = mutate((mm) => {
    const p = mm.profiles[0];
    const journeys = p.cases.filter((c) => c.tenantCase?.kind === "per_tenant_journey");
    assert.equal(journeys.length, MIN_ENABLED_TENANT_JOURNEYS, "the anchor must declare exactly the minimum");
    journeys[1].tenantCase.tenant = journeys[0].tenantCase.tenant;
  });
  const violations = evaluateFaultMatrixDeclaration(m);
  assert.ok(has(violations, "declaration:duplicate_journey_tenant"), codes(violations).join(","));
  assert.ok(has(violations, "declaration:tenant_matrix_journeys"), codes(violations).join(","));
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
        // The clause-4 row fact: the same-tenant live-lease control passed.
        ...(c.family === "credential" && c.credentialCase ? { positiveControlPassed: true } : {}),
        // The clause-5 row facts: clean on every declared stream, the unseeded control LEAKED,
        // and each stream was non-empty (a scan over zero bytes is vacuously clean).
        ...(c.family === "redaction"
          ? {
            redactedOnAllStreams: true,
            scrubberMarkerObservedOnStream: Object.fromEntries(c.redactionCase.streams.map((k) => [k, true])),
            streamBytesObserved: Object.fromEntries(c.redactionCase.streams.map((k) => [k, 1024])),
            // DEP-026 — the withheld-plant arm's own row fact, for a case declaring an IN-RUN arm.
            ...(c.redactionCase.suppressedArm?.scope === "in_run" ? { positiveControlPassed: true } : {}),
          }
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

// ── the lanes cannot drift ───────────────────────────────────────────────────

test("DEP-018: the fault-matrix lane REUSES DEP-016's verdicts and defines no rival of its own", () => {
  // The ticket's reuse clause: "Reuse DEP-016's and DEP-015's shared verdicts rather than writing
  // parallel implementations." Nothing needed extending, so the drift risk is not a diverging
  // signature — it is someone later pasting a second `evaluateEnabledTenantSpine` into the lane and
  // quietly asserting something weaker, while both files still claim to prove the same thing.
  // This is the control for exactly that.
  const lane = readFileSync(path.join(repoRoot, "tests/d1/m1-fault-matrix.test.mjs"), "utf8");
  const shared = ["evaluateEnabledTenantSpine", "evaluateControlTenant", "evaluateCrossTenantIsolation"];
  const importBlock = /import\s*\{([\s\S]*?)\}\s*from\s*"\.\.\/\.\.\/scripts\/lib\/m1-spine-assertions\.mjs";/.exec(lane);
  assert.ok(importBlock, "the lane must import DEP-016's verdicts from scripts/lib/m1-spine-assertions.mjs");
  for (const symbol of shared) {
    assert.ok(
      importBlock[1].includes(symbol),
      `the lane must IMPORT ${symbol} from DEP-016 rather than restate it`,
    );
    // …and must not define one of its own under the same name.
    assert.ok(
      !new RegExp(`(function|const|let)\\s+${symbol}\\b`).test(lane),
      `the lane defines its own ${symbol} — a second implementation of a verdict both lanes claim to prove`,
    );
  }
  // Positive control for THIS check: the patterns it looks for are real, so a green result is not
  // an empty search. (A typo in a symbol name would otherwise pass every assertion above.)
  const assertions = readFileSync(path.join(repoRoot, "scripts/lib/m1-spine-assertions.mjs"), "utf8");
  for (const symbol of shared) {
    assert.ok(
      new RegExp(`export function ${symbol}\\b`).test(assertions),
      `${symbol} must actually be exported by scripts/lib/m1-spine-assertions.mjs — otherwise this check is searching for a name that does not exist`,
    );
  }
});

// ── the COMMITTED declaration ────────────────────────────────────────────────

// -- the clause-4 / clause-5 floors (ADDED 2026-09-24) -----------------------
//
// One mutation per red, measured against the same anchor as every test above. These are the
// floors the E5 exit-gate audit `a2` found missing entirely, so the reds below are the whole
// reason the floors are enforceable rather than recorded in prose.

test("DEP-018 declaration: DROPPING the redaction case reds (E5 clause 5's floor)", () => {
  for (const profile of GATE_PROFILES) {
    const m = mutate((mm, at) => {
      const p = at.profile(profile);
      p.cases = p.cases.filter((c) => c.family !== "redaction");
    });
    const violations = evaluateFaultMatrixDeclaration(m);
    assert.ok(has(violations, "declaration:required_family_missing"), `${profile}: ${codes(violations)}`);
  }
});

test("DEP-018 declaration: a redaction case without a planted canary, without the unseeded control, missing a stream, or with no producer, each reds", () => {
  const rc = (fn) => evaluateFaultMatrixDeclaration(mutate((m, at) => { fn(at.caseIn(GATE_PROFILES[0], "redaction.canary").redactionCase); }));
  assert.ok(has(rc((r) => { r.plantedCanary = false; }), "declaration:redaction_without_planted_canary"));
  assert.ok(has(rc((r) => { r.scrubberMarkerControl = false; }), "declaration:redaction_without_marker_control"));
  assert.ok(has(rc((r) => { r.producer = ""; }), "declaration:redaction_without_producer"));
  for (const stream of REQUIRED_REDACTION_STREAMS) {
    const violations = rc((r) => { r.streams = r.streams.filter((x) => x !== stream); });
    assert.ok(has(violations, "declaration:redaction_stream_missing"), `dropping ${stream} must red: ${codes(violations)}`);
  }
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m, at) => { delete at.caseIn(GATE_PROFILES[0], "redaction.canary").redactionCase; })), "declaration:redaction_case_missing"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m, at) => { at.caseIn(GATE_PROFILES[0], "cross.lease").redactionCase = { plantedCanary: true }; })), "declaration:redaction_case_on_non_redaction"));
});

test("DEP-018 declaration: DROPPING either lease-scoped refusal kind reds (E5 clause 4's floor)", () => {
  for (const profile of GATE_PROFILES) {
    for (const kind of REQUIRED_CREDENTIAL_REFUSAL_KINDS) {
      const m = mutate((mm, at) => {
        const p = at.profile(profile);
        p.cases = p.cases.filter((c) => c.credentialCase?.kind !== kind);
      });
      const violations = evaluateFaultMatrixDeclaration(m);
      assert.ok(
        violations.some((v) => v.code === "declaration:credential_refusal_kind_missing" && v.message.includes(kind)),
        `${profile} without ${kind} must red: ${codes(violations)}`,
      );
    }
  }
});

test("DEP-018 declaration: a refusal case with an unknown kind, or without its same-tenant control, reds", () => {
  const at0 = (fn) => evaluateFaultMatrixDeclaration(mutate((m, a) => { fn(a.caseIn(GATE_PROFILES[0], `credential.${REQUIRED_CREDENTIAL_REFUSAL_KINDS[0]}`)); }));
  assert.ok(has(at0((c) => { c.credentialCase.kind = "something_else"; }), "declaration:credential_case_unknown_kind"));
  assert.ok(has(at0((c) => { c.credentialCase.positiveControl = false; }), "declaration:credential_refusal_without_positive_control"));
  assert.ok(has(at0((c) => { c.credentialCase = "nope"; }), "declaration:credential_case_not_an_object"));
  assert.ok(has(evaluateFaultMatrixDeclaration(mutate((m, a) => { a.caseIn(GATE_PROFILES[0], "cancellation").credentialCase = { kind: REQUIRED_CREDENTIAL_REFUSAL_KINDS[0], positiveControl: true }; })), "declaration:credential_case_on_non_credential"));
});

test("DEP-018 evidence: a refusal row without its same-tenant control reds", () => {
  for (const value of [false, null, undefined]) {
    const { matrix, bundle } = completeBundle(GATE_PROFILES[0]);
    const row = bundle.cases.find((r) => r.case.includes(`credential.${REQUIRED_CREDENTIAL_REFUSAL_KINDS[0]}`));
    if (value === undefined) delete row.positiveControlPassed;
    else row.positiveControlPassed = value;
    const { violations } = evaluateFaultMatrixEvidence(matrix, bundle);
    assert.ok(has(violations, "evidence:credential_positive_control_missing"), `${JSON.stringify(value)}: ${codes(violations)}`);
  }
});

test("DEP-018 evidence: a redaction row reds when the canary was not scrubbed, when the SCRUBBER MARKER was not observed, or when a stream was empty", () => {
  const row = (fn) => {
    const { matrix, bundle } = completeBundle(GATE_PROFILES[0]);
    fn(bundle.cases.find((r) => r.case.includes("redaction.canary")));
    return evaluateFaultMatrixEvidence(matrix, bundle).violations;
  };
  assert.ok(has(row((r) => { r.redactedOnAllStreams = false; }), "evidence:redaction_not_clean"));
  // ★ THE CONTROL'S OWN CONTROL. A seeded run reported clean while the scrubber's marker was NOT
  // observed is the vacuous arm the E5 audit named: nothing shows the clean stream is the
  // scrubber's work rather than a run that emitted the value nowhere.
  // PER STREAM (Codex P2): the marker on ONE stream must NOT satisfy a two-stream declaration.
  for (const stream of REQUIRED_REDACTION_STREAMS) {
    assert.ok(has(row((r) => { r.scrubberMarkerObservedOnStream[stream] = false; }), "evidence:redaction_marker_not_observed"), `${stream} false`);
    assert.ok(has(row((r) => { delete r.scrubberMarkerObservedOnStream[stream]; }), "evidence:redaction_marker_not_observed"), `${stream} absent`);
  }
  assert.ok(has(row((r) => { r.scrubberMarkerObservedOnStream = {}; }), "evidence:redaction_marker_not_observed"));
  assert.ok(has(row((r) => { delete r.scrubberMarkerObservedOnStream; }), "evidence:redaction_marker_not_observed"));
  for (const stream of REQUIRED_REDACTION_STREAMS) {
    assert.ok(has(row((r) => { r.streamBytesObserved[stream] = 0; }), "evidence:redaction_stream_vacuous"), stream);
    assert.ok(has(row((r) => { delete r.streamBytesObserved[stream]; }), "evidence:redaction_stream_vacuous"), `${stream} absent`);
  }
  assert.ok(has(row((r) => { delete r.streamBytesObserved; }), "evidence:redaction_stream_vacuous"));
});

test("E5 clause 5: the harness's mirrored REDACTION_MARKER still equals the worker daemon's own", async () => {
  // ★ A MIRROR CAN ROT, and this one decides a gate case. `tests/d1/lib/e6f-harness.mjs` mirrors
  // `REDACTION_MARKER` rather than importing it (the harness runs from source against built images
  // and must not take a build-time dependency on the worker package). If the daemon ever changes
  // its marker, the clause-5 case would look for a string nothing emits and red for a reason that
  // says nothing about redaction — so the two are pinned together HERE, in a pure-node test that
  // runs in `policy` on every PR.
  const harness = await import("../tests/d1/lib/e6f-harness.mjs");
  const source = readFileSync(path.join(repoRoot, "packages/worker-daemon/src/supervisor/redaction.ts"), "utf8");
  const match = /export const REDACTION_MARKER = "([^"]+)"/.exec(source);
  assert.ok(match, "REDACTION_MARKER is no longer declared as a plain string literal in redaction.ts — re-point this test");
  assert.equal(harness.REDACTION_MARKER, match[1], "the harness's mirrored REDACTION_MARKER has drifted from the worker daemon's");
  // Non-vacuity: an empty or whitespace marker would make `text.includes(marker)` trivially true.
  assert.ok(match[1].trim().length > 0, "the marker must be a non-empty token, else the clause-5 control is vacuous");
});

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

// ── DEP-026: the SUPPRESSED (withheld-plant) arm is graded, per redaction case ───────────────
//
// DEP-025 §11 handed this up, verified at source: the `family === "redaction"` branch never read
// `positiveControlPassed`, so when a probe's withheld-plant arm failed — a non-`succeeded` attempt,
// or its own nonce-tagged marker on a stream — the probe cleared that field and NOTHING graded it.
// Every field the branch did read stayed pass-shaped, so a standalone verdict over the RETAINED row
// reported no violations while the run itself reded. That is `E6-F023` in artifact form: the bundle
// disagreeing with its own run.
//
// ★ The grade is DECLARATION-DRIVEN, and that is the whole point. A withheld-plant control can live
// in the run (a second arm, whose outcome the row can carry) or in a SEPARATE CAMPAIGN (a whole
// re-run with the injection suppressed, whose outcome the row structurally cannot carry). So the
// case DECLARES which, and:
//   - `in_run`  → `positiveControlPassed === true` is REQUIRED on the row;
//   - `none`    → the exemption, which must NAME its blocking finding and give a reason;
//   - anything else, or absent → REFUSED. Fail-closed on a missing declaration is what stops this
//     from being "the guard simply not looking", which is the defect the whole exercise unwinds.

test("DEP-026 evidence: a redaction case declaring an IN-RUN suppressed arm reds without a passing control", () => {
  for (const value of [false, null, undefined]) {
    const { matrix, bundle } = completeBundle(GATE_PROFILES[0]);
    const row = bundle.cases.find((r) => r.case.includes("redaction.canary"));
    if (value === undefined) delete row.positiveControlPassed;
    else row.positiveControlPassed = value;
    const { violations } = evaluateFaultMatrixEvidence(matrix, bundle);
    assert.ok(
      has(violations, "evidence:redaction_positive_control_missing"),
      `${JSON.stringify(value)} must red: ${codes(violations)}`,
    );
  }
});

test("DEP-026 evidence: a redaction case that declares NO suppressed arm is REFUSED, not skipped", () => {
  const { matrix, bundle } = completeBundle(GATE_PROFILES[0]);
  const decl = matrix.profiles
    .find((p) => p.profile === GATE_PROFILES[0]).cases
    .find((c) => c.case.includes("redaction.canary"));
  delete decl.redactionCase.suppressedArm;
  const { violations } = evaluateFaultMatrixEvidence(matrix, bundle);
  assert.ok(has(violations, "evidence:redaction_suppressed_arm_undeclared"), codes(violations).join(","));
});

test("DEP-026 evidence: an unknown suppressed-arm scope is REFUSED rather than read as exempt", () => {
  for (const scope of ["campaign", "", null, 1]) {
    const { matrix, bundle } = completeBundle(GATE_PROFILES[0]);
    matrix.profiles
      .find((p) => p.profile === GATE_PROFILES[0]).cases
      .find((c) => c.case.includes("redaction.canary")).redactionCase.suppressedArm = { scope };
    const { violations } = evaluateFaultMatrixEvidence(matrix, bundle);
    assert.ok(
      has(violations, "evidence:redaction_suppressed_arm_undeclared"),
      `scope ${JSON.stringify(scope)} must red: ${codes(violations)}`,
    );
  }
});

test("DEP-026 evidence: a JUSTIFIED `none` exemption passes without the row field; an UNJUSTIFIED one reds", () => {
  const withArm = (suppressedArm, mutateRow = (r) => { delete r.positiveControlPassed; }) => {
    const { matrix, bundle } = completeBundle(GATE_PROFILES[0]);
    matrix.profiles
      .find((p) => p.profile === GATE_PROFILES[0]).cases
      .find((c) => c.case.includes("redaction.canary")).redactionCase.suppressedArm = suppressedArm;
    mutateRow(bundle.cases.find((r) => r.case.includes("redaction.canary")));
    return evaluateFaultMatrixEvidence(matrix, bundle).violations;
  };
  const justified = { scope: "none", blockedBy: ["E6-F033"], reason: "the logs stream carries no per-run token" };
  assert.deepEqual(withArm(justified), [], "a justified exemption must not red, and must not need the row field");
  // ★ And it is NARROW: every way of writing a bare exemption reds.
  for (const arm of [
    { scope: "none" },
    { scope: "none", reason: "because" },
    { scope: "none", blockedBy: ["E6-F033"] },
    { scope: "none", blockedBy: [], reason: "because" },
    { scope: "none", blockedBy: ["E6-F033"], reason: "  " },
    { scope: "none", blockedBy: "E6-F033", reason: "not an array" },
    { scope: "none", blockedBy: [""], reason: "an empty id" },
  ]) {
    const violations = withArm(arm);
    assert.ok(
      has(violations, "evidence:redaction_suppressed_arm_exemption_unjustified"),
      `${JSON.stringify(arm)} must red: ${codes(violations)}`,
    );
  }
});

test("DEP-026 declaration: a REQUIRED redaction case must declare its suppressed arm, well-formed", () => {
  const decl = (fn) => evaluateFaultMatrixDeclaration(mutate((m, at) => {
    fn(at.caseIn(GATE_PROFILES[0], "redaction.canary").redactionCase);
  }));
  assert.ok(has(decl((r) => { delete r.suppressedArm; }), "declaration:redaction_suppressed_arm_missing"));
  assert.ok(has(decl((r) => { r.suppressedArm = { scope: "campaign" }; }), "declaration:redaction_suppressed_arm_unknown_scope"));
  assert.ok(has(decl((r) => { r.suppressedArm = "in_run"; }), "declaration:redaction_suppressed_arm_unknown_scope"));
  assert.ok(has(decl((r) => { r.suppressedArm = { scope: "none" }; }), "declaration:redaction_suppressed_arm_exemption_unjustified"));
  assert.ok(has(decl((r) => { r.suppressedArm = { scope: "none", blockedBy: ["E6-F033"], reason: "" }; }), "declaration:redaction_suppressed_arm_exemption_unjustified"));
  // The two legal shapes are silent.
  assert.deepEqual(decl((r) => { r.suppressedArm = { scope: "in_run" }; }), []);
  assert.deepEqual(decl((r) => { r.suppressedArm = { scope: "none", blockedBy: ["E6-F033"], reason: "measured structural blocker" }; }), []);
});

test("DEP-026 declaration: a PENDING redaction case need not declare it yet, but a malformed one still reds", () => {
  // The grader never reaches a `pending` case (the evidence loop `continue`s on it), and a case whose
  // driver is unbuilt cannot honestly answer the question — `d2c.redaction.planted_canary_scrubbed`
  // has no producer anywhere in the repo. So PRESENCE is required at the moment the field becomes
  // load-bearing, which is the flip to `required`, and that makes the flip mechanical rather than
  // prose. Well-formedness is required either way, so a pending case cannot park a broken shape.
  const pendingNoArm = evaluateFaultMatrixDeclaration(mutate((m, at) => {
    const c = at.caseIn(GATE_PROFILES[0], "redaction.canary");
    c.evidence = "pending";
    c.pendingKind = "keyed";
    c.pendingReason = "the driver is unbuilt";
    c.pendingOwner = "planning session";
    delete c.redactionCase.suppressedArm;
  }));
  assert.ok(!has(pendingNoArm, "declaration:redaction_suppressed_arm_missing"), codes(pendingNoArm).join(","));
  const pendingBadArm = evaluateFaultMatrixDeclaration(mutate((m, at) => {
    const c = at.caseIn(GATE_PROFILES[0], "redaction.canary");
    c.evidence = "pending";
    c.pendingKind = "keyed";
    c.pendingReason = "the driver is unbuilt";
    c.pendingOwner = "planning session";
    c.redactionCase.suppressedArm = { scope: "vibes" };
  }));
  assert.ok(has(pendingBadArm, "declaration:redaction_suppressed_arm_unknown_scope"), codes(pendingBadArm).join(","));
});

// ★ DEP-026 — AN EXEMPTION THAT NAMES A PHANTOM FINDING IS AN UNCHECKED EXEMPTION.
//
// Found by self-auditing this ticket's OWN diff (`E.1a`: you are the most recent author of the defect
// you are describing). `classifyRedactionSuppressedArm` checks that `blockedBy` is a non-empty array of
// non-empty strings — which answers "is what I wrote well-formed?" and NOT "does the thing it names
// exist?". A typo, or an id invented to satisfy the shape, would pass every check above while the
// exemption pointed at nothing. That is precisely the class this whole surface has been unwinding, one
// level out.
//
// Completeness is a claim about something the artefact does not contain, so it needs a SECOND SOURCE
// (`E.2.1`): the epics' `findings.md` headings. Deliberately NOT `scripts/finding-ownership.json` —
// closing a finding DELETES its register key, and an exemption may legitimately name a blocker that has
// since been closed, so the register would red on a correct declaration. The prose heading survives
// closure; the register key does not.
function declaredFindingHeadings() {
  const ids = new Set();
  const dir = path.join(repoRoot, "docs/replatform/epics");
  for (const epic of readdirSync(dir, { withFileTypes: true })) {
    if (!epic.isDirectory()) continue;
    const file = path.join(dir, epic.name, "findings.md");
    if (!existsSync(file)) continue;
    for (const m of readFileSync(file, "utf8").matchAll(/^##\s+([A-Z][A-Z0-9]*-F\d+)\b/gm)) ids.add(m[1]);
  }
  return ids;
}

/** Every `blockedBy` id any redaction exemption names, as `[caseId, findingId]` pairs. */
function declaredSuppressedArmBlockers(matrix) {
  const out = [];
  for (const p of matrix.profiles ?? []) {
    for (const c of p.cases ?? []) {
      const arm = c.redactionCase?.suppressedArm;
      if (arm?.scope !== "none") continue;
      for (const id of Array.isArray(arm.blockedBy) ? arm.blockedBy : []) out.push([c.case, String(id)]);
    }
  }
  return out;
}

test("DEP-026: every redaction exemption's `blockedBy` names a finding that EXISTS", () => {
  const matrix = JSON.parse(readFileSync(path.join(repoRoot, FAULT_MATRIX_PATH), "utf8"));
  const known = declaredFindingHeadings();
  // Non-vacuity FIRST, twice over: a broken heading regex, or a matrix with no exemption at all, would
  // make the loop below pass while checking nothing.
  assert.ok(known.size >= 50, `the findings-heading scan found only ${known.size} ids — the regex or the layout moved`);
  const pairs = declaredSuppressedArmBlockers(matrix);
  assert.ok(pairs.length > 0, "no redaction exemption declares a blocker, so this control evaluated nothing");
  for (const [caseId, id] of pairs) {
    assert.ok(known.has(id), `${caseId}: suppressedArm.blockedBy names ${id}, which no epic's findings.md declares`);
  }
  // And the control's own control: a phantom id must red.
  assert.throws(
    () => {
      const phantom = JSON.parse(JSON.stringify(matrix));
      declaredSuppressedArmBlockers(phantom).length; // shape check before mutating
      for (const p of phantom.profiles) {
        for (const c of p.cases) {
          if (c.redactionCase?.suppressedArm?.scope === "none") c.redactionCase.suppressedArm.blockedBy = ["E6-F999"];
        }
      }
      for (const [caseId, id] of declaredSuppressedArmBlockers(phantom)) {
        assert.ok(known.has(id), `${caseId}: ${id}`);
      }
    },
    /E6-F999/,
    "a phantom blocker id must red — else this control proves nothing",
  );
});
