#!/usr/bin/env node
// -----------------------------------------------------------------------------
// DEP-018 — the campaign fault matrix's checker (pure node; no Docker, no key, no database).
//
//   node scripts/check-campaign-fault-matrix.mjs                     # the declaration only
//   node scripts/check-campaign-fault-matrix.mjs --evidence <file>   # …and a lane's bundle
//
// Without `--evidence` it holds the committed declaration (`tests/d1/fault-matrix.json`) to the
// E6 plan's Outcome: all three gate profiles, every case family each profile's Outcome names, and
// the F10 tenant matrix in EVERY profile — the per-tenant journeys, the nine cross-tenant denial
// surfaces, refusal of the control tenant, and the four legacy tables of acceptance 5, each with
// its positive control and its anti-vacuity control.
//
// With `--evidence` it additionally judges a lane's bundle: every declared `required` case must
// have a run showing its INJECTION FIRED and the observed classification matching the declared
// one; an undeclared case is refused; a `pending` case that reported evidence is refused (the
// declaration has gone stale). Exit 1 on any violation, 2 on an unreadable input.
//
// The verdicts are `scripts/lib/campaign-fault-matrix.mjs`; their reds — one fixture per
// violation code, which is what keeps this from being a check that evaluates nothing — are
// `scripts/check-campaign-fault-matrix.test.mjs`.
// -----------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FAULT_MATRIX_PATH,
  evaluateFaultMatrixDeclaration,
  evaluateFaultMatrixEvidence,
  formatViolations,
} from "./lib/campaign-fault-matrix.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`FAIL: could not read ${label} (${file}): ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}

const argv = process.argv.slice(2);
const evidenceIndex = argv.indexOf("--evidence");
const evidenceFiles = evidenceIndex === -1 ? [] : argv.slice(evidenceIndex + 1).filter((a) => !a.startsWith("--"));
if (evidenceIndex !== -1 && evidenceFiles.length === 0) {
  console.error("FAIL: --evidence needs at least one bundle path");
  process.exit(2);
}

const matrixFile = path.join(repoRoot, FAULT_MATRIX_PATH);
const matrix = readJson(matrixFile, FAULT_MATRIX_PATH);

const declarationViolations = evaluateFaultMatrixDeclaration(matrix);
if (declarationViolations.length > 0) {
  console.error(`FAIL: ${FAULT_MATRIX_PATH} violates ${declarationViolations.length} DEP-018 declaration invariant(s):`);
  console.error(formatViolations(declarationViolations));
  process.exit(1);
}

const declaredCases = matrix.profiles.reduce((n, p) => n + p.cases.length, 0);
const pendingCases = matrix.profiles.reduce((n, p) => n + p.cases.filter((c) => c.evidence === "pending").length, 0);
console.log(
  `OK: ${FAULT_MATRIX_PATH} declares ${matrix.profiles.length} gate profile(s) and ${declaredCases} case(s) ` +
    `(${declaredCases - pendingCases} required, ${pendingCases} pending), each with an injection, an observer and ` +
    "an expected classification; every profile carries the F10 tenant matrix (journeys, nine denial surfaces, the",
);
console.log("    control tenant, and the four no-RLS legacy tables with positive + anti-vacuity controls).");

if (evidenceFiles.length === 0) process.exit(0);

let failed = 0;
for (const file of evidenceFiles) {
  const resolved = path.isAbsolute(file) ? file : path.join(repoRoot, file);
  const bundle = readJson(resolved, "an evidence bundle");
  const { violations, summary } = evaluateFaultMatrixEvidence(matrix, bundle);
  if (violations.length > 0) {
    console.error(`FAIL: ${file} — ${violations.length} evidence violation(s) for profile ${String(summary.profile)}:`);
    console.error(formatViolations(violations));
    failed += 1;
    continue;
  }
  console.log(
    `OK: ${file} — profile ${summary.profile}: ${summary.fired}/${summary.required} required case(s) fired and classified as declared, ` +
      `${summary.pending} pending. Profile ${summary.complete ? "COMPLETE" : "INCOMPLETE (pending cases remain)"}.`,
  );
}
process.exit(failed > 0 ? 1 : 0);
