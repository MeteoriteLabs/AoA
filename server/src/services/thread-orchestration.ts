/**
 * Thread Orchestration Controller — P1-T3 state bookkeeping.
 *
 * Manages the per-thread `thread_orchestration_state` row that drives the
 * Adjutant agent idempotently as a conversation advances. This module is
 * responsible ONLY for creating and marking the controller as pending — the
 * actual Adjutant run executor is wired in a later task (P1-T4+).
 *
 * Two public operations:
 *
 *   `ensureController(threadId)` — idempotent INSERT: guarantees exactly one
 *   controller row exists for the thread. Uses `onConflictDoNothing` so two
 *   concurrent callers converge on the same row without error.
 *
 *   `triggerOnHumanEntry(threadId)` — marks the controller as "a run is due":
 *   sets `pendingRun = true`, increments `runEpoch`, resets `hopCount = 0`.
 *   Calls `ensureController` first so callers don't need to pre-check. Does
 *   NOT touch `lastProcessedEntryId` — only the run executor advances that.
 *
 * This module purposely does NOT start the Adjutant, send wakeup requests, or
 * gate on feature flags. Those concerns belong to the adjacent wiring in
 * thread-events.ts (peer-wake) and the future run executor.
 */

import { eq, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { threadOrchestrationState } from "@armyofagents/db";
import { logger } from "../middleware/logger.js";

const log = logger.child({ service: "thread-orchestration" });

export function threadOrchestrationService(db: Db) {
  return {
    /**
     * Ensure exactly one controller row exists for `threadId`.
     *
     * Idempotent: uses `onConflictDoNothing` on the `threadId` UNIQUE
     * constraint, so multiple concurrent calls converge on the same row
     * with zero errors and exactly one write.
     *
     * Returns the inserted row on the first call, undefined on subsequent
     * (conflict-suppressed) calls — callers should treat the return value
     * as informational only.
     */
    ensureController: async (threadId: string) => {
      const result = await db
        .insert(threadOrchestrationState)
        .values({ threadId })
        .onConflictDoNothing()
        .returning();

      if (result.length > 0) {
        log.debug({ threadId }, "thread orchestration controller created");
      }

      return result[0] ?? null;
    },

    /**
     * Mark the controller as "a run is due" in response to a human entry.
     *
     * - Calls `ensureController` first, so the row is guaranteed to exist.
     * - Sets `pendingRun = true`.
     * - Increments `runEpoch` atomically via SQL expression (`runEpoch + 1`).
     * - Resets `hopCount = 0` (human entry resets the agent-cascade counter).
     * - Bumps `updatedAt` to now.
     *
     * Does NOT touch `lastProcessedEntryId` — only the run executor advances
     * the read cursor after a completed run.
     *
     * Safe to call from the thread-events debounce callback alongside the
     * existing peer-wake path. The two are additive and do not conflict.
     */
    triggerOnHumanEntry: async (threadId: string) => {
      // Always ensure the row exists first so this works even if the CREATE
      // path didn't call ensureController (e.g. legacy threads).
      await threadOrchestrationService(db).ensureController(threadId);

      const [updated] = await db
        .update(threadOrchestrationState)
        .set({
          pendingRun: true,
          runEpoch: sql`${threadOrchestrationState.runEpoch} + 1`,
          hopCount: 0,
          updatedAt: new Date(),
        })
        .where(eq(threadOrchestrationState.threadId, threadId))
        .returning();

      log.debug(
        {
          threadId,
          runEpoch: updated?.runEpoch,
          pendingRun: updated?.pendingRun,
        },
        "thread orchestration controller triggered on human entry",
      );

      return updated ?? null;
    },
  };
}
