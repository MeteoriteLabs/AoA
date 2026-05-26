/**
 * Result returned by runAoaAgent (T1.0 — failure contract).
 *
 * Before T1.0: runAoaAgent returned `void`, swallowed errors, and the
 * dispatcher inferred success by the absence of a thrown exception. This
 * silently marked wakeups as 'succeeded' whenever the adapter exited
 * cleanly even if the run produced no useful work. Codex outside-voice
 * caught this (findings #1, #2, #3).
 *
 * After T1.0: runAoaAgent returns AoaRunResult so the dispatcher can:
 *   1. Set agent_wakeup_requests.status from the actual outcome
 *      (succeeded/failed reflecting what the adapter reported, not just
 *      whether the runner threw)
 *   2. Persist the adapter's reported usage + cost to internal_agent_runs
 *      (claude/codex/opencode/gemini adapters all populate these on the
 *      AdapterExecutionResult; today the data is discarded)
 *   3. Use the failure path (T1.5 silent-failure guard, T1.9
 *      failure-storm brake) without inventing a third channel
 *
 * The runner still does its own internal_agent_runs writes (status,
 * duration, errorMessage) — that is part of its run lifecycle and was
 * already correct. AoaRunResult just exposes the same truth to callers
 * for their own bookkeeping (the wakeup row, the rate brake, etc.).
 *
 * Cost convention:
 *   - costCents is an integer (cents). Computed from adapter result.costUsd
 *     via Math.round(costUsd * 100). Null when the adapter doesn't report
 *     cost (e.g. CLI subscription mode where billing is flat).
 *   - usage carries the raw token counts from the adapter so the
 *     dispatcher can persist tokenUsage JSONB.
 */

import type { UsageSummary } from "../../../adapters/types.js";

export type AoaRunStatus = "succeeded" | "failed";

/**
 * Translate an AdapterExecutionResult into an AoaRunResult. Pure function;
 * exhaustively unit-tested. Centralizes the success/failure decision so
 * the runner doesn't need to repeat the logic in two places (success path
 * + catch path).
 */
export function buildAoaRunResultFromAdapter(adapterResult: {
  exitCode: number | null;
  errorMessage?: string | null;
  usage?: UsageSummary;
  costUsd?: number | null;
}): AoaRunResult {
  const failed =
    (adapterResult.exitCode !== null && adapterResult.exitCode !== 0)
    || Boolean(adapterResult.errorMessage);
  const costCents = typeof adapterResult.costUsd === "number"
    ? Math.round(adapterResult.costUsd * 100)
    : null;
  return {
    status: failed ? "failed" : "succeeded",
    errorMessage: failed
      ? (adapterResult.errorMessage ?? `exit ${adapterResult.exitCode}`)
      : undefined,
    costCents,
    usage: adapterResult.usage,
  };
}

export interface AoaRunResult {
  /** Terminal outcome. 'failed' covers: adapter threw, adapter returned
   *  non-zero exit code, adapter returned errorMessage, or the runner's
   *  own guards (e.g. silent-failure guard from T1.5) tripped. */
  status: AoaRunStatus;

  /** Human-readable failure summary. Set when status='failed'; omitted
   *  on success. Sourced from adapter.errorMessage when the adapter
   *  reports one, otherwise the caught exception's message. */
  errorMessage?: string;

  /** Integer cents, computed from adapter.costUsd. Null when the adapter
   *  ran in subscription/free mode and reports no per-run cost. The
   *  dispatcher's rate-brake gates on costCents > 0 so a null/zero value
   *  intentionally does not count toward the LLM-spend safety net (T1.1).
   *  A separate failure-storm brake (T1.9) gates on status='failed'. */
  costCents?: number | null;

  /** Raw usage counts from the adapter, persisted as internal_agent_runs.tokenUsage
   *  JSONB. Pass through verbatim from AdapterExecutionResult.usage. */
  usage?: UsageSummary;
}
