import { describe, expect, it, vi } from "vitest";

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

// Builds a mock Db that records insert/update calls (with the table the
// update/insert targeted + the `.where(...)` predicate) and serves a
// `select(...).from(...).where(...)` chain resolving entryId -> discussionId.
function makeMockDb(discussionId: string | null = "disc-1") {
  const inserted: { table: any; values: any }[] = [];
  const updated: { table: any; set: any; where: any }[] = [];
  const selects: { from: any; where: any }[] = [];
  const db: any = {
    insert: (table: any) => ({
      values: (v: any) => {
        inserted.push({ table, values: v });
        return Promise.resolve([]);
      },
    }),
    update: (table: any) => ({
      set: (v: any) => ({
        where: (w: any) => {
          updated.push({ table, set: v, where: w });
          return Promise.resolve([]);
        },
      }),
    }),
    select: (_cols?: any) => ({
      from: (fromTable: any) => ({
        where: (w: any) => {
          selects.push({ from: fromTable, where: w });
          return Promise.resolve(
            discussionId === null ? [] : [{ discussionId }],
          );
        },
      }),
    }),
  };
  return { db, inserted, updated, selects };
}

describe("submit-extracted-items internal-agent tool", () => {
  it("inserts mapped discussion_extracted_items + reports count + marks entry completed", async () => {
    const { db, inserted, updated } = makeMockDb();
    // Real ToolContext shape (see internal-agent/types.ts).
    const ctx: any = {
      companyId: "co-1",
      userId: "u-1",
      userRole: "founder",
      enabledCapabilities: ["discussion_processing"],
      db,
      services: {},
    };

    // Real AgentTool shape: `execute(params, ctx)` -> ToolResult.
    const res = await submitExtractedItemsTool.execute(
      {
        entryId: "e1",
        items: [{ type: "task", content: "Ship X", confidence: 0.9 }],
      },
      ctx,
    );

    expect(res.success).toBe(true);
    expect((res.data as any).count).toBe(1);
    const itemInserts = inserted.filter(
      (i) => i.values?.[0]?.discussionEntryId !== undefined,
    );
    expect(itemInserts.length).toBe(1); // one bulk insert (values array)
    expect(Array.isArray(itemInserts[0].values)).toBe(true);
    expect(itemInserts[0].values).toHaveLength(1);
    // Mapped onto the REAL discussion_extracted_items columns.
    expect(itemInserts[0].values[0].discussionEntryId).toBe("e1");
    expect(itemInserts[0].values[0].type).toBe("task");
    expect(itemInserts[0].values[0].title).toBe("Ship X");
    expect(itemInserts[0].values[0].status).toBe("pending");
    // entry extractionStatus updated to completed.
    const statusUpdates = updated.filter(
      (u) => u.set?.extractionStatus === "completed",
    );
    expect(statusUpdates.length).toBe(1);
  });

  it("skips insert when items is empty but still marks entry completed", async () => {
    const { db, inserted, updated } = makeMockDb();
    const ctx: any = {
      companyId: "co-1",
      userId: "u-1",
      userRole: "founder",
      enabledCapabilities: ["discussion_processing"],
      db,
      services: {},
    };

    const res = await submitExtractedItemsTool.execute(
      { entryId: "e2", items: [] },
      ctx,
    );

    expect(res.success).toBe(true);
    expect((res.data as any).count).toBe(0);
    const itemInserts = inserted.filter(
      (i) => i.values?.[0]?.discussionEntryId !== undefined,
    );
    expect(itemInserts.length).toBe(0);
    const statusUpdates = updated.filter(
      (u) => u.set?.extractionStatus === "completed",
    );
    expect(statusUpdates.length).toBe(1);
  });

  // ── I-1: pendingItemCount increment parity with extraction.ts ─────────────
  it("resolves the entry's discussionId and increments discussions.pendingItemCount by N", async () => {
    const { db, updated, selects } = makeMockDb("disc-42");
    const ctx: any = {
      companyId: "co-1",
      userId: "u-1",
      userRole: "founder",
      enabledCapabilities: ["discussion_processing"],
      db,
      services: {},
    };

    const res = await submitExtractedItemsTool.execute(
      {
        entryId: "e1",
        items: [
          { type: "task", content: "Ship X" },
          { type: "decision", content: "Use Y" },
        ],
      },
      ctx,
    );

    expect(res.success).toBe(true);
    // It must resolve the entry -> discussionId first (a select on
    // discussionEntries keyed by the entry id).
    expect(selects.length).toBeGreaterThanOrEqual(1);
    // A discussions-table update incrementing pendingItemCount via a `sql`
    // expression was recorded (mirrors extraction.ts:614-620).
    const pendingUpdates = updated.filter(
      (u) => u.set?.pendingItemCount !== undefined,
    );
    expect(pendingUpdates.length).toBe(1);
    const incr = pendingUpdates[0].set.pendingItemCount;
    // sql`${discussions.pendingItemCount} + ${rows.length}` — N === 2.
    expect(incr?.sql?.values).toContain(2);
  });

  it("does NOT issue a pendingItemCount increment when items is empty", async () => {
    const { db, updated, selects } = makeMockDb("disc-7");
    const ctx: any = {
      companyId: "co-1",
      userId: "u-1",
      userRole: "founder",
      enabledCapabilities: ["discussion_processing"],
      db,
      services: {},
    };

    const res = await submitExtractedItemsTool.execute(
      { entryId: "e9", items: [] },
      ctx,
    );

    expect(res.success).toBe(true);
    const pendingUpdates = updated.filter(
      (u) => u.set?.pendingItemCount !== undefined,
    );
    expect(pendingUpdates.length).toBe(0);
    // F2: discussionId is now resolved UNCONDITIONALLY so the
    // discussion.extraction.completed LiveEvent fires even for empty
    // extractions (parity with extraction.ts). The no-increment contract is
    // still enforced by the pendingUpdates assertion above.
    expect(selects.length).toBe(1);
  });

  // ── I-2: terminal extractionStatus update is guarded on "processing" ──────
  it("guards the terminal extractionStatus update with extractionStatus='processing'", async () => {
    const { db, updated } = makeMockDb();
    const ctx: any = {
      companyId: "co-1",
      userId: "u-1",
      userRole: "founder",
      enabledCapabilities: ["discussion_processing"],
      db,
      services: {},
    };

    await submitExtractedItemsTool.execute(
      {
        entryId: "e1",
        items: [{ type: "task", content: "Ship X" }],
      },
      ctx,
    );

    const statusUpdates = updated.filter(
      (u) => u.set?.extractionStatus === "completed",
    );
    expect(statusUpdates.length).toBe(1);
    // The `.where(...)` must be an `and(...)` of (id = entryId) AND
    // (extractionStatus = 'processing') — not an unguarded blind write.
    const where = statusUpdates[0].where;
    expect(where?.and).toBeDefined();
    const flat = JSON.stringify(where);
    expect(flat).toContain("processing");
    expect(flat).toContain("e1");
  });

  it("conforms to the AgentTool shape (discussion category, founder role)", () => {
    expect(submitExtractedItemsTool.name).toBe("submit_extracted_items");
    expect(submitExtractedItemsTool.parameters.type).toBe("object");
    expect(submitExtractedItemsTool.parameters.required).toContain("entryId");
    expect(submitExtractedItemsTool.parameters.required).toContain("items");
    expect(submitExtractedItemsTool.category).toBe("discussion");
    expect(typeof submitExtractedItemsTool.execute).toBe("function");
  });
});
