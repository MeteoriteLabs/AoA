// Self-test for the gate-clause wiring guard.
//
// ★ The test that matters is `claimed_wired_but_no_caller` — that single verdict is what
// the 2026-08-25 exit-gate audit had to find by hand across ~70 clauses, and it is what
// would have stopped four epics reporting `complete` while the capability they name had
// never once run.

import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateGateClauseWiring } from "../gate-clause-wiring.mjs";

const kinds = (r) => r.problems.map((p) => p.kind);

test("★ claiming wired with ZERO callers FAILS — the whole point", () => {
  const r = evaluateGateClauseWiring({
    declared: { "E4-1": { status: "wired", symbol: "createPollLoop", epic: "E4" } },
    callerCounts: { createPollLoop: 0 },
  });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ["claimed_wired_but_no_caller"]);
  assert.match(r.problems[0].detail, /createPollLoop has 0 production callers/);
});

test("wired with a real caller passes", () => {
  const r = evaluateGateClauseWiring({
    declared: { "E11-5": { status: "wired", symbol: "evaluateKillSwitches", epic: "E11" } },
    callerCounts: { evaluateKillSwitches: 2 },
  });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.wiredCount, 1);
});

test("★ unwired is ALLOWED but must say why, and is REPORTED on a green run", () => {
  const ok = evaluateGateClauseWiring({
    declared: { "E4-2": { status: "unwired", symbol: "createSupervisor", reason: "needs DEP-010 provider + WRK-008 2b" } },
    callerCounts: { createSupervisor: 0 },
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.problems));
  assert.deepEqual(ok.unwired, ["E4-2"]);

  const noReason = evaluateGateClauseWiring({
    declared: { "E4-2": { status: "unwired", symbol: "createSupervisor", reason: "  " } },
    callerCounts: { createSupervisor: 0 },
  });
  assert.equal(noReason.ok, false);
  assert.deepEqual(kinds(noReason), ["malformed_declaration"]);
});

test("★ an unwired clause that GAINED a caller is surfaced, not silently tolerated", () => {
  // A register nobody updates in either direction stops being believed.
  const r = evaluateGateClauseWiring({
    declared: { "E5-3": { status: "unwired", symbol: "runOrphanQuarantine", reason: "no producer" } },
    callerCounts: { runOrphanQuarantine: 1 },
  });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ["unwired_but_now_has_caller"]);
});

test("a symbol nobody measured fails rather than being assumed wired", () => {
  const r = evaluateGateClauseWiring({
    declared: { "E3-5": { status: "wired", symbol: "jobApprovalBridge" } },
    callerCounts: {},
  });
  assert.equal(r.ok, false);
  assert.deepEqual(kinds(r), ["symbol_not_measured"]);
});

test("a declaration with no symbol, or a bad status, is malformed", () => {
  for (const entry of [{ status: "wired" }, { status: "sortof", symbol: "x" }, null, "nope"]) {
    const r = evaluateGateClauseWiring({ declared: { C: entry }, callerCounts: { x: 1 } });
    assert.equal(r.ok, false, JSON.stringify(entry));
    assert.deepEqual(kinds(r), ["malformed_declaration"]);
  }
});

test("malformed input fails closed rather than reporting OK", () => {
  for (const bad of [null, undefined, 42, "nope", {}, { declared: {}, callerCounts: null }]) {
    assert.equal(evaluateGateClauseWiring(bad).ok, false, JSON.stringify(bad));
  }
});

test("★ POSITIVE CONTROL — a fully-wired manifest is green and counts correctly", () => {
  // Without this, every failure test above could be passing because the evaluator refuses
  // everything. This is the E1-F008 lesson applied to the guard's own suite.
  const r = evaluateGateClauseWiring({
    declared: {
      A: { status: "wired", symbol: "a" },
      B: { status: "wired", symbol: "b" },
      C: { status: "unwired", symbol: "c", reason: "dormant until DEP-010" },
    },
    callerCounts: { a: 1, b: 3, c: 0 },
  });
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.equal(r.wiredCount, 2);
  assert.deepEqual(r.unwired, ["C"]);
});

test("★ expectedReferences allows a KNOWN-unreachable reference, and still catches a new one", () => {
  // runBrowserSession is referenced once (runner.ts) but nothing invokes runner.ts, because
  // no package depends on browser-runtime. Acknowledging the known count keeps the promote
  // check sharp without forcing a false `wired`.
  const entry = (extra) => ({
    "E8-1": { status: "unwired", symbol: "runBrowserSession", reason: "no importer; runner.ts is unreachable", ...extra },
  });
  const at1 = evaluateGateClauseWiring({ declared: entry({ expectedReferences: 1 }), callerCounts: { runBrowserSession: 1 } });
  assert.equal(at1.ok, true, JSON.stringify(at1.problems));

  // A NEW reference appears -> still caught.
  const at2 = evaluateGateClauseWiring({ declared: entry({ expectedReferences: 1 }), callerCounts: { runBrowserSession: 2 } });
  assert.equal(at2.ok, false);
  assert.deepEqual(at2.problems.map((p) => p.kind), ["unwired_but_now_has_caller"]);

  // And an unacknowledged reference is still caught (default expected is 0).
  const at3 = evaluateGateClauseWiring({ declared: entry({}), callerCounts: { runBrowserSession: 1 } });
  assert.equal(at3.ok, false);
});
