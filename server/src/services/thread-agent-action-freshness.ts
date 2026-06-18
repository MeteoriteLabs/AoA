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
        // The snapshot captured at run start was empty/absent (capture threw, so
        // `runner.ts` stored `{}`). We cannot verify freshness against a baseline
        // we never recorded, so we suppress the action under THIS distinct
        // "could not verify" reason rather than letting an empty snapshot
        // masquerade as a `newer_human_entry` human-conflict (a FALSE reason).
        | "snapshot_unavailable"
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

/**
 * A stored snapshot is "unavailable" when freshness capture threw at run start
 * and `runner.ts` persisted an empty `{}` in its place. Detect it by the absence
 * of the always-present baseline fields — a real snapshot ALWAYS carries a string
 * `threadId` and a numeric `entrySeq` (see `captureFreshnessSnapshot`). Treating
 * an empty snapshot as a real baseline would coerce `latestHumanSeq` /
 * `latestScopeVersionNumber` to 0 and falsely report a `newer_human_entry` /
 * `newer_scope_version` conflict for any thread with ≥1 human entry or scope
 * version. Typed loosely because the runtime value may genuinely be `{}` even
 * though the static type says `ThreadFreshnessSnapshot`. Note: `null`
 * `latestScopeVersionId` / `latestHumanSeq` are LEGITIMATE values on a real
 * snapshot (no human entry / no scope version yet) and must NOT be treated as
 * unavailable — hence the baseline check keys off `threadId` + `entrySeq` only.
 */
function isSnapshotUnavailable(snapshot: ThreadFreshnessSnapshot | null | undefined): boolean {
  if (!snapshot || typeof snapshot !== "object") return true;
  const s = snapshot as Partial<ThreadFreshnessSnapshot>;
  return typeof s.threadId !== "string" && typeof s.entrySeq !== "number";
}

export async function compareFreshnessSnapshot(
  db: DbLike,
  threadId: string,
  snapshot: ThreadFreshnessSnapshot,
): Promise<ThreadFreshnessComparison> {
  // An empty/absent baseline snapshot means freshness capture threw at run start
  // (runner.ts stores `{}` in that case). We have no recorded baseline to compare
  // against — so DO NOT silently drop the work as if a human spoke. A `{}`
  // snapshot has `latestHumanSeq === undefined`, which coerces to 0 below and
  // would falsely trip `newer_human_entry` for any thread with ≥1 human entry.
  // Report the distinct "could not verify" reason instead. The snapshot is
  // detected as empty when it carries neither of its always-present baseline
  // keys (`threadId` string + `entrySeq` number) — see isSnapshotUnavailable.
  if (isSnapshotUnavailable(snapshot)) {
    return { fresh: false, reason: "snapshot_unavailable" };
  }

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
