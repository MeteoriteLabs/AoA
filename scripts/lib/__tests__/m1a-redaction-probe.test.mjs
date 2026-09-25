// -----------------------------------------------------------------------------
// DEP-024 — the control for the shipped-boot lane's E5 clause-5 judge.
//
// Every assertion below is a PAIR: the property, and the single mutation of the observation that
// must break it. An evaluator whose violations list is never non-empty is the "check that evaluates
// nothing" this programme keeps paying for, so each `violations.length === 0` here is earned by a
// neighbouring test that makes the same input fail.
//
// PURE + FREE: node:test + node:assert only. Runs in `policy`.
// -----------------------------------------------------------------------------

import assert from "node:assert/strict";
import test from "node:test";

import {
  REDACTION_PROBE_CASE,
  REDACTION_PROBE_EXPECTED_CLASSIFICATION,
  REDACTION_PROBE_REQUIRED_ATTEMPT_STATUS,
  REDACTION_PROBE_STREAMS,
  classifyRedactionObservation,
  redactionAttemptFailureClassification,
  evaluateRedactionProbeEvidence,
  redactionProbeMatrixRow,
} from "../m1a-redaction-probe.mjs";

/** A graded arm as the lane observes it when everything works. */
const GRADED = {
  markerOnEvents: true,
  markerOnLogs: true,
  ownEventsClean: true,
  logsClean: true,
  crossTenantClean: true,
  eventBytes: 4096,
  logBytes: 65_536,
  foreignBytes: 2048,
  // DEP-025 finding (b): the arm's own attempt must have reached a durable `succeeded` terminal
  // before anything it observed is used. A withheld-plant job that terminated `failed` AFTER
  // `attempt_started` has a non-empty event stream and no markers, and satisfied the old suppressed
  // control although the command never ran.
  attemptStatus: "succeeded",
};

/** The suppressed arm: the same run shape with nothing planted. */
const SUPPRESSED = { ...GRADED, markerOnEvents: false, markerOnLogs: false };

const classify = (o) => classifyRedactionObservation(o);
const evaluate = (graded, suppressed, declaredStreams) =>
  evaluateRedactionProbeEvidence({
    graded: graded === null ? null : classify(graded),
    suppressed: suppressed === null ? null : classify(suppressed),
    ...(declaredStreams ? { declaredStreams } : {}),
  });

const has = (violations, re) => violations.some((line) => re.test(line));

// ── classification ───────────────────────────────────────────────────────────

test("the graded arm fires only when the marker is on BOTH declared streams", () => {
  assert.equal(classify(GRADED).injectionFired, true);
  assert.equal(classify({ ...GRADED, markerOnLogs: false }).injectionFired, false);
  assert.equal(classify({ ...GRADED, markerOnEvents: false }).injectionFired, false);
});

test("a CLEAN stream cannot decide `fired` — that is the vacuity the case exists to exclude", () => {
  // Everything clean, nothing planted: the arm must NOT read as a pass.
  const row = classify({ ...GRADED, markerOnEvents: false, markerOnLogs: false });
  assert.equal(row.injectionFired, false);
  assert.equal(row.redactedOnAllStreams, true);
  assert.equal(row.observedClassification, "no_scrubber_marker_observed");
});

test("a marker WITH the canary still present is classified as a leak, not a pass", () => {
  const row = classify({ ...GRADED, ownEventsClean: false });
  assert.equal(row.injectionFired, true);
  assert.equal(row.observedClassification, "canary_leaked_on_a_stream");
});

// ★ REPLACES an earlier test that asserted the SUPPRESSED arm graded the EVENT stream only, because
// the container log is shared across every run on the stack. That asymmetry is GONE: attribution is
// now intrinsic to the line (a per-arm nonce the driver carries in the probe line's plaintext), so
// BOTH arms grade BOTH streams and a stale marked line from any earlier run is excluded by
// construction rather than by the order the arms happen to run in (Codex round 2, PR #607).
test("BOTH arms grade BOTH streams — one stream's marker alone never decides `fired`", () => {
  for (const base of [GRADED, SUPPRESSED]) {
    assert.equal(classify({ ...base, markerOnEvents: true, markerOnLogs: false }).injectionFired, false);
    assert.equal(classify({ ...base, markerOnEvents: false, markerOnLogs: true }).injectionFired, false);
    assert.equal(classify({ ...base, markerOnEvents: true, markerOnLogs: true }).injectionFired, true);
  }
});

test("★ THE STALE-MARKER CASE the old asymmetry was blind to: a log marker with no event marker", () => {
  // A historical tagged+marked line on the shared worker log, while THIS job's line never arrived.
  // Under the old contract the suppressed arm ignored `markerOnLogs` and could not see this at all,
  // and the graded arm would have PASSED on it. Now it reds on both arms.
  const stale = classify({ ...SUPPRESSED, markerOnLogs: true });
  assert.equal(stale.injectionFired, false);
  assert.equal(stale.observedClassification, "no_scrubber_marker_observed");
  const { violations } = evaluate({ ...GRADED, markerOnEvents: false, markerOnLogs: true }, SUPPRESSED);
  assert.ok(has(violations, /no scrubber marker on both declared streams/), violations.join("\n"));
  // ★ AND ON THE SUPPRESSED ARM TOO, which is what the comment above always claimed and what the
  // PAIR VERDICT did not do until DEP-025: `injectionFired` is false on this shape, so the
  // AND-collapsed suppressed check passed it. See the per-stream controls below.
  const suppressedStale = evaluate(GRADED, { ...SUPPRESSED, markerOnLogs: true }).violations;
  assert.ok(has(suppressedStale, /marker was observed on stream "logs"/), suppressedStale.join("\n") || "<no violations>");
});

test("an empty stream is reported as VACUITY on the row, never thrown away", () => {
  const row = classify({ ...GRADED, eventBytes: 0, logBytes: 0, foreignBytes: 0 });
  assert.equal(row.vacuity.length, 3);
  assert.ok(row.vacuity.every((line) => /vacuous|vacuously/.test(line)), row.vacuity.join("\n"));
});

// ── the pair verdict ─────────────────────────────────────────────────────────

test("BOTH arms present and correct ⇒ no violations", () => {
  const { violations, summary } = evaluate(GRADED, SUPPRESSED);
  assert.deepEqual(violations, []);
  assert.equal(summary.gradedFired, true);
  assert.equal(summary.suppressedUnfired, true);
  assert.deepEqual(summary.streams, [...REDACTION_PROBE_STREAMS]);
});

test("POSITIVE CONTROL — a MISSING suppressed arm is refused", () => {
  const { violations } = evaluate(GRADED, null);
  assert.ok(has(violations, /SUPPRESSED arm produced no row/), violations.join("\n"));
});

test("POSITIVE CONTROL — a suppressed arm that STILL FIRES is refused", () => {
  // Both markers, because `fired` is now the conjunction on every arm.
  const { violations } = evaluate(GRADED, { ...SUPPRESSED, markerOnEvents: true, markerOnLogs: true });
  assert.ok(has(violations, /suppressed arm: recorded injectionFired=true/), violations.join("\n"));
});

test("POSITIVE CONTROL — a suppressed arm that never RAN is refused (empty own stream)", () => {
  const { violations } = evaluate(GRADED, { ...SUPPRESSED, eventBytes: 0 });
  assert.ok(has(violations, /indistinguishable from `never ran`/), violations.join("\n"));
});

// ── DEP-025 finding (a): the suppressed arm, PER STREAM ──────────────────────
// ★★★ THE HOLE ROUND 2'S OWN FIX OPENED. Making `injectionFired` the conjunction of both streams
// (so a stale log marker could no longer satisfy the graded arm alone) also made the suppressed
// arm's `injectionFired !== false` check PERMISSIVE: a withheld-plant arm observing its OWN
// nonce-tagged marker on exactly ONE stream yields `injectionFired === false`, so nothing was
// raised — while such a marker already proves something other than this case's injection can
// generate the evidence. The requirement is per stream; the AND-collapse cannot express it.
test("POSITIVE CONTROL — a suppressed arm with a marker on EXACTLY ONE stream is refused", () => {
  for (const stream of ["events", "logs"]) {
    const other = stream === "events" ? "logs" : "events";
    const { violations, summary } = evaluate(GRADED, {
      ...SUPPRESSED,
      [stream === "events" ? "markerOnEvents" : "markerOnLogs"]: true,
    });
    assert.ok(
      has(violations, new RegExp(`suppressed arm: the scrubber's marker was observed on stream "${stream}"`)),
      `a marker on ${stream} alone (${other} clean) must be refused: ${violations.join("\n") || "<no violations>"}`,
    );
    // ★ THE TWIN, in the same shape: `suppressedUnfired` is what becomes the matrix row's
    // `positiveControlPassed`, so the AND-collapse there reports a passing positive control on the
    // very observation that refuses.
    assert.equal(summary.suppressedUnfired, false, `summary.suppressedUnfired must be false when ${stream} carries a marker`);
  }
});

test("POSITIVE CONTROL — a suppressed arm that does not REPORT a stream's observation is refused", () => {
  // Fail-closed on missing input: an unreported stream is refused, never read as clean.
  const row = classify(SUPPRESSED);
  delete row.scrubberMarkerObservedOnStream.logs;
  const { violations, summary } = evaluateRedactionProbeEvidence({ graded: classify(GRADED), suppressed: row });
  assert.ok(has(violations, /suppressed arm: stream "logs" reported no marker observation/), violations.join("\n"));
  assert.equal(summary.suppressedUnfired, false);
});

// ── DEP-025 finding (b): each arm's attempt must have SUCCEEDED ──────────────
test("POSITIVE CONTROL — an arm whose attempt did not reach `succeeded` is refused, per arm", () => {
  // Substring, not a regex: the expected text embeds JSON quotes, which a regex would re-escape.
  const hasText = (violations, text) => violations.some((line) => line.includes(text));
  for (const status of ["failed", "cancelled", "running", null]) {
    const want = `attempt terminated ${JSON.stringify(status)}, not "succeeded"`;
    const g = evaluate({ ...GRADED, attemptStatus: status }, SUPPRESSED).violations;
    assert.ok(
      hasText(g, `graded arm: the seeded job's ${want}`),
      `graded attemptStatus=${JSON.stringify(status)} must be refused: ${g.join("\n") || "<no violations>"}`,
    );
    const s = evaluate(GRADED, { ...SUPPRESSED, attemptStatus: status }).violations;
    assert.ok(
      hasText(s, `suppressed arm: the seeded job's ${want}`),
      `suppressed attemptStatus=${JSON.stringify(status)} must be refused: ${s.join("\n") || "<no violations>"}`,
    );
  }
});

test("★ the shape finding (b) names: a suppressed job that FAILED after `attempt_started`", () => {
  // Non-empty event stream, no markers, terminal `failed`. Under the old contract this satisfied
  // every suppressed check — non-vacuity claimed from a failed setup.
  const { violations } = evaluate(GRADED, { ...SUPPRESSED, attemptStatus: "failed", eventBytes: 512 });
  assert.ok(has(violations, /suppressed arm: the seeded job's attempt terminated "failed"/), violations.join("\n"));
});

test("POSITIVE CONTROL — a MISSING graded arm is refused", () => {
  const { violations } = evaluate(null, SUPPRESSED);
  assert.ok(has(violations, /GRADED arm produced no row/), violations.join("\n"));
});

test("POSITIVE CONTROL — the scrubber REMOVED: no marker on either stream ⇒ refused", () => {
  // This is the mutation the declaration names: remove the redaction and BOTH arms flip. With the
  // scrubber gone the marker disappears AND the canary appears, so both refusals must fire.
  const { violations } = evaluate(
    { ...GRADED, markerOnEvents: false, markerOnLogs: false, ownEventsClean: false, logsClean: false },
    SUPPRESSED,
  );
  assert.ok(has(violations, /no scrubber marker on both declared streams/), violations.join("\n"));
  assert.ok(has(violations, /SURVIVED onto a stream/), violations.join("\n"));
});

test("POSITIVE CONTROL — a graded arm whose declared stream observed ZERO bytes is refused", () => {
  const { violations } = evaluate({ ...GRADED, logBytes: 0 }, SUPPRESSED);
  assert.ok(has(violations, /stream "logs" observed zero bytes/), violations.join("\n"));
  assert.ok(has(violations, /worker container log is empty/), violations.join("\n"));
});

test("POSITIVE CONTROL — a declaration whose streams drifted from this judge's is refused", () => {
  const { violations } = evaluate(GRADED, SUPPRESSED, ["events"]);
  assert.ok(has(violations, /!= the streams this judge knows/), violations.join("\n"));
});

test("the declaration's own classification token is the one required", () => {
  const { violations } = evaluate(GRADED, SUPPRESSED);
  assert.deepEqual(violations, []);
  assert.equal(classify(GRADED).observedClassification, REDACTION_PROBE_EXPECTED_CLASSIFICATION);
});

// ── the row ──────────────────────────────────────────────────────────────────

// ── DEP-025 / Codex round 1 P2: the RETAINED row must carry the refusal ──────
// ★★★ THE REFUSAL MUST NOT LIVE ONLY IN THE THROWING PROCESS. `journey.mjs`'s `redaction` phase
// deliberately retains `cases: observations?.rows ?? error?.rows ?? []`, so a run refused for a
// non-succeeded attempt still writes a row — and a LATER, SEPARATE `fault-matrix` invocation grades
// that file without re-running this judge (`evaluateFaultMatrixEvidence` does not inspect attempt
// statuses). A pass-shaped row would therefore contradict the refusal that produced it.
//
// This is finding (b)'s own class pointed at my own diff (E.1(a)): a fact asserted in one place and
// not carried into the durable record a different consumer grades.
test("★ the retained row is NOT pass-shaped when the GRADED attempt did not succeed", () => {
  const row = redactionProbeMatrixRow(classify({ ...GRADED, attemptStatus: "failed" }), {
    suppressedUnfired: true,
    suppressedAttemptStatus: "succeeded",
  });
  assert.equal(row.injectionFired, false, "a failed graded attempt must not claim its injection fired");
  assert.equal(row.observedClassification, "graded_arm_attempt_failed");
  assert.notEqual(row.observedClassification, REDACTION_PROBE_EXPECTED_CLASSIFICATION);
  assert.equal(row.gradedAttemptStatus, "failed", "the retained row must CARRY the status, so a standalone fault-matrix can see it");
});

// ★ The token the D1 twin ALSO emits. It is exported and imported by both lanes rather than written
// out twice, because the record used to CLAIM "the same token, so the two lanes cannot drift" and
// nothing enforced that. This is the control for the shared definition.
test("★ the attempt-failure classification is ONE definition, and never the declared pass token", () => {
  assert.equal(redactionAttemptFailureClassification("failed"), "graded_arm_attempt_failed");
  assert.equal(redactionAttemptFailureClassification(null), "graded_arm_attempt_null");
  assert.equal(redactionAttemptFailureClassification(undefined), "graded_arm_attempt_null");
  for (const status of ["failed", "cancelled", "running", null, undefined, 7]) {
    assert.notEqual(redactionAttemptFailureClassification(status), REDACTION_PROBE_EXPECTED_CLASSIFICATION);
  }
  // The row builder must USE it, not re-spell it.
  assert.equal(
    redactionProbeMatrixRow(classify({ ...GRADED, attemptStatus: "cancelled" }), { suppressedAttemptStatus: "succeeded" }).observedClassification,
    redactionAttemptFailureClassification("cancelled"),
  );
  assert.equal(REDACTION_PROBE_REQUIRED_ATTEMPT_STATUS, "succeeded");
});

test("★ positiveControlPassed is false when the SUPPRESSED attempt did not succeed", () => {
  // The shape finding (b) names, now followed all the way into the artifact: no markers because the
  // withheld job FAILED, not because suppression worked.
  const row = redactionProbeMatrixRow(classify(GRADED), { suppressedUnfired: true, suppressedAttemptStatus: "failed" });
  assert.equal(row.positiveControlPassed, false);
  assert.equal(row.suppressedAttemptStatus, "failed");
});

test("★ FAIL-CLOSED — a row whose detail omits the suppressed status cannot claim a positive control", () => {
  const row = redactionProbeMatrixRow(classify(GRADED), { suppressedUnfired: true });
  assert.equal(row.positiveControlPassed, false, "an absent status is refused, never read as succeeded");
  assert.equal(row.suppressedAttemptStatus, null);
});

test("a row from an arm with NO status at all names that, rather than the expected classification", () => {
  const { attemptStatus, ...noStatus } = GRADED;
  const row = redactionProbeMatrixRow(classify(noStatus), { suppressedUnfired: true, suppressedAttemptStatus: "succeeded" });
  assert.equal(row.injectionFired, false);
  assert.equal(row.observedClassification, "graded_arm_attempt_null");
});

test("the matrix row carries every field `evaluateFaultMatrixEvidence` grades a redaction case on", () => {
  const row = redactionProbeMatrixRow(classify(GRADED), { suppressedUnfired: true, suppressedAttemptStatus: "succeeded" });
  assert.equal(row.case, REDACTION_PROBE_CASE);
  assert.equal(row.injectionFired, true);
  assert.equal(row.observedClassification, REDACTION_PROBE_EXPECTED_CLASSIFICATION);
  assert.equal(row.redactedOnAllStreams, true);
  assert.deepEqual(row.scrubberMarkerObservedOnStream, { events: true, logs: true });
  assert.equal(row.positiveControlPassed, true);
  for (const stream of REDACTION_PROBE_STREAMS) {
    assert.ok(Number(row.streamBytesObserved[stream]) > 0, stream);
  }
});

test("the row NEVER carries a canary or a stream excerpt — only booleans, counts and ids", () => {
  const row = redactionProbeMatrixRow(classify(GRADED), {
    suppressedUnfired: true,
    organizationId: "11111111-1111-4111-8111-111111111111",
    gradedJobId: "77777777-7777-4777-8777-777777777777",
  });
  const serialized = JSON.stringify(row);
  assert.equal(/canary=|«redacted»/.test(serialized), false, serialized);
  // Everything in `detail` must be a primitive fact, never text captured off a stream.
  for (const value of Object.values(row.detail)) {
    assert.ok(["string", "number", "boolean"].includes(typeof value) || value === null, `detail carries ${typeof value}`);
  }
});

test("a row built from a MISSING graded arm cannot claim a pass", () => {
  const row = redactionProbeMatrixRow(null, {});
  assert.equal(row.injectionFired, false);
  // ★ Was `no_scrubber_marker_observed` before DEP-025's Codex round-1 fix. A MISSING arm has no
  // attempt status either, and naming that is strictly more accurate than naming the stream scan: the
  // streams were never read, so "no marker was observed" would describe a scan that did not happen.
  assert.equal(row.observedClassification, "graded_arm_attempt_null");
  assert.equal(row.gradedAttemptStatus, null);
  assert.equal(row.redactedOnAllStreams, false);
  assert.equal(row.positiveControlPassed, false);
});
