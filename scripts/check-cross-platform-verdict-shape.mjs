#!/usr/bin/env node
// -----------------------------------------------------------------------------
// check-cross-platform-verdict-shape.mjs — E6-F023's verdict-bearing shape must not regress.
//
//   node scripts/check-cross-platform-verdict-shape.mjs
//
// Reads the REAL .github/workflows/cross-platform-weekly.yml and fails closed when:
//   - `verify-cross-platform` or `e2e-cross-platform` carries a job-level `continue-on-error`;
//   - any step of those two jobs carries one — `Install Playwright` above all (the install
//     bypass E6-F023's ruling named);
//   - either job, or the `Install Playwright` step, cannot be found (renamed or removed): the
//     guard never passes with nothing to check.
// `test-cross-platform` is the advisory job and may keep its flag.
//
// The DEP-013 consumer reads this lane's RUN conclusion, which a flagged job cannot move, so
// re-adding any of these flags silently restores the false green E6-F023 measured on run
// 35530935808. See scripts/lib/cross-platform-verdict-shape.mjs for exactly what is and is not
// enforced.
// -----------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  ADVISORY_JOBS,
  VERDICT_BEARING_JOBS,
  evaluateCrossPlatformVerdictShape,
} from "./lib/cross-platform-verdict-shape.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const WORKFLOW_RELATIVE_PATH = ".github/workflows/cross-platform-weekly.yml";

function main() {
  let text;
  try {
    text = readFileSync(path.join(repoRoot, WORKFLOW_RELATIVE_PATH), "utf8");
  } catch (err) {
    console.error(`FAIL  cannot read ${WORKFLOW_RELATIVE_PATH}: ${err.message}`);
    return 1;
  }

  const { ok, findings } = evaluateCrossPlatformVerdictShape(text);
  if (!ok) {
    console.error(`FAIL  ${WORKFLOW_RELATIVE_PATH} no longer has E6-F023's verdict-bearing shape.\n`);
    for (const f of findings) {
      const where = [f.job, f.step].filter(Boolean).join(" > ") || "-";
      console.error(`  [${f.code}] ${where}: ${f.detail}`);
    }
    console.error(
      `\n${findings.length} problem(s). A flagged verdict-bearing job or step cannot fail the run, so` +
        " the lane would read green while it fails (E6-F023). Turning a verdict-bearing job" +
        " advisory is a gate-owner decision, not an edit to this file.",
    );
    return 1;
  }

  console.log(
    `cross-platform verdict shape OK: ${VERDICT_BEARING_JOBS.join(", ")} verdict-bearing ` +
      `(no job- or step-level continue-on-error); ${ADVISORY_JOBS.join(", ")} not checked ` +
      "(advisory by ruling; may keep or drop its flag).",
  );
  return 0;
}

process.exit(main());
