// F2: submit_extracted_items must publish a `discussion.extraction.completed`
// LiveEvent on success — parity with the legacy in-process extraction service
// (server/src/services/extraction.ts:630-638). Without this, UIs subscribed to
// the LiveEvent do not refresh when an AoA agent completes extraction.
//
// Contract test (proxy-table + hoisted-mock harness, mirrors
// aoa-submit-extracted-items.test.ts). Windows-runnable.
import { describe, expect, it, vi, beforeEach } from "vitest";

// vi.mock is hoisted above top-level consts, so the mock fn we also assert on
// must be created via vi.hoisted (vitest-sanctioned pattern).
const { publishLiveEventMock } = vi.hoisted(() => ({
  publishLiveEventMock: vi.fn((input: unknown) => input),
}));

// The tool imports `../../live-events.js`; vitest resolves a mocked module ID
// to the same absolute file regardless of the importer's relative specifier,
// so mocking it via this test file's own relative path intercepts the tool's
// import (both resolve to server/src/services/live-events.js).
vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: publishLiveEventMock,
}));

// Drizzle-orm ESM cycle workaround: stub the operators we use.
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...preds: unknown[]) => ({ and: preds }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    sql: { strings: Array.from(strings), values },
  }),
}));

// Proxy-based table stubs so column references resolve to symbols.
vi.mock("@armyofagents/db", () => {
  const t = (n: string) =>
    new Proxy(
      {},
      {
        get: (_x, p) =>
          typeof p === "string" ? Symbol(`${n}.${p}`) : undefined,
      },
    );
  return {
    discussionExtractedItems: t("dei"),
    discussionEntries: t("de"),
    discussions: t("d"),
  };
});

import { submitExtractedItemsTool } from "../services/internal-agent/tools/submit-extracted-items.js";

// Builds a mock Db that records the ORDER of side-effecting operations so we
// can assert the terminal entry update happens before publishLiveEvent. The
// `select(...).from(...).where(...)` chain resolves entryId -> discussionId.
//
// `terminalRows` models what the guarded terminal UPDATE's `.returning()`
// resolves to: a NON-EMPTY array means the pending->completed transition was
// performed by THIS call (the entry was still `processing`); an empty array
// models a concurrent terminalizer having already moved the entry out of
// `processing` (0 rows matched). Default is a single matched row, faithful to
// the existing F2 tests' intent ("entry was processing -> transition happens
// -> event fires"). The pendingItemCount increment update is a bare `await`
// (no `.returning()`), so the returned handle is BOTH thenable and exposes a
// `.returning()` method.
function makeMockDb(
  discussionId: string | null = "d-1",
  terminalRows: Array<{ id: string }> = [{ id: "e-1" }],
) {
  const order: string[] = [];
  const db: any = {
    insert: (_table: any) => ({
      values: (_v: any) => {
        order.push("insert");
        return Promise.resolve([]);
      },
    }),
    update: (table: any) => ({
      set: (v: any) => ({
        where: (_w: any) => {
          const isTerminal = v?.extractionStatus === "completed";
          // Tag the terminal entry-status write distinctly from the
          // pendingItemCount increment so ordering can be asserted.
          if (isTerminal) {
            order.push("update:entry-completed");
          } else {
            order.push("update:other");
          }
          // The bare pendingItemCount update awaits this directly; the
          // guarded terminal write calls `.returning()` on it. Return a
          // thenable that also exposes `.returning()` so both call shapes
          // work off the same mock handle.
          const result = isTerminal ? terminalRows : [];
          const handle: any = Promise.resolve(result);
          handle.returning = (_proj?: any) => Promise.resolve(result);
          return handle;
        },
      }),
    }),
    select: (_cols?: any) => ({
      from: (_fromTable: any) => ({
        where: (_w: any) => {
          order.push("select");
          return Promise.resolve(
            discussionId === null ? [] : [{ discussionId }],
          );
        },
      }),
    }),
  };
  return { db, order };
}

function makeCtx(db: any) {
  // Real ToolContext shape (see internal-agent/types.ts).
  return {
    companyId: "co-1",
    userId: "u-1",
    userRole: "founder",
    enabledCapabilities: ["discussion_processing"],
    db,
    services: {},
  } as any;
}

describe("submit_extracted_items publishes discussion.extraction.completed (F2)", () => {
  beforeEach(() => {
    publishLiveEventMock.mockClear();
  });

  it("emits the LiveEvent with the resolved discussionId + itemCount when items exist", async () => {
    const { db } = makeMockDb("d-1");
    const res = await submitExtractedItemsTool.execute(
      { entryId: "e-1", items: [{ type: "task", content: "x" }] },
      makeCtx(db),
    );

    expect(res.success).toBe(true);
    expect(publishLiveEventMock).toHaveBeenCalledTimes(1);
    expect(publishLiveEventMock).toHaveBeenCalledWith({
      companyId: "co-1",
      type: "discussion.extraction.completed",
      payload: {
        discussionId: "d-1",
        entryId: "e-1",
        itemCount: 1,
      },
    });
  });

  it("still emits with itemCount:0 for EMPTY items (proves unconditional discussionId resolution)", async () => {
    const { db } = makeMockDb("d-9");
    const res = await submitExtractedItemsTool.execute(
      { entryId: "e-9", items: [] },
      makeCtx(db),
    );

    expect(res.success).toBe(true);
    expect(publishLiveEventMock).toHaveBeenCalledTimes(1);
    expect(publishLiveEventMock).toHaveBeenCalledWith({
      companyId: "co-1",
      type: "discussion.extraction.completed",
      payload: {
        discussionId: "d-9",
        entryId: "e-9",
        itemCount: 0,
      },
    });
  });

  it("does NOT emit discussion.extraction.completed when the guarded terminal write matched 0 rows (concurrent terminalize)", async () => {
    // discussionId IS resolvable, but a concurrent terminalizer already moved
    // the entry out of `processing`, so the guarded UPDATE matches 0 rows
    // (.returning() === []). The emit must be suppressed (no double-emit),
    // mirroring the single-terminalizer / atomic-claim convention. The tool
    // must still return success (idempotent no-op when already terminal).
    const { db } = makeMockDb("d-1", []);
    const res = await submitExtractedItemsTool.execute(
      { entryId: "e-1", items: [{ type: "task", content: "x" }] },
      makeCtx(db),
    );

    expect(res.success).toBe(true);
    expect((res.data as any).count).toBe(1);
    expect(publishLiveEventMock).not.toHaveBeenCalled();
  });

  it("publishes AFTER the terminal entry-status write (ordering parity with extraction.ts)", async () => {
    const { db, order } = makeMockDb("d-1");
    let publishOrderIndex = -1;
    publishLiveEventMock.mockImplementationOnce((input: unknown) => {
      // Record where in the op sequence the publish happened.
      order.push("publish");
      publishOrderIndex = order.length - 1;
      return input;
    });

    await submitExtractedItemsTool.execute(
      { entryId: "e-1", items: [{ type: "task", content: "x" }] },
      makeCtx(db),
    );

    const terminalIndex = order.indexOf("update:entry-completed");
    expect(terminalIndex).toBeGreaterThanOrEqual(0);
    expect(publishOrderIndex).toBeGreaterThanOrEqual(0);
    expect(terminalIndex).toBeLessThan(publishOrderIndex);
  });
});
