#!/usr/bin/env node
// -----------------------------------------------------------------------------
// DEP-022 — the SUPPRESSED run's per-case verdict.
//
// The shipped-boot lane's positive control runs the `cross-tenant` phase with every hostile act
// suppressed and requires it to go RED. Two greps proved the red came from the injection rather
// than from a bring-up failure — but "at least one `injection_did_not_fire`" is the same defect as
// "at least one test ran" (Codex P1, PR #600, round 4). One case quietly executing its hostile arm
// during suppression would have left both greps matching and that case's non-vacuity undemonstrated.
//
// So this checker asserts, per case, against a SECOND source: every case the DECLARATION marks
// `required` and the cross-tenant driver owns must be present in the suppressed bundle with
// `injectionFired: false`. Flipping a new case to `required` puts it under this check automatically.
//
// Usage: node scripts/check-cross-tenant-suppression.mjs --evidence <cross-tenant-suppressed.json>
// -----------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FAULT_MATRIX_PATH } from "./lib/campaign-fault-matrix.mjs";
import { D2M_PROFILE, evaluateSuppressedRun } from "./lib/d2m-cross-tenant.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const evidencePath = arg("--evidence");
if (!evidencePath) {
  console.error("usage: node scripts/check-cross-tenant-suppression.mjs --evidence <cross-tenant-suppressed.json>");
  process.exit(2);
}

const matrix = JSON.parse(readFileSync(path.join(repoRoot, FAULT_MATRIX_PATH), "utf8"));
let bundle;
try {
  bundle = JSON.parse(readFileSync(evidencePath, "utf8"));
} catch (error) {
  // FAIL CLOSED. An absent or unparseable suppressed bundle is not "nothing to check": it is the
  // control step having produced no evidence at all, which is exactly what it exists to rule out.
  console.error(`FAIL: cannot read the suppressed bundle at ${evidencePath} — ${String(error && error.message ? error.message : error)}`);
  process.exit(1);
}

const { violations, summary } = evaluateSuppressedRun(matrix, bundle);
if (violations.length > 0) {
  console.error(`FAIL: the suppressed cross-tenant run does not demonstrate non-vacuity for every declared case:\n`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error(`\n${summary.unfired} of ${summary.expected} expected case(s) recorded injectionFired=false (${summary.reported} row(s) reported).`);
  process.exit(1);
}
console.log(
  `OK: the suppressed run reports all ${summary.expected} driver-owned \`required\` case(s) of ${D2M_PROFILE} ` +
  `with injectionFired=false (${summary.reported} row(s) in the bundle).`,
);
