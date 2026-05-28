// server/src/__tests__/c2-thread-update-summary.test.ts
//
// Task C2 batch 1 — thread.updateSummary tool tests.
// Verifies summary persistence, summaryUpdatedAt timestamp advance, embedding
// enqueueing (best-effort), and graceful behavior when the embedding service
// is absent.

import { describe, expect, it, vi } from "vitest";
import { threadUpdateSummaryTool } from "../services/internal-agent/tools/thread-update-summary.js";
import type { ToolContext } from "../services/internal-agent/types.js";

function makeDb() {
  const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
  const update = vi.fn().mockReturnValue({ set: setMock });
  return { db: { update } as any, setMock };
}

function makeCtx(db: any, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    companyId: "co-1",
    userId: "u-1",
    userRole: "team_member",
    enabledCapabilities: ["system_actions"],
    db,
    services: {} as any,
    ...overrides,
  } as unknown as ToolContext;
}

describe("thread.updateSummary tool (C2 batch 1)", () => {
  it("metadata: name, category=action, requiredRole=team_member, no confirmation", () => {
    expect(threadUpdateSummaryTool.name).toBe("thread.updateSummary");
    expect(threadUpdateSummaryTool.category).toBe("action");
    expect(threadUpdateSummaryTool.requiredRole).toBe("team_member");
    expect(threadUpdateSummaryTool.requiresConfirmation).toBe(false);
  });

  it("saves summary and stamps summaryUpdatedAt with a current Date", async () => {
    const { db, setMock } = makeDb();
    const before = Date.now();
    const ctx = makeCtx(db);
    const result = await threadUpdateSummaryTool.execute(
      { threadId: "t-1", summary: "Recent progress: shipped login flow." },
      ctx,
    );
    const after = Date.now();
    expect(result.success).toBe(true);

    const setCall = setMock.mock.calls[0][0];
    expect(setCall.summaryText).toBe("Recent progress: shipped login flow.");
    expect(setCall.summaryUpdatedAt).toBeInstanceOf(Date);
    const ts = (setCall.summaryUpdatedAt as Date).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("enqueues summary embedding when embedding service is wired", async () => {
    const { db } = makeDb();
    const enqueue = vi.fn().mockResolvedValue({ id: "queue-1" });
    const ctx = makeCtx(db, {
      services: { embeddings: { enqueue } } as any,
    });

    const result = await threadUpdateSummaryTool.execute(
      { threadId: "t-1", summary: "summary text" },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith({
      targetTable: "discussions",
      targetId: "t-1",
      targetColumn: "summary_embedding",
      inputText: "summary text",
    });
    expect((result.data as any).embeddingQueued).toBe(true);
  });

  it("does NOT fail when embedding service is missing", async () => {
    const { db } = makeDb();
    const ctx = makeCtx(db);
    const result = await threadUpdateSummaryTool.execute(
      { threadId: "t-1", summary: "summary text" },
      ctx,
    );
    expect(result.success).toBe(true);
    expect((result.data as any).embeddingQueued).toBe(false);
  });

  it("does NOT fail when embedding enqueue throws (best-effort)", async () => {
    const { db } = makeDb();
    const enqueue = vi
      .fn()
      .mockRejectedValue(new Error("queue write failed"));
    const ctx = makeCtx(db, {
      services: { embeddings: { enqueue } } as any,
    });
    const result = await threadUpdateSummaryTool.execute(
      { threadId: "t-1", summary: "summary" },
      ctx,
    );
    expect(result.success).toBe(true);
    expect((result.data as any).embeddingQueued).toBe(false);
  });

  it("returns INVALID_PARAMS when threadId is missing", async () => {
    const { db } = makeDb();
    const ctx = makeCtx(db);
    const result = await threadUpdateSummaryTool.execute(
      { summary: "x" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
  });

  it("returns INVALID_PARAMS when summary is not a string", async () => {
    const { db } = makeDb();
    const ctx = makeCtx(db);
    const result = await threadUpdateSummaryTool.execute(
      { threadId: "t-1", summary: 42 as any },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
  });
});
