#!/usr/bin/env node
/**
 * check-cross-platform-verdict-shape.test.mjs — corpus for the E6-F023 shape guard.
 *
 * Run with:
 *   node --test scripts/check-cross-platform-verdict-shape.test.mjs
 *
 * (A) THE REAL FILE. The parser runs against the actual cross-platform-weekly.yml and must SEE
 *     it: the three jobs, the `Install Playwright` step, and the one `continue-on-error` the
 *     file legitimately carries (on the advisory `test-cross-platform`). A parser that sees no
 *     flag anywhere would report every sabotage below as clean, so its sight is asserted, not
 *     assumed. Then the real file must be clean.
 *
 * (B) MUTATIONS OF THE REAL FILE. Each sabotage takes the real, currently-green text and breaks
 *     exactly one thing, and each asserts the mutation actually changed the text before it
 *     asserts red — a mutation that matches nothing proves nothing.
 *
 * (C) ANTI-VACUITY. A renamed or removed job or step must fail, never pass for lack of anything
 *     to check.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ADVISORY_JOBS,
  VERDICT_BEARING_JOBS,
  REQUIRED_STEPS,
  evaluateCrossPlatformVerdictShape,
  parseWorkflowShape,
} from "./lib/cross-platform-verdict-shape.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = path.join(repoRoot, ".github", "workflows", "cross-platform-weekly.yml");

// LF-normalised so the anchored mutation regexes match on a CRLF Windows checkout too.
const real = fs.readFileSync(WORKFLOW, "utf8").replace(/\r\n/g, "\n");

const evaluate = (text) => evaluateCrossPlatformVerdictShape(text);
const codes = (r) => r.findings.map((f) => f.code);

/** Replace exactly one occurrence; throw if the anchor is absent, so no mutation is a no-op. */
function mutate(text, anchor, replacement) {
  const count = text.split(anchor).length - 1;
  assert.equal(count, 1, `mutation anchor must occur exactly once, found ${count}: ${JSON.stringify(anchor)}`);
  const out = text.replace(anchor, replacement);
  assert.notEqual(out, text, "mutation changed nothing");
  return out;
}

const VERIFY_HEADER = "  verify-cross-platform:\n    strategy:";
const E2E_HEADER = "  e2e-cross-platform:\n    strategy:";
const INSTALL_STEP = "      - name: Install Playwright\n        id: install-playwright\n";

// ---------------------------------------------------------------------------
// (A) The real file.
// ---------------------------------------------------------------------------

test("the declared job sets are the E6-F023 option-3 split", () => {
  assert.deepEqual([...VERDICT_BEARING_JOBS].sort(), ["e2e-cross-platform", "verify-cross-platform"]);
  assert.deepEqual([...ADVISORY_JOBS], ["test-cross-platform"]);
  assert.deepEqual(REQUIRED_STEPS, [{ job: "e2e-cross-platform", step: "Install Playwright" }]);
});

test("the parser actually sees the real workflow — jobs, steps and the advisory flag", () => {
  const shape = parseWorkflowShape(real);
  for (const id of ["verify-cross-platform", "test-cross-platform", "e2e-cross-platform"]) {
    assert.ok(shape.jobs.has(id), `job ${id} not parsed`);
  }
  const e2e = shape.jobs.get("e2e-cross-platform");
  const names = e2e.steps.map((s) => s.name);
  assert.ok(names.includes("Install Playwright"), `Install Playwright not parsed; saw ${names.join(", ")}`);
  assert.ok(names.length >= 8, `expected the e2e job's steps, saw ${names.length}`);

  // POSITIVE SIGHT: the one flag the real file legitimately carries must be SEEN. If this goes
  // red the parser is blind and every "clean" verdict below is vacuous.
  const advisory = shape.jobs.get("test-cross-platform");
  assert.equal(advisory.continueOnError, "true", "parser did not see the advisory job's real flag");

  // Header-comment lines that MENTION `continue-on-error` must not be read as keys.
  assert.equal(shape.jobs.get("verify-cross-platform").continueOnError, null);
  assert.equal(e2e.continueOnError, null);
});

test("the real workflow is clean", () => {
  const r = evaluate(real);
  assert.deepEqual(r.findings, []);
  assert.equal(r.ok, true);
});

test("test-cross-platform keeping its continue-on-error is allowed (it is the advisory job)", () => {
  // Already true in the real file — assert it explicitly, and that the flag is really there.
  assert.match(real, /\n  test-cross-platform:\n[\s\S]*?\n    continue-on-error: true\n/);
  assert.equal(evaluate(real).ok, true);
  // And a step-level flag inside the advisory job is also its own business.
  const withStepFlag = mutate(
    real,
    "      - name: Run tests (shard ${{ matrix.shard }}/4)\n",
    "      - name: Run tests (shard ${{ matrix.shard }}/4)\n        continue-on-error: true\n",
  );
  assert.equal(evaluate(withStepFlag).ok, true);
});

// ---------------------------------------------------------------------------
// (B) Sabotage — each re-adds one flag E6-F023 removed.
// ---------------------------------------------------------------------------

test("(a) continue-on-error re-added to verify-cross-platform reds", () => {
  const text = mutate(real, VERIFY_HEADER, "  verify-cross-platform:\n    continue-on-error: true\n    strategy:");
  const r = evaluate(text);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes("verdict_job_continue_on_error"), codes(r).join(","));
  assert.equal(r.findings.find((f) => f.code === "verdict_job_continue_on_error").job, "verify-cross-platform");
});

test("(b) continue-on-error re-added to e2e-cross-platform reds", () => {
  const text = mutate(real, E2E_HEADER, "  e2e-cross-platform:\n    continue-on-error: true\n    strategy:");
  const r = evaluate(text);
  assert.equal(r.ok, false);
  assert.equal(r.findings.find((f) => f.code === "verdict_job_continue_on_error").job, "e2e-cross-platform");
});

test("(b') any value — an expression, a quoted key, a trailing comment — still reds", () => {
  for (const line of [
    "    continue-on-error: ${{ matrix.os == 'windows-latest' }}\n",
    '    "continue-on-error": true\n',
    "    continue-on-error: true # temporarily\n",
    "    continue-on-error: yes\n",
  ]) {
    const text = mutate(real, E2E_HEADER, `  e2e-cross-platform:\n${line}    strategy:`);
    assert.equal(evaluate(text).ok, false, `not caught: ${line.trim()}`);
  }
});

test("an explicit continue-on-error: false on a verdict-bearing job is allowed", () => {
  const text = mutate(real, VERIFY_HEADER, "  verify-cross-platform:\n    continue-on-error: false\n    strategy:");
  assert.equal(evaluate(text).ok, true);
});

test("(c) continue-on-error re-added to the Install Playwright step reds — the install bypass", () => {
  const text = mutate(real, INSTALL_STEP, `${INSTALL_STEP}        continue-on-error: true\n`);
  const r = evaluate(text);
  assert.equal(r.ok, false);
  const f = r.findings.find((x) => x.code === "verdict_step_continue_on_error");
  assert.ok(f, codes(r).join(","));
  assert.equal(f.job, "e2e-cross-platform");
  assert.equal(f.step, "Install Playwright");
});

test("(c') a step-level flag on ANY step of a verdict-bearing job reds (same bypass class)", () => {
  const text = mutate(
    real,
    "      - name: Typecheck\n        run: pnpm -r typecheck\n",
    "      - name: Typecheck\n        continue-on-error: true\n        run: pnpm -r typecheck\n",
  );
  const r = evaluate(text);
  assert.equal(r.ok, false);
  const f = r.findings.find((x) => x.code === "verdict_step_continue_on_error");
  assert.equal(f.job, "verify-cross-platform");
  assert.equal(f.step, "Typecheck");
});

test("a `continue-on-error:` inside a run block's text is not a key and does not red", () => {
  const text = mutate(
    real,
    "        run: pnpm -r typecheck\n",
    "        run: |\n          echo continue-on-error: true\n          pnpm -r typecheck\n",
  );
  assert.equal(evaluate(text).ok, true);
});

// ---------------------------------------------------------------------------
// (C) Anti-vacuity — the guard must never pass for lack of anything to check.
// ---------------------------------------------------------------------------

test("(d) verify-cross-platform renamed away reds (missing job)", () => {
  const text = mutate(real, VERIFY_HEADER, "  verify-xp:\n    continue-on-error: true\n    strategy:");
  const r = evaluate(text);
  assert.equal(r.ok, false);
  const f = r.findings.find((x) => x.code === "verdict_job_missing");
  assert.ok(f, codes(r).join(","));
  assert.equal(f.job, "verify-cross-platform");
});

test("(d) e2e-cross-platform removed entirely reds (missing job)", () => {
  const start = real.indexOf("\n  e2e-cross-platform:\n");
  assert.ok(start > 0);
  const text = real.slice(0, start + 1);
  const r = evaluate(text);
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.code === "verdict_job_missing" && f.job === "e2e-cross-platform"));
  // With the job gone, its required step is necessarily gone too; it must not pass silently.
  assert.ok(r.findings.some((f) => f.code === "required_step_missing"));
});

test("(d) the Install Playwright step renamed reds (missing step)", () => {
  const text = mutate(real, INSTALL_STEP, "      - name: Install browsers\n        id: install-playwright\n        continue-on-error: true\n");
  const r = evaluate(text);
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.code === "required_step_missing" && f.step === "Install Playwright"));
});

test("(d) no jobs: block at all reds", () => {
  const r = evaluate("name: x\non: push\n");
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes("no_jobs_block"));
});

test("(d) an empty or missing file reds", () => {
  assert.equal(evaluate("").ok, false);
});

test("a verdict-bearing job declared twice reds (a later duplicate key could shadow the clean one)", () => {
  const dup = `${real}\n  verify-cross-platform:\n    continue-on-error: true\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo\n`;
  const r = evaluate(dup);
  assert.equal(r.ok, false);
  assert.ok(r.findings.some((f) => f.code === "duplicate_job" && f.job === "verify-cross-platform"));
});

test("a YAML merge key inside a verdict-bearing job reds (shape not visible to a line parser)", () => {
  const text = mutate(real, VERIFY_HEADER, "  verify-cross-platform:\n    <<: *advisory\n    strategy:");
  const r = evaluate(text);
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes("unanalyzable_merge_key"));
});

test("a step whose first key is not `name` is still read (flag on the id-first Install step reds)", () => {
  const text = mutate(
    real,
    INSTALL_STEP,
    "      - id: install-playwright\n        continue-on-error: true\n        name: Install Playwright\n",
  );
  const r = evaluate(text);
  assert.equal(r.ok, false);
  const f = r.findings.find((x) => x.code === "verdict_step_continue_on_error");
  assert.equal(f.step, "Install Playwright");
  assert.ok(!codes(r).includes("required_step_missing"));
});

test("CRLF line endings: clean stays clean and sabotage still reds", () => {
  assert.equal(evaluate(real.replace(/\n/g, "\r\n")).ok, true);
  const text = mutate(real, INSTALL_STEP, `${INSTALL_STEP}        continue-on-error: true\n`);
  assert.equal(evaluate(text.replace(/\n/g, "\r\n")).ok, false);
});
