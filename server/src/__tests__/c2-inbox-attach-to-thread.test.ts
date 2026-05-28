// server/src/__tests__/c2-inbox-attach-to-thread.test.ts
//
// Task C2 batch 2 — attach_to_thread tool tests.
// Verifies: happy path (entry inserted + inbox marked attached), missing
// inbox item -> NOT_FOUND, originMedium → inputType mapping (with fallback to
// "mcp" for unknown values), transactional rollback on insert failure.

import { describe, expect, it, vi } from "vitest";
import { attachToThreadTool } from "../services/internal-agent/tools/inbox-attach-to-thread.js";
import type { ToolContext } from "../services/internal-agent/types.js";

// Build a mock tx that tracks (insert, update) calls. The tool issues:
//   1. tx.insert(discussionEntries).values({...}).returning() — entry
//   2. tx.update(threadInboxItems).set({status:"attached"}).where(...)
// We key behavior off insert/update call ordinal.
function makeTxTracker(opts: {
  entryReturn?: any[];
  insertThrows?: Error;
  updateThrows?: Error;
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
    return makeInsertChain(() => opts.entryReturn ?? [{ id: "entry-1" }], idx);
  });

  const update = vi.fn((_table: any) => {
    const idx = updateCalls.length;
    updateCalls.push({ set: undefined });
    if (opts.updateThrows) {
      throw opts.updateThrows;
    }
    const chain: any = {};
    chain.set = (vals: any) => {
      updateCalls[idx].set = vals;
      return chain;
    };
    chain.where = () => Promise.resolve([]);
    return chain;
  });

  return { insert, update, insertCalls, updateCalls };
}

function makeDb(opts: {
  inboxItemRows?: any[];
  txOpts?: Parameters<typeof makeTxTracker>[0];
} = {}) {
  const tracker = makeTxTracker(opts.txOpts);
  const limit = vi.fn().mockResolvedValue(opts.inboxItemRows ?? [
    {
      id: "inbox-1",
      rawContent: "some inbound text",
      originSource: "external",
      originMedium: "text",
    },
  ]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });

  const transaction = vi.fn(async (cb: any) => {
    return await cb({ insert: tracker.insert, update: tracker.update });
  });

  return {
    db: { select, transaction } as any,
    tracker,
    transactionFn: transaction,
  };
}

function makeCtx(db: any): ToolContext {
  return {
    companyId: "co-1",
    userId: "u-1",
    userRole: "team_member",
    enabledCapabilities: ["system_actions"],
    agentId: "agent-router",
    db,
    services: {} as any,
  } as unknown as ToolContext;
}

describe("attach_to_thread tool (C2 batch 2)", () => {
  it("metadata: name, category=action, requiredRole=team_member, no confirmation", () => {
    expect(attachToThreadTool.name).toBe("attach_to_thread");
    expect(attachToThreadTool.category).toBe("action");
    expect(attachToThreadTool.requiredRole).toBe("team_member");
    expect(attachToThreadTool.requiresConfirmation).toBe(false);
  });

  it("happy path: inserts entry + marks inbox attached in a transaction", async () => {
    const { db, tracker, transactionFn } = makeDb();
    const ctx = makeCtx(db);
    const result = await attachToThreadTool.execute(
      { inboxItemId: "inbox-1", threadId: "thread-9" },
      ctx,
    );
    expect(result.success).toBe(true);
    expect((result.data as any).entryId).toBe("entry-1");
    // Exactly one insert + one update inside the transaction.
    expect(transactionFn).toHaveBeenCalledOnce();
    expect(tracker.insertCalls.length).toBe(1);
    expect(tracker.updateCalls.length).toBe(1);
    // Entry payload threads the inbox metadata into sourceInfo and uses the
    // agentId for createdBy.
    const entryValues = tracker.insertCalls[0].values;
    expect(entryValues).toMatchObject({
      discussionId: "thread-9",
      rawContent: "some inbound text",
      createdBy: "agent-router",
      sourceInfo: {
        originSource: "external",
        fromInboxItem: "inbox-1",
      },
    });
    // Inbox status update -> "attached"
    expect(tracker.updateCalls[0].set).toMatchObject({ status: "attached" });
  });

  it("maps originMedium to inputType when it's a valid DiscussionEntryInputType", async () => {
    const { db, tracker } = makeDb({
      inboxItemRows: [
        {
          id: "inbox-2",
          rawContent: "voice content",
          originSource: "external",
          originMedium: "voice",
        },
      ],
    });
    const ctx = makeCtx(db);
    await attachToThreadTool.execute(
      { inboxItemId: "inbox-2", threadId: "thread-9" },
      ctx,
    );
    expect(tracker.insertCalls[0].values.inputType).toBe("voice");
  });

  it("falls back to 'mcp' when originMedium isn't a valid entry input type", async () => {
    const { db, tracker } = makeDb({
      inboxItemRows: [
        {
          id: "inbox-3",
          rawContent: "scheduled hop",
          originSource: "system",
          // 'scheduled' is a valid THREAD_ORIGIN_MEDIUM but not a
          // DISCUSSION_ENTRY_INPUT_TYPE — should fall back to "mcp".
          originMedium: "scheduled",
        },
      ],
    });
    const ctx = makeCtx(db);
    await attachToThreadTool.execute(
      { inboxItemId: "inbox-3", threadId: "thread-9" },
      ctx,
    );
    expect(tracker.insertCalls[0].values.inputType).toBe("mcp");
  });

  it("returns NOT_FOUND when the inbox item doesn't exist", async () => {
    const { db, transactionFn } = makeDb({ inboxItemRows: [] });
    const ctx = makeCtx(db);
    const result = await attachToThreadTool.execute(
      { inboxItemId: "missing", threadId: "thread-9" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("NOT_FOUND");
    expect(transactionFn).not.toHaveBeenCalled();
  });

  it("rolls back when the entry insert throws", async () => {
    const { db } = makeDb({
      txOpts: { insertThrows: new Error("simulated insert failure") },
    });
    const ctx = makeCtx(db);
    const result = await attachToThreadTool.execute(
      { inboxItemId: "inbox-1", threadId: "thread-9" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("TRANSACTION_FAILED");
    expect(result.summary).toContain("simulated insert failure");
  });

  it("returns INVALID_PARAMS when inboxItemId is missing", async () => {
    const { db, transactionFn } = makeDb();
    const ctx = makeCtx(db);
    const result = await attachToThreadTool.execute(
      { threadId: "thread-9" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
    expect(transactionFn).not.toHaveBeenCalled();
  });

  it("returns INVALID_PARAMS when threadId is missing", async () => {
    const { db, transactionFn } = makeDb();
    const ctx = makeCtx(db);
    const result = await attachToThreadTool.execute(
      { inboxItemId: "inbox-1" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
    expect(transactionFn).not.toHaveBeenCalled();
  });
});
