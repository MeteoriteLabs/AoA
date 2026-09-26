/**
 * cross-platform-verdict-shape.mjs — the pure half of check-cross-platform-verdict-shape.mjs.
 *
 * E6-F023 (docs/replatform/epics/E6-deployment-test-harness/findings.md, gate-owner ruling
 * 2026-09-21, option 3) split `.github/workflows/cross-platform-weekly.yml` into:
 *
 *   verify-cross-platform  VERDICT-BEARING  no `continue-on-error`
 *   e2e-cross-platform     VERDICT-BEARING  no `continue-on-error`, AND no flag on its
 *                                           `Install Playwright` step (the install bypass: every
 *                                           later step is gated on that step's outcome, so a
 *                                           flagged failed install skipped the suite and the job
 *                                           concluded GREEN having run no browser test)
 *   test-cross-platform    ADVISORY         keeps `continue-on-error: true`
 *
 * The DEP-013 consumer reads this lane's RUN conclusion, and a job or step carrying
 * `continue-on-error` cannot move it. So re-adding any of those flags silently restores the false
 * green that run 35530935808 demonstrated (run `success`, 8 of 12 jobs failing). Before this
 * guard, nothing prevented it.
 *
 * WHAT IS ENFORCED
 *   - every VERDICT_BEARING_JOBS id exists as a job (renaming or removing one reds — the guard
 *     must never pass for lack of anything to check);
 *   - no verdict-bearing job carries a job-level `continue-on-error` other than a literal `false`
 *     (an expression, `yes`, a quoted key — all red; fail closed on anything not provably off);
 *   - no STEP of a verdict-bearing job carries one either. The ruling names `Install Playwright`;
 *     a flag on `Typecheck` or `Run e2e tests` is the same bypass one step later, so the rule is
 *     class-wide rather than step-specific;
 *   - every REQUIRED_STEPS step exists (renaming `Install Playwright` reds);
 *   - a job id declared twice, or a YAML merge key (`<<:`) inside a verdict-bearing job, reds:
 *     both make the effective shape something this line parser cannot see.
 *
 * WHAT IS NOT ENFORCED (named, not implied)
 *   - `test-cross-platform` may keep or drop its flag; this guard does not require it to stay
 *     advisory. Turning it verdict-bearing is stricter, and is a gate-owner call, not a regression.
 *   - A step skipped by an `if:` that does not depend on the install outcome, a `|| true` inside a
 *     `run:` block, or a `timeout-minutes` change is not examined. Those are different bypasses.
 *   - A NEW job added to the workflow is neither verdict-bearing nor advisory to this guard.
 *
 * A deliberately small, dependency-free line parser (the sibling guards in scripts/ are
 * dependency-free, and the policy lane has no `pnpm install`). It understands indentation, block
 * scalars (`run: |` bodies are skipped, so text inside a script is never read as a key), full-line
 * and trailing comments, quoted keys, and step lists whose first key is not `name`.
 */

export const VERDICT_BEARING_JOBS = Object.freeze(["verify-cross-platform", "e2e-cross-platform"]);
export const ADVISORY_JOBS = Object.freeze(["test-cross-platform"]);
export const REQUIRED_STEPS = Object.freeze([
  Object.freeze({ job: "e2e-cross-platform", step: "Install Playwright" }),
]);

const KEY_LINE = /^(\s*)(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9_<][A-Za-z0-9_.<-]*))\s*:(?:\s+(.*)|\s*)$/;
const DASH_LINE = /^(\s*)-(\s+)(.*)$/;
const BLOCK_SCALAR = /^[|>][-+0-9]*$/;

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/** Strip a trailing ` # comment` from a plain scalar value, then surrounding quotes. */
function scalar(raw) {
  if (raw === undefined || raw === null) return "";
  let v = raw.trim();
  if (v.startsWith('"') || v.startsWith("'")) {
    const q = v[0];
    const end = v.indexOf(q, 1);
    if (end > 0) return v.slice(1, end);
  }
  const hash = v.search(/\s#/);
  if (hash >= 0) v = v.slice(0, hash);
  return v.trim();
}

function parseKey(text) {
  const m = KEY_LINE.exec(text);
  if (!m) return null;
  return { indent: m[1].length, key: m[2] ?? m[3] ?? m[4], value: m[5] ?? "" };
}

/**
 * Returns { hasJobsBlock, jobs: Map<id, { continueOnError: string|null, mergeKey: boolean,
 * steps: [{ name: string|null, continueOnError: string|null }] }>, duplicateJobs: string[] }.
 * `continueOnError` is the unquoted, comment-stripped value, or null when the key is absent.
 */
export function parseWorkflowShape(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const jobs = new Map();
  const duplicateJobs = [];
  let hasJobsBlock = false;

  let blockScalarIndent = null; // indent of the key that opened a `|`/`>` block
  let inJobs = false;
  let jobIndent = null;
  let job = null;
  let jobBodyIndent = null;
  let stepsIndent = null; // indent of the `steps:` key
  let stepDashIndent = null;
  let step = null;
  let stepKeyIndent = null;

  const closeStep = () => {
    step = null;
    stepKeyIndent = null;
  };
  const closeSteps = () => {
    closeStep();
    stepsIndent = null;
    stepDashIndent = null;
  };
  const closeJob = () => {
    closeSteps();
    job = null;
    jobBodyIndent = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, "  ");
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const indent = indentOf(line);

    if (blockScalarIndent !== null) {
      if (indent > blockScalarIndent) continue; // inside a `run: |` (or similar) body
      blockScalarIndent = null;
    }
    if (trimmed.startsWith("#")) continue;

    // Top level.
    if (indent === 0) {
      closeJob();
      const k = parseKey(line);
      inJobs = Boolean(k && k.key === "jobs");
      if (inJobs) hasJobsBlock = true;
      jobIndent = null;
      if (k && BLOCK_SCALAR.test(scalar(k.value))) blockScalarIndent = 0;
      continue;
    }
    if (!inJobs) {
      const k = parseKey(line);
      if (k && BLOCK_SCALAR.test(scalar(k.value))) blockScalarIndent = indent;
      continue;
    }

    // Job header.
    if (jobIndent === null) jobIndent = indent;
    if (indent <= jobIndent) {
      closeJob();
      const k = parseKey(line);
      if (k && indent === jobIndent) {
        if (jobs.has(k.key)) duplicateJobs.push(k.key);
        job = { continueOnError: null, mergeKey: false, steps: [] };
        jobs.set(k.key, job);
      }
      continue;
    }
    if (!job) continue;

    // Inside the steps list.
    if (stepsIndent !== null && indent > stepsIndent) {
      const dash = DASH_LINE.exec(line);
      if (dash && (stepDashIndent === null || dash[1].length === stepDashIndent)) {
        stepDashIndent = dash[1].length;
        closeStep();
        step = { name: null, continueOnError: null };
        job.steps.push(step);
        stepKeyIndent = dash[1].length + 1 + dash[2].length;
        const k = parseKey(" ".repeat(stepKeyIndent) + dash[3]);
        if (k) applyStepKey(step, k);
        if (k && BLOCK_SCALAR.test(scalar(k.value))) blockScalarIndent = stepKeyIndent;
        continue;
      }
      const k = parseKey(line);
      if (k && step && indent === stepKeyIndent) applyStepKey(step, k);
      if (k && BLOCK_SCALAR.test(scalar(k.value))) blockScalarIndent = indent;
      continue;
    }
    if (stepsIndent !== null && indent <= stepsIndent) closeSteps();

    // Job body.
    const k = parseKey(line);
    if (!k) continue;
    if (jobBodyIndent === null) jobBodyIndent = indent;
    if (indent === jobBodyIndent) {
      if (k.key === "continue-on-error") job.continueOnError = scalar(k.value);
      if (k.key === "<<") job.mergeKey = true;
      if (k.key === "steps") stepsIndent = indent;
    }
    if (BLOCK_SCALAR.test(scalar(k.value))) blockScalarIndent = indent;
  }

  return { hasJobsBlock, jobs, duplicateJobs };
}

function applyStepKey(step, k) {
  if (k.key === "name") step.name = scalar(k.value);
  if (k.key === "continue-on-error") step.continueOnError = scalar(k.value);
  if (k.key === "<<") step.mergeKey = true;
}

const isOff = (v) => v === null || v === "false";

export function evaluateCrossPlatformVerdictShape(text) {
  const findings = [];
  const shape = parseWorkflowShape(text);

  if (!shape.hasJobsBlock) {
    findings.push({ code: "no_jobs_block", detail: "no top-level `jobs:` block was found" });
  }
  for (const id of shape.duplicateJobs) {
    findings.push({ code: "duplicate_job", job: id, detail: `job \`${id}\` is declared more than once` });
  }

  for (const id of VERDICT_BEARING_JOBS) {
    const job = shape.jobs.get(id);
    if (!job) {
      findings.push({
        code: "verdict_job_missing",
        job: id,
        detail: `verdict-bearing job \`${id}\` not found — renamed or removed? This guard must not pass with nothing to check.`,
      });
      continue;
    }
    if (!isOff(job.continueOnError)) {
      findings.push({
        code: "verdict_job_continue_on_error",
        job: id,
        detail: `job-level \`continue-on-error: ${job.continueOnError}\` on a verdict-bearing job (E6-F023 option 3)`,
      });
    }
    if (job.mergeKey || job.steps.some((s) => s.mergeKey)) {
      findings.push({
        code: "unanalyzable_merge_key",
        job: id,
        detail: "a YAML merge key (`<<:`) hides the effective shape from this guard",
      });
    }
    for (const s of job.steps) {
      if (!isOff(s.continueOnError)) {
        findings.push({
          code: "verdict_step_continue_on_error",
          job: id,
          step: s.name,
          detail: `step \`${s.name ?? "(unnamed)"}\` carries \`continue-on-error: ${s.continueOnError}\` inside a verdict-bearing job — the E6-F023 install-bypass class`,
        });
      }
    }
  }

  for (const { job: id, step: name } of REQUIRED_STEPS) {
    const job = shape.jobs.get(id);
    if (!job || !job.steps.some((s) => s.name === name)) {
      findings.push({
        code: "required_step_missing",
        job: id,
        step: name,
        detail: `step \`${name}\` not found in \`${id}\` — renamed or removed? This guard must not pass with nothing to check.`,
      });
    }
  }

  return { ok: findings.length === 0, findings };
}
