// server/src/__tests__/c2-artifact-create-version.test.ts
//
// Task C2 batch 2 — create_artifact_version tool tests.
// Verifies: increments versionNumber correctly, sets currentVersionId on the
// artifacts row, parentVersionId tracked when provided, transactional
// integrity on insert failure, and param validation.

import { describe, expect, it, vi } from "vitest";
import { createArtifactVersionTool } from "../services/internal-agent/tools/artifact-create-version.js";
import type { ToolContext } from "../services/internal-agent/types.js";

// Build a mock tx that tracks:
//   1. tx.select({max: ...}).from(artifactVersions).where(...) — current max
//   2. tx.insert(artifactVersions).values({...}).returning() — new version
//   3. tx.update(artifacts).set({currentVersionId, updatedAt}).where(...) — pointer bump
function makeTxTracker(opts: {
  currentMax?: number;
  versionId?: string;
  insertThrows?: Error;
} = {}) {
  const insertCalls: Array<{ values: any }> = [];
  const updateCalls: Array<{ set: any }> = [];

  function makeInsertChain(getResult: () => any[], idx: number) {
    const chain: any = {};
    chain.values = (vals: any) => {
      insertCalls[idx].values = vals;
      return chain;
    };
    chain.returning = () => Promise.resolve(getResult());
    return chain;
  }

  const insert = vi.fn((_table: any) => {
    const idx = insertCalls.length;
    insertCalls.push({ values: undefined });
    if (opts.insertThrows) {
      throw opts.insertThrows;
    }
    return makeInsertChain(
      () => [{ id: opts.versionId ?? "v-new" }],
      idx,
    );
  });

  const update = vi.fn((_table: any) => {
    const idx = updateCalls.length;
    updateCalls.push({ set: undefined });
    const chain: any = {};
    chain.set = (vals: any) => {
      updateCalls[idx].set = vals;
      return chain;
    };
    chain.where = () => Promise.resolve([]);
    return chain;
  });

  // tx.select({max:..}).from(artifactVersions).where(...)
  const selectFn = vi.fn(() => {
    const fromObj = {
      where: vi
        .fn()
        .mockResolvedValue([{ max: opts.currentMax ?? 0 }]),
    };
    return { from: vi.fn().mockReturnValue(fromObj) };
  });

  return { insert, update, select: selectFn, insertCalls, updateCalls };
}

function makeCtx(transactionFn: any): ToolContext {
  return {
    companyId: "co-1",
    userId: "u-1",
    userRole: "team_member",
    enabledCapabilities: ["system_actions"],
    agentId: "agent-eng",
    db: { transaction: transactionFn },
    services: {} as any,
  } as unknown as ToolContext;
}

describe("create_artifact_version tool (C2 batch 2)", () => {
  it("metadata: name, category=action, requiredRole=team_member, no confirmation", () => {
    expect(createArtifactVersionTool.name).toBe("create_artifact_version");
    expect(createArtifactVersionTool.category).toBe("action");
    expect(createArtifactVersionTool.requiredRole).toBe("team_member");
    expect(createArtifactVersionTool.requiresConfirmation).toBe(false);
  });

  it("increments versionNumber from existing max and updates currentVersionId", async () => {
    const tracker = makeTxTracker({ currentMax: 3, versionId: "v-4" });
    const transactionFn = vi.fn(async (cb: any) =>
      cb({
        select: tracker.select,
        insert: tracker.insert,
        update: tracker.update,
      }),
    );
    const ctx = makeCtx(transactionFn);

    const result = await createArtifactVersionTool.execute(
      { artifactId: "art-1", content: "new content" },
      ctx,
    );

    expect(result.success).toBe(true);
    expect((result.data as any).versionId).toBe("v-4");
    expect((result.data as any).versionNumber).toBe(4);
    // version_number = current max (3) + 1 = 4
    expect(tracker.insertCalls[0].values).toMatchObject({
      artifactId: "art-1",
      versionNumber: 4,
      content: "new content",
      source: "agent",
      parentVersionId: null,
    });
    // currentVersionId bumped to the new version id
    expect(tracker.updateCalls[0].set).toMatchObject({
      currentVersionId: "v-4",
    });
  });

  it("starts at version 1 when no versions exist (max = 0)", async () => {
    const tracker = makeTxTracker({ currentMax: 0, versionId: "v-1" });
    const transactionFn = vi.fn(async (cb: any) =>
      cb({
        select: tracker.select,
        insert: tracker.insert,
        update: tracker.update,
      }),
    );
    const ctx = makeCtx(transactionFn);

    const result = await createArtifactVersionTool.execute(
      { artifactId: "art-fresh", content: "first" },
      ctx,
    );

    expect(result.success).toBe(true);
    expect((result.data as any).versionNumber).toBe(1);
  });

  it("tracks parentVersionId when provided (branching)", async () => {
    const tracker = makeTxTracker({ currentMax: 2, versionId: "v-3" });
    const transactionFn = vi.fn(async (cb: any) =>
      cb({
        select: tracker.select,
        insert: tracker.insert,
        update: tracker.update,
      }),
    );
    const ctx = makeCtx(transactionFn);

    await createArtifactVersionTool.execute(
      {
        artifactId: "art-1",
        content: "branch content",
        parentVersionId: "v-1",
      },
      ctx,
    );
    expect(tracker.insertCalls[0].values.parentVersionId).toBe("v-1");
  });

  it("rolls back when the version insert fails", async () => {
    const tracker = makeTxTracker({
      insertThrows: new Error("simulated insert error"),
    });
    const transactionFn = vi.fn(async (cb: any) =>
      cb({
        select: tracker.select,
        insert: tracker.insert,
        update: tracker.update,
      }),
    );
    const ctx = makeCtx(transactionFn);

    const result = await createArtifactVersionTool.execute(
      { artifactId: "art-1", content: "x" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("TRANSACTION_FAILED");
    expect(result.summary).toContain("simulated insert error");
  });

  it("returns INVALID_PARAMS when artifactId is missing", async () => {
    const transactionFn = vi.fn();
    const ctx = makeCtx(transactionFn);
    const result = await createArtifactVersionTool.execute(
      { content: "x" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
    expect(transactionFn).not.toHaveBeenCalled();
  });

  it("returns INVALID_PARAMS when content is not a string", async () => {
    const transactionFn = vi.fn();
    const ctx = makeCtx(transactionFn);
    const result = await createArtifactVersionTool.execute(
      { artifactId: "art-1" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
    expect(transactionFn).not.toHaveBeenCalled();
  });
});
