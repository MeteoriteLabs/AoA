// server/src/__tests__/scope-proposal-writer.test.ts
//
// Task 2.1 (Crew Work-as-Tasks): writeScopeProposal unit tests.
//
// Three cases:
//   (a) companyId mismatch → throws COMPANY_MISMATCH
//   (b) happy path → writes entry + plan-steps, returns existing:false
//   (c) pending-proposal unique violation → returns existing:true with existing entry id

import { describe, expect, it, vi } from "vitest";

// Mock publishLiveEvent — not under test here; we just want it not to throw.
vi.mock("../services/live-events.js", () => ({ publishLiveEvent: vi.fn() }));

import { writeScopeProposal } from "../services/scope-proposal-writer.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PROPOSAL = {
  summary: "Build the auth flow",
  proposedTasks: [
    { title: "Spec login UI" },
    { title: "Implement JWT issuance" },
  ],
};

const CONSTRAINT_NAME = "discussion_entries_one_pending_scope_proposal_idx";

/**
 * Simulate the Drizzle/postgres-js unique-violation shape.
 * The error must have code "23505" and constraint matching the index name
 * so that isUniqueViolation(..., CONSTRAINT_NAME) returns true.
 */
function makeUniqueViolationError(constraint: string): Error {
  const err: any = new Error(`duplicate key value violates unique constraint "${constraint}"`);
  err.code = "23505";
  err.constraint = constraint;
  return err;
}

// ── Mock DB builder ───────────────────────────────────────────────────────────

/**
 * Build a mock `db` whose `select` path returns the given thread row and
 * whose `transaction` executes the callback with a `tx` that either succeeds
 * or throws `txError`.
 */
function makeDb(opts: {
  /** Row returned by SELECT on discussions (null = thread not found). */
  threadRow?: { companyId: string; entrySeq: number } | null;
  /** Return value from the entry insert. */
  entryReturn?: any[];
  /** If set, the transaction callback throws this error after the first insert. */
  txError?: Error;
  /** Id of the existing pending entry (for SELECT after unique-violation). */
  existingEntryId?: string;
}) {
  const {
    threadRow = { companyId: "co-1", entrySeq: 3 },
    entryReturn = [{ id: "entry-new-1", seq: 4 }],
    txError,
    existingEntryId = "entry-existing-1",
  } = opts;

  // Track insert calls so tests can inspect them.
  const insertCalls: Array<{ values: any }> = [];

  // select() chain: returns threadRow for the pre-tx companyId check,
  // and existingEntryId row for the post-violation SELECT.
  let selectCallCount = 0;
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockImplementation(() => {
      selectCallCount += 1;
      if (selectCallCount === 1) {
        // First select: thread companyId check
        return Promise.resolve(threadRow ? [threadRow] : []);
      }
      // Second select: find existing pending scope_proposal entry
      return Promise.resolve([{ id: existingEntryId }]);
    }),
  };
  const select = vi.fn().mockReturnValue(selectChain);

  // tx.update(discussions) — bumps entrySeq + entryCount, returns [{ entrySeq, companyId }]
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([
      {
        entrySeq: (threadRow?.entrySeq ?? 0) + 1,
        companyId: threadRow?.companyId ?? "co-1",
      },
    ]),
  };
  const update = vi.fn().mockReturnValue(updateChain);

  // tx.insert() chain — entry first, plan steps second.
  const insert = vi.fn().mockImplementation((_table: any) => {
    const idx = insertCalls.length;
    const isEntry = idx === 0;
    insertCalls.push({ values: undefined });

    const returningMock = vi.fn().mockResolvedValue(isEntry ? entryReturn : []);

    if (!isEntry && txError) {
      // plan-steps insert throws (simulates unique violation or other error)
      const chain: any = {
        values: vi.fn().mockImplementation((vals: any) => {
          insertCalls[idx].values = vals;
          throw txError;
        }),
        returning: returningMock,
      };
      return chain;
    }

    const chain: any = {
      values: vi.fn().mockImplementation((vals: any) => {
        insertCalls[idx].values = vals;
        // For entry insert: if txError triggers ON the entry insert itself
        if (isEntry && txError) throw txError;
        return chain;
      }),
      returning: returningMock,
    };
    return chain;
  });

  const transaction = vi.fn().mockImplementation(async (cb: any) => {
    return await cb({ insert, update });
  });

  return {
    db: { select, transaction } as any,
    insertCalls,
    select,
    update,
    insert,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("writeScopeProposal", () => {
  // (a) companyId mismatch
  describe("companyId validation (security — Codex #14)", () => {
    it("throws COMPANY_MISMATCH when thread is not found", async () => {
      const { db } = makeDb({ threadRow: null });
      await expect(
        writeScopeProposal(db, {
          threadId: "thread-1",
          companyId: "co-1",
          proposal: PROPOSAL,
          agentId: "agent-1",
        }),
      ).rejects.toThrow("COMPANY_MISMATCH");
    });

    it("throws COMPANY_MISMATCH when thread belongs to a different company", async () => {
      const { db } = makeDb({ threadRow: { companyId: "co-OTHER", entrySeq: 2 } });
      await expect(
        writeScopeProposal(db, {
          threadId: "thread-1",
          companyId: "co-1",
          proposal: PROPOSAL,
          agentId: "agent-1",
        }),
      ).rejects.toThrow("COMPANY_MISMATCH");
    });

    it("does NOT enter the transaction when the company check fails", async () => {
      const { db, db: { transaction } } = makeDb({ threadRow: null });
      await expect(
        writeScopeProposal(db, {
          threadId: "thread-1",
          companyId: "co-1",
          proposal: PROPOSAL,
          agentId: null,
        }),
      ).rejects.toThrow();
      expect(transaction).not.toHaveBeenCalled();
    });
  });

  // (b) happy path
  describe("happy path", () => {
    it("returns existing:false with entryId and proposalCursorSeq", async () => {
      const { db } = makeDb({});
      const result = await writeScopeProposal(db, {
        threadId: "thread-1",
        companyId: "co-1",
        proposal: PROPOSAL,
        agentId: "agent-1",
      });
      expect(result.existing).toBe(false);
      expect(result.entryId).toBe("entry-new-1");
      expect(typeof result.proposalCursorSeq).toBe("number");
    });

    it("sets proposalCursorSeq to the thread's entrySeq before the bump", async () => {
      const { db } = makeDb({ threadRow: { companyId: "co-1", entrySeq: 7 } });
      const result = await writeScopeProposal(db, {
        threadId: "thread-1",
        companyId: "co-1",
        proposal: PROPOSAL,
        agentId: "agent-1",
      });
      // The cursor is the seq BEFORE the bump (what we read from the discussions row)
      expect(result.proposalCursorSeq).toBe(7);
    });

    it("inserts entry with extractionStatus=skipped and proposalStatus=pending (D9)", async () => {
      const { db, insertCalls } = makeDb({});
      await writeScopeProposal(db, {
        threadId: "thread-1",
        companyId: "co-1",
        proposal: PROPOSAL,
        agentId: "agent-42",
      });
      // First insert is the entry
      expect(insertCalls[0].values).toMatchObject({
        discussionId: "thread-1",
        inputType: "scope_proposal",
        extractionStatus: "skipped",
        proposalStatus: "pending",
        authorAgentId: "agent-42",
      });
    });

    it("rawContent includes proposalCursorSeq + proposal fields", async () => {
      const { db, insertCalls } = makeDb({ threadRow: { companyId: "co-1", entrySeq: 5 } });
      await writeScopeProposal(db, {
        threadId: "thread-1",
        companyId: "co-1",
        proposal: PROPOSAL,
        agentId: null,
      });
      const parsed = JSON.parse(insertCalls[0].values.rawContent);
      expect(parsed.proposalCursorSeq).toBe(5);
      expect(parsed.summary).toBe(PROPOSAL.summary);
      expect(Array.isArray(parsed.proposedTasks)).toBe(true);
    });

    it("inserts plan-steps with correct threadId, stepOrder, and title", async () => {
      const { db, insertCalls } = makeDb({});
      await writeScopeProposal(db, {
        threadId: "thread-1",
        companyId: "co-1",
        proposal: {
          summary: "Plan",
          proposedTasks: [{ title: "Step A" }, { title: "Step B" }],
        },
        agentId: null,
      });
      // Second insert is plan steps
      expect(insertCalls.length).toBe(2);
      expect(insertCalls[1].values).toEqual([
        { threadId: "thread-1", stepOrder: 0, title: "Step A", linkedItemId: null },
        { threadId: "thread-1", stepOrder: 1, title: "Step B", linkedItemId: null },
      ]);
    });

    it("skips plan-steps insert when proposedTasks is empty (only 1 insert)", async () => {
      const { db, insertCalls } = makeDb({});
      await writeScopeProposal(db, {
        threadId: "thread-1",
        companyId: "co-1",
        proposal: { summary: "Summary only", proposedTasks: [] },
        agentId: null,
      });
      expect(insertCalls.length).toBe(1);
    });

    it("uses authorAgentId=null and createdBy='aoa-agent' when agentId is null", async () => {
      const { db, insertCalls } = makeDb({});
      await writeScopeProposal(db, {
        threadId: "thread-1",
        companyId: "co-1",
        proposal: PROPOSAL,
        agentId: null,
      });
      expect(insertCalls[0].values.authorAgentId).toBeNull();
      expect(insertCalls[0].values.createdBy).toBe("aoa-agent");
    });

    it("publishes two live events on success", async () => {
      const { publishLiveEvent } = await import("../services/live-events.js");
      (publishLiveEvent as ReturnType<typeof vi.fn>).mockClear();

      const { db } = makeDb({});
      await writeScopeProposal(db, {
        threadId: "thread-1",
        companyId: "co-1",
        proposal: PROPOSAL,
        agentId: null,
      });
      expect(publishLiveEvent).toHaveBeenCalledTimes(2);
      const calls = (publishLiveEvent as ReturnType<typeof vi.fn>).mock.calls;
      const types = calls.map(([arg]: [any]) => arg.type);
      expect(types).toContain("discussion.entry.created");
      expect(types).toContain("thread.entry.created");
    });
  });

  // (c) unique-violation → existing:true
  describe("one-pending-per-thread guard (idempotency)", () => {
    it("returns existing:true with the existing entry id when unique violation fires on the entry insert", async () => {
      const uniqueErr = makeUniqueViolationError(CONSTRAINT_NAME);
      // The unique violation fires on the ENTRY insert (inside the transaction).
      // We need the mock to throw during the entry insert.
      const insertCalls: Array<{ values: any }> = [];
      const throwingInsert = vi.fn().mockImplementation((_table: any) => {
        const idx = insertCalls.length;
        insertCalls.push({ values: undefined });
        const chain: any = {
          values: vi.fn().mockImplementation((vals: any) => {
            insertCalls[idx].values = vals;
            return chain;
          }),
          returning: vi.fn().mockRejectedValue(uniqueErr),
        };
        return chain;
      });

      // Select: first call returns thread, second call returns existing pending entry
      let selectCount = 0;
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => {
          selectCount += 1;
          if (selectCount === 1) return Promise.resolve([{ companyId: "co-1", entrySeq: 2 }]);
          return Promise.resolve([{ id: "entry-existing-99" }]);
        }),
      };
      const updateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ entrySeq: 3, companyId: "co-1" }]),
      };

      const db: any = {
        select: vi.fn().mockReturnValue(selectChain),
        transaction: vi.fn().mockImplementation(async (cb: any) => {
          return await cb({ insert: throwingInsert, update: vi.fn().mockReturnValue(updateChain) });
        }),
      };

      const result = await writeScopeProposal(db, {
        threadId: "thread-1",
        companyId: "co-1",
        proposal: PROPOSAL,
        agentId: null,
      });

      expect(result.existing).toBe(true);
      expect(result.entryId).toBe("entry-existing-99");
    });

    it("re-throws unique violations from a DIFFERENT constraint (not the pending guard)", async () => {
      const otherErr = makeUniqueViolationError("some_other_unique_idx");

      const throwingInsert = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockRejectedValue(otherErr),
      }));

      const updateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ entrySeq: 2, companyId: "co-1" }]),
      };

      let selectCount = 0;
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => {
          selectCount += 1;
          if (selectCount === 1) return Promise.resolve([{ companyId: "co-1", entrySeq: 1 }]);
          return Promise.resolve([{ id: "x" }]);
        }),
      };

      const db: any = {
        select: vi.fn().mockReturnValue(selectChain),
        transaction: vi.fn().mockImplementation(async (cb: any) => {
          return await cb({ insert: throwingInsert, update: vi.fn().mockReturnValue(updateChain) });
        }),
      };

      await expect(
        writeScopeProposal(db, {
          threadId: "thread-1",
          companyId: "co-1",
          proposal: PROPOSAL,
          agentId: null,
        }),
      ).rejects.toThrow();
    });

    it("does NOT publish live events when returning existing:true", async () => {
      const { publishLiveEvent } = await import("../services/live-events.js");
      (publishLiveEvent as ReturnType<typeof vi.fn>).mockClear();

      const uniqueErr = makeUniqueViolationError(CONSTRAINT_NAME);
      const throwingInsert = vi.fn().mockImplementation(() => ({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockRejectedValue(uniqueErr),
      }));

      let selectCount = 0;
      const selectChain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockImplementation(() => {
          selectCount += 1;
          if (selectCount === 1) return Promise.resolve([{ companyId: "co-1", entrySeq: 0 }]);
          return Promise.resolve([{ id: "entry-existing-2" }]);
        }),
      };
      const updateChain = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ entrySeq: 1, companyId: "co-1" }]),
      };

      const db: any = {
        select: vi.fn().mockReturnValue(selectChain),
        transaction: vi.fn().mockImplementation(async (cb: any) => {
          return await cb({ insert: throwingInsert, update: vi.fn().mockReturnValue(updateChain) });
        }),
      };

      await writeScopeProposal(db, {
        threadId: "thread-1",
        companyId: "co-1",
        proposal: PROPOSAL,
        agentId: null,
      });

      expect(publishLiveEvent).not.toHaveBeenCalled();
    });
  });
});
