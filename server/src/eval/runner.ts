/**
 * Eval framework — suite runner (Phase F1, T10 foundation).
 *
 * This is the small, opinionated executor that the Phase F LLM eval suites
 * sit on top of. A "suite" pairs a list of fixture cases with a `runOne`
 * (the system under test) and a `grade` function; this runner takes the
 * suite, executes every case in parallel, captures wall-clock duration,
 * and aggregates pass/fail counts for CI reporting.
 *
 * Errors are swallowed into pass:false results on purpose: a single broken
 * fixture or flaky grader should never tank the whole run, because the
 * suite results are the signal CI uses to decide whether prompt edits
 * regressed agent behavior.
 *
 * F2–F4 build concrete suites (Adjutant, Memory Keeper, Planner) using
 * this runner — see `./types.ts` for the suite contract itself.
 */

import type { EvalSuite, EvalSuiteResult, EvalCaseResult } from "./types.js";

/**
 * Run all cases in a suite. Cases execute in parallel — the suite is
 * responsible for any rate-limiting it needs (e.g., OpenAI tier limits).
 *
 * Errors thrown by runOne or grade become pass:false with the error message
 * as the reason, so one bad fixture can't tank the whole run.
 */
export async function runEvalSuite<TInput, TActual, TExpected>(
  suite: EvalSuite<TInput, TActual, TExpected>,
): Promise<EvalSuiteResult> {
  const results: EvalCaseResult[] = await Promise.all(
    suite.cases.map(async (c) => {
      const startedAt = Date.now();
      try {
        const actual = await suite.runOne(c.input);
        const grade = await suite.grade(actual, c.expected);
        return {
          caseId: c.id,
          pass: grade.pass,
          score: grade.score,
          reason: grade.reason,
          actual,
          durationMs: Date.now() - startedAt,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          caseId: c.id,
          pass: false,
          score: 0,
          reason: `threw: ${message}`,
          durationMs: Date.now() - startedAt,
        };
      }
    }),
  );

  const passCount = results.filter((r) => r.pass).length;
  return {
    name: suite.name,
    total: results.length,
    pass: passCount,
    fail: results.length - passCount,
    results,
  };
}
