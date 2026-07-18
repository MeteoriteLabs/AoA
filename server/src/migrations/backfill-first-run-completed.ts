import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { onboardingProgress } from "@armyofagents/db";

/**
 * WS0b — one-time startup backfill: stamp `firstRunCompletedAt = now()` onto
 * every onboarding_progress row that is ALREADY complete but predates the
 * flag.
 *
 * `pnpm db:generate` only adds the column; it cannot compute which existing
 * rows are already done. "Complete" must be checked against BOTH
 * representations the row may carry (Codex P1, `onboarding.ts` computeAdvance):
 *   - `currentState === "SETUP_COMPLETE"`
 *   - `completedStates` (jsonb array) containing "SETUP_COMPLETE"
 * A row can be complete under either without the other (e.g. currentState
 * advanced past SETUP_COMPLETE conceptually, or completedStates recorded it
 * mid-transition) — this deliberately matches on both, not just one.
 *
 * Mirrors `backfillCrewTemplateOrigin`: a single atomic UPDATE...WHERE, safe
 * to call on every startup. Only touches rows where firstRunCompletedAt IS
 * NULL, so it is idempotent — a second run updates 0 rows.
 */
export async function backfillFirstRunCompleted(db: Db): Promise<void> {
  await db
    .update(onboardingProgress)
    .set({
      firstRunCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        isNull(onboardingProgress.firstRunCompletedAt),
        or(
          eq(onboardingProgress.currentState, "SETUP_COMPLETE"),
          sql`${onboardingProgress.completedStates} @> ${JSON.stringify(["SETUP_COMPLETE"])}::jsonb`,
        ),
      ),
    );
}
