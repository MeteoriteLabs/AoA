import { and, desc, eq, isNull, notInArray } from "drizzle-orm";
import { discussionEntries, discussions, threadScopeVersions } from "@armyofagents/db";

type DbLike = {
  select: (...args: unknown[]) => QueryChain;
};

type QueryChain = PromiseLike<unknown[]> & {
  from: (table: unknown) => QueryChain;
  where: (...args: unknown[]) => QueryChain;
  orderBy: (...args: unknown[]) => QueryChain;
  limit: (...args: unknown[]) => QueryChain;
};

export type ThreadFreshnessSnapshot = {
  threadId: string;
  threadStatus: string;
  threadPhase: string;
  entrySeq: number;
  latestHumanEntryId: string | null;
  latestHumanSeq: number | null;
  latestScopeVersionId: string | null;
  latestScopeVersionNumber: number | null;
  latestScopeVersionStatus: string | null;
  latestScopeSourceEndSeq: number | null;
};

export type ThreadFreshnessComparison =
  | { fresh: true }
  | {
      fresh: false;
      reason:
        | "thread_missing"
        | "thread_done"
        | "newer_human_entry"
        | "newer_scope_version";
    };

export async function captureFreshnessSnapshot(
  db: DbLike,
  threadId: string,
): Promise<ThreadFreshnessSnapshot> {
  const [thread] = (await db
    .select({
      id: discussions.id,
      status: discussions.status,
      phase: discussions.phase,
      entrySeq: discussions.entrySeq,
    })
    .from(discussions)
    .where(eq(discussions.id, threadId))
    .limit(1)) as Array<{ id: string; status: string; phase: string; entrySeq: number }>;

  if (!thread) {
    throw new Error(`Thread not found: ${threadId}`);
  }

  const [latestHuman] = (await db
    .select({
      id: discussionEntries.id,
      seq: discussionEntries.seq,
    })
    .from(discussionEntries)
    .where(
      and(
        eq(discussionEntries.discussionId, threadId),
        isNull(discussionEntries.authorAgentId),
        notInArray(discussionEntries.inputType, ["agent", "system", "scope_proposal"]),
      ),
    )
    .orderBy(desc(discussionEntries.seq))
    .limit(1)) as Array<{ id: string; seq: number }>;

  const [latestScope] = (await db
    .select({
      id: threadScopeVersions.id,
      versionNumber: threadScopeVersions.versionNumber,
      status: threadScopeVersions.status,
      sourceEndSeq: threadScopeVersions.sourceEndSeq,
    })
    .from(threadScopeVersions)
    .where(eq(threadScopeVersions.threadId, threadId))
    .orderBy(desc(threadScopeVersions.versionNumber), desc(threadScopeVersions.createdAt))
    .limit(1)) as Array<{ id: string; versionNumber: number; status: string; sourceEndSeq: number }>;

  return {
    threadId: thread.id,
    threadStatus: thread.status,
    threadPhase: thread.phase,
    entrySeq: thread.entrySeq,
    latestHumanEntryId: latestHuman?.id ?? null,
    latestHumanSeq: latestHuman?.seq ?? null,
    latestScopeVersionId: latestScope?.id ?? null,
    latestScopeVersionNumber: latestScope?.versionNumber ?? null,
    latestScopeVersionStatus: latestScope?.status ?? null,
    latestScopeSourceEndSeq: latestScope?.sourceEndSeq ?? null,
  };
}

export async function compareFreshnessSnapshot(
  db: DbLike,
  threadId: string,
  snapshot: ThreadFreshnessSnapshot,
): Promise<ThreadFreshnessComparison> {
  let current: ThreadFreshnessSnapshot;
  try {
    current = await captureFreshnessSnapshot(db, threadId);
  } catch {
    return { fresh: false, reason: "thread_missing" };
  }

  if (current.threadPhase === "done") {
    return { fresh: false, reason: "thread_done" };
  }

  if ((current.latestHumanSeq ?? 0) > (snapshot.latestHumanSeq ?? 0)) {
    return { fresh: false, reason: "newer_human_entry" };
  }

  if (
    current.latestScopeVersionId !== snapshot.latestScopeVersionId ||
    (current.latestScopeVersionNumber ?? 0) > (snapshot.latestScopeVersionNumber ?? 0)
  ) {
    return { fresh: false, reason: "newer_scope_version" };
  }

  return { fresh: true };
}
