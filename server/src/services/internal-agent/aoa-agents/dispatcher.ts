import { and, eq, lt, inArray, notInArray, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { discussionEntries, discussions, internalAgentRuns, agentWakeupRequests, agents } from "@armyofagents/db";
import { listEnabledOutboxAgents } from "./triggers.js";
import { ensureExtractionAgent } from "./ensure-extraction-agent.js";
import { runExtractionConsumer } from "../subagents/extraction-consumer.js";
import { runAoaAgent } from "./runner.js";
import { createLimiter } from "../subagents/concurrency-limiter.js";
import { publishLiveEvent } from "../../live-events.js";
import { logger } from "../../../middleware/logger.js";

export interface DispatchOptions {
  /** Max simultaneous extractions per dispatch tick. */
  limiterMax: number;
  /** A 'processing' entry whose LINKED run has been 'running' (non-terminal)
   *  longer than this is treated as orphaned (crash between the M2 atomic
   *  claim and a terminal status). Must be conservatively larger than the
   *  longest legitimate extraction so healthy in-flight is never reset. */
  staleMs: number;
}

/**
 * AoA Dispatcher — the generalized durable poll (transactional-outbox
 * pattern), not an event listener. Generalizes the battle-tested
 * Decision-#99 extraction sweeper: the committed row
 * `discussion_entries.extractionStatus='pending'` IS the work item, so no
 * event can be "lost" (spec §6.2). Each tick:
 *
 *  1. RECLAIM orphans (spec §6.3) — VERBATIM the #99 linked-run reclaim.
 *     Orphan = entry `processing` AND its **linked current run**
 *     (`extraction_run_id`, set by the consumer at run creation) is still
 *     `running` and older than staleMs. Reclaim atomically: (a) terminalize
 *     that linked run → `failed` so it can never re-trigger reclaim (no
 *     zombie `running` rows, no perpetual re-reclaim of a healthily-
 *     reprocessing entry — the bug the prior join-on-any-running design
 *     produced); (b) reset the entry → `pending`, `extraction_run_id=null`.
 *     Both guarded so they are safe under concurrency with the consumer /
 *     the untouched reprocess path. Using the LINKED run means a stale
 *     leftover run from a *previous* attempt cannot condemn an entry that a
 *     *fresh* run is healthily processing. (Identical predicates to the
 *     extraction sweeper; only the reclaim error message differs.)
 *
 *  2. DRAIN pending (incl. just-reclaimed), GATED PER COMPANY. A pending
 *     entry is only dispatched if its company has an enabled `outbox`
 *     trigger (`listEnabledOutboxAgents`). Companies with no enabled outbox
 *     agent are SKIPPED — they have not opted into the durable extraction
 *     pipeline. For gated-in companies the extraction agent is resolved
 *     (memoized per company) and the consumer invoked under a bounded
 *     limiter. The Milestone-2 atomic claim inside extractFromDiscussionEntry
 *     guarantees at-most-one extraction per entry even under concurrent
 *     pickup.
 *
 * Memoizes BOTH the per-company enabled-outbox check and the per-company
 * extraction agent id once per tick.
 */
export async function runAoaDispatch(db: Db, opts: DispatchOptions): Promise<void> {
  const staleCutoff = new Date(Date.now() - opts.staleMs);

  // ── Phase 1: reclaim orphaned 'processing' entries (#99 verbatim) ──────────
  const orphanRows: Array<{ id: string; runId: string | null }> = await db
    .select({
      id: discussionEntries.id,
      runId: discussionEntries.extractionRunId,
    })
    .from(discussionEntries)
    .leftJoin(
      internalAgentRuns,
      eq(internalAgentRuns.id, discussionEntries.extractionRunId),
    )
    .where(
      // Orphan = a CONSUMER-driven 'processing' entry whose LINKED run is
      // still 'running' and older than the stale window. The consumer links
      // extraction_run_id *before* the atomic claim, so every consumer-driven
      // 'processing' entry has a non-null linked run — there is no consumer
      // path that yields (processing, run_id NULL). The only producer of
      // (processing, run_id NULL) is the untouched reprocess direct-call path
      // (Q2-b), which is HEALTHY in-flight work; a NULL-guard branch would
      // false-reclaim it and cause double extraction. Reprocess-crash
      // recovery is a deferred follow-up (spec §16.1), not in scope here.
      and(
        eq(discussionEntries.extractionStatus, "processing"),
        eq(internalAgentRuns.status, "running"),
        lt(internalAgentRuns.createdAt, staleCutoff),
      ),
    )
    .then((r: Array<{ id: string; runId: string | null }>) => r);

  if (orphanRows.length > 0) {
    const orphanIds = [...new Set(orphanRows.map((o) => o.id))];
    const staleRunIds = [
      ...new Set(
        orphanRows
          .map((o) => o.runId)
          .filter((v): v is string => typeof v === "string"),
      ),
    ];

    // (a) Terminalize the stale linked runs so they can never re-trigger
    //     reclaim. Guarded on status='running' so an already-terminal run is
    //     never clobbered.
    if (staleRunIds.length > 0) {
      await db
        .update(internalAgentRuns)
        .set({
          status: "failed",
          errorMessage: "reclaimed: orphaned (aoa-dispatcher)",
          completedAt: new Date(),
        })
        .where(
          and(
            inArray(internalAgentRuns.id, staleRunIds),
            eq(internalAgentRuns.status, "running"),
          ),
        );
    }

    // (b) Reset the entries → pending. Guarded on status='processing' so it
    //     is safe even if state changed between the select and the update.
    await db
      .update(discussionEntries)
      .set({ extractionStatus: "pending", extractionRunId: null })
      .where(
        and(
          inArray(discussionEntries.id, orphanIds),
          eq(discussionEntries.extractionStatus, "processing"),
        ),
      );
  }

  // ── Phase 2: drain pending (includes the just-reclaimed orphans) ───────────
  const rows: Array<{ id: string; companyId: string }> = await db
    .select({ id: discussionEntries.id, companyId: discussions.companyId })
    .from(discussionEntries)
    .innerJoin(discussions, eq(discussions.id, discussionEntries.discussionId))
    .where(eq(discussionEntries.extractionStatus, "pending"))
    .limit(200)
    .then((r: Array<{ id: string; companyId: string }>) => r);

  const limiter = createLimiter(opts.limiterMax);

  if (rows.length > 0) {
    // Per-company memoization within this tick: the enabled-outbox gate result
    // (true = has an enabled outbox agent) and the resolved extraction agent id.
    const outboxByCompany = new Map<string, boolean>();
    const agentByCompany = new Map<string, string>();

    await Promise.allSettled(
      rows.map((row) =>
        limiter.run(async () => {
          // Gate: only dispatch if the company has an enabled `outbox` trigger.
          let gated = outboxByCompany.get(row.companyId);
          if (gated === undefined) {
            const enabled = await listEnabledOutboxAgents(db, row.companyId);
            gated = enabled.length > 0;
            outboxByCompany.set(row.companyId, gated);
          }
          if (!gated) return; // no outbox trigger for this company → skip

          let agentId = agentByCompany.get(row.companyId);
          if (!agentId) {
            agentId = await ensureExtractionAgent(db, row.companyId);
            agentByCompany.set(row.companyId, agentId);
          }
          await runExtractionConsumer(db, row.companyId, row.id, agentId);
        }),
      ),
    );
  }

  // ── Phase 3: drain the wakeup queue for kind='aoa' agents ─────────────────
  const wakeupRows: Array<{ id: string; agentId: string; companyId: string; payload: Record<string, unknown> | null }> = await db
    .select({
      id: agentWakeupRequests.id,
      agentId: agentWakeupRequests.agentId,
      companyId: agentWakeupRequests.companyId,
      payload: agentWakeupRequests.payload,
    })
    .from(agentWakeupRequests)
    .innerJoin(agents, eq(agents.id, agentWakeupRequests.agentId))
    .where(
      and(
        eq(agentWakeupRequests.status, "queued"),
        eq(agents.kind, "aoa"),
        notInArray(agents.status, ["paused", "terminated"]),
      ),
    )
    .limit(200)
    .then((r) => r);

  if (wakeupRows.length > 0) {
    await Promise.allSettled(
      wakeupRows.map((w) =>
        limiter.run(async () => {
          // Atomic claim: queued → processing
          const claimed = await db
            .update(agentWakeupRequests)
            .set({ status: "processing", claimedAt: new Date() })
            .where(and(eq(agentWakeupRequests.id, w.id), eq(agentWakeupRequests.status, "queued")))
            .returning({ id: agentWakeupRequests.id });
          if (claimed.length === 0) return; // already claimed by concurrent tick

          try {
            await runAoaAgent(db, w.agentId, {
              companyId: w.companyId,
              source: "wakeup",
              wakeupId: w.id,
              ...(w.payload ?? {}),
            });
            await db
              .update(agentWakeupRequests)
              .set({ status: "done", finishedAt: new Date() })
              .where(eq(agentWakeupRequests.id, w.id));
          } catch (err: unknown) {
            await db
              .update(agentWakeupRequests)
              .set({
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
                finishedAt: new Date(),
              })
              .where(eq(agentWakeupRequests.id, w.id));
          }
        }),
      ),
    );
  }

  // ── Phase 4 (FX1/B1): disjoint reclaim — 'processing' entries whose LINKED
  //    run is already 'failed' ────────────────────────────────────────────────
  // Phase 1 handles entries whose linked run is still 'running' & stale (crash
  // mid-flight) → reset to 'pending' for a retry. This phase handles a
  // DIFFERENT terminal case: the runner's catch terminalized the RUN →
  // 'failed' but (pre-FX1) left the entry stuck 'processing' forever — silent
  // permanent loss. The run already failed, so retrying is wrong — terminalize
  // the ENTRY → 'failed' (NOT 'pending') + emit the
  // discussion.extraction.failed LiveEvent. Mirrors extraction.ts's failure
  // branch (status + sourceInfo.extractionError + event; NO notification).
  // Disjoint from Phase 1 (linked run 'running' vs 'failed' are mutually
  // exclusive) and from the runner's own in-process terminalizer (this is the
  // durable safety net for a run that died before it could run its catch —
  // e.g. SIGKILL). Runs LAST: it neither feeds Phase 2 (output is terminal
  // 'failed', not 'pending') nor interacts with the Phase 3 wakeup queue, so
  // ordering is irrelevant to correctness. Each transition individually
  // guarded; per-entry best-effort so one failure can't abort the tick.
  const failedRunRows: Array<{
    id: string;
    discussionId: string;
    companyId: string;
  }> = await db
    .select({
      id: discussionEntries.id,
      discussionId: discussionEntries.discussionId,
      companyId: discussions.companyId,
    })
    .from(discussionEntries)
    .innerJoin(discussions, eq(discussions.id, discussionEntries.discussionId))
    .leftJoin(
      internalAgentRuns,
      eq(internalAgentRuns.id, discussionEntries.extractionRunId),
    )
    .where(
      and(
        eq(discussionEntries.extractionStatus, "processing"),
        eq(internalAgentRuns.status, "failed"),
      ),
    )
    .limit(200)
    .then(
      (
        r: Array<{ id: string; discussionId: string; companyId: string }>,
      ) => r,
    );

  if (failedRunRows.length > 0) {
    const reclaimErr = "reclaimed: extraction run failed (aoa-dispatcher)";
    for (const fr of failedRunRows) {
      // Guarded on status='processing' so a concurrent transition is never
      // clobbered.
      await db
        .update(discussionEntries)
        .set({
          extractionStatus: "failed",
          sourceInfo: sql`jsonb_set(COALESCE(${discussionEntries.sourceInfo}, '{}'::jsonb), '{extractionError}', ${JSON.stringify(reclaimErr)}::jsonb)`,
        })
        .where(
          and(
            eq(discussionEntries.id, fr.id),
            eq(discussionEntries.extractionStatus, "processing"),
          ),
        )
        .catch((updateErr: unknown) => {
          logger
            .child({ subagent: "aoa-dispatcher" })
            .error(
              { err: updateErr, entryId: fr.id },
              "Phase-4: failed to terminalize entry with failed linked run",
            );
        });
      publishLiveEvent({
        companyId: fr.companyId,
        type: "discussion.extraction.failed",
        payload: {
          discussionId: fr.discussionId,
          entryId: fr.id,
          error: reclaimErr,
        },
      });
    }
  }

  logger
    .child({ subagent: "aoa-dispatcher" })
    .info(
      {
        reclaimed: orphanRows.length,
        failedRunReclaimed: failedRunRows.length,
        drained: rows.length,
        wakeups: wakeupRows.length,
      },
      "aoa dispatch complete",
    );
}
