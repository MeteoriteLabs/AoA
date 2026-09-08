// W19 -- the pin for scripts/ci-local.mjs's "skip pnpm install" guard.
//
// ★★★ WHAT THIS EXISTS TO CATCH, stated as the two defects it was written from. The guard
// read, in source, `if (/^pnpm install<0x08>/.test(cmd)) continue;` -- a literal backspace
// byte where the two characters backslash-b belonged, eaten by a shell heredoc when the file
// was written. It matched nothing, so the deviation its own comment called "the ONE deliberate
// deviation from CI" had never once been in effect: eight `pnpm install` steps executed,
// including `policy`'s LOCKFILE-MUTATING --lockfile-only variant, in the DEFAULT fast gate.
//
// Fixing the byte moved that count 8 -> 7, not 8 -> 0, which is the second defect and the
// reason this file asserts a COUNT rather than a byte. The guard sat only on the multi-line
// `run: |` path; seven of the eight installs are inline `run:` steps the parser pushes and
// returns on, above the guard. A byte-only test would have gone green over a guard that still
// covered one eighth of the cases.
//
// So: assert the CONSEQUENCE (zero installs survive parsing of the real pr.yml), assert the
// MECHANISM (both parser paths), and assert the BYTE (no control characters in the source).
// Each of the three fails independently.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseJobs, IS_INSTALL_STEP, INSTALL_SKIP_REASON } from "../../ci-local.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WORKFLOW = path.join(ROOT, ".github", "workflows", "pr.yml");
const SOURCE = path.join(ROOT, "scripts", "ci-local.mjs");

/** Every step the runner would actually EXECUTE (strings; objects are recorded skips). */
function executableSteps(jobs) {
  const out = [];
  for (const [job, steps] of jobs) {
    for (const step of steps) if (typeof step === "string") out.push({ job, step });
  }
  return out;
}

test("no `pnpm install` step survives parsing of the real pr.yml", () => {
  const jobs = parseJobs(readFileSync(WORKFLOW, "utf8"));
  const surviving = executableSteps(jobs).filter((s) => /pnpm install/.test(s.step));
  assert.deepEqual(
    surviving,
    [],
    `these \`pnpm install\` steps would run locally:\n${surviving
      .map((s) => `  ${s.job} :: ${s.step}`)
      .join("\n")}`,
  );
});

test("the guard covers BOTH parser paths -- the inline `run:` one is where 7 of 8 lived", () => {
  const jobs = parseJobs(readFileSync(WORKFLOW, "utf8"));
  const deviations = [];
  for (const [job, steps] of jobs) {
    for (const step of steps) {
      if (typeof step === "object" && step.deliberateSkip) deviations.push({ job, step });
    }
  }
  // Seven inline (`run: pnpm install --frozen-lockfile`) plus one block-form
  // (`policy`'s --lockfile-only, inside a `run: |`). If this drops to 1, the guard has
  // slipped back onto the block path only.
  assert.ok(
    deviations.length >= 8,
    `expected >= 8 recorded install deviations, saw ${deviations.length}`,
  );
  assert.ok(
    deviations.some((d) => d.job === "policy" && /--lockfile-only/.test(d.step.deliberateSkip)),
    "the block-form `policy` lockfile-only install must be a recorded deviation",
  );
  assert.ok(
    deviations.some((d) => d.job === "verify" && /--frozen-lockfile/.test(d.step.deliberateSkip)),
    "the inline `verify` install must be a recorded deviation",
  );
  for (const d of deviations) {
    assert.equal(d.step.why, INSTALL_SKIP_REASON, "every deviation carries the stated reason");
  }
});

test("the deviation is REPORTED, never silently dropped", () => {
  // The source comment claims the deviation "is stated in --list". It said that while --list
  // stated nothing, which is the same class of defect as the dead byte: self-description that
  // does not match behaviour. A recorded object is what makes the claim checkable.
  const jobs = parseJobs(readFileSync(WORKFLOW, "utf8"));
  const verify = jobs.get("verify") ?? [];
  const recorded = verify.filter((s) => typeof s === "object" && s.deliberateSkip);
  assert.equal(recorded.length, 1);
  assert.match(INSTALL_SKIP_REASON, /pnpm-lock\.yaml/);
});

test("the regex matches both install forms, and is not anchored to a control byte", () => {
  assert.ok(IS_INSTALL_STEP.test("pnpm install --frozen-lockfile"));
  assert.ok(IS_INSTALL_STEP.test("pnpm install --lockfile-only --ignore-scripts"));
  assert.ok(IS_INSTALL_STEP.test("pnpm install"));
  // Not a blanket `pnpm` skip: a real check that merely starts with the same word must run.
  assert.equal(IS_INSTALL_STEP.test("pnpm installer:verify"), false);
  assert.equal(IS_INSTALL_STEP.test("pnpm run install-check"), false);
  assert.equal(IS_INSTALL_STEP.test("node scripts/check-x.mjs"), false);
});

test("scripts/ci-local.mjs carries no invisible control characters", () => {
  // The byte half. A literal 0x08 renders invisibly in every terminal, editor and diff view,
  // which is why the original survived review for its whole life. `cat -A` shows it as ^H.
  const text = readFileSync(SOURCE, "utf8");
  const BANNED = [0x00, 0x07, 0x08, 0x0b, 0x0c, 0x1b];
  const hits = [];
  text.split("\n").forEach((line, i) => {
    for (const code of BANNED) {
      if (line.includes(String.fromCharCode(code))) {
        hits.push(`line ${i + 1}: U+${code.toString(16).padStart(4, "0")}`);
      }
    }
  });
  assert.deepEqual(hits, [], `control characters in ci-local.mjs:\n${hits.join("\n")}`);
});
