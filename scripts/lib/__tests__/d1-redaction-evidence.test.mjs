import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateFaultMatrixEvidence } from "../campaign-fault-matrix.mjs";

const moduleUnderTest = await import("../d1-redaction-evidence.mjs").catch(() => ({}));

const NONCES = {
  graded: "graded-0123456789abcdef",
  suppressed: "withheld-0123456789abcdef",
};
const TAG = "AOA-RUN-OUTPUT-PROBE";
const MARKER = "«redacted»";

function arm(nonce, { attemptStatus = "succeeded", eventLine, logLine } = {}) {
  const controlCanary = `control-${nonce}`;
  const defaultLine = `${TAG} arm=${nonce} control=${controlCanary}`;
  return {
    nonce,
    controlCanary,
    attemptStatus,
    streams: {
      events: eventLine ?? defaultLine,
      logs: logLine ?? defaultLine,
    },
  };
}

test("DEP-027 exports the nonce-scoped D1 redaction evidence judge", () => {
  assert.equal(typeof moduleUnderTest.evaluateD1RedactionEvidence, "function");
});

test("DEP-027 both live arms retain the capability-bearing secret handle", () => {
  const source = readFileSync(new URL("../../../tests/d1/m1-fault-matrix.test.mjs", import.meta.url), "utf8");
  const runArm = source.slice(source.indexOf("const runArm ="), source.indexOf("const suppressed = runArm"));
  assert.match(runArm, /seedSecret:\s*true/);
  assert.doesNotMatch(runArm, /seedSecret:\s*plant/);
});

test("DEP-027 stale nonce lines cannot satisfy either arm", () => {
  const evaluate = moduleUnderTest.evaluateD1RedactionEvidence;
  assert.equal(typeof evaluate, "function");
  const result = evaluate({
    canary: "inert-canary",
    crossTenantCanaryAbsent: true,
    graded: arm(NONCES.graded, {
      eventLine: `${TAG} arm=stale-0123456789abcdef value=${MARKER}`,
      logLine: `${TAG} arm=stale-0123456789abcdef value=${MARKER}`,
    }),
    suppressed: arm(NONCES.suppressed),
  });
  assert.equal(result.row.injectionFired, false);
  assert.equal(result.row.scrubberMarkerObservedOnStream.events, false);
  assert.equal(result.row.scrubberMarkerObservedOnStream.logs, false);
});

test("DEP-027 missing per-stream suppressed evidence fails the retained control", () => {
  const result = moduleUnderTest.evaluateD1RedactionEvidence({
    canary: "inert-canary",
    crossTenantCanaryAbsent: true,
    graded: arm(NONCES.graded, {
      eventLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
      logLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
    }),
    suppressed: {
      ...arm(NONCES.suppressed),
      streams: { events: `${TAG} arm=${NONCES.suppressed} control=unseeded` },
    },
  });
  assert.equal(result.row.positiveControlPassed, false);
  assert.equal(result.row.suppressedArmEvidence.observedOnStream.logs, false);
});

test("DEP-027 a failed control terminal cannot pass", () => {
  const result = moduleUnderTest.evaluateD1RedactionEvidence({
    canary: "inert-canary",
    crossTenantCanaryAbsent: true,
    graded: arm(NONCES.graded, {
      eventLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
      logLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
    }),
    suppressed: arm(NONCES.suppressed, { attemptStatus: "failed" }),
  });
  assert.equal(result.row.positiveControlPassed, false);
  assert.equal(result.row.suppressedArmEvidence.attemptStatus, "failed");
});

test("DEP-027 a foreign-tenant canary leak makes the retained row fail", () => {
  const result = moduleUnderTest.evaluateD1RedactionEvidence({
    canary: "inert-canary",
    crossTenantCanaryAbsent: false,
    graded: arm(NONCES.graded, {
      eventLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
      logLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
    }),
    suppressed: arm(NONCES.suppressed),
  });
  assert.equal(result.row.crossTenantCanaryAbsent, false);
  assert.equal(result.row.redactedOnAllStreams, false);
  assert.equal(result.row.observedClassification, "canary_leaked_on_a_stream");
  const serialized = moduleUnderTest.serializeD1FaultMatrixRow("d1.redaction.planted_canary_scrubbed", result.row);
  assert.equal(serialized.crossTenantCanaryAbsent, false, "the actual bundle serializer must retain the refusal fact");
  const matrix = JSON.parse(readFileSync(new URL("../../../tests/d1/fault-matrix.json", import.meta.url), "utf8"));
  const verdict = evaluateFaultMatrixEvidence(matrix, { profile: "M1-D1-SPINE", cases: [serialized] });
  assert.ok(verdict.violations.some((v) => v.code === "evidence:redaction_cross_tenant_leak"));
});

test("DEP-027 the credential-free control must carry its inert canary verbatim on both streams", () => {
  const suppressed = arm(NONCES.suppressed);
  suppressed.streams.logs = `${TAG} arm=${NONCES.suppressed} control=wrong-inert-canary`;
  const result = moduleUnderTest.evaluateD1RedactionEvidence({
    canary: "inert-canary",
    crossTenantCanaryAbsent: true,
    graded: arm(NONCES.graded, {
      eventLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
      logLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
    }),
    suppressed,
  });
  assert.equal(result.row.positiveControlPassed, false);
  assert.deepEqual(result.row.suppressedArmEvidence.verbatimCanaryObservedOnStream, { events: true, logs: false });
});

for (const stream of ["events", "logs"]) {
  test(`DEP-027 a marker on the suppressed ${stream} stream fails independently`, () => {
    const suppressed = arm(NONCES.suppressed);
    suppressed.streams[stream] = `${TAG} arm=${NONCES.suppressed} value=${MARKER}`;
    const result = moduleUnderTest.evaluateD1RedactionEvidence({
      canary: "inert-canary",
      crossTenantCanaryAbsent: true,
      graded: arm(NONCES.graded, {
        eventLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
        logLine: `${TAG} arm=${NONCES.graded} value=${MARKER}`,
      }),
      suppressed,
    });
    assert.equal(result.row.positiveControlPassed, false);
    assert.equal(result.row.suppressedArmEvidence.scrubberMarkerObservedOnStream[stream], true);
  });
}
