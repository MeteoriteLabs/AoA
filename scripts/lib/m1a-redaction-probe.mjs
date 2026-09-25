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

  if (!graded || typeof graded !== "object") {
    violations.push("the GRADED arm produced no row — the phase cannot claim a case it did not observe");
  } else {
    for (const v of graded.vacuity ?? []) violations.push(`graded arm: ${v}`);
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
    if (suppressed.injectionFired !== false) {
      violations.push(
        `suppressed arm: recorded injectionFired=${JSON.stringify(suppressed.injectionFired ?? null)} — ` +
        "a marker observed while the plant was withheld means the marker is not produced by this case's injection",
      );
    }
    if (suppressed.redactedOnAllStreams !== true) {
      violations.push("suppressed arm: a canary appeared on a stream although nothing planted it");
    }
    summary.suppressedUnfired = suppressed.injectionFired === false;
  }

  return { violations, summary };
}

/** The matrix row this phase files, in the shape `evaluateFaultMatrixEvidence` grades. */
export function redactionProbeMatrixRow(graded, detail) {
  return {
    case: REDACTION_PROBE_CASE,
    injectionFired: graded?.injectionFired === true,
    observedClassification: graded?.observedClassification ?? "no_scrubber_marker_observed",
    redactedOnAllStreams: graded?.redactedOnAllStreams === true,
    scrubberMarkerObservedOnStream: {
      events: graded?.scrubberMarkerObservedOnStream?.events === true,
      logs: graded?.scrubberMarkerObservedOnStream?.logs === true,
    },
    streamBytesObserved: {
      events: Number(graded?.streamBytesObserved?.events ?? 0),
      logs: Number(graded?.streamBytesObserved?.logs ?? 0),
    },
    // The same positive-control field the cross-tenant rows carry: here it is the SUPPRESSED arm.
    positiveControlPassed: detail?.suppressedUnfired === true,
    detail: detail ?? {},
  };
}
