export const D1_REDACTION_STREAMS = Object.freeze(["events", "logs"]);
export const D1_REDACTION_REQUIRED_ATTEMPT_STATUS = "succeeded";

const RUN_OUTPUT_PROBE_TAG = "AOA-RUN-OUTPUT-PROBE";
const REDACTION_MARKER = "«redacted»";

function scopedLines(text, nonce) {
  const token = ` arm=${nonce} `;
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => line.includes(RUN_OUTPUT_PROBE_TAG) && line.includes(token));
}

function observeArm(arm) {
  const observedOnStream = {};
  const scrubberMarkerObservedOnStream = {};
  const streamBytesObserved = {};
  const canaryAbsentOnStream = {};
  for (const stream of D1_REDACTION_STREAMS) {
    const lines = scopedLines(arm?.streams?.[stream], arm?.nonce);
    const scoped = lines.join("\n");
    observedOnStream[stream] = lines.length > 0;
    scrubberMarkerObservedOnStream[stream] = lines.some((line) => line.includes(REDACTION_MARKER));
    streamBytesObserved[stream] = Buffer.byteLength(scoped, "utf8");
    canaryAbsentOnStream[stream] = !String(arm?.streams?.[stream] ?? "").includes(arm?.canary ?? "\0");
  }
  return {
    attemptStatus: arm?.attemptStatus ?? null,
    observedOnStream,
    scrubberMarkerObservedOnStream,
    streamBytesObserved,
    canaryAbsentOnStream,
  };
}

export function evaluateD1RedactionEvidence({ canary, graded, suppressed }) {
  const gradedEvidence = observeArm({ ...graded, canary });
  const suppressedEvidence = observeArm(suppressed);
  const gradedSucceeded = gradedEvidence.attemptStatus === D1_REDACTION_REQUIRED_ATTEMPT_STATUS;
  const suppressedSucceeded = suppressedEvidence.attemptStatus === D1_REDACTION_REQUIRED_ATTEMPT_STATUS;
  const gradedObserved = D1_REDACTION_STREAMS.every((stream) => gradedEvidence.observedOnStream[stream] === true);
  const gradedMarked = D1_REDACTION_STREAMS.every(
    (stream) => gradedEvidence.scrubberMarkerObservedOnStream[stream] === true,
  );
  const gradedClean = D1_REDACTION_STREAMS.every((stream) => gradedEvidence.canaryAbsentOnStream[stream] === true);
  const suppressedObserved = D1_REDACTION_STREAMS.every(
    (stream) => suppressedEvidence.observedOnStream[stream] === true,
  );
  const suppressedClean = D1_REDACTION_STREAMS.every(
    (stream) => suppressedEvidence.scrubberMarkerObservedOnStream[stream] === false,
  );
  const injectionFired = gradedSucceeded && gradedObserved && gradedMarked;
  const positiveControlPassed = suppressedSucceeded && suppressedObserved && suppressedClean;

  return {
    row: {
      injectionFired,
      observedClassification: !gradedSucceeded
        ? `redaction_probe_attempt_${gradedEvidence.attemptStatus ?? "missing"}`
        : injectionFired && gradedClean
          ? "canary_scrubbed_while_unseeded_twin_leaks"
          : injectionFired
            ? "canary_leaked_on_a_stream"
            : "no_scrubber_marker_observed",
      attemptStatus: gradedEvidence.attemptStatus,
      redactedOnAllStreams: gradedClean,
      scrubberMarkerObservedOnStream: gradedEvidence.scrubberMarkerObservedOnStream,
      streamBytesObserved: gradedEvidence.streamBytesObserved,
      positiveControlPassed,
      suppressedArmEvidence: suppressedEvidence,
    },
    gradedEvidence,
    suppressedEvidence,
  };
}
