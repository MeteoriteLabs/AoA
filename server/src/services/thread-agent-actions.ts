import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type {
  ThreadAgentActionStatus,
  ThreadAgentActionType,
  ThreadPhase,
} from "@armyofagents/shared";
import {
  agentWakeupRequests,
  agents,
  artifacts,
  discussionEntries,
  discussionEntryAttachments,
  discussions,
  threadAgentActions,
  threadScopeItems,
} from "@armyofagents/db";
import type { Db } from "@armyofagents/db";
import {
  compareFreshnessSnapshot,
  type ThreadFreshnessSnapshot,
  type ThreadFreshnessComparison,
} from "./thread-agent-action-freshness.js";
import { discussionService } from "./discussions.js";
import { threadScopeVersionService } from "./thread-scope-versions.js";
import { artifactService } from "./artifacts.js";
import { threadService, parseMentions, processMentions } from "./threads.js";
import { logger } from "../middleware/logger.js";
import { isUniqueViolation } from "./db-errors.js";

const log = logger.child({ service: "thread-agent-actions" });

type QueryChain = PromiseLike<unknown[]> & {
  from: (table: unknown) => QueryChain;
  where: (...args: unknown[]) => QueryChain;
  orderBy: (...args: unknown[]) => QueryChain;
  limit: (...args: unknown[]) => QueryChain;
  values: (value: unknown) => QueryChain;
  set: (value: unknown) => QueryChain;
  onConflictDoNothing: (...args: unknown[]) => QueryChain;
  returning: (...args: unknown[]) => QueryChain;
};

type DbLike = {
  select: (...args: unknown[]) => QueryChain;
  insert: (...args: unknown[]) => QueryChain;
  update: (...args: unknown[]) => QueryChain;
  transaction?: <T>(fn: (tx: DbLike) => Promise<T> | T) => Promise<T>;
};

type ThreadActionRow = {
  id: string;
  companyId: string;
  threadId: string;
  runId: string | null;
  agentId: string | null;
  actionType: string;
  status: string;
  payload: unknown;
  idempotencyKey: string;
  freshness: ThreadFreshnessSnapshot;
  attemptCount?: number;
  maxAttempts?: number;
};

export type ProposeThreadActionInput = {
  companyId: string;
  threadId: string;
  runId?: string | null;
  agentId?: string | null;
  actionType: ThreadAgentActionType;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  freshness?: Record<string, unknown>;
};

export type CommitThreadAgentActionsInput = {
  companyId: string;
  threadId: string;
  runId: string;
};

export type CommitThreadAgentActionsResult = {
  committed: number;
  suppressed: number;
  blocked: number;
  failed: number;
};

type DiscussionCommitService = {
  addEntry: (
    companyId: string,
    discussionId: string,
    data: {
      inputType: string;
      rawContent: string;
      parentEntryId?: string | null;
      authorAgentId?: string | null;
      sourceInfo?: Record<string, unknown> | null;
      sourceActionId?: string | null;
    },
    actorId: string,
  ) => Promise<{ id: string }>;
};

type ScopeVersionCommitService = {
  createDraftFromThread: (
    companyId: string,
    threadId: string,
    actor: { userId?: string; agentId?: string; isHuman?: boolean },
    input: {
      summary?: string;
      assumptions?: unknown[];
      decisions?: unknown[];
      openQuestions?: unknown[];
    },
  ) => Promise<{ status: string; version?: { id: string } }>;
};

type ArtifactCommitService = {
  create: (
    companyId: string,
    actorId: string,
    input: {
      title: string;
      type: string;
      source: string;
      content?: string | null;
      fileUrl?: string | null;
      sourceActionId?: string | null;
    },
  ) => Promise<{ id: string; versions?: Array<{ id: string }> }>;
};

type ThreadCommitService = {
  advancePhase: (
    companyId: string,
    threadId: string,
    toPhase: string,
    actor: { userId: string; role: "team_member"; isHuman: false },
  ) => Promise<unknown>;
};

type ThreadAgentActionDeps = {
  compareFreshnessSnapshot?: (
    db: DbLike,
    threadId: string,
    snapshot: ThreadFreshnessSnapshot,
  ) => Promise<ThreadFreshnessComparison>;
  discussions?: DiscussionCommitService;
  scopeVersions?: ScopeVersionCommitService;
  artifacts?: ArtifactCommitService;
  threads?: ThreadCommitService;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function isThreadPhase(value: unknown): value is ThreadPhase {
  return value === "discuss" || value === "scope" || value === "assign" || value === "done";
}

async function updateActionStatus(
  db: DbLike,
  actionId: string,
  values: {
    status: ThreadAgentActionStatus;
    blockedReason?: string | null;
    committedEntryId?: string | null;
    committedScopeVersionId?: string | null;
    committedScopeItemId?: string | null;
    // When set, atomically bump attempt_count (used on the failed-retry path
    // so a poison row eventually stops being re-selected). (Review fix (c).)
    bumpAttempt?: boolean;
  },
) {
  const { bumpAttempt, ...rest } = values;
  const [updated] = await db
    .update(threadAgentActions)
    .set({
      ...rest,
      ...(bumpAttempt
        ? { attemptCount: sql`${threadAgentActions.attemptCount} + 1` }
        : {}),
      committedAt: values.status === "committed" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(threadAgentActions.id, actionId))
    .returning();
  return updated;
}

/**
 * Fenced compare-and-swap for the proposed→committing claim. (PR-B Release-1.)
 *
 * Unlike {@link updateActionStatus} (which keys only on `id` and is used for the
 * downstream transitions this committer already owns), the claim must be a CAS:
 * it only wins if the row is still claimable (`status IN ('proposed','failed')`) AND
 * its `attempt_count` still matches the value observed when the row was SELECTed.
 * Together those close the check-then-act gap between the per-action freshness
 * re-check and the claim: a concurrent committer that already claimed the row flips
 * `status` out of the claimable set, and a concurrent reaper/failure that bumps
 * `attempt_count` changes the fence — either way the UPDATE touches 0 rows and the
 * empty `.returning()` signals a LOST RACE, so the caller skips the action.
 *
 * NOTE: `updated_at` is deliberately NOT a fence token. The column is microsecond
 * `timestamptz`, but a SELECTed value round-trips through a millisecond JS `Date`, so
 * `eq(updated_at, observed)` would almost never match a freshly-proposed row (its
 * default `now()` is microsecond) and the legitimate first claimer would phantom-lose.
 * `attempt_count` is an exact integer and advances on every failure/reaper flip, so it
 * fences the only mutation that matters here without the precision hazard.
 *
 * Mirrors the inbox-router status-CAS idiom. Strict narrowing of the previously-
 * unconditional claim → backward-compatible with the still-present run-scoped SELECT.
 */
async function claimActionForCommit(
  db: DbLike,
  actionId: string,
  fence: { attemptCount?: number },
) {
  const [claimed] = await db
    .update(threadAgentActions)
    .set({ status: "committing", updatedAt: new Date() })
    .where(
      and(
        eq(threadAgentActions.id, actionId),
        or(
          eq(threadAgentActions.status, "proposed"),
          eq(threadAgentActions.status, "failed"),
        ),
        eq(threadAgentActions.attemptCount, fence.attemptCount ?? 0),
      ),
    )
    .returning();
  return claimed;
}

export function threadAgentActionService(db: Db | DbLike, deps: ThreadAgentActionDeps = {}) {
  const actionDb = db as unknown as DbLike;
  const discussionCommitter =
    deps.discussions ?? discussionService(db as unknown as Db);
  const scopeVersionCommitter =
    deps.scopeVersions ?? threadScopeVersionService(db as unknown as Db);
  const artifactCommitter =
    deps.artifacts ?? artifactService(db as unknown as Db);
  const threadCommitter =
    deps.threads ?? threadService(db as unknown as Db);
  // Tx-bound resolvers for the create_artifact_candidate transaction (fix (e)):
  // artifact + draft + scope-item + attach must commit/roll back together. When
  // a dep override is supplied (tests), it is used verbatim — the fake does not
  // need a real tx binding; otherwise the committer is re-bound to the tx handle.
  const resolveScopeVersionCommitter = (dbArg: DbLike): ScopeVersionCommitService =>
    deps.scopeVersions ?? threadScopeVersionService(dbArg as unknown as Db);
  const resolveArtifactCommitter = (dbArg: DbLike): ArtifactCommitService =>
    deps.artifacts ?? artifactService(dbArg as unknown as Db);
  // Run `fn` inside a DB transaction when the handle supports it; otherwise fall
  // back to running against the bare handle (defensive — production `Db` always
  // exposes `.transaction`).
  const runInTransaction = <T>(fn: (tx: DbLike) => Promise<T>): Promise<T> =>
    actionDb.transaction ? actionDb.transaction(fn) : fn(actionDb);
  const compare = deps.compareFreshnessSnapshot ?? compareFreshnessSnapshot;

  return {
    proposeThreadAction: async (input: ProposeThreadActionInput) => {
      const [thread] = await actionDb
        .select({ id: discussions.id })
        .from(discussions)
        .where(and(eq(discussions.id, input.threadId), eq(discussions.companyId, input.companyId)))
        .limit(1);

      if (!thread) {
        throw new Error("Thread not found");
      }

      // Race-safe insert: onConflictDoNothing on the (companyId, idempotencyKey)
      // unique index means a concurrent propose with the same key does NOT throw
      // a 500 unique-violation — it returns no row, and we re-select the existing
      // row instead. (Review fix (minor): TOCTOU between check and insert.)
      const [inserted] = await actionDb
        .insert(threadAgentActions)
        .values({
          companyId: input.companyId,
          threadId: input.threadId,
          runId: input.runId ?? null,
          agentId: input.agentId ?? null,
          actionType: input.actionType,
          status: "proposed",
          payload: input.payload ?? {},
          idempotencyKey: input.idempotencyKey,
          freshness: input.freshness ?? {},
        })
        .onConflictDoNothing({
          target: [threadAgentActions.companyId, threadAgentActions.idempotencyKey],
        })
        .returning();

      if (inserted) return inserted;

      // Conflict suppressed → the row already exists. Re-select and return it so
      // callers see the canonical (idempotent) action.
      const [existing] = (await actionDb
        .select()
        .from(threadAgentActions)
        .where(
          and(
            eq(threadAgentActions.companyId, input.companyId),
            eq(threadAgentActions.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1)) as ThreadActionRow[];

      // #198 follow-up (Codex #202 P2): with run-INDEPENDENT keys a same-turn retry
      // under a new run collides with a row created by an EARLIER run. commitThread-
      // AgentActions filters on runId, so if that earlier run left the row committable
      // (proposed, or failed under its attempt cap) the current run would never flush
      // it — the action is silently lost. Re-home the re-proposable row onto THIS run
      // so this run's commit picks it up. NEVER steal a committed / mid-commit
      // (committing) / policy-blocked row. Race-safe: the status predicate in the
      // UPDATE is the compare-and-swap — a concurrent committer that already moved the
      // row out of the re-homable set yields 0 rows and we fall through to the
      // canonical row unchanged. attemptCount is preserved, so the commit's
      // attemptCount < maxAttempts poison-pill bound still holds.
      //
      // (Codex #202 P1) We ALSO adopt the current run's freshness snapshot. The row
      // carries the earlier run's snapshot, but the commit re-checks freshness per
      // action against the row's stored snapshot — keeping the stale one would let a
      // scope-version bump (with no new human entry) wrongly mark this fresh
      // re-proposal `suppressed_stale`. The current run re-proposed from a fresh view,
      // so the row must represent THAT freshness.
      //
      // (Codex #202 P1, round 2) `suppressed_stale` is included in the re-homable set
      // and REVIVED to `proposed`. It is terminal, but the run-independent key means a
      // genuine same-turn re-proposal collides with it; without revival commit would
      // never re-select it (it filters proposed/retryable-failed) and the action would
      // be stranded until a new human message moves the turn anchor. Reviving with the
      // fresh snapshot lets commit re-evaluate it — if still genuinely stale it simply
      // re-suppresses. `blocked_policy` is NOT revived (re-proposing won't change a
      // policy outcome).
      const REHOMABLE_STATUSES = ["proposed", "failed", "suppressed_stale"];
      if (
        existing &&
        input.runId != null &&
        existing.runId !== input.runId &&
        REHOMABLE_STATUSES.includes(existing.status)
      ) {
        const [rehomed] = await actionDb
          .update(threadAgentActions)
          .set({
            runId: input.runId,
            freshness: input.freshness ?? {},
            ...(existing.status === "suppressed_stale"
              ? { status: "proposed", blockedReason: null }
              : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(threadAgentActions.id, existing.id),
              inArray(threadAgentActions.status, REHOMABLE_STATUSES),
            ),
          )
          .returning();
        if (rehomed) return rehomed;
      }

      return existing;
    },

    commitThreadAgentActions: async (
      input: CommitThreadAgentActionsInput,
    ): Promise<CommitThreadAgentActionsResult> => {
      const result: CommitThreadAgentActionsResult = {
        committed: 0,
        suppressed: 0,
        blocked: 0,
        failed: 0,
      };

      // Select both "proposed" rows and "failed" rows that are still under their
      // attempt cap. A transient per-action failure (status="failed") is thus
      // retried on the next commit tick instead of being permanently dropped;
      // once attemptCount >= maxAttempts the row is no longer re-selected (poison
      // pill stops). (Review fix (c) part 3.)
      const actions = await actionDb
        .select()
        .from(threadAgentActions)
        .where(
          and(
            eq(threadAgentActions.companyId, input.companyId),
            eq(threadAgentActions.threadId, input.threadId),
            eq(threadAgentActions.runId, input.runId),
            or(
              eq(threadAgentActions.status, "proposed"),
              and(
                eq(threadAgentActions.status, "failed"),
                lt(threadAgentActions.attemptCount, threadAgentActions.maxAttempts),
              ),
            ),
          ),
        )
        .orderBy(asc(threadAgentActions.createdAt)) as ThreadActionRow[];

      // Freshness is re-checked INSIDE the per-action loop (not once up front) so
      // a human entry arriving mid-commit suppresses the *remaining* actions, not
      // just the ones evaluated before the batch started. (Review fix (minor).)
      const freshActions: ThreadActionRow[] = actions;

      const sameRunArtifacts: Array<{ artifactId: string; attachedEntryId: string | null }> = [];
      let sameRunReplyEntryId: string | null = null;
      const attachArtifactToEntry = async (
        artifactId: string,
        entryId: string,
        dbArg: DbLike = actionDb,
      ) => {
        await dbArg
          .insert(discussionEntryAttachments)
          .values({
            discussionEntryId: entryId,
            artifactId,
          })
          .returning();
      };

      // Validate that a caller-supplied target entry actually belongs to THIS
      // thread (and company) before attaching an artifact to it. Prevents a
      // cross-thread attachment within a company via a forged attachToEntryId.
      // (Review fix (minor): attachToEntryId not scoped to thread/company.)
      const isEntryInThread = async (entryId: string): Promise<boolean> => {
        const [row] = (await actionDb
          .select({ id: discussionEntries.id })
          .from(discussionEntries)
          .where(
            and(
              eq(discussionEntries.id, entryId),
              eq(discussionEntries.discussionId, input.threadId),
            ),
          )
          .limit(1)) as Array<{ id: string }>;
        return Boolean(row);
      };

      for (const action of freshActions) {
        try {
          // Per-action freshness re-check (Review fix (minor)): re-evaluate against
          // the live thread state before each action so a human entry that arrives
          // mid-commit suppresses the REMAINING actions in the batch.
          const freshness = await compare(actionDb, input.threadId, action.freshness);
          if (!freshness.fresh) {
            await updateActionStatus(actionDb, action.id, {
              status: "suppressed_stale",
              blockedReason: freshness.reason,
            });
            result.suppressed += 1;
            continue;
          }

          // NOTE: the "committing" status de-duplicates within a single
          // commitThreadAgentActions invocation. Cross-run safety for the two
          // highest-value action types is now provided by run-INDEPENDENT stable keys
          // (post_reply, create_artifact_candidate — a re-propose dedups on the
          // (companyId, idempotencyKey) unique index) PLUS a `source_action_id` partial
          // unique index on discussion_entries/artifacts that makes the side-effect
          // itself idempotent (the branches below converge on the unique violation).
          // The other four action types keep run-scoped keys; full thread-scoped retry
          // for all types is #198. A reaper for stale "committing" rows is wired via
          // reapStaleThreadAgentActions below.
          //
          // PR-B Release-1: the claim is a FENCED CAS, not an unconditional update.
          // It only wins if the row is still claimable (proposed|failed) AND its
          // attempt_count + updated_at still match what we SELECTed — closing the
          // check-then-act gap with the per-action freshness re-check above. A
          // concurrent reaper/failure that flips the row in that window makes the
          // fence miss → 0 rows returned → this committer LOST the race and skips the
          // action entirely (NOT counted as committed/failed/suppressed). After a won
          // claim this committer owns the row, so the downstream transitions stay
          // unfenced (updateActionStatus, keyed on id).
          const claimed = await claimActionForCommit(actionDb, action.id, {
            attemptCount: action.attemptCount,
          });
          if (!claimed) {
            continue;
          }

          if (action.actionType === "post_reply") {
            const payload = asRecord(action.payload);
            const rawContent = asString(payload.rawContent);
            if (!rawContent || !action.agentId) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "invalid_post_reply_payload",
              });
              result.blocked += 1;
              continue;
            }

            let entry: { id: string };
            try {
              entry = await discussionCommitter.addEntry(
                input.companyId,
                input.threadId,
                {
                  inputType: "agent",
                  rawContent,
                  parentEntryId: asString(payload.parentEntryId) ?? null,
                  authorAgentId: action.agentId,
                  // Review fix (f): carry `sourceInfo` from the action payload
                  // through the commit so the committed entry preserves the same
                  // metadata the non-gated path persists (post-entry-tool.ts).
                  sourceInfo: (payload.sourceInfo as Record<string, unknown> | null) ?? null,
                  // #197: stamp the action id so the partial unique index makes this
                  // commit idempotent — the SAME action can never produce two entries.
                  sourceActionId: action.id,
                },
                `agent:${action.agentId}`,
              );
            } catch (err) {
              if (!isUniqueViolation(err, "discussion_entries_source_action_uq")) throw err;
              // #197: the entry for this action already exists (single-invocation
              // partial crash, or the reaper flipped a stranded `committing` row to
              // `failed` after the entry write succeeded). Re-select it and converge —
              // no duplicate, NOT counted as a failure. NOTE: a fresh same-run artifact
              // is not drained onto this re-selected entry here (rare mid-batch crash);
              // tracked as a #198 residual.
              const [existing] = (await actionDb
                .select({ id: discussionEntries.id })
                .from(discussionEntries)
                .where(
                  and(
                    eq(discussionEntries.discussionId, input.threadId),
                    eq(discussionEntries.sourceActionId, action.id),
                  ),
                )
                .limit(1)) as Array<{ id: string }>;
              await updateActionStatus(actionDb, action.id, {
                status: "committed",
                committedEntryId: existing?.id ?? null,
              });
              result.committed += 1;
              continue;
            }
            sameRunReplyEntryId = entry.id;
            for (const artifactRef of sameRunArtifacts) {
              if (artifactRef.attachedEntryId) continue;
              await attachArtifactToEntry(artifactRef.artifactId, entry.id);
              artifactRef.attachedEntryId = entry.id;
            }
            await updateActionStatus(actionDb, action.id, {
              status: "committed",
              committedEntryId: entry.id,
            });
            result.committed += 1;

            // Review fix (f): run mention processing on the committed entry, just
            // like the non-gated post path (post-entry-tool.ts). Without this a
            // "@Planner …" reply that committed through the action queue would
            // never convene Planner — the gated path silently dropped mentions.
            // Hop-capped at 1 (same as the non-gated path) so a chain of mentions
            // can't spiral. Best-effort: a mention-dispatch failure must not roll
            // back the already-committed reply, so it is caught and logged.
            try {
              const mentions = parseMentions(rawContent);
              if (mentions.length > 0) {
                await processMentions(
                  actionDb as unknown as Db,
                  input.companyId,
                  input.threadId,
                  entry.id,
                  mentions,
                  { hopCount: 1 },
                );
              }
            } catch (mentionErr) {
              log.warn(
                {
                  err: mentionErr,
                  threadId: input.threadId,
                  entryId: entry.id,
                  actionId: action.id,
                },
                "thread-agent-actions: mention processing failed for committed post_reply — entry kept",
              );
            }
            continue;
          }

          if (action.actionType === "create_scope_draft") {
            const payload = asRecord(action.payload);
            const draft = await scopeVersionCommitter.createDraftFromThread(
              input.companyId,
              input.threadId,
              { agentId: action.agentId ?? undefined, isHuman: false },
              {
                summary: asString(payload.summary),
                assumptions: asArray(payload.assumptions),
                decisions: asArray(payload.decisions),
                openQuestions: asArray(payload.openQuestions),
              },
            );
            await updateActionStatus(actionDb, action.id, {
              status: "committed",
              committedScopeVersionId: draft.version?.id ?? null,
            });
            result.committed += 1;
            continue;
          }

          if (action.actionType === "add_scope_item") {
            const payload = asRecord(action.payload);
            const kind = asString(payload.kind);
            const title = asString(payload.title);
            if (!kind || !title) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "invalid_scope_item_payload",
              });
              result.blocked += 1;
              continue;
            }

            const draft = await scopeVersionCommitter.createDraftFromThread(
              input.companyId,
              input.threadId,
              { agentId: action.agentId ?? undefined, isHuman: false },
              {},
            );
            const scopeVersionId = draft.version?.id;
            if (!scopeVersionId) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "scope_draft_unavailable",
              });
              result.blocked += 1;
              continue;
            }

            let item: { id?: string } | undefined;
            try {
              [item] = (await actionDb
                .insert(threadScopeItems)
                .values({
                  companyId: input.companyId,
                  scopeVersionId,
                  kind,
                  status: "draft",
                  title,
                  description: asString(payload.content) ?? asString(payload.description) ?? null,
                  payload,
                  sourceEntryIds: asArray(payload.sourceEntryIds) ?? [],
                  // #198: stamp the action id so the partial unique index makes this
                  // commit idempotent — the SAME action can never produce two items.
                  sourceActionId: action.id,
                })
                .returning()) as Array<{ id?: string }>;
            } catch (err) {
              if (!isUniqueViolation(err, "thread_scope_items_source_action_uq")) throw err;
              // #198: this action already produced a scope item (single-invocation
              // partial crash, or the reaper flipped a stranded `committing` row to
              // `failed` after the item write succeeded). Re-select and converge — no
              // duplicate, NOT counted as a failure. Stamp the EXISTING row's scope
              // version (a re-run may have landed in a new draft version).
              const [existing] = (await actionDb
                .select({
                  id: threadScopeItems.id,
                  scopeVersionId: threadScopeItems.scopeVersionId,
                })
                .from(threadScopeItems)
                .where(
                  and(
                    eq(threadScopeItems.companyId, input.companyId),
                    eq(threadScopeItems.sourceActionId, action.id),
                  ),
                )
                .limit(1)) as Array<{ id: string; scopeVersionId: string }>;
              await updateActionStatus(actionDb, action.id, {
                status: "committed",
                committedScopeVersionId: existing?.scopeVersionId ?? scopeVersionId,
                committedScopeItemId: existing?.id ?? null,
              });
              result.committed += 1;
              continue;
            }

            await updateActionStatus(actionDb, action.id, {
              status: "committed",
              committedScopeVersionId: scopeVersionId,
              committedScopeItemId: (item as { id?: string } | undefined)?.id ?? null,
            });
            result.committed += 1;
            continue;
          }

          if (action.actionType === "convene_agent") {
            const payload = asRecord(action.payload);
            const targetAgentId = asString(payload.targetAgentId);
            if (!targetAgentId) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "invalid_convene_agent_payload",
              });
              result.blocked += 1;
              continue;
            }

            const [targetAgent] = await actionDb
              .select({ id: agents.id, companyId: agents.companyId })
              .from(agents)
              .where(eq(agents.id, targetAgentId))
              .limit(1) as Array<{ id: string; companyId: string }>;

            if (!targetAgent || targetAgent.companyId !== input.companyId) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "target_agent_not_in_company",
              });
              result.blocked += 1;
              continue;
            }

            const context = asRecord(payload.context);
            const reason = asString(payload.reason) ?? "agent_dispatch";
            const dedupKey = `${targetAgentId}:${input.threadId}:queued`;
            await actionDb
              .insert(agentWakeupRequests)
              .values({
                companyId: input.companyId,
                agentId: targetAgentId,
                source: "agent.dispatch",
                reason,
                payload: context,
                dedupKey,
                status: "queued",
              })
              .onConflictDoNothing()
              .returning();

            await updateActionStatus(actionDb, action.id, {
              status: "committed",
            });
            result.committed += 1;
            continue;
          }

          if (action.actionType === "create_artifact_candidate") {
            const payload = asRecord(action.payload);
            const title = asString(payload.title);
            const agentId = action.agentId;
            if (!title || !agentId) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "invalid_artifact_candidate_payload",
              });
              result.blocked += 1;
              continue;
            }

            const explicitEntryId = asString(payload.attachToEntryId);
            // Validate the caller-supplied attach target is in THIS thread BEFORE
            // any writes — reject a forged cross-thread attachToEntryId up front
            // so no artifact is created for an invalid target. (Review fix (minor).)
            if (explicitEntryId && !(await isEntryInThread(explicitEntryId))) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "attach_target_not_in_thread",
              });
              result.blocked += 1;
              continue;
            }

            // Sentinel used to abort the transaction when the scope draft is
            // unavailable — rolls back the artifact + version so no orphan remains.
            const SCOPE_DRAFT_UNAVAILABLE = Symbol("scope_draft_unavailable");

            // Wrap the whole action body in ONE transaction (Review fix (e)): the
            // artifact, its version, the scope draft, the scope item, and the
            // attachment all commit or roll back together. The scope draft is
            // resolved+validated FIRST so an unavailable draft aborts before any
            // artifact row is written — the previously-reachable orphan path is
            // closed.
            let committed: { scopeVersionId: string; scopeItemId: string | null } | null = null;
            try {
              committed = await runInTransaction(async (tx) => {
                const txScopeVersions = resolveScopeVersionCommitter(tx);
                const txArtifacts = resolveArtifactCommitter(tx);

                const draft = await txScopeVersions.createDraftFromThread(
                  input.companyId,
                  input.threadId,
                  { agentId, isHuman: false },
                  {},
                );
                const scopeVersionId = draft.version?.id;
                if (!scopeVersionId) {
                  throw SCOPE_DRAFT_UNAVAILABLE;
                }

                const artifact = await txArtifacts.create(
                  input.companyId,
                  agentId,
                  {
                    title,
                    type: asString(payload.artifactType) ?? "document",
                    source: "agent",
                    content: asString(payload.content) ?? null,
                    fileUrl: asString(payload.fileRef) ?? null,
                    // #197: stamp the action id so the partial unique index makes this
                    // artifact commit idempotent across re-runs / reaper re-commits.
                    sourceActionId: action.id,
                  },
                );
                const artifactVersionId = artifact.versions?.[0]?.id ?? null;

                const [item] = await tx
                  .insert(threadScopeItems)
                  .values({
                    companyId: input.companyId,
                    scopeVersionId,
                    kind: "artifact_link",
                    status: "draft",
                    title,
                    description: "Artifact candidate created by agent",
                    artifactId: artifact.id,
                    artifactVersionId,
                    payload: {
                      ...payload,
                      artifactId: artifact.id,
                      artifactVersionId,
                      role: "reference",
                    },
                    sourceEntryIds: explicitEntryId ? [explicitEntryId] : [],
                  })
                  .returning();

                if (explicitEntryId) {
                  await attachArtifactToEntry(artifact.id, explicitEntryId, tx);
                } else if (sameRunReplyEntryId) {
                  await attachArtifactToEntry(artifact.id, sameRunReplyEntryId, tx);
                } else {
                  sameRunArtifacts.push({ artifactId: artifact.id, attachedEntryId: null });
                }

                return {
                  scopeVersionId,
                  scopeItemId: (item as { id?: string } | undefined)?.id ?? null,
                };
              });
            } catch (txError) {
              if (txError === SCOPE_DRAFT_UNAVAILABLE) {
                // Draft never materialized → artifact (if any) rolled back. Mark
                // the action blocked; no orphan artifact exists.
                await updateActionStatus(actionDb, action.id, {
                  status: "blocked_policy",
                  blockedReason: "scope_draft_unavailable",
                });
                result.blocked += 1;
                continue;
              }
              if (isUniqueViolation(txError, "artifacts_source_action_uq")) {
                // #197: the artifact for this action already exists (single-invocation
                // partial crash / reaper re-commit). The tx rolled back; converge on
                // the existing rows — no duplicate, NOT counted as a failure.
                const [existingArtifact] = (await actionDb
                  .select({ id: artifacts.id })
                  .from(artifacts)
                  .where(
                    and(
                      eq(artifacts.companyId, input.companyId),
                      eq(artifacts.sourceActionId, action.id),
                    ),
                  )
                  .limit(1)) as Array<{ id: string }>;
                const [existingItem] = existingArtifact
                  ? ((await actionDb
                      .select({
                        id: threadScopeItems.id,
                        scopeVersionId: threadScopeItems.scopeVersionId,
                      })
                      .from(threadScopeItems)
                      // Narrow to the artifact_link row this action created (a later,
                      // unrelated draft can reference the same artifactId with a
                      // different kind) and order deterministically so convergence
                      // stamps the ORIGINAL scope version, not a stale one. (Review I1.)
                      .where(
                        and(
                          eq(threadScopeItems.artifactId, existingArtifact.id),
                          eq(threadScopeItems.kind, "artifact_link"),
                        ),
                      )
                      .orderBy(asc(threadScopeItems.createdAt))
                      .limit(1)) as Array<{ id: string; scopeVersionId: string }>)
                  : [];
                await updateActionStatus(actionDb, action.id, {
                  status: "committed",
                  committedScopeVersionId: existingItem?.scopeVersionId ?? null,
                  committedScopeItemId: existingItem?.id ?? null,
                });
                result.committed += 1;
                continue;
              }
              throw txError;
            }

            await updateActionStatus(actionDb, action.id, {
              status: "committed",
              committedScopeVersionId: committed.scopeVersionId,
              committedScopeItemId: committed.scopeItemId,
            });
            result.committed += 1;
            continue;
          }

          if (action.actionType === "advance_phase") {
            const payload = asRecord(action.payload);
            const toPhase = asString(payload.toPhase);
            const effectiveAutonomy =
              typeof payload.effectiveAutonomy === "number" ? payload.effectiveAutonomy : 0;
            if (!isThreadPhase(toPhase)) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "invalid_advance_phase_payload",
              });
              result.blocked += 1;
              continue;
            }
            if (effectiveAutonomy < 2) {
              await updateActionStatus(actionDb, action.id, {
                status: "blocked_policy",
                blockedReason: "autonomy_insufficient",
              });
              result.blocked += 1;
              continue;
            }

            await threadCommitter.advancePhase(
              input.companyId,
              input.threadId,
              toPhase,
              {
                userId: action.agentId ?? "aoa-agent",
                role: "team_member",
                isHuman: false,
              },
            );

            await updateActionStatus(actionDb, action.id, {
              status: "committed",
            });
            result.committed += 1;
            continue;
          }

          await updateActionStatus(actionDb, action.id, {
            status: "blocked_policy",
            blockedReason: `unsupported_action:${action.actionType}`,
          });
          result.blocked += 1;
        } catch (error) {
          // Bump attempt_count on every failure so a poison row eventually stops
          // being re-selected once it hits maxAttempts. (Review fix (c) part 3.)
          await updateActionStatus(actionDb, action.id, {
            status: "failed",
            blockedReason: error instanceof Error ? error.message : "commit_failed",
            bumpAttempt: true,
          });
          result.failed += 1;
        }
      }

      return result;
    },
  };
}

/**
 * Default TTL after which a `committing` thread-agent-action row is considered
 * crash-stranded. A commit that takes longer than this almost certainly died
 * mid-flight (process crash, lost connection) rather than legitimately running,
 * so the reaper resets it for a bounded retry.
 */
export const STALE_COMMITTING_TTL_MS = 10 * 60 * 1000;

export interface ReapStaleThreadAgentActionsResult {
  reaped: number;
}

/**
 * Reaper for crash-stranded thread-agent-action rows.
 *
 * A row left in `committing` past {@link STALE_COMMITTING_TTL_MS} (because the
 * committing process crashed before it could write a terminal status) would
 * otherwise sit forever — never re-selected by `commitThreadAgentActions`
 * (which only picks `proposed` + retryable `failed`) and never advancing the
 * orchestration cursor. This sweeper flips such rows to `failed` and bumps
 * `attemptCount`, so they become re-selectable under the attempt cap (fix (c))
 * but a perpetually-crashing row eventually stops once it hits `maxAttempts`.
 *
 * Mirrors `sweepExpiredWorkspaces` in `workspace-ttl-sweeper.ts`: a single
 * bounded UPDATE, returns a count, safe to run on the existing sweep cadence.
 *
 * Wired into `runControllerSweep` (`sweep-controller.ts`), which runs on the
 * 2-minute controller-sweep cadence: the reaper fires best-effort at the start
 * of each sweep so stranded `committing` rows are flipped to `failed` (under the
 * attempt cap) before the sweep drains pending threads.
 */
export async function reapStaleThreadAgentActions(
  db: Db | DbLike,
  opts: { ttlMs?: number; now?: Date } = {},
): Promise<ReapStaleThreadAgentActionsResult> {
  const reaperDb = db as unknown as DbLike;
  const ttlMs = opts.ttlMs ?? STALE_COMMITTING_TTL_MS;
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - ttlMs);

  const reaped = (await reaperDb
    .update(threadAgentActions)
    .set({
      status: "failed",
      blockedReason: "reaped_stale_committing",
      attemptCount: sql`${threadAgentActions.attemptCount} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        inArray(threadAgentActions.status, ["committing"]),
        lt(threadAgentActions.updatedAt, cutoff),
      ),
    )
    .returning()) as unknown[];

  return { reaped: reaped.length };
}
