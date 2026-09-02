#!/usr/bin/env node
// Run this repository's CI jobs LOCALLY, in the same form CI runs them.
//
// ★ WHY THIS EXISTS, AND WHY IT PARSES THE WORKFLOW RATHER THAN LISTING COMMANDS.
// A hand-maintained copy of CI's command list drifts, and a drifted local runner is worse than
// none: it reports green for a suite CI does not run, or red for one it does not have. So this
// reads `.github/workflows/pr.yml` and executes the steps it finds. If CI changes, this changes
// with it.
//
// ★ THE FALSE ALARM THIS REMOVES. A naive `for f in scripts/check-*.mjs; do node $f; done` reports
// `check-browser-suite-executed` and `check-embedded-secrets` as failing, every time, forever. They
// take an argument that only the `browser` job supplies; the `policy` job runs their SELF-TESTS
// (`node --test …test.mjs`) instead. Running the workflow's own steps makes that class of
// phantom failure unrepresentable.
//
// Usage:
//   node scripts/ci-local.mjs                 # the fast gate: policy, lint, brand-check, contract bytes
//   node scripts/ci-local.mjs --all           # adds verify (typecheck + 4 vitest shards) and migrations
//   node scripts/ci-local.mjs --jobs policy   # a named job, or a comma-separated list
//   node scripts/ci-local.mjs --list          # what this can and cannot run here, and why
//   node scripts/ci-local.mjs --all --keep-going
//
// Exit code is 0 only if every job it RAN passed. Jobs it skips are reported, never counted green.

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const WORKFLOW = path.join(ROOT, ".github", "workflows", "pr.yml");

/**
 * Jobs this runner cannot honestly run on this machine, with the reason. A skip is REPORTED, never
 * silently treated as a pass -- a skipped required check that reads as success is the exact failure
 * this repository's CI redesign exists to prevent.
 */
const CANNOT_RUN_HERE = {
  e2e: "embedded-postgres cannot start on Windows CI runners (Issue #114); playwright config skips it",
  "e2e-pgvector": "needs the pgvector service container CI provides",
  browser: "needs `playwright install --with-deps chromium` and a browser sandbox",
  changes: "computes a git diff against the PR base; meaningless locally",
  "ci-required": "an aggregator over other jobs' results; nothing to execute",
};

/**
 * Jobs that need an environment CI provides and this machine may not. Unlike CANNOT_RUN_HERE
 * these are runnable WHEN the environment exists, so the check is dynamic -- and reporting
 * "FAIL" for a missing service would be a lie that trains people to ignore this runner.
 */
const NEEDS_ENV = [
  {
    // ★ PER-STEP, NOT PER-JOB — and that distinction cost a red CI run. Skipping the whole
    // `migrations` job for want of a DATABASE_URL also skipped its journal/snapshot CHAIN
    // assertion, which is inline python and needs no database. A broken `prevId` chain
    // therefore passed locally and failed on GitHub: exactly the round trip this exists to
    // remove. Gate the step that needs the environment; run everything else.
    match: /db:migrate|drizzle-kit (migrate|push)/,
    ok: () => Boolean(process.env.DATABASE_URL),
    why: "needs DATABASE_URL pointing at the postgres CI supplies as a service container",
  },
];

/** The reason a single STEP cannot run here, or undefined if it can. */
function envSkipReason(cmd) {
  const rule = NEEDS_ENV.find((r) => r.match.test(cmd));
  return rule && !rule.ok() ? rule.why : undefined;
}

/** The default fast gate: everything cheap that catches most red CI. */
const FAST_JOBS = ["policy", "brand-check", "worker-protocol-contract-bytes", "lint"];

/**
 * Extract `run:` commands per job from the workflow, including multi-line `run: |` blocks.
 * Deliberately a small indent state machine rather than a YAML dependency: this repo has no yaml
 * package installed, and adding one to run CI locally would be its own supply-chain decision.
 */
function parseJobs(text) {
  const lines = text.split(/\r?\n/);
  const jobs = new Map();
  let job = null;
  let inRun = false;
  let runIndent = 0;

  for (const line of lines) {
    const jobMatch = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobMatch && !/^\s*#/.test(line)) {
      job = jobMatch[1];
      if (!jobs.has(job)) jobs.set(job, []);
      inRun = false;
      continue;
    }
    if (!job) continue;

    const runInline = /^(\s+)run:\s*(.+?)\s*$/.exec(line);
    if (runInline && runInline[2] !== "|") {
      jobs.get(job).push(runInline[2]);
      inRun = false;
      continue;
    }
    const runBlock = /^(\s+)run:\s*\|\s*$/.exec(line);
    if (runBlock) {
      inRun = true;
      runIndent = runBlock[1].length;
      continue;
    }
    if (inRun) {
      if (line.trim() === "") continue;
      const indent = line.length - line.trimStart().length;
      if (indent <= runIndent) {
        inRun = false;
        continue;
      }
      const cmd = line.trim();
      // ★★★ A HEREDOC IS ONE STEP THIS PARSER CANNOT REPRESENT, AND DROPPING IT SILENTLY IS
      // THE FAILURE THIS FILE IS SUPPOSED TO PREVENT. `migrations` verifies the drizzle
      // journal/snapshot chain with `python <<'PYEOF' … PYEOF`; keeping only the first line
      // would run `python` with no script, read EOF, and exit 0 — a VACUOUS PASS. Proven by
      // mutation: with the first-line-only behaviour, breaking 0271's `prevId` exactly as CI
      // found it still reported `PASS migrations`.
      //
      // Until this executes whole `run:` blocks through a shell, such a step is recorded as
      // UNREPRESENTABLE and surfaced, never counted green.
      if (/<<\s*['"]?\w+['"]?/.test(cmd)) {
        jobs.get(job).push({ unrepresentable: cmd });
        continue;
      }
      // Shell scaffolding inside a block is executed as part of the block, not as a step; keep only
      // the invocations this runner can meaningfully attribute a pass/fail to.
      // Environment setup, not a check. Running `pnpm install --frozen-lockfile` locally costs
      // minutes and can churn node_modules; the local runner assumes a working tree that already
      // installs. This is the ONE deliberate deviation from CI, and it is stated in --list.
      if (/^pnpm install/.test(cmd)) continue;
      if (/^(node|pnpm|npx) /.test(cmd)) jobs.get(job).push(cmd);
    }
  }
  return jobs;
}

function run(cmd) {
  const started = Date.now();
  const result = spawnSync(cmd, { shell: true, stdio: "inherit", cwd: ROOT });
  return { code: result.status ?? 1, ms: Date.now() - started };
}

function main() {
  if (!existsSync(WORKFLOW)) {
    console.error(`no workflow at ${WORKFLOW}`);
    process.exit(2);
  }
  const jobs = parseJobs(readFileSync(WORKFLOW, "utf8"));
  const argv = process.argv.slice(2);
  const keepGoing = argv.includes("--keep-going");

  if (argv.includes("--list")) {
    console.log("jobs in pr.yml:\n");
    for (const [name, steps] of jobs) {
      const why = CANNOT_RUN_HERE[name];
      const gated = steps.filter((c) => typeof c === "string" && envSkipReason(c)).length;
      const unrep = steps.filter((c) => typeof c === "object").length;
      const mark = why ? "SKIP" : steps.length ? " RUN" : "  --";
      console.log(`  ${mark}  ${name.padEnd(32)} ${steps.length} step(s)${why ? `  — ${why}` : gated || unrep ? `  (${gated} gated on env, ${unrep} unrepresentable)` : ""}`);
    }
    console.log("\nfast gate:", FAST_JOBS.join(", "));
    return;
  }

  const explicit = argv.find((a) => a.startsWith("--jobs="))?.slice(7)
    ?? (argv.includes("--jobs") ? argv[argv.indexOf("--jobs") + 1] : undefined);

  let selected;
  if (explicit) selected = explicit.split(",").map((s) => s.trim()).filter(Boolean);
  else if (argv.includes("--all")) {
    selected = [...jobs.keys()].filter((j) => !CANNOT_RUN_HERE[j] && jobs.get(j).length > 0);
  } else selected = FAST_JOBS;

  const results = [];
  const skipped = [];
  let failed = false;

  for (const name of selected) {
    if (CANNOT_RUN_HERE[name]) {
      skipped.push({ name, why: CANNOT_RUN_HERE[name] });
      continue;
    }
    const steps = jobs.get(name);
    if (!steps || steps.length === 0) {
      skipped.push({ name, why: "no runnable steps found in pr.yml" });
      continue;
    }
    console.log(`\n━━━ ${name} (${steps.length} steps) ━━━`);
    let jobFailed = false;
    let jobMs = 0;
    for (const step of steps) {
      if (typeof step === "object" && step.unrepresentable) {
        console.log(`
  ? ${step.unrepresentable}`);
        console.log("    UNREPRESENTABLE — multi-line run: block; this runner cannot execute it");
        skipped.push({
          name: `${name}:step`,
          why: `${step.unrepresentable} — multi-line run: block, NOT checked here`,
        });
        continue;
      }
      const envWhy = envSkipReason(step);
      if (envWhy) {
        console.log(`
  - ${step}`);
        console.log(`    SKIP — ${envWhy}`);
        skipped.push({ name: `${name}:step`, why: `${step} — ${envWhy}` });
        continue;
      }
      console.log(`\n  $ ${step}`);
      const { code, ms } = run(step);
      jobMs += ms;
      if (code !== 0) {
        jobFailed = true;
        console.log(`  ✗ exit ${code}`);
        if (!keepGoing) break;
      }
    }
    results.push({ name, ok: !jobFailed, ms: jobMs });
    if (jobFailed) {
      failed = true;
      if (!keepGoing) break;
    }
  }

  console.log("\n━━━ summary ━━━");
  for (const r of results) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(32)} ${(r.ms / 1000).toFixed(1)}s`);
  }
  for (const s of skipped) console.log(`  SKIP  ${s.name.padEnd(32)} ${s.why}`);
  if (skipped.length) {
    console.log("\n  ★ Skipped jobs are NOT green. Linux CI remains the authority for them.");
  }
  process.exit(failed ? 1 : 0);
}

main();
