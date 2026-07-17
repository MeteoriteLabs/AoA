/**
 * Transactional outbox for @mention crew summons (PR #291 round-6 #3).
 *
 * `enqueueMentionOutbox` is called INSIDE the entry-insert transaction, so a
 * committed entry always has a pending summon row (atomic — the whole point).
 * `drainMentionOutbox` is the worker tick: it claims pending (and stale-
 * 'processing', i.e. crash-orphaned) rows with FOR UPDATE SKIP LOCKED, runs
 * `processMentions` exactly once per row, and marks 'done' or schedules a backoff
 * retry. Single-claim + mark-'done' means the non-idempotent hop bump fires once
 * across concurrent workers and across a worker restart. (A crash DURING
 * processMentions can still re-run on the stale reclaim — at-least-once — but
 * that is far rarer, and infinitely better than the old fire-and-forget which
 * lost the summon on any failure.)
 */

import { eq, sql } from "drizzle-orm";
import type { Db } from "@armyofagents/db";
import { discussionMentionOutbox } from "@armyofagents/db";
import { logger } from "../middleware/logger.js";

const log = logger.child({ service: "mention-outbox" });

export type OutboxMention = { raw: string; name: string };

export type RunMentionsFn = (
  db: Db,
  companyId: string,
  discussionId: string,
  entryId: string,
  mentions: OutboxMention[],
  opts?: { hopCount?: number },
) => Promise<void>;

/** Rows still 'processing' longer than this are treated as crash-orphaned. */
const STALE_PROCESSING_MINUTES = 5;
const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_BATCH_SIZE = 20;

/** Enqueue a summon row. MUST run inside the entry-insert transaction (`tx`). */
export async function enqueueMentionOutbox(
  tx: Db,
  row: {
    companyId: string;
    discussionId: string;
    entryId: string;
    mentions: OutboxMention[];
    /** Mention-cascade hop count (round-8 #1). 0 = human-originated (default);
     * 1 = an agent-authored reply. Preserves the loop-cap semantics the internal
     * writers' direct { hopCount: 1 } calls had before the outbox owned summons. */
    hopCount?: number;
  },
): Promise<void> {
  await tx.insert(discussionMentionOutbox).values({
    companyId: row.companyId,
    discussionId: row.discussionId,
    entryId: row.entryId,
    mentions: row.mentions,
    hopCount: row.hopCount ?? 0,
  });
}

/** Default summon: lazy-import processMentions to keep its heavy crew-runner
 * transitive tree off the worker's module-load path (mirrors threads.ts). */
const defaultRunMentions: RunMentionsFn = async (db, companyId, discussionId, entryId, mentions, opts) => {
  const { processMentions } = await import("./threads.js");
  await processMentions(db, companyId, discussionId, entryId, mentions, opts);
};

export interface DrainOpts {
  batchSize?: number;
  maxAttempts?: number;
  /** Injectable for tests; defaults to the real processMentions. */
  runMentions?: RunMentionsFn;
}

export interface DrainResult {
  processed: number;
  failed: number;
}

interface ClaimedRow {
  id: string;
  companyId: string;
  discussionId: string;
  entryId: string;
  mentions: OutboxMention[];
  attempts: number;
  hopCount: number;
}

function normalizeMentions(value: unknown): OutboxMention[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? (parsed as OutboxMention[]) : [];
}

/** Exponential-ish backoff, capped, mirroring the embedding queue's shape. */
function backoffMs(attempts: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
}

export async function drainMentionOutbox(db: Db, opts: DrainOpts = {}): Promise<DrainResult> {
  const batchSize = Math.max(1, Math.floor(opts.batchSize ?? DEFAULT_BATCH_SIZE));
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const runMentions = opts.runMentions ?? defaultRunMentions;

  // Atomic claim: pending+due OR stale-'processing' (crash reclaim). The
  // conditional UPDATE marks rows 'processing' in the same round-trip that
  // selects them, so two workers cannot claim the same row.
  const result = await db.execute(
    sql.raw(`
      WITH claimed AS (
        SELECT id FROM discussion_mention_outbox
        WHERE (status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= now()))
           OR (status = 'processing' AND updated_at < now() - interval '${STALE_PROCESSING_MINUTES} minutes')
        ORDER BY created_at
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE discussion_mention_outbox
      SET status = 'processing', updated_at = now()
      WHERE id IN (SELECT id FROM claimed)
      RETURNING
        id,
        company_id AS "companyId",
        discussion_id AS "discussionId",
        entry_id AS "entryId",
        mentions,
        attempts,
        hop_count AS "hopCount"
    `),
  );
  const rawRows = Array.isArray(result) ? result : ((result as { rows?: unknown[] })?.rows ?? []);
  const claimed: ClaimedRow[] = rawRows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      companyId: String(row.companyId),
      discussionId: String(row.discussionId),
      entryId: String(row.entryId),
      mentions: normalizeMentions(row.mentions),
      attempts: Number(row.attempts ?? 0),
      hopCount: Number(row.hopCount ?? 0),
    };
  });

  let processed = 0;
  let failed = 0;

  for (const row of claimed) {
    try {
      await runMentions(db, row.companyId, row.discussionId, row.entryId, row.mentions, { hopCount: row.hopCount });
      await db
        .update(discussionMentionOutbox)
        .set({ status: "done", updatedAt: new Date() })
        .where(eq(discussionMentionOutbox.id, row.id));
      processed += 1;
    } catch (err) {
      const attempts = row.attempts + 1;
      const terminal = attempts >= maxAttempts;
      await db
        .update(discussionMentionOutbox)
        .set({
          status: terminal ? "failed" : "pending",
          attempts,
          error: String((err as { message?: string })?.message ?? err).slice(0, 500),
          nextRetryAt: terminal ? null : new Date(Date.now() + backoffMs(attempts)),
          updatedAt: new Date(),
        })
        .where(eq(discussionMentionOutbox.id, row.id));
      failed += 1;
      log.warn({ err, outboxId: row.id, attempts, terminal }, "mention outbox row failed");
    }
  }

  return { processed, failed };
}
