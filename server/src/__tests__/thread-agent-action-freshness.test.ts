import { describe, expect, it } from "vitest";
import {
  captureFreshnessSnapshot,
  compareFreshnessSnapshot,
} from "../services/thread-agent-action-freshness.js";

function createSequenceDb(rows: unknown[][]) {
  let index = 0;
  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "where", "orderBy", "limit"]) {
      chain[method] = () => chain;
    }
    chain.then = (resolve: (value: unknown[]) => unknown) =>
      Promise.resolve(resolve(rows[index++] ?? []));
    return chain;
  };

  return {
    select: () => makeChain(),
  };
}

const baseThread = {
  id: "thread-1",
  status: "active",
  phase: "scope",
  entrySeq: 6,
  updatedAt: new Date("2026-06-15T10:00:00Z"),
};

const baseHuman = {
  id: "entry-6",
  seq: 6,
  createdAt: new Date("2026-06-15T10:01:00Z"),
};

const baseScope = {
  id: "scope-v1",
  versionNumber: 1,
  status: "draft",
  sourceEndSeq: 6,
  createdAt: new Date("2026-06-15T10:02:00Z"),
};

describe("thread agent action freshness", () => {
  it("captures the thread freshness snapshot", async () => {
    const db = createSequenceDb([[baseThread], [baseHuman], [baseScope]]);

    await expect(captureFreshnessSnapshot(db as never, "thread-1")).resolves.toEqual({
      threadId: "thread-1",
      threadStatus: "active",
      threadPhase: "scope",
      entrySeq: 6,
      latestHumanEntryId: "entry-6",
      latestHumanSeq: 6,
      latestScopeVersionId: "scope-v1",
      latestScopeVersionNumber: 1,
      latestScopeVersionStatus: "draft",
      latestScopeSourceEndSeq: 6,
    });
  });

  it("returns fresh when the thread has not advanced", async () => {
    const snapshot = await captureFreshnessSnapshot(
      createSequenceDb([[baseThread], [baseHuman], [baseScope]]) as never,
      "thread-1",
    );

    const result = await compareFreshnessSnapshot(
      createSequenceDb([[baseThread], [baseHuman], [baseScope]]) as never,
      "thread-1",
      snapshot,
    );

    expect(result).toEqual({ fresh: true });
  });

  it("marks stale when a newer human entry arrives", async () => {
    const snapshot = await captureFreshnessSnapshot(
      createSequenceDb([[baseThread], [baseHuman], [baseScope]]) as never,
      "thread-1",
    );
    const newerThread = { ...baseThread, entrySeq: 7 };
    const newerHuman = { id: "entry-7", seq: 7, createdAt: new Date("2026-06-15T10:03:00Z") };

    const result = await compareFreshnessSnapshot(
      createSequenceDb([[newerThread], [newerHuman], [baseScope]]) as never,
      "thread-1",
      snapshot,
    );

    expect(result).toEqual({ fresh: false, reason: "newer_human_entry" });
  });

  it("marks stale when a newer scope version appears", async () => {
    const snapshot = await captureFreshnessSnapshot(
      createSequenceDb([[baseThread], [baseHuman], [baseScope]]) as never,
      "thread-1",
    );
    const newerScope = {
      id: "scope-v2",
      versionNumber: 2,
      status: "draft",
      sourceEndSeq: 6,
      createdAt: new Date("2026-06-15T10:04:00Z"),
    };

    const result = await compareFreshnessSnapshot(
      createSequenceDb([[baseThread], [baseHuman], [newerScope]]) as never,
      "thread-1",
      snapshot,
    );

    expect(result).toEqual({ fresh: false, reason: "newer_scope_version" });
  });

  it("marks done threads stale for controller commits", async () => {
    const snapshot = await captureFreshnessSnapshot(
      createSequenceDb([[baseThread], [baseHuman], [baseScope]]) as never,
      "thread-1",
    );

    const result = await compareFreshnessSnapshot(
      createSequenceDb([[{ ...baseThread, phase: "done" }], [baseHuman], [baseScope]]) as never,
      "thread-1",
      snapshot,
    );

    expect(result).toEqual({ fresh: false, reason: "thread_done" });
  });

  it("reports snapshot_unavailable (not newer_human_entry) for an empty snapshot", async () => {
    // When captureFreshnessSnapshot threw at run start, the stored snapshot is
    // empty `{}`. The live thread has a human entry, so the legacy code reported
    // `newer_human_entry` (a FALSE human-conflict reason). It must now report a
    // distinct `snapshot_unavailable` reason instead.
    const result = await compareFreshnessSnapshot(
      createSequenceDb([[baseThread], [baseHuman], [baseScope]]) as never,
      "thread-1",
      {} as never,
    );

    expect(result).toEqual({ fresh: false, reason: "snapshot_unavailable" });
  });
});
