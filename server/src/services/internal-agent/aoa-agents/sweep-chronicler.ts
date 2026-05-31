// server/src/services/internal-agent/aoa-agents/sweep-chronicler.ts
//
// Chronicler card-update sweep.
//
// Queries threads that have new entries since their last card update and
// queues one agentWakeupRequests row per eligible thread.
//
// Eligibility: discussions.status='active' AND
//   (summaryUpdatedAt IS NULL OR lastEntryAt > summaryUpdatedAt)
// Debounce: skip threads with a Chronicler wakeup queued OR processing in the
//   last CHRONICLER_DEBOUNCE_MS (45s) to absorb entry bursts.
// Concurrency cap: process at most CHRONICLER_MAX_CONCURRENT threads per cycle.
//
// KNOWN LIMITATION (Codex P2 — single-instance assumption): the debounce is a
// read-then-insert, not a DB-level unique constraint. Two server processes
// sweeping the same company within the same 45s window could each queue a
// wakeup for the same thread. v1 runs a single server process, so this is
// acceptable; multi-instance dedup (a unique partial index on
// agentWakeupRequests(agentId, payload->>'threadId') WHERE status IN
// ('queued','processing')) is a follow-up if/when the server scales out.

import { and, eq, ne, gt, isNull, isNotNull, or, inArray, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { agents, aoaAgentTriggers, discussions, agentWakeupRequests } from "@armyofagents/db";
import { logger } from "../../../middleware/logger.js";

const log = logger.child({ svc: "sweep-chronicler" });

/** Matches the sweep interval in index.ts. */
export const CHRONICLER_SWEEP_INTERVAL_MS = 45_000;

/** Skip threads with a Chronicler wakeup queued within this window. */
export const CHRONICLER_DEBOUNCE_MS = 45_000;

/** Max threads to queue per sweep tick. */
export const CHRONICLER_MAX_CONCURRENT = 10;

export interface RunChroniclerSweepResult {
  queued: number;
}

/**
 * For every company that has a Chronicler agent with a 'sweep' trigger,
 * find active threads with stale cards and queue one Chronicler wakeup per thread.
 */
export async function runChroniclerSweep(db: Db): Promise<RunChroniclerSweepResult> {
  // ── 1. Find all companies with an active Chronicler sweep trigger ─────────
  const chroniclerRows = await db
    .select({
      agentId: aoaAgentTriggers.agentId,
      companyId: aoaAgentTriggers.companyId,
    })
    .from(aoaAgentTriggers)
    .innerJoin(agents, eq(agents.id, aoaAgentTriggers.agentId))
    .where(
      and(
        eq(aoaAgentTriggers.kind, "sweep"),
        eq(aoaAgentTriggers.enabled, true),
        sql`(${aoaAgentTriggers.config}->>'role') = 'chronicler'`,
        ne(agents.status, "terminated"),
        ne(agents.status, "paused"),
      ),
    );

  if (chroniclerRows.length === 0) {
    return { queued: 0 };
  }

  // ── 2. For each company, find stale threads + queue wakeups ───────────────
  let totalQueued = 0;

  for (const { agentId, companyId } of chroniclerRows) {
    try {
      const queued = await queueForCompany(db, agentId, companyId);
      totalQueued += queued;
    } catch (err) {
      log.warn({ err, companyId }, "sweep-chronicler: queueForCompany failed — continuing");
    }
  }

  if (totalQueued > 0) {
    log.debug({ queued: totalQueued }, "sweep-chronicler: done");
  }

  return { queued: totalQueued };
}

async function queueForCompany(db: Db, agentId: string, companyId: string): Promise<number> {
  // ── Threads with new entries since last card update ───────────────────────
  // Eligibility: active thread that has at least one entry (lastEntryAt set) AND
  // either no card yet (summaryUpdatedAt null) or new entries since the last card.
  // The isNotNull(lastEntryAt) guard (Codex round-3 P2) avoids waking the
  // Chronicler for brand-new no-entry threads (created with lastEntryAt=null) —
  // there is nothing to summarize until a first entry lands.
  const staleThreads = await db
    .select({ id: discussions.id })
    .from(discussions)
    .where(
      and(
        eq(discussions.companyId, companyId),
        eq(discussions.status, "active"),
        isNotNull(discussions.lastEntryAt),
        or(
          isNull(discussions.summaryUpdatedAt),
          gt(discussions.lastEntryAt, discussions.summaryUpdatedAt),
        ),
      ),
    )
    .limit(CHRONICLER_MAX_CONCURRENT);

  if (staleThreads.length === 0) return 0;

  // ── Debounce: skip threads with a Chronicler wakeup still queued OR in-flight
  //    (Codex P2 — a 'processing' wakeup means a Chronicler is mid-run on that
  //    thread; queuing another would double-run it). Wakeup statuses:
  //    'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'.
  const cutoff = new Date(Date.now() - CHRONICLER_DEBOUNCE_MS);
  const recentWakeups = await db
    .select({ payload: agentWakeupRequests.payload })
    .from(agentWakeupRequests)
    .where(
      and(
        eq(agentWakeupRequests.agentId, agentId),
        inArray(agentWakeupRequests.status, ["queued", "processing"]),
        gt(agentWakeupRequests.createdAt, cutoff),
      ),
    );

  const alreadyQueued = new Set(
    recentWakeups
      .map((r) => (r.payload as Record<string, unknown>)?.threadId as string | undefined)
      .filter(Boolean),
  );

  const toQueue = staleThreads.filter((t) => !alreadyQueued.has(t.id));
  if (toQueue.length === 0) return 0;

  // ── Insert wakeup rows ────────────────────────────────────────────────────
  const wakeupRows = toQueue.map((t) => ({
    companyId,
    agentId,
    source: "sweep.chronicler" as const,
    reason: "card_stale",
    payload: { threadId: t.id, role: "chronicler" } as Record<string, unknown>,
    status: "queued" as const,
  }));

  await db.insert(agentWakeupRequests).values(wakeupRows);

  return toQueue.length;
}
