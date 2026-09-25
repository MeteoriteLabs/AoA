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
  REDACTION_PROBE_STREAMS,
  classifyRedactionObservation,
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

test("the matrix row carries every field `evaluateFaultMatrixEvidence` grades a redaction case on", () => {
  const row = redactionProbeMatrixRow(classify(GRADED), { suppressedUnfired: true });
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
  assert.equal(row.observedClassification, "no_scrubber_marker_observed");
  assert.equal(row.redactedOnAllStreams, false);
  assert.equal(row.positiveControlPassed, false);
});
