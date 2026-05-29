/**
 * Phase G4.3 — Integration tests for the live-thread → spin-off flow.
 *
 * Verifies the wiring from `spin_off_thread` (the agent tool, Navigator-
 * invoked) through the discussions + thread_links + seed-entry copy. We
 * assert what the tool ACTUALLY does today (not what a future Phase H
 * change might enforce).
 *
 * Wiring gap noted (see test below): the plan calls for spin-off to be
 * REJECTED on a non-live thread (subtype != 'live'). The current
 * `spin_off_thread` tool does NOT inspect the source thread's subtype —
 * it accepts any source. The schema column exists (`discussions.subtype`,
 * default 'normal', enum normal|live) but no service code reads it. The
 * "rejected on non-live" guard is documented as a TODO test asserting
 * the CURRENT permissive behavior so a future tightening doesn't slip
 * silently. The other three plan requirements (link kind, seed-entry
 * copy semantics, scope inheritance) ARE exercised against today's code.
 *
 * Visibility: the tool hardcodes the new thread's visibility to "company"
 * (see thread-spin-off.ts line 79: `visibility: "company"`). It does NOT
 * inherit from the source thread. We assert what the code does today and
 * note the gap explicitly.
 */

import { describe, expect, it, vi } from "vitest";
import { spinOffThreadTool } from "../../services/internal-agent/tools/thread-spin-off.js";
import type { ToolContext } from "../../services/internal-agent/types.js";

// ---------------------------------------------------------------------------
// Mock harness — mirrors c2-thread-spin-off.test.ts. Tracks insert ordinals
// so we can identify which insert is the new thread vs entry copies vs the
// thread_links row.
// ---------------------------------------------------------------------------

interface TxTrackerOpts {
  newThreadReturn?: any[];
  seedSelectReturn?: any[];
  /** When provided, the insert at this ordinal throws (transaction roll-back). */
  insertThrowsAt?: number;
}

function makeTxTracker(opts: TxTrackerOpts = {}) {
  const insertCalls: Array<{ values: any }> = [];

  function makeInsertChain(getResult: () => any[], idx: number) {
    const chain: any = {};
    chain.values = (vals: any) => {
      insertCalls[idx].values = vals;
      return chain;
    };
    chain.returning = () => Promise.resolve(getResult());
    chain.then = (resolve: any) => Promise.resolve(resolve(getResult()));
    return chain;
  }

  const insert = vi.fn((_table: any) => {
    const idx = insertCalls.length;
    insertCalls.push({ values: undefined });
    if (typeof opts.insertThrowsAt === "number" && opts.insertThrowsAt === idx) {
      throw new Error("simulated transaction failure");
    }
    if (idx === 0) {
      return makeInsertChain(
        () => opts.newThreadReturn ?? [{ id: "new-thread-spinoff" }],
        idx,
      );
    }
    return makeInsertChain(() => [], idx);
  });

  const selectFn = vi.fn(() => {
    const fromObj = {
      where: vi.fn().mockResolvedValue(opts.seedSelectReturn ?? []),
    };
    return { from: vi.fn().mockReturnValue(fromObj) };
  });

  return { insert, select: selectFn, insertCalls };
}

function makeCtx(transactionFn: any): ToolContext {
  return {
    companyId: "co-spinoff-1",
    userId: "u-spinoff-1",
    userRole: "team_member",
    enabledCapabilities: ["system_actions"],
    agentId: "agent-navigator",
    db: { transaction: transactionFn },
    services: {} as any,
  } as unknown as ToolContext;
}

describe("integration: live thread → spin-off flow", () => {
  // ── Happy path — links, scope inheritance ────────────────────────────────

  it("spin_off creates a new thread linked back to the source via thread_links(kind='spinoff')", async () => {
    const tracker = makeTxTracker();
    const transactionFn = vi.fn(async (cb: any) =>
      cb({ insert: tracker.insert, select: tracker.select }),
    );

    const result = await spinOffThreadTool.execute(
      { fromThreadId: "thread-src-1", title: "Spin-off thread" },
      makeCtx(transactionFn),
    );

    expect(result.success).toBe(true);
    expect((result.data as any).threadId).toBe("new-thread-spinoff");

    // The tx makes 2 inserts when no seeds: (1) discussions, (2) thread_links.
    expect(tracker.insertCalls).toHaveLength(2);
    const newThread = tracker.insertCalls[0].values;
    expect(newThread).toMatchObject({
      companyId: "co-spinoff-1",
      title: "Spin-off thread",
      forkedFromId: "thread-src-1",
      // Tool hardcodes "company" — see file header note on visibility.
      visibility: "company",
      phase: "discuss",
      createdBy: "agent-navigator",
    });
    const link = tracker.insertCalls[1].values;
    expect(link).toMatchObject({
      companyId: "co-spinoff-1",
      fromThreadId: "thread-src-1",
      toThreadId: "new-thread-spinoff",
      kind: "spinoff",
    });
  });

  it("spawned thread inherits companyId from the caller's context (not from the source row)", async () => {
    // The tool doesn't read the source thread row — it copies ctx.companyId
    // onto the new thread. This is correct for our cross-company guard
    // (which is enforced upstream by RBAC + ctx assembly), but worth
    // pinning so a future "inherit from source" refactor doesn't quietly
    // change the semantic.
    const tracker = makeTxTracker();
    const transactionFn = vi.fn(async (cb: any) =>
      cb({ insert: tracker.insert, select: tracker.select }),
    );

    await spinOffThreadTool.execute(
      { fromThreadId: "any-source", title: "scope-inherit-check" },
      makeCtx(transactionFn),
    );

    expect(tracker.insertCalls[0].values.companyId).toBe("co-spinoff-1");
    expect(tracker.insertCalls[1].values.companyId).toBe("co-spinoff-1");
  });

  // ── Seed-entry copy semantics ────────────────────────────────────────────

  it("seed entries are copied into the new thread with sourceInfo back-pointers", async () => {
    const tracker = makeTxTracker({
      seedSelectReturn: [
        { id: "src-e-1", rawContent: "first seed entry content" },
        { id: "src-e-2", rawContent: "second seed entry content" },
      ],
    });
    const transactionFn = vi.fn(async (cb: any) =>
      cb({ insert: tracker.insert, select: tracker.select }),
    );

    const result = await spinOffThreadTool.execute(
      {
        fromThreadId: "thread-src-1",
        title: "Seeded spin-off",
        seedEntries: ["src-e-1", "src-e-2"],
      },
      makeCtx(transactionFn),
    );

    expect(result.success).toBe(true);
    expect((result.data as any).seedEntryCount).toBe(2);

    // 1 new-thread + 2 seed entries + 1 link = 4 inserts in order.
    expect(tracker.insertCalls).toHaveLength(4);
    const entry1 = tracker.insertCalls[1].values;
    expect(entry1).toMatchObject({
      discussionId: "new-thread-spinoff",
      inputType: "agent", // seeded entries are tagged as agent-authored
      rawContent: "first seed entry content",
      sourceInfo: {
        copiedFromThreadId: "thread-src-1",
        originalEntryId: "src-e-1",
      },
    });
    const entry2 = tracker.insertCalls[2].values;
    expect(entry2).toMatchObject({
      rawContent: "second seed entry content",
      sourceInfo: {
        copiedFromThreadId: "thread-src-1",
        originalEntryId: "src-e-2",
      },
    });
  });

  it("missing source title falls back to the supplied tool title (no implicit copy)", async () => {
    // We're asserting that the tool does NOT silently borrow the source
    // title — that would be a privacy leak if the source title contained
    // sensitive context. The caller is responsible for the new title.
    const tracker = makeTxTracker();
    const transactionFn = vi.fn(async (cb: any) =>
      cb({ insert: tracker.insert, select: tracker.select }),
    );

    await spinOffThreadTool.execute(
      { fromThreadId: "thread-src-1", title: "explicit-title-only" },
      makeCtx(transactionFn),
    );

    expect(tracker.insertCalls[0].values.title).toBe("explicit-title-only");
  });

  // ── Wiring gap: spin-off on a non-live thread is NOT rejected today ──────

  it(
    "TODO(wiring-gap): spin-off on a non-live source thread is currently ALLOWED " +
      "(plan G4.3 calls for subtype='live' guard; tool doesn't enforce it yet)",
    async () => {
      // The plan asks for "Spin-off on a non-live thread is rejected (only
      // subtype='live' threads spin off)". The current tool
      // (`server/src/services/internal-agent/tools/thread-spin-off.ts`)
      // does not read source.subtype at all — see the file. We assert
      // CURRENT behavior so the gap is visible: the spin-off succeeds and
      // no select against discussions.subtype is issued.
      //
      // When the future enforcement lands (a subtype='live' guard before
      // the tx), flip this test to assert rejection with reason 'not_live'
      // or whatever the tool error code becomes.
      const tracker = makeTxTracker();
      const transactionFn = vi.fn(async (cb: any) =>
        cb({ insert: tracker.insert, select: tracker.select }),
      );

      const result = await spinOffThreadTool.execute(
        { fromThreadId: "normal-thread-id", title: "should-be-blocked-but-isnt" },
        makeCtx(transactionFn),
      );

      // Today: succeeds.
      expect(result.success).toBe(true);
      // Today: NO select against the source's subtype is issued (the tool
      // never queries the source row inside the tx — it trusts the caller's
      // companyId).
      expect(tracker.select).not.toHaveBeenCalled();
    },
  );

  // ── Failure mode ─────────────────────────────────────────────────────────

  it("transaction rollback when the new-thread insert fails (no link, no entries)", async () => {
    const tracker = makeTxTracker({ insertThrowsAt: 0 });
    const transactionFn = vi.fn(async (cb: any) =>
      cb({ insert: tracker.insert, select: tracker.select }),
    );

    const result = await spinOffThreadTool.execute(
      { fromThreadId: "thread-src-1", title: "should-fail" },
      makeCtx(transactionFn),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("TRANSACTION_FAILED");
    expect(result.summary).toMatch(/simulated transaction failure/);
  });

  it("missing fromThreadId or title → INVALID_PARAMS, no tx attempted", async () => {
    const transactionFn = vi.fn();
    const ctx = makeCtx(transactionFn);

    let r = await spinOffThreadTool.execute({ title: "no-source" }, ctx);
    expect(r.error).toBe("INVALID_PARAMS");

    r = await spinOffThreadTool.execute({ fromThreadId: "thread-src-1" }, ctx);
    expect(r.error).toBe("INVALID_PARAMS");

    expect(transactionFn).not.toHaveBeenCalled();
  });
});
