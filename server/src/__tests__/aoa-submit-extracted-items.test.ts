import { describe, expect, it, vi } from "vitest";

// Drizzle-orm ESM cycle workaround: stub the operator we use.
vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
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
  };
});

import { submitExtractedItemsTool } from "../services/internal-agent/tools/submit-extracted-items.js";

describe("submit-extracted-items internal-agent tool", () => {
  it("inserts mapped discussion_extracted_items + reports count + marks entry completed", async () => {
    const inserted: any[] = [];
    const updated: any[] = [];
    const db: any = {
      insert: () => ({
        values: (v: any) => {
          inserted.push(v);
          return Promise.resolve([]);
        },
      }),
      update: () => ({
        set: (v: any) => {
          updated.push(v);
          return { where: () => Promise.resolve([]) };
        },
      }),
    };
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
    expect(inserted.length).toBe(1); // one bulk insert (values array)
    expect(Array.isArray(inserted[0])).toBe(true);
    expect(inserted[0]).toHaveLength(1);
    // Mapped onto the REAL discussion_extracted_items columns.
    expect(inserted[0][0].discussionEntryId).toBe("e1");
    expect(inserted[0][0].type).toBe("task");
    expect(inserted[0][0].title).toBe("Ship X");
    expect(inserted[0][0].status).toBe("pending");
    expect(updated.length).toBe(1); // entry extractionStatus updated
    expect(updated[0].extractionStatus).toBe("completed");
  });

  it("skips insert when items is empty but still marks entry completed", async () => {
    const inserted: any[] = [];
    const updated: any[] = [];
    const db: any = {
      insert: () => ({
        values: (v: any) => {
          inserted.push(v);
          return Promise.resolve([]);
        },
      }),
      update: () => ({
        set: (v: any) => {
          updated.push(v);
          return { where: () => Promise.resolve([]) };
        },
      }),
    };
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
    expect(inserted.length).toBe(0);
    expect(updated.length).toBe(1);
    expect(updated[0].extractionStatus).toBe("completed");
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
