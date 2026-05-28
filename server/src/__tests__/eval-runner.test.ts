import { describe, expect, it, vi } from "vitest";
import { runEvalSuite } from "../eval/runner.js";
import type { EvalSuite, EvalCase } from "../eval/types.js";

function makeCase<TInput, TExpected>(
  id: string,
  input: TInput,
  expected: EvalCase<TInput, TExpected>["expected"],
): EvalCase<TInput, TExpected> {
  return { id, input, expected };
}

describe("runEvalSuite", () => {
  it("runs all cases and aggregates pass/fail counts", async () => {
    const suite: EvalSuite<number, number, number> = {
      name: "doubler",
      cases: [
        makeCase("a", 1, { type: "exact", value: 2 }),
        makeCase("b", 2, { type: "exact", value: 4 }),
        makeCase("c", 3, { type: "exact", value: 999 }), // will fail
      ],
      async runOne(n) { return n * 2; },
      async grade(actual, expected) {
        const pass = actual === expected.value;
        return { pass, score: pass ? 1 : 0, reason: pass ? "ok" : `got ${actual}` };
      },
    };

    const result = await runEvalSuite(suite);
    expect(result.name).toBe("doubler");
    expect(result.total).toBe(3);
    expect(result.pass).toBe(2);
    expect(result.fail).toBe(1);
    expect(result.results.find((r) => r.caseId === "c")?.pass).toBe(false);
    expect(result.results.find((r) => r.caseId === "c")?.reason).toContain("got 6");
  });

  it("captures durationMs per case", async () => {
    const suite: EvalSuite<void, void, void> = {
      name: "timing",
      cases: [makeCase("only", undefined, { type: "exact", value: undefined })],
      async runOne() { await new Promise((r) => setTimeout(r, 5)); },
      async grade() { return { pass: true, score: 1, reason: "ok" }; },
    };
    const result = await runEvalSuite(suite);
    expect(result.results[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("treats thrown errors in runOne as pass:false with the error reason", async () => {
    const suite: EvalSuite<void, void, void> = {
      name: "throwy",
      cases: [makeCase("boom", undefined, { type: "exact", value: undefined })],
      async runOne() { throw new Error("kaboom"); },
      async grade() { return { pass: true, score: 1, reason: "ok" }; },
    };
    const result = await runEvalSuite(suite);
    expect(result.pass).toBe(0);
    expect(result.fail).toBe(1);
    expect(result.results[0].reason).toContain("kaboom");
  });

  it("treats thrown errors in grade as pass:false", async () => {
    const suite: EvalSuite<void, void, void> = {
      name: "throwy-grade",
      cases: [makeCase("boom-grade", undefined, { type: "exact", value: undefined })],
      async runOne() { /* ok */ },
      async grade() { throw new Error("grade-failed"); },
    };
    const result = await runEvalSuite(suite);
    expect(result.pass).toBe(0);
    expect(result.results[0].reason).toContain("grade-failed");
  });

  it("runs cases in parallel (smoke test via timing)", async () => {
    const suite: EvalSuite<number, void, void> = {
      name: "parallel",
      cases: [
        makeCase("a", 50, { type: "exact", value: undefined }),
        makeCase("b", 50, { type: "exact", value: undefined }),
        makeCase("c", 50, { type: "exact", value: undefined }),
      ],
      async runOne(ms) { await new Promise((r) => setTimeout(r, ms)); },
      async grade() { return { pass: true, score: 1, reason: "ok" }; },
    };
    const startedAt = Date.now();
    await runEvalSuite(suite);
    const elapsed = Date.now() - startedAt;
    // Sequential would be ~150ms; parallel should be ~50ms. Allow generous slack.
    expect(elapsed).toBeLessThan(120);
  });
});
