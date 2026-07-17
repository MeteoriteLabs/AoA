/**
 * In-process Commander turn claim registry (PR #291 round-3 review, P1 #1).
 *
 * Problem: a duplicate Send that arrives AFTER the first request has committed
 * its user row but BEFORE it finishes streaming/persisting the assistant reply
 * finds the prior user row with no linked reply. Round-2 treated that as a dead
 * orphan and re-ran the CLI — but if the original request is still streaming,
 * that double-executes the Commander turn and its tools.
 *
 * The user row + "no reply yet" state is IDENTICAL whether the original request
 * is (a) still running or (b) genuinely dead (config error / CLI crash — the
 * request already returned). Timing heuristics cannot tell them apart: a
 * concurrent duplicate and a fast Retry-after-error both arrive within seconds.
 * The only reliable discriminator is whether the original request is STILL
 * EXECUTING. This registry records exactly that: a turn key is claimed for the
 * lifetime of its CLI run and released in a `finally`, so:
 *   - claimed  → the original request is still running here → signal in-progress
 *                (do NOT re-run — no double execution).
 *   - unclaimed→ the original request ended (finished or died) → safe to re-run
 *                the orphan (preserves round-2 Retry-after-error recovery).
 *
 * Scope: single Node process. This closes the reported double-run for the
 * common single-process / single-container deployment (both SSE streams are
 * handled by the same process). A fully cross-instance guarantee needs a
 * durable claim (a DB status/lock column) — tracked as a follow-up; the DB
 * client-submission unique index still backstops the simultaneous-insert case
 * across instances.
 */

const inFlight = new Set<string>();

/** Stable key for a Commander turn's idempotency claim. */
export function commanderTurnKey(conversationId: string, clientSubmissionId: string): string {
  return `${conversationId}::${clientSubmissionId}`;
}

/** Mark a turn as actively executing in this process. */
export function claimCommanderTurn(key: string): void {
  inFlight.add(key);
}

/**
 * Atomically claim a turn: returns true if THIS caller acquired it, false if it
 * was already held. JS is single-threaded, so the has()+add() below runs with no
 * `await` between them and cannot interleave with another request — this is the
 * race-safe replacement for a check-then-claim pair (PR #291 round-4 review).
 */
export function tryClaimCommanderTurn(key: string): boolean {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

/** Release a turn's claim once its run finishes (call from a `finally`). */
export function releaseCommanderTurn(key: string): void {
  inFlight.delete(key);
}

/** True while the turn's original request is still executing in this process. */
export function isCommanderTurnInFlight(key: string): boolean {
  return inFlight.has(key);
}
