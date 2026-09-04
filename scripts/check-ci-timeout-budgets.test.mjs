#!/usr/bin/env node
/**
 * check-ci-timeout-budgets.test.mjs — corpus for the derived-cap gate.
 *
 * Run with:
 *   node --test scripts/check-ci-timeout-budgets.test.mjs
 *
 * Two halves, deliberately.
 *
 * (A) THE REAL FILES. The scanner runs against the actual .github/workflows/pr.yml and the
 *     actual manifest, and asserts both that it FINDS the nine-job exposure it was written
 *     for and that the tree is currently clean. A guard whose scanner silently stops matching
 *     reports a clean workflow forever — the failure mode this programme calls "a check that
 *     nothing runs" — so the scanner's sight is asserted, not assumed.
 *
 * (B) MUTATIONS OF THE REAL FILES. Every clause is proven by taking the real, currently-green
 *     inputs and breaking exactly one thing. In particular `catches the real defect this guard
 *     was built for` reconstructs the pre-fix state — a `Setup pnpm` step with no cap of its
 *     own inside a job whose cap silently absorbs it — and asserts red. That state was the tip
 *     of this branch before this commit, and 17 findings across 9 jobs were the measured red.
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_WORK_BUDGET_FACTOR,
  MIN_MEASUREMENT_SAMPLE_SIZE,
  derivedJobCapMinutes,
  derivedStepCapMinutes,
  evaluateCiTimeoutBudgets,
  parseWorkflowJobs,
} from "./lib/ci-timeout-budgets.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = path.join(repoRoot, ".github", "workflows", "pr.yml");
const MANIFEST = path.join(repoRoot, ".github", "ci-timeout-budgets.json");

const workflowText = fs.readFileSync(WORKFLOW, "utf8");
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

const clone = (o) => JSON.parse(JSON.stringify(o));
const run = (text, m) => evaluateCiTimeoutBudgets({ jobs: parseWorkflowJobs(text), manifest: m });
const codes = (r) => r.findings.map((f) => f.code);

// ---------------------------------------------------------------------------
// (A) The real files.
// ---------------------------------------------------------------------------

test("the scanner actually sees pr.yml — jobs, caps, needs, and the pnpm step", () => {
  const jobs = parseWorkflowJobs(workflowText);
  assert.ok(jobs.length >= 10, `expected the workflow's jobs, got ${jobs.length}`);

  const withSetup = jobs.filter((j) => j.pnpmSetup);
  assert.ok(
    withSetup.length >= 8,
    `expected the multi-job pnpm exposure this guard exists for, saw ${withSetup.length}`,
  );

  const policy = jobs.find((j) => j.id === "policy");
  assert.ok(policy, "policy job not found");
  assert.equal(typeof policy.timeoutMinutes, "number");
  assert.ok(policy.pnpmSetup, "policy must still run pnpm/action-setup");
  assert.match(policy.pnpmSetup.name, /pnpm/i);

  const required = jobs.find((j) => j.id === "ci-required");
  assert.ok(required, "ci-required aggregator not found");
  assert.ok(required.needs.includes("policy"), "ci-required must consume policy");
  assert.ok(required.needs.length >= 5, "ci-required needs list did not parse");
});

test("the tree is currently green", () => {
  const result = run(workflowText, manifest);
  assert.deepEqual(result.findings, [], "real workflow + real manifest must be clean");
  assert.equal(result.ok, true);
});

test("every budgeted job's two caps are exactly the derived values", () => {
  const jobs = new Map(parseWorkflowJobs(workflowText).map((j) => [j.id, j]));
  for (const [id, entry] of Object.entries(manifest.jobs)) {
    const job = jobs.get(id);
    assert.ok(job, `${id} budgeted but absent from the workflow`);
    assert.equal(job.timeoutMinutes, derivedJobCapMinutes(entry), `${id} job cap`);
    assert.equal(job.pnpmSetup.timeoutMinutes, derivedStepCapMinutes(entry), `${id} step cap`);
  }
});

// ---------------------------------------------------------------------------
// (B) Mutations.
// ---------------------------------------------------------------------------

test("catches the real defect this guard was built for: an uncapped pnpm step", () => {
  // Reconstruct the pre-fix state of every budgeted job: the step cap lines removed, so the
  // job cap alone absorbs a fetch that has been measured at 431s.
  const mutated = workflowText
    .split("\n")
    .filter((l) => !/^ {8}timeout-minutes: 8$/.test(l))
    .join("\n");
  const result = run(mutated, manifest);
  assert.equal(result.ok, false);
  const uncapped = result.findings.filter((f) => f.code === "setup_step_uncapped");
  assert.equal(
    uncapped.length,
    Object.keys(manifest.jobs).length,
    "every budgeted job must be reported, not just the first",
  );
  assert.match(uncapped[0].detail, /blames whichever step is running at the wall/);
});

test("catches a job cap edited on its own", () => {
  const policyCap = derivedJobCapMinutes(manifest.jobs.policy);
  const mutated = workflowText.replace(
    `    timeout-minutes: ${policyCap}\n`,
    `    timeout-minutes: ${policyCap + 4}\n`,
  );
  assert.notEqual(mutated, workflowText, "mutation did not apply");
  const result = run(mutated, manifest);
  assert.ok(codes(result).includes("job_cap_mismatch"));
});

test("catches a step cap edited on its own", () => {
  const mutated = workflowText.replace(
    /^ {8}timeout-minutes: 8$/m,
    "        timeout-minutes: 20",
  );
  assert.notEqual(mutated, workflowText, "mutation did not apply");
  const result = run(mutated, manifest);
  assert.ok(codes(result).includes("setup_step_cap_mismatch"));
});

test("catches instance ten: a NEW job that adds pnpm/action-setup with no budget", () => {
  const mutated = `${workflowText}
  freshly-added-lane:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Setup pnpm
        uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6.0.9
`;
  const result = run(mutated, manifest);
  const f = result.findings.find((x) => x.code === "job_missing_budget");
  assert.ok(f, "a new pnpm-exposed job must be refused");
  assert.equal(f.job, "freshly-added-lane");
});

test("catches instance ten's other shape: a required-lane job with a cap and no budget", () => {
  const m = clone(manifest);
  delete m.exempt["worker-protocol-contract-bytes"];
  const result = run(workflowText, m);
  const f = result.findings.find((x) => x.code === "required_lane_unbudgeted");
  assert.ok(f, "an unbudgeted, unexempt required-lane cap must be refused");
  assert.equal(f.job, "worker-protocol-contract-bytes");
});

test("refuses raise-the-cap-until-it-is-green", () => {
  const m = clone(manifest);
  const measured = m.jobs.policy.measuredMaxWorkSeconds;
  m.jobs.policy.workBudgetSeconds = MAX_WORK_BUDGET_FACTOR * measured + 1;
  const result = run(workflowText, m);
  const f = result.findings.find((x) => x.code === "work_budget_unjustified");
  assert.ok(f, "a budget past its own measurement must be refused");
  assert.match(f.detail, /Re-measure/);
});

test("refuses a budget below its own measurement", () => {
  const m = clone(manifest);
  m.jobs.lint.workBudgetSeconds = m.jobs.lint.measuredMaxWorkSeconds - 1;
  assert.ok(codes(run(workflowText, m)).includes("work_budget_below_measurement"));
});

test("refuses a measurement that is not one", () => {
  for (const mutate of [
    (e) => {
      e.measuredSampleSize = MIN_MEASUREMENT_SAMPLE_SIZE - 1;
    },
    (e) => {
      e.measuredOn = "yesterday";
    },
    (e) => {
      e.measuredRuns = [];
    },
    (e) => {
      delete e.measuredMaxWorkSeconds;
    },
  ]) {
    const m = clone(manifest);
    mutate(m.jobs.browser);
    assert.ok(
      codes(run(workflowText, m)).includes("measurement_incomplete"),
      "an unattributable measurement must be refused",
    );
  }
});

test("refuses an exemption with no argument in it", () => {
  const m = clone(manifest);
  m.exempt.changes = { reason: "n/a" };
  assert.ok(codes(run(workflowText, m)).includes("exempt_without_reason"));
});

test("refuses a stale budget for a job that no longer fetches pnpm", () => {
  const m = clone(manifest);
  m.jobs["brand-check"] = clone(m.jobs.lint);
  const result = run(workflowText, m);
  const f = result.findings.find((x) => x.code === "budget_orphan");
  assert.ok(f, "brand-check no longer runs pnpm/action-setup; budgeting it must be refused");
  assert.equal(f.job, "brand-check");

  const m2 = clone(manifest);
  m2.jobs["a-job-that-does-not-exist"] = clone(m2.jobs.lint);
  assert.ok(codes(run(workflowText, m2)).includes("budget_orphan"));
});

test("a scanner that matches nothing FAILS rather than reporting clean", () => {
  assert.deepEqual(codes(run("", manifest)), ["scanner_found_no_jobs"]);

  const noPnpm = workflowText.replaceAll("pnpm/action-setup", "some-other/action");
  const result = run(noPnpm, manifest);
  assert.equal(result.ok, false);
  assert.ok(
    codes(result).includes("scanner_found_no_pnpm_setup_steps"),
    "losing sight of every pnpm step must be a failure, not a pass",
  );
});

test("the derivation is the documented arithmetic", () => {
  assert.equal(derivedJobCapMinutes({ workBudgetSeconds: 150, setupAllowanceSeconds: 480 }), 11);
  assert.equal(derivedJobCapMinutes({ workBudgetSeconds: 1, setupAllowanceSeconds: 59 }), 1);
  assert.equal(derivedJobCapMinutes({ workBudgetSeconds: 1, setupAllowanceSeconds: 60 }), 2);
  assert.equal(derivedStepCapMinutes({ setupAllowanceSeconds: 480 }), 8);
  assert.equal(derivedStepCapMinutes({ setupAllowanceSeconds: 481 }), 9);
});
