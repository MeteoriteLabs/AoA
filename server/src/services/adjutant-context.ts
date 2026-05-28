/**
 * Adjutant context packager (Task B3, T13).
 *
 * When the Adjutant agent is woken for a thread, it needs three things to
 * reason well:
 *
 *   1. The thread's own entry log (capped — 200 entries by default).
 *   2. The thread's running summary, used as the "older context" stand-in
 *      whenever the entry count exceeds the cap.
 *   3. A handful of RELATED threads in the same company, scored by
 *      `discussions.summary_embedding` cosine similarity, so cross-thread
 *      context can flow without leaking private threads the caller has no
 *      business reading.
 *
 * This file is the pure assembly step. It does NOT spawn the Adjutant runtime,
 * does NOT format the bundle for any specific provider, and does NOT call out
 * to embedding generation — the embedding is already on the thread row by the
 * time we get here (populated by the B1 write-behind queue).
 *
 * Privacy model — three visibility tiers (see THREAD_VISIBILITIES in
 * packages/shared/src/constants.ts):
 *
 *   - "company"    — visible to anyone with company access
 *   - "department" — Phase 1 treats this as accessible to crew agents inside
 *                    the same company. Department-scoped narrowing will land
 *                    in Phase 2 once we have a stable "agent ↔ department"
 *                    binding to check against
 *   - "private"    — visible ONLY when the caller (an agent, passed via
 *                    `callerAgentId`) is listed as a participant in
 *                    `thread_participants`. No `callerAgentId` → private
 *                    threads are dropped entirely. Fail-closed.
 *
 * The candidate set is over-fetched (relatedLimit × 3) before visibility
 * filtering so a private-thread cluster can't starve the result list down
 * to zero accessible neighbors.
 *
 * Embedded-postgres reality: the bundled `pg-embedded` instance does NOT ship
 * pgvector. In environments without vector support, `summary_embedding` will
 * be null on every row, the `IS NOT NULL` filter zeroes the candidate set,
 * and we return `relatedThreads: []`. Tests mock the DB select layer; they
 * don't rely on actual pgvector SQL semantics.
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { discussions, discussionEntries, threadParticipants } from "@armyofagents/db";
import type { Db } from "@armyofagents/db";

/** Default cap on the entry log returned to the Adjutant. */
const DEFAULT_MAX_ENTRIES = 200;

/** Default size of the related-thread sidecar. */
const DEFAULT_RELATED_THREAD_LIMIT = 5;

/** Multiplier on the candidate set before visibility filtering. */
const RELATED_OVERFETCH_MULTIPLIER = 3;

export interface AdjutantContextOpts {
  /** Cap on `entries.length`. Defaults to 200. When totalEntryCount > maxEntries we mark `usedSummaryFallback = true`. */
  maxEntries?: number;
  /** Max number of accessible related threads to surface. Defaults to 5. */
  relatedThreadLimit?: number;
  /**
   * When packaging context for a specific agent (e.g. Adjutant), pass its id
   * so the "accessible related threads" calculation can include private
   * threads that this agent is a participant in. If omitted, only non-private
   * related threads are surfaced (safe default).
   */
  callerAgentId?: string;
}

export interface RelatedThread {
  id: string;
  title: string | null;
  summaryText: string | null;
  visibility: string;
}

export interface AdjutantContext {
  /** The most recent `maxEntries` entries in chronological order. */
  entries: Array<typeof discussionEntries.$inferSelect>;
  /** Thread.summaryText, or null if the summarizer hasn't produced one yet. */
  summaryText: string | null;
  /**
   * True when totalEntryCount > maxEntries. The Adjutant runtime uses this
   * to decide whether to prefix the entry log with "(earlier context
   * summarized as: …)" so the model knows it doesn't have the full log.
   */
  usedSummaryFallback: boolean;
  /** Up to `relatedThreadLimit` related threads, filtered for visibility. */
  relatedThreads: RelatedThread[];
  /** ThreadIntent[] — empty array when the column is null. */
  intent: string[];
  /** ThreadPhase: discuss|scope|assign|done. */
  phase: string;
  /** 1..3, or null if the thread defers to internal_agent_config. */
  autonomyLevel: number | null;
  /** ThreadVisibility: private|department|company. */
  visibility: string;
  /** Total entry rows on the thread (not just the returned slice). */
  totalEntryCount: number;
}

/**
 * Format a 1536-d embedding as a pgvector literal. Mirrors the pattern in
 * `embeddings.ts` / `memory.ts` — keep them in sync if pgvector ever changes
 * its literal grammar.
 */
function toVectorString(embedding: number[]): string {
  // We trust the column dimensionality (defended at insert time) and skip the
  // per-element finite check that `embeddings.toVectorString` does — by the
  // time the value lands in `discussions.summary_embedding` it has already
  // been validated by the write-behind queue.
  return `[${embedding.join(",")}]`;
}

/**
 * Package the context bundle for an Adjutant wakeup on a single thread.
 *
 * @throws Error when `threadId` does not resolve to a `discussions` row.
 *         (Intentionally throws rather than returning null — a wakeup on a
 *         deleted thread is a programming bug, not a user-visible state.)
 */
export async function packageAdjutantContext(
  db: Db,
  threadId: string,
  opts: AdjutantContextOpts = {},
): Promise<AdjutantContext> {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const relatedLimit = opts.relatedThreadLimit ?? DEFAULT_RELATED_THREAD_LIMIT;

  // ── 1. Fetch the source thread ──────────────────────────────────────────
  const [thread] = await db
    .select()
    .from(discussions)
    .where(eq(discussions.id, threadId))
    .limit(1);

  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  // ── 2. Entry-log slice + total count ────────────────────────────────────
  //
  // Two queries because we need *both* the recent window and the exact total
  // (for the summary-fallback flag). Counting then slicing in a single
  // window function is cheaper in raw SQL but the drizzle-orm composition
  // is clearer this way and the discussion_entries index already covers
  // (discussion_id, created_at) for the second query.
  const totalEntryCountRow = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(discussionEntries)
    .where(eq(discussionEntries.discussionId, threadId));
  const totalEntryCount = totalEntryCountRow[0]?.count ?? 0;

  const usedSummaryFallback = totalEntryCount > maxEntries;

  // Fetch the latest `maxEntries` entries (newest is the most relevant
  // recency signal for the model) then reverse to chronological so the
  // packed bundle reads top-to-bottom in conversation order.
  const recentEntriesDesc = await db
    .select()
    .from(discussionEntries)
    .where(eq(discussionEntries.discussionId, threadId))
    .orderBy(desc(discussionEntries.createdAt))
    .limit(maxEntries);
  const entries = [...recentEntriesDesc].reverse();

  // ── 3. Related threads via summaryEmbedding HNSW similarity ─────────────
  let relatedThreads: RelatedThread[] = [];

  if (thread.summaryEmbedding) {
    const vectorStr = toVectorString(thread.summaryEmbedding);
    // Over-fetch so visibility filtering can drop private threads the
    // caller can't see without starving the final list.
    const overFetch = relatedLimit * RELATED_OVERFETCH_MULTIPLIER;

    const candidates = await db
      .select({
        id: discussions.id,
        title: discussions.title,
        summaryText: discussions.summaryText,
        visibility: discussions.visibility,
      })
      .from(discussions)
      .where(
        and(
          eq(discussions.companyId, thread.companyId),
          sql`${discussions.id} <> ${threadId}`,
          sql`${discussions.summaryEmbedding} IS NOT NULL`,
          eq(discussions.status, "active"),
        ),
      )
      .orderBy(sql`${discussions.summaryEmbedding} <=> ${vectorStr}::vector`)
      .limit(overFetch);

    // Resolve which private threads (if any) this agent participates in.
    // Skipped entirely when callerAgentId is omitted — private candidates
    // will all fall through to the safe-default reject branch below.
    let accessiblePrivateThreadIds = new Set<string>();
    if (opts.callerAgentId) {
      const participantRows = await db
        .select({ threadId: threadParticipants.threadId })
        .from(threadParticipants)
        .where(
          and(
            eq(threadParticipants.companyId, thread.companyId),
            eq(threadParticipants.principalType, "agent"),
            eq(threadParticipants.principalId, opts.callerAgentId),
          ),
        );
      accessiblePrivateThreadIds = new Set(
        participantRows.map((r) => r.threadId),
      );
    }

    relatedThreads = candidates
      .filter((c) => {
        if (c.visibility === "company") return true;
        // Phase 1: department-scoped threads are visible to any crew agent
        // inside the same company. Phase 2 will tighten this once we wire
        // agent ↔ department bindings — leaving a TODO marker keeps the
        // future cleanup discoverable via grep.
        // TODO(Phase 2): narrow "department" to same-department crew only.
        if (c.visibility === "department") return true;
        if (c.visibility === "private") {
          return accessiblePrivateThreadIds.has(c.id);
        }
        // Unknown visibility — fail closed. Future enum additions should
        // require an explicit branch here.
        return false;
      })
      .slice(0, relatedLimit)
      .map((c) => ({
        id: c.id,
        title: c.title,
        summaryText: c.summaryText,
        visibility: c.visibility,
      }));
  }

  // ── 4. Assemble the bundle ───────────────────────────────────────────────
  return {
    entries,
    summaryText: thread.summaryText,
    usedSummaryFallback,
    relatedThreads,
    // jsonb defaults to [] in schema but we double-defend here in case
    // legacy rows were inserted before the default was set.
    intent: Array.isArray(thread.intent) ? (thread.intent as string[]) : [],
    phase: thread.phase,
    autonomyLevel: thread.autonomyLevel,
    visibility: thread.visibility,
    totalEntryCount,
  };
}
