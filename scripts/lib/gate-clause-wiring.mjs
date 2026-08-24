// An epic gate clause may not claim a capability whose production path has no caller.
//
// ★ WHY THIS EXISTS. The 2026-08-25 exit-gate audit verdicted ~70 gate clauses across
// E0..E11 and found **17 UNPROVABLE** — the clause names a capability, a ticket delivered
// the mechanism, and no boot root reaches it. Not "untested": unreachable. Examples that
// were all reported inside `complete` epics:
//   createPollLoop, createSupervisor, createStartupReconciler, openEventOutboxStore,
//   createEventOutboxDrain, createResultCommitter, createPatchApplyService,
//   createFenceAwareEgressProxy, jobApprovalBridge, jobBudgetCostBridge, jobAuditBridge,
//   jobOutputBridge, createExecutionTargetRevocationFanout, createDistributedExecutionDrain
//
// The pattern the audit named: **every ticket doc was honest; the aggregation was not.**
// `bin/worker-daemon.ts` says "INERT" four times. CLI-006's result says its volume clauses
// "are NOT claimed here". SVC-001 says "storage half only". Nobody over-claimed at the
// ticket level. What over-claimed was "epic complete", counted by TICKETS SHIPPED rather
// than by whether the capability runs.
//
// ★ WHY DECLARATION-BASED. The tempting version parses the gate prose and infers which
// symbol each clause names. That inference was tried in this repo for a neighbouring guard
// and was WRONG FIVE TIMES IN BOTH DIRECTIONS. So a human states the mapping, and the
// machine verifies only the cheap, mechanical half: does that symbol have a caller that is
// not a test and not a comment.
//
// ★ WHY `unwired` IS ALLOWED. A guard that forbids honest debt gets deleted. `unwired` is
// permitted and REPORTED ON A GREEN RUN, so a dormant capability stays visible instead of
// silently passing as complete. What is forbidden is claiming `wired` when nothing calls it.
//
// Pure. The caller supplies the manifest and a callerCount lookup.

/**
 * wired   — a production caller exists. The guard verifies it and FAILS if the count is 0.
 * unwired — deliberately dormant. `reason` must say what would have to change. Reported.
 */
export const GATE_CLAUSE_STATUSES = Object.freeze(["wired", "unwired"]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasReason(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {{
 *   declared?: Record<string, {status: string, symbol?: string, epic?: string, reason?: string}>,
 *   callerCounts?: Record<string, number>,   // symbol -> production caller count
 * }} input
 * @returns {{ok: boolean, problems: Array<{kind: string, clause: string|null, detail?: string}>,
 *            wiredCount: number, unwired: string[]}}
 */
export function evaluateGateClauseWiring(input) {
  const problems = [];
  if (!isPlainObject(input)) {
    return { ok: false, problems: [{ kind: "malformed_input", clause: null }], wiredCount: 0, unwired: [] };
  }
  const { declared, callerCounts } = input;
  if (!isPlainObject(declared) || !isPlainObject(callerCounts)) {
    return { ok: false, problems: [{ kind: "malformed_input", clause: null }], wiredCount: 0, unwired: [] };
  }

  const unwired = [];
  let wiredCount = 0;

  for (const clause of Object.keys(declared).sort()) {
    const entry = declared[clause];
    if (!isPlainObject(entry) || !GATE_CLAUSE_STATUSES.includes(entry.status)) {
      problems.push({ kind: "malformed_declaration", clause, detail: String(entry && entry.status) });
      continue;
    }
    if (typeof entry.symbol !== "string" || entry.symbol.length === 0) {
      problems.push({ kind: "malformed_declaration", clause, detail: "symbol missing" });
      continue;
    }
    const count = callerCounts[entry.symbol];
    if (typeof count !== "number") {
      // A symbol nobody measured is not evidence of anything. Fail rather than assume.
      problems.push({ kind: "symbol_not_measured", clause, detail: entry.symbol });
      continue;
    }
    if (entry.status === "wired") {
      // THE CHECK THIS GUARD EXISTS FOR.
      if (count === 0) {
        problems.push({ kind: "claimed_wired_but_no_caller", clause, detail: `${entry.symbol} has 0 production callers` });
        continue;
      }
      wiredCount += 1;
      continue;
    }
    // unwired
    if (!hasReason(entry.reason)) {
      problems.push({ kind: "malformed_declaration", clause, detail: "unwired needs a reason" });
      continue;
    }
    // ★ An `unwired` entry that has SINCE acquired a caller is good news the manifest is
    // hiding. Surface it so the clause gets promoted rather than staying pessimistic - a
    // register nobody updates in either direction stops being believed.
    //
    // `expectedReferences` exists because a non-zero count does not always mean reachable.
    // `runBrowserSession` is referenced once, by `runner.ts`, which nothing invokes because
    // no package depends on `browser-runtime` at all. Acknowledging a KNOWN count keeps the
    // promote-check sharp — it still fires the moment a NEW reference appears — without
    // forcing a false `wired`. The number must be typed out, so nobody can wave away an
    // arbitrary quantity of references by accident.
    const expected = typeof entry.expectedReferences === "number" ? entry.expectedReferences : 0;
    if (count > expected) {
      problems.push({
        kind: "unwired_but_now_has_caller",
        clause,
        detail: `${entry.symbol} has ${count} reference(s), expected ${expected} - promote to wired, or raise expectedReferences and say why`,
      });
      continue;
    }
    unwired.push(clause);
  }

  return { ok: problems.length === 0, problems, wiredCount, unwired };
}
