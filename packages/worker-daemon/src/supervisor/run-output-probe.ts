/**
 * DEP-023 — the RUN OUTPUT REDACTION PROBE: the narrow, opt-in observation surface that makes the
 * E5 audit matrix's clause 5 (redaction) provable on a live lane.
 *
 * ── Why anything new is needed at all ────────────────────────────────────────
 * Redaction on the run-output path WORKS and is applied twice, but nothing downstream can SEE it,
 * so clause 5 had no floor on either lane. Measured link by link at this revision:
 *   1. an echo's only channel out of a sandbox is `ExecuteInput.onStdout`
 *      (`supervisor/provider.ts`, the per-op port);
 *   2. on the networked lane that callback IS `createRunOutputCapture`, composed by
 *      `executeRelayingStdout` (`packages/adapter-manager/src/server.ts`), whose canaries are
 *      `Object.values(env)` — so a planted credential is one of them — and which returns only the
 *      SCRUBBED `stdoutTail`;
 *   3. the daemon's own `createRunOutputCapture` (`supervisor/supervisor.ts`, the `output` capture
 *      around `execute`) scrubs that tail AGAIN with the run's own canaries, before `observeRun`;
 *   4. the tail's only consumer was `createUsageObserver`, which returns four integers and never
 *      populated `obs.logs` — the one field the supervisor turns into a `log` EVENT;
 *   5. the diagnostic log that would have carried it was built and then DROPPED by the M1 planning
 *      session under ruling F2 (2026-09-23), filed as `E4-F019`.
 * So the scrubber's marker terminated in an integer parser and reached neither declared stream.
 * This module restores the SAFE half of that surface.
 *
 * ── What it carries, and what it refuses to carry ────────────────────────────
 * ★★★ NOT the run's output. `WRK-018` acceptance 1(c) records that emitting the run's result line
 * would push tenant MODEL OUTPUT across the daemon boundary and would pre-empt the open **F7**
 * output-mechanism decision. So this surface is deliberately NOT an output channel:
 *   - only lines that begin with the fixed {@link RUN_OUTPUT_PROBE_TAG} are selected — a workload
 *     opts a line IN, byte by byte, and nothing else is ever forwarded;
 *   - at most {@link RUN_OUTPUT_PROBE_MAX_LINES} such line per run;
 *   - truncated to {@link RUN_OUTPUT_PROBE_MAX_CHARS} (surrogate-safe);
 *   - and the whole surface is OFF unless the daemon was booted with
 *     `AOA_WORKER_RUN_OUTPUT_PROBE=1` (the same shape `DEP-017`'s env probe uses). Without the
 *     flag the observer is byte-identical to before.
 *
 * ── Why surfacing it carries no secret (the safety argument, PROVEN not inherited) ──
 * The input to {@link selectRunOutputProbeLines} is `RunOutputObservation.stdoutTail`, which is the
 * return of `createRunOutputCapture.close()`. That value is `scrubOutputText`'s output, which is
 * FAIL-CLOSED: if any needle survives scrubbing, the WHOLE tail is dropped to `""` and the drop is
 * counted (`RUN_OUTPUT_DROPPED_METRIC{reason:"unscrubbable"}`). So a tail carrying a live canary
 * cannot exist. On the networked lane that has happened TWICE by the time it gets here (link 2 and
 * link 3 above), with the second scrub reading the run's own canary array LIVE.
 *
 * ★★★ AND THE `E4-F019` SINK-COLLISION CLASS IS NOT REACHABLE THROUGH THIS SURFACE. That finding is
 * about `createWorkerLogger`'s SINK adding `msg`/`time`/`level` BELOW any caller-side scrub, so a
 * secret equal to a structural token is emitted verbatim. Both of this surface's destinations put
 * their scrubber at the TRANSPORT boundary, below every key any sink adds:
 *   - the `events` stream: `EventSequencer.#emit` assembles the COMPLETE envelope and then runs
 *     `scrubEventStrings` over every string leaf of it, before the digest and the schema parse.
 *     Nothing is added afterwards but `eventDigest`, a hex digest OF the scrubbed bytes.
 *   - the `logs` stream: `createRedactingDestination` (`logging/redacting-destination.ts`) scrubs
 *     the fully-serialized pino record, after the sink has added its keys. That is closure route 2
 *     of `E4-F019`, and it is what makes this line safe to write at all.
 * A surface that wrote through `createWorkerLogger` WITHOUT that destination would re-create the
 * defect the F2 drop was protecting against, which is why this module does not ship alone.
 *
 * Runtime imports: relative modules only — the E4-D01 boundary.
 */

/** The fixed line prefix a workload uses to opt ONE line into the probe surface. Deliberately
 * outside any plausible secret alphabet and outside the `--aoa-fake-` scripting namespace. */
export const RUN_OUTPUT_PROBE_TAG = "AOA-RUN-OUTPUT-PROBE";

/** At most one tagged line per run reaches the surface. A bound, not a convenience: the point is a
 * redaction OBSERVATION, and every additional line is more of a channel for no more proof. */
export const RUN_OUTPUT_PROBE_MAX_LINES = 1;

/** The per-line ceiling, in UTF-16 code units. Far above the tagged line the reference provider
 * writes, far below anything that would make this an output mechanism. */
export const RUN_OUTPUT_PROBE_MAX_CHARS = 512;

/** The fixed message the probe line is logged under, so a lane can grep for it. A CONSTANT: it is
 * never derived from run output. */
export const RUN_OUTPUT_PROBE_LOG_MESSAGE = "worker: run output redaction probe";

/** Truncate without bisecting a surrogate pair (the same rule `EventSequencer` applies, applied
 * here too so the bound is enforced before the event layer rather than only by it). */
function truncateSurrogateSafe(text: string, max: number): string {
  if (text.length <= max) return text;
  const sliced = text.slice(0, max);
  const last = sliced.charCodeAt(sliced.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? sliced.slice(0, -1) : sliced;
}

export interface RunOutputProbeOptions {
  readonly maxLines?: number;
  readonly maxChars?: number;
}

/**
 * Select the tagged lines of an ALREADY-SCRUBBED stdout tail.
 *
 * ★ The contract is the caller's: `stdoutTail` must be `createRunOutputCapture.close()`'s output,
 * never a raw stream. This function performs NO scrubbing and must never be handed unscrubbed
 * text — it is a selector, and saying so is the point of this note.
 *
 * A line is selected only when it STARTS with {@link RUN_OUTPUT_PROBE_TAG} — leading whitespace is
 * not trimmed first, because trimming would let a line the workload never opted in be admitted by
 * an accident of formatting. `\r` is stripped from a CRLF stream so the tag test and the retained
 * text agree on one line grammar.
 */
export function selectRunOutputProbeLines(
  stdoutTail: string,
  options: RunOutputProbeOptions = {},
): readonly string[] {
  const maxLines = options.maxLines ?? RUN_OUTPUT_PROBE_MAX_LINES;
  const maxChars = options.maxChars ?? RUN_OUTPUT_PROBE_MAX_CHARS;
  if (typeof stdoutTail !== "string" || stdoutTail.length === 0 || maxLines <= 0 || maxChars <= 0) return [];
  const out: string[] = [];
  for (const raw of stdoutTail.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line.startsWith(RUN_OUTPUT_PROBE_TAG)) continue;
    out.push(truncateSurrogateSafe(line, maxChars));
    if (out.length >= maxLines) break;
  }
  return out;
}
