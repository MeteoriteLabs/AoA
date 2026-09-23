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
// written to stdout — the surface GitHub publishes — through `redactKeyMaterialLine`, which
// replaces a line carrying key material with a marker naming its shape. A `::add-mask::` line
// passes through unchanged: it is the masking mechanism.
//
// It is a pure consumer: it never fails the pipeline. The producer's exit status is preserved by
// `pipefail` (the job declares `shell: bash`), which the workflow-shape guard enforces.
// -----------------------------------------------------------------------------

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

import { redactKeyMaterialLine } from "../lib/m1-shipped-boot.mjs";

const capturePath = process.argv[2];
if (!capturePath) {
  console.error("usage: log-filter.mjs <capture-file>");
  process.exit(2);
}
mkdirSync(path.dirname(capturePath), { recursive: true });

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  // RAW to the capture file (what the leak scan reads) …
  try {
    appendFileSync(capturePath, `${line}\n`);
  } catch {
    // A capture failure must not swallow the phase's output: the scan will then find no job log
    // and say so, which is visible, rather than silently dropping the line from both surfaces.
  }
  // … REDACTED to the published Actions log.
  process.stdout.write(`${redactKeyMaterialLine(line)}\n`);
});
