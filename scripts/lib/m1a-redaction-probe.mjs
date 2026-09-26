// -----------------------------------------------------------------------------
// DEP-024 — the PURE half of the shipped-boot lane's E5 clause-5 (redaction) case:
// `d2m.redaction.planted_canary_scrubbed`.
//
// ── WHY THIS CASE NEEDED A THIRD OWNER SHAPE ─────────────────────────────────
// The `M1a-D2-MECHANISM` profile has two existing shapes for a case, and the redaction case fits
// NEITHER, which is measured rather than asserted:
//
//   * JOURNEY-owned (`d2m.tenant.journey.A`, `…B`, `…control_refused`) — decided from the
//     journey's own per-tenant outcomes. Those cases have NO suppressed arm on this lane at all.
//   * DRIVER-owned (the fourteen `cross-tenant.mjs` cases) — driven in BOTH modes, and
//     `runCrossTenantCases`' own verdict refuses ANY row whose `injectionFired !== true`. This case
//     cannot fire in `keyless` mode: the adapter-manager is never started there, so no sandbox can
//     be created and nothing can echo anything. Putting it in that phase would make the KEYLESS
//     lane permanently red for a reason that says nothing about redaction.
//
// So it gets its own KEYED-ONLY phase that carries BOTH arms inside ONE run: a suppressed job whose
// workload plants nothing, then a graded job whose workload plants the leak. That is strictly
// stronger than the cross-tenant phase's arrangement, where the graded and suppressed arms are two
// separate invocations and a stale one cannot be told from a fresh one: here the pair is produced
// by one phase, against one stack, in one run, and the phase refuses unless BOTH hold.
//
// ── WHAT DECIDES "FIRED" ─────────────────────────────────────────────────────
// The scrubber's OWN replacement marker (`REDACTION_MARKER`, substituted FOR the canary by
// `scrubEventStrings`), on a line that ALSO carries `RUN_OUTPUT_PROBE_TAG`. Never the harness's
// intent, and never a clean stream: a stream with no canary in it is exactly as clean when nothing
// was ever planted, which is the vacuity this case exists to exclude. Both arms are required
// because neither is sufficient alone — a clean stream with no marker may be a run that emitted the
// value nowhere, and a marker with the canary still present is a partial scrub.
//
// PURE: no I/O, no Docker, no database. `scripts/m1-shipped-boot/redaction.mjs` observes; this file
// judges; `scripts/lib/__tests__/m1a-redaction-probe.test.mjs` is the control.
// -----------------------------------------------------------------------------

/** The one case this phase owns. */
export const REDACTION_PROBE_CASE = "d2m.redaction.planted_canary_scrubbed";

/** The declared streams, in the declaration's own order. A stream added there and not here (or the
 * reverse) is a drift this module's `evaluate…` refuses rather than silently ignores. */
export const REDACTION_PROBE_STREAMS = Object.freeze(["events", "logs"]);

/** The classification the declaration requires of the graded arm. */
export const REDACTION_PROBE_EXPECTED_CLASSIFICATION = "canary_scrubbed_while_unseeded_twin_leaks";

/** Printed per refusal so the lane's log can show WHICH property failed, not merely that it did. */
export const REDACTION_PROBE_EVIDENCE_MARKER = "[redaction-probe:evidence]";

/**
 * The durable terminal EVERY arm's own seeded job must reach before anything it observed is used.
 *
 * ★ DEP-025 finding (b), handed up by DEP-024 §5.5(b) and verified at source before acceptance. The
 * harness's own docstring on `awaitSpineWorkerDrivenTerminal` says a timeout is "judged by the
 * verdict (as `attempt_not_succeeded`), never swallowed here" — i.e. the harness delegates the
 * assertion to its caller, and this judge is that caller. Before this constant existed the status
 * was read, logged and carried on the row's `detail` and never asserted anywhere, so a suppressed
 * job that terminated `failed` AFTER `attempt_started` had a non-empty event stream and no markers
 * and satisfied every suppressed check — NON-VACUITY CLAIMED FROM A FAILED SETUP. It is checked on
 * BOTH arms, because the graded arm has the mirror shape: a job that failed after emitting its probe
 * line would grade a partial run.
 */
export const REDACTION_PROBE_REQUIRED_ATTEMPT_STATUS = "succeeded";

/**
 * The classification a redaction row files when its own arm's attempt did not succeed.
 *
 * ★ ONE DEFINITION, IMPORTED BY BOTH LANES. The shipped-boot row (`redactionProbeMatrixRow`) and the
 * D1 twin (`tests/d1/m1-fault-matrix.test.mjs`) both emit it. An earlier draft duplicated the template
 * string in the two files and the record CLAIMED "the same token, so the two lanes cannot drift" —
 * which nothing enforced. A false claim of enforcement is worse than a missing check, so the claim is
 * now true by construction instead: the D1 case imports this function, exactly as it already imports
 * `evaluateFaultMatrixEvidence`.
 */
export function redactionAttemptFailureClassification(status) {
  return `graded_arm_attempt_${String(typeof status === "string" ? status : null)}`;
}

/**
 * One arm's observation → its classification, plus the vacuity findings that make the
 * classification meaningful at all.
 *
 * ★ VACUITY IS REPORTED, NOT THROWN. A caller that threw on an empty stream would file no row, and
 * an absent row reads as "the phase did not run" rather than "the phase ran and measured nothing"
 * — the shape DEP-023 §5.2.2 measured and filed as an owed refinement on the D1 twin. This module
 * takes the other branch deliberately: every arm ALWAYS produces a row, and the vacuity findings
 * ride ON it.
 *
 * @param {object} o
 * @param {boolean} o.markerOnEvents  a line on THIS job's event stream carrying tag AND marker
 * @param {boolean} o.markerOnLogs    a line in the worker container log carrying tag AND marker
 * @param {boolean} o.ownEventsClean  the canary is ABSENT from this job's event stream
 * @param {boolean} o.logsClean       the canary is ABSENT from the worker container log
 * @param {boolean} o.crossTenantClean the canary is ABSENT from the OTHER tenant's whole stream
 * @param {number}  o.eventBytes      bytes observed on the event stream
 * @param {number}  o.logBytes        bytes observed on the container log
 * @param {number}  o.foreignBytes    bytes observed on the other tenant's stream
 * @param {string|null} o.attemptStatus the arm's OWN attempt terminal, as the control plane recorded
 *   it. Carried onto the row so the PAIR VERDICT can refuse an arm whose setup did not succeed
 *   (DEP-025 finding (b)); absent ⇒ `null` ⇒ refused, never read as fine.
 */
export function classifyRedactionObservation(o) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const vacuity = [];
  if (num(o.eventBytes) <= 0) vacuity.push("the job's own event stream is empty, so every scan over it is vacuously clean");
  if (num(o.logBytes) <= 0) vacuity.push("the worker container log is empty, so every scan over it is vacuously clean");
  if (num(o.foreignBytes) <= 0) vacuity.push("the OTHER tenant's event stream is empty, so its cross-tenant clean arm is vacuous");

  const redactedOnAllStreams = o.ownEventsClean === true && o.logsClean === true && o.crossTenantClean === true;
  // ★★★ BOTH ARMS GRADE BOTH STREAMS, because attribution is INTRINSIC to the line (Codex round 2 on
  // PR #607, and the finding was right).
  //
  // An earlier draft graded the suppressed arm on the EVENT stream only, reasoning that
  // `composeServiceLogs` returns the WHOLE container log — every run the stack has done — so "no
  // marked probe line in the log" is not attributable to one job, while the per-job event stream is.
  // It then leaned on ORDER (suppressed first) to make the graded arm's log line attributable. That
  // is a POSITIONAL argument, and nothing enforced it: a repeated phase invocation, or any other
  // probe-producing job on that worker, leaves a historical tagged+marked line, and the graded log
  // arm would have passed on it while this job's line never arrived — a FALSE PASS on a gate clause,
  // which the suppressed arm could not have caught precisely because it ignored the log arm.
  //
  // The fix is not a pre-arm log boundary but a per-arm NONCE carried in the probe line's own
  // plaintext (`arm=<nonce>`, chosen by the driver, never a secret and therefore never scrubbed). A
  // line counts only when it carries the tag, the scrubber's marker AND this arm's nonce, so a stale
  // line from any earlier run is excluded by construction rather than by ordering — and the
  // suppressed arm regains its log arm, which is what makes it able to catch the stale-marker case
  // at all.
  const injectionFired = o.markerOnEvents === true && o.markerOnLogs === true;

  const observedClassification = injectionFired && redactedOnAllStreams
    ? REDACTION_PROBE_EXPECTED_CLASSIFICATION
    : injectionFired
      ? "canary_leaked_on_a_stream"
      : "no_scrubber_marker_observed";

  return {
    injectionFired,
    observedClassification,
    redactedOnAllStreams,
    // DEP-025 finding (b): read here, ASSERTED by `evaluateRedactionProbeEvidence`. Normalised to
    // `null` rather than to a passing default, because the absence of a status is exactly the
    // "not run" this case must not read as clean.
    attemptStatus: typeof o.attemptStatus === "string" ? o.attemptStatus : null,
    scrubberMarkerObservedOnStream: { events: o.markerOnEvents === true, logs: o.markerOnLogs === true },
    streamBytesObserved: { events: num(o.eventBytes), logs: num(o.logBytes) },
    vacuity,
  };
}

/**
 * The PAIR verdict: the graded arm must fire and be fully scrubbed, and the suppressed arm must be
 * present and must NOT fire. Returns violations; never throws.
 *
 * ★ BOTH DIRECTIONS, because each alone is satisfiable by something that proves nothing. A graded
 * arm alone could be green on a lane where the marker is produced by something other than this
 * run's plant; a suppressed arm alone is green on a lane where the surface does not exist.
 *
 * @param {object} input
 * @param {object|null} input.graded      the graded arm's row (from `classifyRedactionObservation`)
 * @param {object|null} input.suppressed  the suppressed arm's row
 * @param {string[]}    [input.declaredStreams] the declaration's `redactionCase.streams`
 */
export function evaluateRedactionProbeEvidence(input) {
  const violations = [];
  const summary = { gradedFired: false, suppressedUnfired: false, streams: [] };

  const declared = Array.isArray(input?.declaredStreams) ? [...input.declaredStreams] : [...REDACTION_PROBE_STREAMS];
  summary.streams = declared;
  // A declaration that grew or lost a stream must not silently keep passing against a judge that
  // still only knows two (E.2.1: a single-source check cannot see what is missing).
  if (declared.slice().sort().join(",") !== [...REDACTION_PROBE_STREAMS].sort().join(",")) {
    violations.push(
      `the declaration's redactionCase.streams {${declared.join(", ")}} != the streams this judge knows ` +
      `{${REDACTION_PROBE_STREAMS.join(", ")}} — one of the two was changed without the other`,
    );
  }

  const graded = input?.graded ?? null;
  const suppressed = input?.suppressed ?? null;

  /**
   * ★ DEP-025 finding (b) — EVERY arm's own setup must have succeeded, or nothing it observed is a
   * measurement. Applied to BOTH arms from one helper rather than written twice, so the two cannot
   * drift apart (the asymmetry that produced finding (a) in the first place).
   */
  const requireArmSucceeded = (arm, row) => {
    if (row.attemptStatus !== REDACTION_PROBE_REQUIRED_ATTEMPT_STATUS) {
      violations.push(
        `${arm} arm: the seeded job's attempt terminated ${JSON.stringify(row.attemptStatus ?? null)}, not ` +
        `${JSON.stringify(REDACTION_PROBE_REQUIRED_ATTEMPT_STATUS)} — a job that did not reach a durable succeeded ` +
        "terminal proves nothing about redaction, and its empty-or-markerless streams are a failed setup rather than a clean run",
      );
    }
  };

  if (!graded || typeof graded !== "object") {
    violations.push("the GRADED arm produced no row — the phase cannot claim a case it did not observe");
  } else {
    for (const v of graded.vacuity ?? []) violations.push(`graded arm: ${v}`);
    requireArmSucceeded("graded", graded);
    if (graded.injectionFired !== true) {
      violations.push(
        "graded arm: no scrubber marker on both declared streams, so the plant is not observed to have been scrubbed " +
        `(events=${graded.scrubberMarkerObservedOnStream?.events ?? null}, logs=${graded.scrubberMarkerObservedOnStream?.logs ?? null})`,
      );
    }
    if (graded.redactedOnAllStreams !== true) {
      violations.push("graded arm: the planted canary SURVIVED onto a stream — this is a real leak, and the surface must be reverted rather than debugged");
    }
    if (graded.observedClassification !== REDACTION_PROBE_EXPECTED_CLASSIFICATION) {
      violations.push(
        `graded arm: observed ${JSON.stringify(graded.observedClassification ?? null)}, ` +
        `the declaration requires ${JSON.stringify(REDACTION_PROBE_EXPECTED_CLASSIFICATION)}`,
      );
    }
    for (const stream of declared) {
      if (Number(graded.streamBytesObserved?.[stream] ?? 0) <= 0) {
        violations.push(`graded arm: stream ${JSON.stringify(stream)} observed zero bytes, so its arm is vacuous`);
      }
    }
    summary.gradedFired = graded.injectionFired === true;
  }

  if (!suppressed || typeof suppressed !== "object") {
    violations.push(
      "the SUPPRESSED arm produced no row — without it the graded arm's marker could have come from " +
      "anything on this stack, and the case's non-vacuity is not demonstrated",
    );
  } else {
    // ★ The suppressed arm's OWN non-vacuity: it must have RUN. A suppressed job that never reached
    // the sandbox would report no marker for the same reason a working suppression does.
    if (Number(suppressed.streamBytesObserved?.events ?? 0) <= 0) {
      violations.push("suppressed arm: its own event stream is empty, so `no marker` is indistinguishable from `never ran`");
    }
    requireArmSucceeded("suppressed", suppressed);
    // ★★★ DEP-025 finding (a) — PER STREAM, NOT THROUGH THE AND-COLLAPSED `injectionFired`.
    //
    // THE CLASS: *a per-stream requirement enforced through the AND-collapsed `injectionFired`
    // instead of over each stream's own observation, in the polarity where "ANY marker is a
    // violation" — where the collapse is permissive rather than merely imprecise.*
    //
    // This hole was opened by DEP-024's OWN round-2 fix (E.1(a): the first place to look for a class
    // is the code you just wrote). Making `injectionFired` the conjunction of both streams closed a
    // false pass on the GRADED arm and, in the same stroke, made `suppressed.injectionFired !== false`
    // unable to see a suppressed arm carrying its own nonce-tagged marker on exactly ONE stream:
    // `true && false === false`, so nothing was raised. But such a marker bears THIS arm's nonce and
    // the plant was withheld, so it already proves that something other than this case's injection
    // can generate the evidence — which is the entire property the suppressed arm exists to exclude.
    //
    // The AND-collapse is kept BELOW as a backstop for a row whose `injectionFired` was computed
    // some other way; it is no longer the thing that decides.
    for (const stream of declared) {
      const observed = suppressed.scrubberMarkerObservedOnStream?.[stream];
      if (observed === true) {
        violations.push(
          `suppressed arm: the scrubber's marker was observed on stream ${JSON.stringify(stream)} while the plant was ` +
          "WITHHELD — a marker carrying THIS arm's own nonce means something other than this case's injection can " +
          "generate the evidence, and the case proves nothing",
        );
      } else if (observed !== false) {
        violations.push(
          `suppressed arm: stream ${JSON.stringify(stream)} reported no marker observation ` +
          `(${JSON.stringify(observed ?? null)}) — an unreported stream is REFUSED rather than read as clean`,
        );
      }
    }
    if (suppressed.injectionFired !== false) {
      violations.push(
        `suppressed arm: recorded injectionFired=${JSON.stringify(suppressed.injectionFired ?? null)} — ` +
        "a marker observed while the plant was withheld means the marker is not produced by this case's injection",
      );
    }
    if (suppressed.redactedOnAllStreams !== true) {
      violations.push("suppressed arm: a canary appeared on a stream although nothing planted it");
    }
    // ★ THE TWIN, fixed with it. This is what becomes the matrix row's `positiveControlPassed`, so
    // the AND-collapse here would have reported a PASSING positive control on the very observation
    // the loop above refuses — a known twin left behind is worse than the original defect.
    summary.suppressedUnfired =
      suppressed.injectionFired === false
      && declared.every((stream) => suppressed.scrubberMarkerObservedOnStream?.[stream] === false);
  }

  return { violations, summary };
}

/**
 * The matrix row this phase files, in the shape `evaluateFaultMatrixEvidence` grades.
 *
 * ★★★ THE REFUSAL MUST NOT LIVE ONLY IN THE THROWING PROCESS (Codex round 1 on PR #608 — verified at
 * source before acceptance, and the finding was right).
 *
 * THE CLASS: *a fact asserted in one process, while the DURABLE record it retains stays pass-shaped
 * for a different consumer that grades it later.* `journey.mjs`'s `redaction` phase deliberately
 * retains `cases: observations?.rows ?? error?.rows ?? []` — so a run refused by
 * `evaluateRedactionProbeEvidence` for a non-succeeded attempt still writes a row to
 * `redaction-observations.json` — and a LATER, SEPARATE `fault-matrix` invocation folds that row
 * without re-running this judge: `evaluateFaultMatrixEvidence` inspects `injectionFired`,
 * `observedClassification`, `redactedOnAllStreams`, the stream bytes and `positiveControlPassed`, and
 * nothing about an attempt status. A pass-shaped row would then CONTRADICT the refusal that produced
 * it, and the failed setup would be ungradeable from the artifact alone.
 *
 * ★ And this is finding (b)'s OWN class pointed at my own diff (E.1(a)): asserting the status in the
 * judge and leaving the row untouched is the same shape as reading the status and never asserting it.
 * So the status is now BOTH carried on the row (so a standalone consumer can see it) AND allowed to
 * degrade the fields that would otherwise read as a pass.
 *
 * ★★★ AND THE PROPERTY HOLDS FOR THE GRADED ARM ONLY — stated here rather than left for a reader to
 * assume, because the surrounding prose reads as if it were complete. A SUPPRESSED-arm failure
 * (non-`succeeded`, or a marker on one stream) clears only `positiveControlPassed`, and
 * `evaluateFaultMatrixEvidence`'s `family === "redaction"` branch NEVER READS that field: measured at
 * source, it is read only in the `credential` branch and the `tenantCase` branch. So an artifact-only
 * verdict still passes on that half. That is Codex round 3 on PR #608, verified and HANDED TO THE
 * PLANNING SESSION under rule C's two-round cap — the phase itself still refuses, so an end-to-end
 * keyed run reds, and the case is `pending` so the row cannot enter a graded bundle meanwhile. Two
 * candidate fixes are in `DEP-025-result.md` §11; the general one reds the `required` D1 case.
 *
 * `redactedOnAllStreams` is deliberately left as the RAW observation: the streams really were scanned
 * and really were clean, and forcing it to `false` would make the bundle claim a LEAK — a diagnosis
 * the run does not support, and one whose stated remedy is "revert the surface". `injectionFired`
 * going false is what stops the row passing (`evidence:injection_did_not_fire`), and the
 * classification names the real cause.
 */
export function redactionProbeMatrixRow(graded, detail) {
  const gradedAttemptStatus = typeof graded?.attemptStatus === "string" ? graded.attemptStatus : null;
  const suppressedAttemptStatus = typeof detail?.suppressedAttemptStatus === "string" ? detail.suppressedAttemptStatus : null;
  const gradedSucceeded = gradedAttemptStatus === REDACTION_PROBE_REQUIRED_ATTEMPT_STATUS;
  // FAIL-CLOSED on both: an absent status is refused, never read as succeeded.
  const suppressedSucceeded = suppressedAttemptStatus === REDACTION_PROBE_REQUIRED_ATTEMPT_STATUS;
  return {
    case: REDACTION_PROBE_CASE,
    injectionFired: gradedSucceeded && graded?.injectionFired === true,
    observedClassification: gradedSucceeded
      ? (graded?.observedClassification ?? "no_scrubber_marker_observed")
      : redactionAttemptFailureClassification(gradedAttemptStatus),
    // Carried on the ROW, not only in `detail`, so a consumer reading the retained artifact sees the
    // fact that refused the run without having to know this module's detail shape.
    gradedAttemptStatus,
    suppressedAttemptStatus,
    redactedOnAllStreams: graded?.redactedOnAllStreams === true,
    scrubberMarkerObservedOnStream: {
      events: graded?.scrubberMarkerObservedOnStream?.events === true,
      logs: graded?.scrubberMarkerObservedOnStream?.logs === true,
    },
    streamBytesObserved: {
      events: Number(graded?.streamBytesObserved?.events ?? 0),
      logs: Number(graded?.streamBytesObserved?.logs ?? 0),
    },
    // The same positive-control field the cross-tenant rows carry: here it is the SUPPRESSED arm —
    // which must ALSO have succeeded, or its "no marker" is a failed setup rather than a working
    // suppression, and the row would certify a control that never ran.
    positiveControlPassed: suppressedSucceeded && detail?.suppressedUnfired === true,
    suppressedArmEvidence: {
      attemptStatus: suppressedAttemptStatus,
      observedOnStream: {
        events: detail?.suppressedObservedOnEvents === true,
        logs: detail?.suppressedObservedOnLogs === true,
      },
      scrubberMarkerObservedOnStream: {
        events: detail?.suppressedMarkerOnEvents === true,
        logs: detail?.suppressedMarkerOnLogs === true,
      },
    },
    detail: detail ?? {},
  };
}
