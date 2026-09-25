// -----------------------------------------------------------------------------
// DEP-024 — the `M1a-D2-MECHANISM` E5 clause-5 (redaction) driver, on the SHIPPED BOOT lane.
//
// ── THE THREE THINGS THAT WERE MISSING, AND WHICH OF THEM THIS FILE IS ───────
// `d2m.redaction.planted_canary_scrubbed` stood `pending`/`structural` because THREE things were
// absent on this lane, measured by DEP-023 §7 after a Codex correction:
//   (1) DEPLOYMENT — `AOA_WORKER_RUN_OUTPUT_PROBE` was set in exactly ONE place in the repo, the D1
//       override, so the shipped-boot worker forwarded no probe line at all. Fixed in
//       `docker/m1-boot/docker-compose.m1-boot.yml`, held by `SHIPPED_BOOT_RUN_OUTPUT_PROBE_ENV`.
//   (2) PRODUCER — the only thing emitting a tagged line was the reference provider's
//       `--aoa-fake-echo-env`, which the real E2B lane does not run. Fixed HERE, and without any
//       product code: the case seeds its OWN worker-driven job, so it authors the TENANT COMMAND,
//       and that command is a `printf` of the run's own redeemed env var behind the probe tag.
//   (3) DRIVER — the assertion. Also here.
//
// ── ★★★ THE PLANTED VALUE IS NEVER A REAL PROVIDER KEY ──────────────────────
// This is the safety property, and it is a property of the SEED rather than of the scrubber. The
// case's job carries its own `job_secret_handles` row pointing at a Company secret this driver
// wrote seconds earlier, whose value is a high-entropy canary minted for this one arm. So the value
// the sandbox receives as `ANTHROPIC_API_KEY`, and therefore the value the workload echoes, is a
// token with NO authority anywhere: not the Organization's configured provider key, not the job
// secret the workflow holds, not anything that outlives the run. Echoing a live provider key into a
// third-party sandbox's stdout would put it into E2B's own service logs, which no scrubber of ours
// reaches — so the design does not rely on redaction for that, it never plants it.
//
// The redaction chain is nonetheless the thing under test, and every link of it was read at source
// for THIS lane rather than inherited from the D1 twin:
//   1. the echo's only channel out of the sandbox is `ExecuteInput.onStdout`;
//   2. on this lane that callback is the adapter-manager's `createRunOutputCapture`
//      (`executeRelayingStdout`), whose canaries are `Object.values(env)` — the planted value is
//      one of them — and which is FAIL-CLOSED: any surviving needle drops the WHOLE tail to `""`;
//   3. the daemon's own `createRunOutputCapture` scrubs the returned tail again with the run's LIVE
//      canary array, which `synthesiseRunSecrets` seeded with this same value;
//   4. `events`: `EventSequencer.#emit` runs `scrubEventStrings` over the COMPLETE envelope, below
//      every key, before the digest;
//   5. `logs`: `createRedactingDestination` scrubs the fully-serialized pino record, below the
//      `msg`/`time`/`level` the sink adds — which is what keeps the `E4-F019` collision class out
//      of this surface. Composed on THIS lane: the shipped workers enter
//      `bin/networked-host.js` → `runContainerHost` → `bootstrapWorkerDaemon`, which builds the
//      logger with `redactionCanaries: () => canaryCoordinator.snapshot()` and passes that same
//      coordinator to the dispatch runtime.
//
// ── BOTH ARMS, IN ONE RUN ────────────────────────────────────────────────────
// The SUPPRESSED arm runs FIRST and plants nothing; the GRADED arm runs second and plants the leak.
//
// ★ ORDER IS NO LONGER THE ATTRIBUTION ARGUMENT. It used to be: the container log is shared by every
// run on the stack, and this file once reasoned that a marked line seen during the graded arm could
// only have come from the graded job, while the suppressed arm's log check was not attributable at
// all (so it graded the per-job EVENT stream only). Nothing enforced that, and a repeated invocation
// or any other probe-producing job on the worker would have satisfied the graded log arm on a
// HISTORICAL line — a false pass on a gate clause, which the suppressed arm could not have caught
// precisely because it ignored the log arm (Codex round 2, PR #607). Attribution is now INTRINSIC:
// every probe line carries a per-arm nonce in its plaintext, and a line counts only when it carries
// the tag, the scrubber's marker AND that nonce. So BOTH arms now grade BOTH streams, and the
// suppressed arm can catch a stale marker — exactly the case it was blind to before.
//
// ── WHY NOT IN `cross-tenant.mjs` ───────────────────────────────────────────
// That phase runs in BOTH modes and its verdict refuses any row that did not fire. This case cannot
// fire in `keyless`: the adapter-manager is never started there, so no sandbox exists and nothing
// can echo anything. Folding it in would make the free keyless rehearsal permanently red for a
// reason that says nothing about redaction.
// -----------------------------------------------------------------------------

import { randomBytes, randomUUID } from "node:crypto";

import {
  REDACTION_PROBE_EVIDENCE_MARKER,
  classifyRedactionObservation,
  evaluateRedactionProbeEvidence,
  redactionProbeMatrixRow,
} from "../lib/m1a-redaction-probe.mjs";

export { REDACTION_PROBE_EVIDENCE_MARKER };

/** The phase's own refusal, carrying whatever rows it had gathered — the same shape
 * `CrossTenantError` uses, and for the same reason: on a refusal the rows ARE the evidence. */
class RedactionProbeError extends Error {
  constructor(message, { rows = [], detail = {} } = {}) {
    super(message);
    this.rows = rows;
    this.detail = detail;
  }
}

/**
 * ★ THE MINT-AND-SCRUB CHOKEPOINT (self-audit family 1, applied to my own diff first — E.1(a)).
 *
 * THE CLASS: *a failure path that puts a value this module minted into a durable record.* Every
 * canary here is minted locally, so `journey.mjs`'s `redactSecrets` — which knows only the JOB's
 * secrets — cannot catch it. So the boundary is enforced where the values exist: everything minted
 * is registered, and every refusal message goes through `scrub`.
 *
 * THE DUAL (E.1b), searched and reported although it found nothing: a SUCCESS path that records the
 * same value. Every field this module puts on a row is a boolean, a count or an id; no stream text
 * and no canary reaches `detail`, and `scripts/lib/__tests__/m1a-redaction-probe.test.mjs` asserts
 * that shape rather than trusting it.
 *
 * ★ AND THE CHOKEPOINT IS NOT SUFFICIENT ON ITS OWN, which Codex found and this module now says out
 * loud: it is PROCESS-LOCAL, while `collect` and `leak-scan` are separate processes reading the
 * journey's state file. Every canary is therefore ALSO registered with the journey's own ledger
 * before the seed (see `arm`). The two are complements, not alternatives: `minted` covers this
 * module's refusal text, the ledger covers every retained surface.
 */
const minted = new Set();

function mint(value) {
  if (typeof value === "string" && value.length >= 8) minted.add(value);
  return value;
}

function scrub(text) {
  return [...minted]
    .sort((a, b) => b.length - a.length)
    .reduce((acc, v) => acc.split(v).join("[REDACTED]"), String(text ?? ""));
}

function truncate(value, max = 1200) {
  const text = scrub(typeof value === "string" ? value : JSON.stringify(value));
  return text && text.length > max ? `${text.slice(0, max)}… [+${text.length - max} chars]` : text;
}

/** The D1 harness, resolved relative to THIS file (the same lazy import `cross-tenant.mjs` uses:
 * its stack binding is read from `process.env` at module load, and the caller sets that binding
 * immediately before calling in). */
function harnessUrl() {
  return new URL("../../tests/d1/lib/e6f-harness.mjs", import.meta.url).href;
}

/** How long a real E2B run of this workload is given to reach a durable terminal. Generous: it
 * covers sandbox create, stage-in, the DEP-017 env probe AND its planted control, then the
 * `printf`. A bound, not a hope — a timeout is judged by the verdict, never swallowed. */
const TERMINAL_TIMEOUT_MS = 600_000;

/**
 * Drive the clause-5 redaction case and return its matrix row.
 *
 * @param {object} opts
 * @param {object} opts.tenants     `state.tenants` — `{ a, b, c }`
 * @param {(sqlText: string, params: unknown[]) => any[]} opts.ownerSql
 * @param {string} opts.policyHash  the lane's own placement policy hash (ONE source, passed in)
 * @param {(name: string, value: string) => void} opts.registerSecret  the JOURNEY's own secret
 *   ledger (`trackSecret` + `saveState`). REQUIRED, and called BEFORE each arm is seeded — see the
 *   note on `arm` below.
 * @param {string} [opts.workerService] the compose service whose container log is the `logs` stream
 * @param {(line: string) => void} [opts.log]
 * @returns {Promise<{rows: object[], detail: object}>}
 */
export async function runRedactionProbeCases({
  tenants,
  ownerSql,
  policyHash,
  registerSecret,
  workerService = "m1-worker-a",
  log = console.log,
}) {
  const H = await import(harnessUrl());
  const fail = (message, carry) => {
    throw new RedactionProbeError(scrub(message), carry);
  };

  const A = { key: "a", ...tenants.a };
  const B = { key: "b", ...tenants.b };
  if (A.role !== "enabled" || B.role !== "enabled") {
    fail(`the redaction phase needs TWO enabled tenants (F10); got a=${A.role} b=${B.role}`);
  }
  if (A.organizationId === B.organizationId) fail("tenants a and b share an Organization — there is no cross-tenant arm to make");
  if (!/^[0-9a-f]{64}$/.test(String(policyHash))) fail(`the lane must pass its own 64-hex placement policy hash; got ${JSON.stringify(policyHash)}`);
  // ★ FAIL CLOSED ON A MISSING LEDGER. Without it the canary would be known only to this process,
  // and the whole point of registering it is the run where the mechanism under test FAILED.
  if (typeof registerSecret !== "function") {
    fail("the redaction phase requires the journey's `registerSecret` ledger: a canary known only to this process would survive `collect` and `leak-scan` on exactly the run where redaction failed");
  }

  // ── the executing tenant's ratified target, read rather than assumed ───────
  const [target] = ownerSql(
    `SELECT id, organization_id AS "organizationId", registered_profile_hash AS "profileHash",
            provider_constraint_profile->>'digest' AS "providerDigest",
            device_generation AS "generation", scope
       FROM execution_targets WHERE id = $1`,
    [A.targetId],
  );
  if (!target) fail(`tenant a has no execution target row for ${A.targetId}`);
  // ★ THE NARROWING IS ASSERTED, NOT TRUSTED. The cross-tenant arm below is only honest while the
  // executing target is dedicated to tenant A's Organization; if that ever stops being true the
  // case must be revisited rather than quietly kept (the shape DEP-023 measured on the D1 twin).
  if (target.organizationId !== A.organizationId) {
    fail(`tenant a's target ${A.targetId} belongs to ${target.organizationId}, not to ${A.organizationId} — this case's single-executing-tenant narrowing must be revisited`);
  }
  if (!/^[0-9a-f]{64}$/.test(String(target.profileHash)) || !/^[0-9a-f]{64}$/.test(String(target.providerDigest))) {
    fail(`tenant a's target is not ratified (profileHash/providerDigest): ${truncate(target)}`);
  }

  /** Unwrap a dexec result or fail with the (scrubbed) container output. */
  const step = (res, label) => {
    if (res?.result === null || res?.result === undefined) {
      fail(`${label}: no result parsed (exit=${res?.status ?? "?"})\n--- stdout ---\n${truncate(res?.stdout)}\n--- stderr ---\n${truncate(res?.stderr, 800)}`);
    }
    return res.result;
  };

  /**
   * A line of THIS ARM's probe output: it carries the probe tag, the scrubber's OWN replacement
   * marker, AND this arm's nonce.
   *
   * ★★★ THE NONCE IS WHAT MAKES THE LOG ARM ATTRIBUTABLE (Codex round 2, PR #607 — verified at
   * source before accepting it). `composeServiceLogs` returns the WHOLE `m1-worker-a` container log,
   * every run the stack has done. Without the nonce a historical tagged+marked line — from a
   * repeated phase invocation, or any other probe-producing job on that worker — satisfies the graded
   * log arm while THIS job's line never arrives, and the run reports that both streams scrubbed a job
   * whose line never reached the sink. Ordering the arms does not fix that: it is an argument about
   * what usually happens, and nothing enforces it.
   *
   * The nonce is NOT a secret and is deliberately NOT registered with the ledger: masking it would
   * remove the very token the attribution depends on. It is 8 random bytes of hex per arm, carried in
   * the probe line's plaintext beside the scrubbed value.
   */
  const markedProbeLine = (text, nonce) =>
    String(text ?? "")
      .split(/\r?\n/)
      .some((line) =>
        line.includes(H.RUN_OUTPUT_PROBE_TAG) && line.includes(H.REDACTION_MARKER) && line.includes(`arm=${nonce}`));

  /**
   * One arm: seed a worker-driven job for tenant A with its own canary as the redeemed value, let
   * the DEPLOYED worker run it in a REAL sandbox, then read both declared streams.
   *
   * `plant` decides the TENANT COMMAND and nothing else. Withholding the plant is the suppression:
   * everything else — the seed, the handle, the redemption, the sandbox, the probe flag — is
   * identical, so the two arms differ in exactly the fact under test.
   */
  const arm = ({ label, plant }) => {
    const nonce = randomBytes(6).toString("hex");
    const canary = mint(`d2mcanary${randomBytes(20).toString("hex")}`);
    // ★★★ REGISTERED WITH THE JOURNEY BEFORE IT CAN EXIST ANYWHERE ELSE (Codex P2, PR #607, and the
    // finding was right — verified at source).
    //
    // THE CLASS: *a value this lane mints that is never registered with the journey's secret ledger,
    // yet has a path to a RETAINED surface.* The local `minted` set above covers this module's own
    // refusal messages and nothing else. `collect` and `leak-scan` run in SEPARATE PROCESSES that
    // read `state.secrets` / `state.redact` off the state file; `collect` copies the worker container
    // logs into the evidence bundle under `if: always()`, and `leak-scan` searches for NAMED secrets
    // plus key material BY SHAPE — and `d2mcanary…` matches neither. So on the one run that matters
    // most, the run where the redaction mechanism under test FAILED and the raw canary reached the
    // worker log, the bundle would have been uploaded carrying the exact value the case was testing.
    //
    // Registering it here, BEFORE the seed writes it as a Company secret and long before any sandbox
    // can echo it, puts it into `state.redact` (so every retained log is scrubbed), into
    // `state.secrets` (so the pre-upload scan searches for it on BOTH surfaces, in raw, base64 and
    // base64url form) and behind an `::add-mask::` directive in the Actions log.
    registerSecret(`REDACTION_CANARY_${label.toUpperCase()}_${nonce}`, canary);
    const ids = {
      issueId: randomUUID(),
      runId: randomUUID(),
      jobId: randomUUID(),
      attemptId: randomUUID(),
      handleId: randomUUID(),
    };
    // ★ The plant echoes the ENV VAR, never the literal: the value in the sandbox is the one the
    // worker redeemed through `synthesiseRunSecrets`, which is what puts it into the run's canary
    // array. A literal would prove the scrubber can remove a string the harness chose, not that it
    // removes what the run redeemed.
    // The per-arm attribution token. Plaintext, not a secret, never registered (see
    // `markedProbeLine`): it must survive the scrub, which is the whole point of it.
    const armNonce = `${label}${randomBytes(8).toString("hex")}`;
    const workloadArgs = plant
      ? ["-c", `printf '${H.RUN_OUTPUT_PROBE_TAG} arm=${armNonce} canary=%s\\n' "$ANTHROPIC_API_KEY"`]
      : ["-c", `printf 'd2m-redaction arm=${armNonce}: the plant is WITHHELD on this arm\\n'`];
    const seeded = step(
      H.seedSpineWorkerDrivenJob({
        tenant: A,
        ...ids,
        target: { profileHash: target.profileHash, providerDigest: target.providerDigest, generation: target.generation },
        targetId: A.targetId,
        policyHash,
        command: "sh",
        workloadArgs,
        secretName: `provider:d2m-redaction-${label}-${nonce}`,
        secretValue: canary,
      }),
      `${label} canary job seed`,
    );
    if (seeded.ok !== true) fail(`${label} canary job seed: ${truncate(seeded)}`);

    const observation = step(H.awaitSpineWorkerDrivenTerminal({ jobId: ids.jobId, timeoutMs: TERMINAL_TIMEOUT_MS }), `${label} terminal`);
    const events = step(H.queryJobEventPayloadText({ jobId: ids.jobId }), `${label} event stream`);
    const logs = H.composeServiceLogs(workerService);
    const foreign = step(H.queryOrganizationEventText({ organizationId: B.organizationId }), `${label} cross-tenant event stream`);
    if (events.ok !== true) fail(`${label} event stream read: ${truncate({ ok: events.ok, error: events.error ?? null })}`);
    if (logs.ok !== true) fail(`${label} worker log read: exit=${logs.status}`);
    if (foreign.ok !== true) fail(`${label} cross-tenant event stream read: ${truncate({ ok: foreign.ok, error: foreign.error ?? null })}`);

    const row = classifyRedactionObservation({
      markerOnEvents: markedProbeLine(events.text, armNonce),
      markerOnLogs: markedProbeLine(logs.text, armNonce),
      ownEventsClean: !String(events.text ?? "").includes(canary),
      logsClean: !String(logs.text ?? "").includes(canary),
      crossTenantClean: !String(foreign.text ?? "").includes(canary),
      eventBytes: events.bytes ?? 0,
      logBytes: logs.bytes ?? 0,
      foreignBytes: foreign.bytes ?? 0,
    });
    log(
      `redaction: arm=${label} plant=${plant} attempt=${observation.attemptStatus ?? "none"} ` +
      `events=${events.events ?? 0} fired=${row.injectionFired} class=${row.observedClassification}`,
    );
    return {
      row,
      facts: {
        arm: label,
        planted: plant,
        armNonce,
        jobId: ids.jobId,
        attemptStatus: observation.attemptStatus ?? null,
        eventCount: Number(events.events ?? 0),
        crossTenantEventCount: Number(foreign.events ?? 0),
        crossTenantBytes: Number(foreign.bytes ?? 0),
        crossTenantCanaryAbsent: !String(foreign.text ?? "").includes(canary),
      },
    };
  };

  // SUPPRESSED FIRST — see the header: it is what makes the graded arm's log evidence attributable.
  const suppressed = arm({ label: "suppressed", plant: false });
  const graded = arm({ label: "graded", plant: true });

  const { violations, summary } = evaluateRedactionProbeEvidence({ graded: graded.row, suppressed: suppressed.row });
  const detailFacts = {
    executingTenant: A.key,
    crossTenant: B.key,
    organizationId: A.organizationId,
    executingTargetId: A.targetId,
    executingTargetScope: String(target.scope ?? ""),
    workerService,
    gradedJobId: graded.facts.jobId,
    gradedAttemptStatus: graded.facts.attemptStatus,
    gradedEventCount: graded.facts.eventCount,
    suppressedJobId: suppressed.facts.jobId,
    suppressedAttemptStatus: suppressed.facts.attemptStatus,
    suppressedEventCount: suppressed.facts.eventCount,
    suppressedFired: suppressed.row.injectionFired,
    suppressedUnfired: summary.suppressedUnfired,
    crossTenantEventCount: graded.facts.crossTenantEventCount,
    crossTenantCanaryAbsent: graded.facts.crossTenantCanaryAbsent,
  };
  const rows = [redactionProbeMatrixRow(graded.row, detailFacts)];
  const detail = { arms: { graded: graded.facts, suppressed: suppressed.facts }, summary };

  if (violations.length > 0) {
    for (const v of violations) log(`${REDACTION_PROBE_EVIDENCE_MARKER} ${v}`);
    fail(`the redaction phase refuses its own observations:\n${violations.map((v) => `  - ${v}`).join("\n")}`, { rows, detail });
  }
  log(
    `redaction: the planted canary is SCRUBBED from both declared streams, the scrubber's own marker ` +
    `is observed on a line carrying this run's probe tag on BOTH, and the withheld-plant arm produced ` +
    `no marker (${summary.streams.join(" + ")})`,
  );
  return { rows, detail };
}

export { RedactionProbeError };
