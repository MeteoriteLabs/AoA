/**
 * Eval framework — shared types (Phase F1, T10 foundation).
 *
 * The Phase F LLM eval suites lock in subjective decision contracts for the
 * Thread-Native crew agents (Adjutant readiness, Memory Keeper extraction,
 * Planner completeness, etc.). Each suite is a fixture-driven test of one
 * agent's judgement: a list of cases is fed through the system under test
 * and the output is graded — sometimes by exact match, sometimes by an LLM
 * rubric — to detect silent regressions when prompts change.
 *
 * A "suite" here is the smallest unit that can be run end-to-end:
 *   - a stable `name` (used in CI summary lines)
 *   - a list of `cases` loaded from fixture files
 *   - a `runOne` that turns a single case input into an actual output
 *   - a `grade` that scores that output against the expected value
 *
 * F2–F4 wire concrete suites on top of this foundation; this file holds the
 * shape they all share.
 */

export interface EvalCase<TInput = unknown, TExpected = unknown> {
  /** Stable identifier — also the fixture filename stem. */
  id: string;
  /** Input passed to suite.runOne. Shape is suite-specific. */
  input: TInput;
  /** Expected output + grading mode. */
  expected: {
    type: "exact" | "contains" | "llm-graded";
    value: TExpected;
    /** Required when type === "llm-graded". A prose rubric the grader follows. */
    rubric?: string;
  };
}

export interface EvalGrade {
  pass: boolean;
  /** 0..1 — granular grade. For "exact" matches: 1.0 or 0.0. */
  score: number;
  /** Human-readable explanation of why it passed/failed. */
  reason: string;
}

export interface EvalSuite<TInput = unknown, TActual = unknown, TExpected = unknown> {
  name: string;
  cases: Array<EvalCase<TInput, TExpected>>;
  /** Run a single case input through the system under test. */
  runOne(input: TInput): Promise<TActual>;
  /** Grade the actual output against the expected output. */
  grade(actual: TActual, expected: EvalCase<TInput, TExpected>["expected"]): Promise<EvalGrade>;
}

export interface EvalCaseResult extends EvalGrade {
  caseId: string;
  /** Optional — captured for debugging when the suite chooses to surface it. */
  actual?: unknown;
  /** ms wall-clock for this case (runOne + grade). */
  durationMs: number;
}

export interface EvalSuiteResult {
  name: string;
  total: number;
  pass: number;
  /** Number of cases below pass threshold. Useful for CI summary lines. */
  fail: number;
  results: EvalCaseResult[];
}
