#!/usr/bin/env node
// -----------------------------------------------------------------------------
// DEP-015 — the job-log filter: capture RAW, publish REDACTED.
//
//   <phase> 2>&1 | node scripts/m1-shipped-boot/log-filter.mjs "$M1_OUT/job-log.txt"
//
// It replaces a plain `tee` (Codex P1, PR #574). `trackSecret` masks every REGISTERED secret, but
// masking cannot cover a key this job did not generate — a re-run's, an operator's — and the
// leak scan runs after the phases, by which time a published Actions log cannot be retracted.
//
// So each line is written to the capture file VERBATIM, which is what the leak scan judges, and
// written to stdout — the surface GitHub publishes — through `createLineRedactor`, which replaces
// a line carrying key material, and every line of a PEM BLOCK (a re-wrapped PEM splits the DER
// prefix across lines, so per-line matching alone would forward the body), with a marker naming
// its shape. A `::add-mask::` line passes through unchanged: it is the masking mechanism.
//
// It is a pure consumer: it never fails the pipeline. The producer's exit status is preserved by
// `pipefail` (the job declares `shell: bash`), which the workflow-shape guard enforces.
// -----------------------------------------------------------------------------

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import { createLineRedactor } from "../lib/m1-shipped-boot.mjs";

const capturePath = process.argv[2];
if (!capturePath) {
  console.error("usage: log-filter.mjs <capture-file>");
  process.exit(2);
}

/**
 * Fail closed, and leave a DURABLE trace of it.
 *
 * ★ Exiting non-zero is not enough (Codex P1, PR #574): the step that fails may be the best-effort
 * COLLECT step, while the leak scan runs `if: always()` and the upload is gated on the SCAN. A
 * truncated job log would then read clean and ship. The marker beside the capture makes the scan
 * refuse, whichever step the failure happened in.
 */
function captureFailed(err, where) {
  const code = err && err.code ? err.code : "unknown";
  try {
    writeFileSync(`${capturePath}.capture-failed`, `${where}: ${code}\n`);
  } catch {
    // The marker is a second line of defence; its own failure must not mask the first.
  }
  process.stdout.write(
    `::error::DEP-015 log-filter: the job-log capture failed (${code}); the log surface would be incomplete\n`,
  );
  process.exit(1);
}
try {
  mkdirSync(path.dirname(capturePath), { recursive: true });
} catch (err) {
  // Same fail-closed rule as the per-line write: a capture directory that cannot exist means no
  // log surface, and the leak scan would read that absence as clean.
  captureFailed(err, "mkdir");
}

// ★ INTACTNESS SENTINELS (Codex P1, PR #574). A filter that dies WITHOUT reaching `captureFailed`
// — OOM, SIGKILL, an uncaught throw — fails its own phase through `pipefail` but leaves no marker;
// the next phase's filter then appends happily, and the scan reads a log missing a stretch it can
// neither see nor suspect. So every invocation writes OPENED on start and CLOSED on a clean end of
// input, and the scan requires the two counts to match — which a killed filter breaks.
const OPENED = "[log-filter] opened";
const CLOSED = "[log-filter] closed";
try {
  appendFileSync(capturePath, `${OPENED}\n`);
} catch (err) {
  captureFailed(err, "open-sentinel");
}

// STATEFUL: a PEM block is redacted whole, because a re-wrapped PEM splits the DER prefix across
// lines and per-line matching alone would forward the body (Codex P1, PR #574).
const redact = createLineRedactor();
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  // RAW to the capture file (what the leak scan reads) …
  try {
    appendFileSync(capturePath, `${line}\n`);
  } catch (err) {
    // ★ FAIL CLOSED (Codex P1, PR #574). Swallowing this would leave the pipeline green while the
    // leak scan read an absent or truncated job log as clean — the lane would claim a log-surface
    // coverage it did not have. Exiting non-zero fails the step through `pipefail`, and the marker
    // makes the scan refuse even when the failing step is the best-effort one.
    captureFailed(err, "append");
  }
  // … REDACTED to the published Actions log.
  process.stdout.write(`${redact(line)}\n`);
});
rl.on("close", () => {
  // stdin ended normally: this invocation captured everything its producer wrote.
  try {
    appendFileSync(capturePath, `${CLOSED}\n`);
  } catch (err) {
    captureFailed(err, "close-sentinel");
  }
});
