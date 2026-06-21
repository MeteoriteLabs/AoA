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
  // When parentVersionId validation is exercised the tool issues an EXTRA
  // tx.select (the parent-artifact lookup) BEFORE the max-version select.
  // `parentArtifactId` is the artifactId that parent lookup resolves to.
  // `undefined` here means "no parent row" (foreign/missing parent).
  parentLookupRows?: any[];
} = {}) {
  const insertCalls: Array<{ values: any }> = [];
  const updateCalls: Array<{ set: any }> = [];
  // Records every tx.select() call's resolved rows in order, so tests can
  // assert which select ran (parent lookup vs. max-version) and how many.
  const selectCalls: Array<{ projection: any }> = [];

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

  // tx.select(projection).from(...).where(...) — dispatches by projection:
  //   { artifactId: ... } → parent-artifact lookup (parentVersionId validation)
  //   { max: ... }        → current max-version read
  const selectFn = vi.fn((projection: any) => {
    selectCalls.push({ projection });
    const isParentLookup =
      projection && Object.prototype.hasOwnProperty.call(projection, "artifactId");
    const rows = isParentLookup
      ? opts.parentLookupRows ?? []
      : [{ max: opts.currentMax ?? 0 }];
    const fromObj = {
      where: vi.fn().mockResolvedValue(rows),
    };
    return { from: vi.fn().mockReturnValue(fromObj) };
  });

  return { insert, update, select: selectFn, insertCalls, updateCalls, selectCalls };
}

// db.select({companyId}).from(artifacts).where(eq(artifacts.id, id)) — the
// company-scope pre-check that runs BEFORE the transaction. `rows` is what the
// `.where()` resolves to (the company-ownership lookup result).
function makeDbSelect(rows: any[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where };
}

function makeCtx(
  transactionFn: any,
  opts: { companyId?: string; selectFn?: any } = {},
): ToolContext {
  // Default ownership lookup returns a same-company artifact so existing
  // success-path tests pass unchanged.
  const dbSelect =
    opts.selectFn ?? makeDbSelect([{ companyId: opts.companyId ?? "co-1" }]).select;
  return {
    companyId: opts.companyId ?? "co-1",
    userId: "u-1",
    userRole: "team_member",
    enabledCapabilities: ["system_actions"],
    agentId: "agent-eng",
    db: { transaction: transactionFn, select: dbSelect },
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

  it("tracks parentVersionId when provided (branching) and parent belongs to the artifact", async () => {
    // The parent version row resolves to the SAME artifact → validation passes.
    const tracker = makeTxTracker({
      currentMax: 2,
      versionId: "v-3",
      parentLookupRows: [{ artifactId: "art-1" }],
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
      {
        artifactId: "art-1",
        content: "branch content",
        parentVersionId: "v-1",
      },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(tracker.insertCalls[0].values.parentVersionId).toBe("v-1");
  });

  it("foreign parentVersionId (parent belongs to another artifact) → NOT_FOUND, no version inserted", async () => {
    // SECURITY: the FK on artifact_versions.parent_version_id only constrains it
    // to SOME artifact_versions row. A prompt-injected crew agent could branch a
    // new version on a same-company artifact off a parent owned by ANOTHER
    // artifact/company. The tool inserts the row directly inside its own tx
    // (bypassing artifactService.addVersion's guard), so it must re-validate the
    // parent's artifactId === the target artifactId INSIDE the tx, before insert.
    const tracker = makeTxTracker({
      currentMax: 2,
      versionId: "v-3",
      // Parent row exists but belongs to a DIFFERENT artifact.
      parentLookupRows: [{ artifactId: "art-other" }],
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
      {
        artifactId: "art-1",
        content: "branch off a foreign parent",
        parentVersionId: "v-foreign",
      },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("NOT_FOUND");
    // No version row inserted, no pointer bump — the foreign parent is rejected
    // before any write.
    expect(tracker.insertCalls.length).toBe(0);
    expect(tracker.updateCalls.length).toBe(0);
  });

  it("missing parentVersionId row (lookup returns nothing) → NOT_FOUND, no version inserted", async () => {
    const tracker = makeTxTracker({
      currentMax: 2,
      versionId: "v-3",
      parentLookupRows: [], // parent version id does not exist
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
      {
        artifactId: "art-1",
        content: "branch off a ghost parent",
        parentVersionId: "v-ghost",
      },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("NOT_FOUND");
    expect(tracker.insertCalls.length).toBe(0);
    expect(tracker.updateCalls.length).toBe(0);
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

  it("cross-company artifactId → NOT_FOUND and writes NOTHING (no transaction)", async () => {
    // The artifact row resolves to a DIFFERENT company. A crew agent (Engineer/
    // Planner, prompt-injection surface) must not be able to add a version to,
    // or repoint, another company's artifact. The company check must run BEFORE
    // ctx.db.transaction — returning failure from inside the tx callback would be
    // lost (the outer handler reads result.versionNumber and reports success).
    const tracker = makeTxTracker({ currentMax: 3, versionId: "v-4" });
    const transactionFn = vi.fn(async (cb: any) =>
      cb({
        select: tracker.select,
        insert: tracker.insert,
        update: tracker.update,
      }),
    );
    const foreignSelect = makeDbSelect([{ companyId: "other-co" }]);
    const ctx = makeCtx(transactionFn, {
      companyId: "co-1",
      selectFn: foreignSelect.select,
    });

    const result = await createArtifactVersionTool.execute(
      { artifactId: "art-foreign", content: "leak" },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("NOT_FOUND");
    // The transaction must never run — nothing inserted, no pointer bump.
    expect(transactionFn).not.toHaveBeenCalled();
    expect(tracker.insertCalls.length).toBe(0);
    expect(tracker.updateCalls.length).toBe(0);
  });

  it("missing artifact (lookup returns no row) → NOT_FOUND and no transaction", async () => {
    const tracker = makeTxTracker({ currentMax: 0, versionId: "v-1" });
    const transactionFn = vi.fn(async (cb: any) =>
      cb({
        select: tracker.select,
        insert: tracker.insert,
        update: tracker.update,
      }),
    );
    const emptySelect = makeDbSelect([]); // no artifact row
    const ctx = makeCtx(transactionFn, { selectFn: emptySelect.select });

    const result = await createArtifactVersionTool.execute(
      { artifactId: "ghost", content: "x" },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("NOT_FOUND");
    expect(transactionFn).not.toHaveBeenCalled();
    expect(tracker.insertCalls.length).toBe(0);
  });

  it("regression: same-company artifactId still creates the version", async () => {
    const tracker = makeTxTracker({ currentMax: 1, versionId: "v-2" });
    const transactionFn = vi.fn(async (cb: any) =>
      cb({
        select: tracker.select,
        insert: tracker.insert,
        update: tracker.update,
      }),
    );
    // Ownership lookup returns the caller's company → success path.
    const ownSelect = makeDbSelect([{ companyId: "co-1" }]);
    const ctx = makeCtx(transactionFn, {
      companyId: "co-1",
      selectFn: ownSelect.select,
    });

    const result = await createArtifactVersionTool.execute(
      { artifactId: "art-own", content: "ok" },
      ctx,
    );

    expect(result.success).toBe(true);
    expect((result.data as any).versionNumber).toBe(2);
    expect(transactionFn).toHaveBeenCalledTimes(1);
    expect(tracker.insertCalls[0].values).toMatchObject({
      artifactId: "art-own",
      versionNumber: 2,
    });
  });
});
