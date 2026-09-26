// -----------------------------------------------------------------------------
// DEP-022 — the ONE list of which `M1a-D2-MECHANISM` cases the cross-tenant driver owns.
//
// Two checks need it and must not keep separate copies:
//   * `scripts/lib/__tests__/d2m-cross-tenant-coverage.test.mjs` — every `required` case has a
//     driver (the declaration checked against the driver's source);
//   * `scripts/check-cross-tenant-suppression.mjs` — every one of those cases appears in the
//     SUPPRESSED run's reds (the declaration checked against the suppressed evidence).
//
// A second copy of a list is a list that drifts, and these two are the halves of one property:
// a case that exists, fires when injected, and provably does NOT fire when the injection is
// suppressed. Either half alone can be satisfied by a case that proves nothing.
// -----------------------------------------------------------------------------

export const D2M_PROFILE = "M1a-D2-MECHANISM";

/**
 * The cases the JOURNEY decides, from its own per-tenant outcomes (`faultMatrix` in
 * `scripts/m1-shipped-boot/journey.mjs`, DEP-015/DEP-020) — not the cross-tenant phase. Named
 * rather than counted, so one cannot be dropped by editing a number.
 */
export const JOURNEY_OWNED_CASES = Object.freeze([
  "d2m.tenant.journey.A",
  "d2m.tenant.journey.B",
  "d2m.tenant.control_refused",
]);

/**
 * DEP-024 - the cases a DEDICATED KEYED-ONLY PHASE decides, which the cross-tenant driver must not
 * be held responsible for either.
 *
 * `d2m.redaction.planted_canary_scrubbed` cannot live in the cross-tenant phase: that phase runs in
 * BOTH modes and `runCrossTenantCases`' own verdict refuses any row whose `injectionFired !== true`,
 * while this case needs a REAL sandbox, which `keyless` never starts (no adapter-manager). Folding it
 * in would make the free keyless rehearsal permanently red for a reason that says nothing about
 * redaction. It therefore carries BOTH of its arms inside its own phase
 * (`scripts/m1-shipped-boot/redaction.mjs` + `scripts/lib/m1a-redaction-probe.mjs`), which is a
 * STRONGER arrangement than the one this file guards: the graded and withheld arms are produced by
 * one phase, against one stack, in one run, so a stale suppressed bundle cannot stand in for a fresh
 * one - and `evaluateRedactionProbeEvidence` refuses unless BOTH hold.
 *
 * Named rather than counted, for the same reason as the journey-owned three.
 */
export const PHASE_OWNED_CASES = Object.freeze([
  "d2m.redaction.planted_canary_scrubbed",
]);

/**
 * Every case the cross-tenant driver is responsible for: the profile's `required` set minus the
 * journey-owned three and the phase-owned one. Derived from the DECLARATION, never from a hand-kept
 * list, so flipping a case to `required` automatically puts it under both checks - unless it is
 * named above as owned elsewhere, and each of those names carries WHY.
 *
 * @param {object} matrix the parsed `tests/d1/fault-matrix.json`
 * @returns {string[]}
 */
export function driverOwnedRequiredCases(matrix) {
  const profile = (matrix?.profiles ?? []).find((p) => p && p.profile === D2M_PROFILE);
  if (!profile || !Array.isArray(profile.cases)) {
    throw new Error(`the fault matrix declares no ${D2M_PROFILE} profile`);
  }
  return profile.cases
    .filter((c) => c && c.evidence === "required"
      && !JOURNEY_OWNED_CASES.includes(c.case)
      && !PHASE_OWNED_CASES.includes(c.case))
    .map((c) => c.case);
}

/**
 * The SUPPRESSED run's verdict: every driver-owned `required` case must be present and must record
 * `injectionFired: false`.
 *
 * ★ WHY THIS IS NOT THE WORKFLOW'S TWO GREPS (Codex P1 on PR #600, round 4, and the finding was
 * right). The control step greps for `[cross-tenant:evidence]` and for one
 * `injection_did_not_fire`. If ONE of the fourteen cases quietly executed its hostile arm during a
 * suppressed run, the other thirteen would still make the phase exit non-zero and both greps would
 * still match — so CI would report the positive control as passing while that case's non-vacuity
 * was never demonstrated. "At least one marker" is the same defect as "at least one test ran".
 *
 * PURE: takes the declaration and the suppressed bundle, returns violations. No I/O.
 *
 * @param {object} matrix the parsed declaration
 * @param {object} bundle the parsed `cross-tenant-suppressed.json`
 * @returns {{violations: string[], summary: {expected: number, reported: number, unfired: number}}}
 */
export function evaluateSuppressedRun(matrix, bundle) {
  const violations = [];
  const expected = driverOwnedRequiredCases(matrix);
  const summary = { expected: expected.length, reported: 0, unfired: 0 };

  if (!bundle || typeof bundle !== "object") {
    violations.push("the suppressed bundle is unreadable");
    return { violations, summary };
  }
  if (bundle.suppressInjection !== true) {
    violations.push(
      `the bundle records suppressInjection=${JSON.stringify(bundle.suppressInjection ?? null)} — ` +
      "this check judges the SUPPRESSED run, and a graded bundle would pass it for the wrong reason",
    );
  }
  const rows = Array.isArray(bundle.cases) ? bundle.cases : [];
  summary.reported = rows.length;
  const byCase = new Map();
  for (const row of rows) {
    if (!row || typeof row.case !== "string") continue;
    if (byCase.has(row.case)) violations.push(`case ${row.case} appears twice in the suppressed bundle`);
    byCase.set(row.case, row);
  }

  for (const id of expected) {
    const row = byCase.get(id);
    if (!row) {
      // The defect this check exists for: a case that vanished from the suppressed run entirely.
      violations.push(`case ${id} is declared \`required\` but the SUPPRESSED run reports nothing for it — its non-vacuity is not demonstrated`);
      continue;
    }
    if (row.injectionFired === false) {
      summary.unfired += 1;
    } else {
      violations.push(
        `case ${id}: the SUPPRESSED run recorded injectionFired=${JSON.stringify(row.injectionFired ?? null)} — ` +
        "an injection that still fires when suppression is on means this case's hostile arm is not actually under the suppression switch",
      );
    }
  }

  // Non-vacuity of THIS check: a declaration with nothing required would make every loop above
  // evaluate nothing and return clean.
  if (expected.length === 0) {
    violations.push(`the ${D2M_PROFILE} profile declares no driver-owned \`required\` case, so this check evaluated nothing`);
  }
  return { violations, summary };
}
