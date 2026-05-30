/**
 * Backstop drain for the orchestration controller — `runControllerSweep`.
 *
 * The PRIMARY driver of controller-path threads is the inline fire-and-forget
 * `runController` call in thread-events.ts (immediate reaction to a human entry,
 * fired within the 30s debounce window). This sweep is the SAFETY NET: it
 * catches threads where the inline drain crashed or was missed and
 * `pendingRun` is still true.
 *
 * Serialization: the atomic claim inside `runController`
 * (`UPDATE … SET pendingRun=false WHERE pendingRun=true RETURNING …`) means
 * only one caller wins per thread — the sweep and the inline drain cannot
 * both execute the same run. If the inline drain already claimed the run,
 * `runController` returns `{ ran: false, reason: "no-pending" }` for the sweep.
 *
 * Scheduled in server/src/index.ts at a 2-minute interval (backstop cadence).
 */

import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { discussions, threadOrchestrationState } from "@armyofagents/db";
import { threadOrchestrationService } from "../../thread-orchestration.js";
import { makeControllerAdjutantRunner } from "./controller-adjutant-runner.js";
import type { AdjutantRunner } from "../../thread-orchestration.js";
import { logger } from "../../../middleware/logger.js";

const log = logger.child({ svc: "sweep-controller" });

/**
 * Drain all controller-path threads that have `pendingRun = true`.
 *
 * @param db - Drizzle db instance.
 * @param deps - Injectable for tests. Pass `{ adjutantRunner: myFake }` to
 *               avoid spawning a real CLI process in unit tests.
 */
export async function runControllerSweep(
  db: Db,
  deps: { adjutantRunner?: AdjutantRunner } = {},
): Promise<void> {
  const adjutantRunner = deps.adjutantRunner ?? makeControllerAdjutantRunner(db);

  // Select threads that need a run: pendingRun=true + useControllerPath=true
  // + not done + crew not paused. The `innerJoin` ties the state row to the
  // live discussions row so we can filter on phase and crewPaused in one query.
  const pending = await db
    .select({ threadId: threadOrchestrationState.threadId })
    .from(threadOrchestrationState)
    .innerJoin(discussions, eq(discussions.id, threadOrchestrationState.threadId))
    .where(
      and(
        eq(threadOrchestrationState.pendingRun, true),
        eq(discussions.useControllerPath, true),
        ne(discussions.phase, "done"),
        eq(discussions.crewPaused, false),
      ),
    );

  if (pending.length === 0) return;

  log.debug({ count: pending.length }, "controller sweep: draining pending threads");

  const svc = threadOrchestrationService(db);

  for (const { threadId } of pending) {
    await svc
      .runController(threadId, { adjutantRunner })
      .catch((err) =>
        log.warn({ err, threadId }, "controller sweep: runController failed — continuing"),
      );
  }
}
