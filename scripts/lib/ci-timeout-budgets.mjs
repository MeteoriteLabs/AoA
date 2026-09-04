// A required check whose verdict is a function of something the commit does not contain.
//
// ★ WHY THIS EXISTS. Three instances of that class landed in three days (E3-F034 runner
// fsync vs a 750 ms `lock_timeout`; E3-F036 npm-registry latency vs a 30 s `testTimeout`
// under a 120,000 ms install budget; E6-F014 `pnpm/action-setup` vs a 5-minute job cap).
// Each was fixed one instance at a time, and E6-F014's fix — raise `policy` 5 → 12 — closed
// ONE of the NINE jobs in pr.yml that run the same step. Nothing would have caught the tenth.
//
// ★★ WHAT MAKES A CAP DISHONEST. `timeout-minutes` on a job is ONE number asked to bound TWO
// unrelated distributions. Measured on this repo across 13 runs of pr.yml on
// docs/replatform-program (2026-09-04):
//
//   the WORK (job total minus `Setup pnpm`)   p50 → max ratio 1.06 – 1.78, every job
//   the `Setup pnpm` step                     p50 4 s, max 431 s — a ratio near 108
//
// At the time of that measurement the workflow had nine `Setup pnpm` steps, and they were the
// nine highest-variance steps in it — `brand-check`'s was then deleted outright, leaving eight
// (the manifest's `exempt` entry records why). All nine ranked above every other step; the
// tenth-worst is `verify :: Run tests` at a 173 s spread, which is real work. So a single cap
// sized for work + worst-observed-infrastructure is necessarily loose enough to hide a work
// regression by the whole size of the infrastructure allowance — and when it does fire,
// GitHub blames whichever step happened to be running at the wall (E6-F014 addendum: four
// different innocent steps accused across eight cancelled attempts).
//
// ★★★ THE INSTRUMENT. Split the budget and DERIVE the cap:
//
//     job timeout-minutes  ==  ceil((workBudgetSeconds + setupAllowanceSeconds) / 60)
//     step timeout-minutes ==  ceil(setupAllowanceSeconds / 60)
//
// The step cap makes a slow registry fail BY NAME instead of eating an unrelated step's
// budget. The job cap then bounds the WORK, which is the only part the commit owns. And
// because the cap is a function of two declared numbers, RAISING IT IS NOT A FREE MOVE: you
// must raise `workBudgetSeconds`, which is bounded above by `MAX_WORK_BUDGET_FACTOR ×
// measuredMaxWorkSeconds` — a number that must be re-measured, dated, and attributed to real
// run ids in the same diff. "Raise the cap until it stops complaining" is refused by clause
// `work_budget_unjustified`.
//
// Pure. The caller supplies the parsed workflow and the manifest.

/** A work budget may exceed the measured maximum by at most this factor. Two is deliberately
 * generous — the point is not to squeeze, it is to make an UNBOUNDED raise impossible without
 * a new measurement. `verify` sat at 60 minutes against a measured 18-minute worst work, and
 * that 42 minutes of undeclared slack once masked a real hang for weeks. */
export const MAX_WORK_BUDGET_FACTOR = 2;

/** Fewer samples than this is not a measurement. Each instance of this class was first
 * "explained" from a single red run, before anyone counted. */
export const MIN_MEASUREMENT_SAMPLE_SIZE = 5;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function derivedJobCapMinutes(entry) {
  return Math.ceil((entry.workBudgetSeconds + entry.setupAllowanceSeconds) / 60);
}

export function derivedStepCapMinutes(entry) {
  return Math.ceil(entry.setupAllowanceSeconds / 60);
}

/**
 * Scan a GitHub workflow into the shape this guard reasons about.
 *
 * Deliberately a line scanner rather than a YAML parse: `steps:` is a sequence of mappings,
 * which this repo's dependency-free yaml-lite does not model, and `check-ci-lanes.mjs` made
 * the same call for the same reason. Indentation in pr.yml is fixed — jobs at 2, job keys at
 * 4, step items at 6, step keys at 8 — and `assertScannerSawTheWorkflow` refuses a silent
 * zero-match parse, which is the failure mode a scanner actually has.
 */
export function parseWorkflowJobs(text) {
  const lines = String(text).split(/\r?\n/);
  const jobStarts = [];
  let inJobs = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    if (/^\S/.test(line) && line.trim() !== "") inJobs = false;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) jobStarts.push({ id: m[1], line: i });
  }

  const jobs = [];
  for (let k = 0; k < jobStarts.length; k += 1) {
    const start = jobStarts[k].line;
    const end = k + 1 < jobStarts.length ? jobStarts[k + 1].line : lines.length;
    const body = lines.slice(start, end);

    const capLine = body.find((l) => /^ {4}timeout-minutes:\s*\d+\s*$/.test(l));
    const timeoutMinutes = capLine ? Number(/(\d+)/.exec(capLine)[1]) : null;

    const needsLine = body.find((l) => /^ {4}needs:\s*\[/.test(l));
    const needs = needsLine
      ? needsLine
          .slice(needsLine.indexOf("[") + 1, needsLine.lastIndexOf("]"))
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    // Step blocks: a `      - ` line starts one, and it runs to the next one or the job's end.
    const stepStarts = [];
    for (let i = 0; i < body.length; i += 1) {
      if (/^ {6}- /.test(body[i])) stepStarts.push(i);
    }
    let pnpmSetup = null;
    for (let s = 0; s < stepStarts.length; s += 1) {
      const sFrom = stepStarts[s];
      const sTo = s + 1 < stepStarts.length ? stepStarts[s + 1] : body.length;
      const stepBody = body.slice(sFrom, sTo);
      if (!stepBody.some((l) => /pnpm\/action-setup/.test(l))) continue;
      const nameLine = stepBody.find((l) => /^ {6}- name:\s*\S/.test(l));
      const stepCapLine = stepBody.find((l) => /^ {8}timeout-minutes:\s*\d+\s*$/.test(l));
      pnpmSetup = {
        name: nameLine ? nameLine.replace(/^ {6}- name:\s*/, "").trim() : "(unnamed step)",
        line: start + sFrom + 1,
        timeoutMinutes: stepCapLine ? Number(/(\d+)/.exec(stepCapLine)[1]) : null,
      };
      break;
    }

    jobs.push({ id: jobStarts[k].id, line: start + 1, timeoutMinutes, needs, pnpmSetup });
  }
  return jobs;
}

/**
 * A scanner that silently matches nothing reports a clean workflow. This programme has a name
 * for that — a check that nothing runs is not a check — so the scan asserts it saw a workflow
 * before any verdict is computed.
 */
export function assertScannerSawTheWorkflow(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return "scanner_found_no_jobs";
  }
  if (!jobs.some((j) => j.pnpmSetup)) {
    return "scanner_found_no_pnpm_setup_steps";
  }
  return null;
}

/**
 * @param {object} input
 * @param {Array}  input.jobs           output of parseWorkflowJobs
 * @param {object} input.manifest       the budget manifest
 * @param {string} input.requiredJobId  aggregator job whose `needs` defines the required lane
 */
export function evaluateCiTimeoutBudgets({ jobs, manifest, requiredJobId = "ci-required" }) {
  const findings = [];
  const add = (code, job, detail) => findings.push({ code, job, detail });

  const scanFailure = assertScannerSawTheWorkflow(jobs);
  if (scanFailure) {
    add(scanFailure, null, "the workflow scan produced nothing to check; refusing to pass");
    return { ok: false, findings };
  }

  const budgets = (manifest && manifest.jobs) || {};
  const exempt = (manifest && manifest.exempt) || {};
  const byId = new Map(jobs.map((j) => [j.id, j]));

  // 1 + 2 — the manifest and the workflow must describe the same set of exposures.
  for (const job of jobs) {
    if (!job.pnpmSetup) continue;
    if (!Object.prototype.hasOwnProperty.call(budgets, job.id)) {
      add(
        "job_missing_budget",
        job.id,
        "job runs pnpm/action-setup (line " +
          job.pnpmSetup.line +
          ") but has no entry in the budget manifest",
      );
    }
  }
  for (const id of Object.keys(budgets)) {
    const job = byId.get(id);
    if (!job) {
      add("budget_orphan", id, "manifest budgets a job that does not exist in the workflow");
      continue;
    }
    if (!job.pnpmSetup) {
      add(
        "budget_orphan",
        id,
        "manifest budgets a pnpm setup allowance for a job that no longer runs pnpm/action-setup",
      );
    }
  }

  // 3-8 — every budgeted job's caps must be DERIVED from a dated measurement.
  for (const [id, entry] of Object.entries(budgets)) {
    const job = byId.get(id);
    if (!job || !job.pnpmSetup) continue;

    const nums = ["workBudgetSeconds", "setupAllowanceSeconds", "measuredMaxWorkSeconds"];
    const badNum = nums.find((k) => !Number.isFinite(entry[k]) || entry[k] <= 0);
    if (badNum) {
      add("measurement_incomplete", id, "`" + badNum + "` must be a positive number");
      continue;
    }
    if (
      !Number.isFinite(entry.measuredSampleSize) ||
      entry.measuredSampleSize < MIN_MEASUREMENT_SAMPLE_SIZE
    ) {
      add(
        "measurement_incomplete",
        id,
        "`measuredSampleSize` must be >= " +
          MIN_MEASUREMENT_SAMPLE_SIZE +
          "; got " +
          String(entry.measuredSampleSize),
      );
    }
    if (typeof entry.measuredOn !== "string" || !ISO_DATE.test(entry.measuredOn)) {
      add("measurement_incomplete", id, "`measuredOn` must be a YYYY-MM-DD date");
    }
    if (!Array.isArray(entry.measuredRuns) || entry.measuredRuns.length === 0) {
      add("measurement_incomplete", id, "`measuredRuns` must name at least one workflow run id");
    }

    if (entry.workBudgetSeconds < entry.measuredMaxWorkSeconds) {
      add(
        "work_budget_below_measurement",
        id,
        "workBudgetSeconds " +
          entry.workBudgetSeconds +
          " is below the measured worst work " +
          entry.measuredMaxWorkSeconds +
          "s — the job would red on a normal run",
      );
    }
    const ceiling = MAX_WORK_BUDGET_FACTOR * entry.measuredMaxWorkSeconds;
    if (entry.workBudgetSeconds > ceiling) {
      add(
        "work_budget_unjustified",
        id,
        "workBudgetSeconds " +
          entry.workBudgetSeconds +
          " exceeds " +
          MAX_WORK_BUDGET_FACTOR +
          "x the measured worst work (" +
          entry.measuredMaxWorkSeconds +
          "s -> " +
          ceiling +
          "s). Re-measure and record it, or lower the budget; a cap raised past its own " +
          "measurement hides the regression it was meant to catch.",
      );
    }

    const wantStep = derivedStepCapMinutes(entry);
    if (job.pnpmSetup.timeoutMinutes === null) {
      add(
        "setup_step_uncapped",
        id,
        'step "' +
          job.pnpmSetup.name +
          '" (line ' +
          job.pnpmSetup.line +
          ") has no timeout-minutes; a slow registry silently spends the JOB budget and " +
          "GitHub blames whichever step is running at the wall",
      );
    } else if (job.pnpmSetup.timeoutMinutes !== wantStep) {
      add(
        "setup_step_cap_mismatch",
        id,
        'step "' +
          job.pnpmSetup.name +
          '" has timeout-minutes: ' +
          job.pnpmSetup.timeoutMinutes +
          "; derived from setupAllowanceSeconds " +
          entry.setupAllowanceSeconds +
          " it must be " +
          wantStep,
      );
    }

    const wantJob = derivedJobCapMinutes(entry);
    if (job.timeoutMinutes === null) {
      add("job_cap_missing", id, "job has no timeout-minutes");
    } else if (job.timeoutMinutes !== wantJob) {
      add(
        "job_cap_mismatch",
        id,
        "job has timeout-minutes: " +
          job.timeoutMinutes +
          "; derived from workBudgetSeconds " +
          entry.workBudgetSeconds +
          " + setupAllowanceSeconds " +
          entry.setupAllowanceSeconds +
          " it must be " +
          wantJob,
      );
    }
  }

  // 9 + 10 — the required lane is closed: every job the aggregator consumes is budgeted, or
  // exempt WITH A REASON. This is the clause that catches instance ten, whatever step carries it.
  const required = byId.get(requiredJobId);
  if (!required) {
    add("required_job_missing", requiredJobId, "aggregator job not found in the workflow");
  } else {
    for (const id of required.needs) {
      const job = byId.get(id);
      if (!job) continue;
      if (job.timeoutMinutes === null) continue;
      if (Object.prototype.hasOwnProperty.call(budgets, id)) continue;
      const ex = exempt[id];
      if (!ex) {
        add(
          "required_lane_unbudgeted",
          id,
          "required-lane job carries timeout-minutes: " +
            job.timeoutMinutes +
            " but is neither budgeted nor exempt",
        );
      } else if (typeof ex.reason !== "string" || ex.reason.trim().length < 20) {
        add("exempt_without_reason", id, "an exemption must carry a reason a human can argue with");
      }
    }
  }

  return { ok: findings.length === 0, findings };
}
