// server/src/__tests__/c2-agent-dispatch.test.ts
//
// Task C2 batch 4 — agent.dispatch tool tests.
// Verifies:
//   - metadata (coordination category, team_member role, no confirmation),
//   - hop-count: 0→1, 1→2 (queued), 3 → HOP_LIMIT_EXCEEDED,
//   - AGENT_NOT_FOUND / CROSS_COMPANY_FORBIDDEN errors,
//   - dedup: when (agentId, threadId, status='queued') already exists,
//     onConflictDoNothing returns empty and wakeupId is null,
//   - dedupKey null when no threadId in context,
//   - reason defaults to 'agent_dispatch' when omitted.

import { describe, expect, it, vi } from "vitest";
import { discussions, issues } from "@armyofagents/db";
import { agentDispatchTool } from "../services/internal-agent/tools/agent-dispatch.js";
import type { ToolContext } from "../services/internal-agent/types.js";

// Mock chain for: db.select().from(table).where().limit() → Promise<rows>
// and:           db.insert().values().onConflictDoNothing().returning() → Promise<rows>
//
// The tool issues up to three distinct select chains — the Layer-1 cross-tenant
// guards (discussions for threadId, issues for issueId) and the target-agent
// lookup. We branch on the `from(table)` argument so the harness is order-
// independent: each chain resolves the rows keyed to its own table. A `[]`
// result models "id does not resolve within the caller's company" (the WHERE
// carries the companyId conjunct, which is what excludes a foreign-tenant row).
function makeDb(opts: {
  agentRows?: any[];
  threadRows?: any[];
  issueRows?: any[];
  insertedRows?: any[];
} = {}) {
  const agentRows = opts.agentRows ?? [{ id: "agent-target", companyId: "co-1" }];
  const threadRows = opts.threadRows ?? [{ id: "thread-7" }];
  const issueRows = opts.issueRows ?? [{ id: "issue-9" }];

  const select = vi.fn().mockImplementation(() => {
    const state: { table?: unknown } = {};
    const limit = vi.fn().mockImplementation(() => {
      if (state.table === discussions) return Promise.resolve(threadRows);
      if (state.table === issues) return Promise.resolve(issueRows);
      return Promise.resolve(agentRows);
    });
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockImplementation((t: unknown) => {
      state.table = t;
      return { where };
    });
    return { from };
  });

  // INSERT chain — returns the inserted row id (or empty on dedup conflict).
  const returning = vi.fn().mockResolvedValue(opts.insertedRows ?? [{ id: "wakeup-1" }]);
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    db: { select, insert } as any,
    selectFn: select,
    insertFn: insert,
    valuesMock: values,
    onConflictDoNothingMock: onConflictDoNothing,
  };
}

function makeCtx(db: any, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    companyId: "co-1",
    userId: "u-1",
    userRole: "team_member",
    enabledCapabilities: ["system_actions"],
    agentId: "agent-caller",
    db,
    services: {} as any,
    ...overrides,
  } as unknown as ToolContext;
}

describe("agent.dispatch tool (C2 batch 4)", () => {
  it("metadata: name, category=coordination, requiredRole=team_member, no confirmation", () => {
    expect(agentDispatchTool.name).toBe("agent.dispatch");
    expect(agentDispatchTool.category).toBe("coordination");
    expect(agentDispatchTool.requiredRole).toBe("team_member");
    expect(agentDispatchTool.requiresConfirmation).toBe(false);
  });

  it("dispatches with hopCount=0 → wakeup row inserted with hopCount=1 in payload", async () => {
    const { db, valuesMock } = makeDb();
    const ctx = makeCtx(db);
    const result = await agentDispatchTool.execute(
      {
        agentId: "agent-target",
        context: { threadId: "thread-7", hopCount: 0 },
        reason: "test_dispatch",
      },
      ctx,
    );
    expect(result.success).toBe(true);
    expect((result.data as any).wakeupId).toBe("wakeup-1");
    expect((result.data as any).hopCount).toBe(1);
    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.payload.hopCount).toBe(1);
    expect(insertedValues.payload.threadId).toBe("thread-7");
    expect(insertedValues.source).toBe("agent.dispatch");
    expect(insertedValues.reason).toBe("test_dispatch");
    expect(insertedValues.companyId).toBe("co-1");
    expect(insertedValues.agentId).toBe("agent-target");
    expect(insertedValues.status).toBe("queued");
    expect(insertedValues.dedupKey).toBe("agent-target:thread-7:queued");
  });

  it("dispatches with hopCount=1 → wakeup row inserted with hopCount=2 in payload", async () => {
    const { db, valuesMock } = makeDb();
    const ctx = makeCtx(db);
    const result = await agentDispatchTool.execute(
      {
        agentId: "agent-target",
        context: { threadId: "thread-7", hopCount: 1 },
      },
      ctx,
    );
    expect(result.success).toBe(true);
    expect((result.data as any).hopCount).toBe(2);
    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.payload.hopCount).toBe(2);
  });

  it("blocks dispatch when incoming hopCount=3 → returns HOP_LIMIT_EXCEEDED", async () => {
    const { db, insertFn, selectFn } = makeDb();
    const ctx = makeCtx(db);
    const result = await agentDispatchTool.execute(
      {
        agentId: "agent-target",
        context: { threadId: "thread-7", hopCount: 3 },
      },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("HOP_LIMIT_EXCEEDED");
    expect(result.summary).toContain("3");
    // No DB calls should happen — block fires before lookup or insert.
    expect(selectFn).not.toHaveBeenCalled();
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("returns AGENT_NOT_FOUND when target agent doesn't exist", async () => {
    const { db, insertFn } = makeDb({ agentRows: [] });
    const ctx = makeCtx(db);
    const result = await agentDispatchTool.execute(
      { agentId: "agent-missing" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("AGENT_NOT_FOUND");
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("returns CROSS_COMPANY_FORBIDDEN when target belongs to a different company", async () => {
    const { db, insertFn } = makeDb({
      agentRows: [{ id: "agent-other", companyId: "co-other" }],
    });
    const ctx = makeCtx(db);
    const result = await agentDispatchTool.execute(
      { agentId: "agent-other" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("CROSS_COMPANY_FORBIDDEN");
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("dedupes: second dispatch for same (agentId, threadId, queued) gets no new row", async () => {
    // Simulate the partial unique index firing — onConflictDoNothing returns
    // an empty array, so wakeupId resolves to null.
    const { db, valuesMock } = makeDb({ insertedRows: [] });
    const ctx = makeCtx(db);
    const result = await agentDispatchTool.execute(
      {
        agentId: "agent-target",
        context: { threadId: "thread-7" },
      },
      ctx,
    );
    expect(result.success).toBe(true);
    expect((result.data as any).wakeupId).toBeNull();
    expect(result.summary).toContain("Already queued");
    // We still attempted the insert with the dedupKey set — the DB rejected
    // it; the tool didn't.
    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.dedupKey).toBe("agent-target:thread-7:queued");
  });

  it("leaves dedupKey null when no threadId in context", async () => {
    const { db, valuesMock } = makeDb();
    const ctx = makeCtx(db);
    const result = await agentDispatchTool.execute(
      { agentId: "agent-target", context: {} },
      ctx,
    );
    expect(result.success).toBe(true);
    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.dedupKey).toBeNull();
  });

  it("leaves dedupKey null when context is omitted entirely", async () => {
    const { db, valuesMock } = makeDb();
    const ctx = makeCtx(db);
    const result = await agentDispatchTool.execute(
      { agentId: "agent-target" },
      ctx,
    );
    expect(result.success).toBe(true);
    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.dedupKey).toBeNull();
    // hopCount defaults to 0 → stored as 1
    expect(insertedValues.payload.hopCount).toBe(1);
  });

  it("defaults reason to 'agent_dispatch' when omitted", async () => {
    const { db, valuesMock } = makeDb();
    const ctx = makeCtx(db);
    const result = await agentDispatchTool.execute(
      { agentId: "agent-target" },
      ctx,
    );
    expect(result.success).toBe(true);
    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.reason).toBe("agent_dispatch");
  });

  // ── Cross-tenant confidentiality guard (Layer 1 — validate at the source) ──
  // A team_member in company A must not be able to smuggle a foreign entity id
  // into the wakeup payload. The threadId/issueId ownership check runs BEFORE
  // any enqueue, so a foreign id is refused and never reaches the dispatcher.

  it("SECURITY: refuses a foreign-company threadId (exists in company B, not caller's) — no insert", async () => {
    // The thread EXISTS in company B, but the company-scoped lookup (WHERE
    // companyId = caller) returns no row → treated as not-in-company → refused.
    const { db, insertFn } = makeDb({ threadRows: [] });
    const ctx = makeCtx(db); // caller is co-1
    const result = await agentDispatchTool.execute(
      { agentId: "agent-target", context: { threadId: "thread-in-company-B" } },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("CROSS_COMPANY_FORBIDDEN");
    expect(result.summary).toContain("threadId");
    // The foreign id never made it into a wakeup row.
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("SECURITY: a same-company threadId dispatches fine (legitimate case preserved)", async () => {
    const { db, valuesMock, insertFn } = makeDb({
      threadRows: [{ id: "thread-7" }], // resolves within the caller's company
    });
    const ctx = makeCtx(db);
    const result = await agentDispatchTool.execute(
      { agentId: "agent-target", context: { threadId: "thread-7", hopCount: 0 } },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(insertFn).toHaveBeenCalledTimes(1);
    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues.payload.threadId).toBe("thread-7");
    expect(insertedValues.dedupKey).toBe("agent-target:thread-7:queued");
  });

  it("SECURITY: refuses a foreign-company issueId (task-branch exposure) — no insert", async () => {
    const { db, insertFn } = makeDb({ issueRows: [] });
    const ctx = makeCtx(db);
    const result = await agentDispatchTool.execute(
      { agentId: "agent-target", context: { issueId: "issue-in-company-B" } },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("CROSS_COMPANY_FORBIDDEN");
    expect(result.summary).toContain("issueId");
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("SECURITY: a same-company issueId dispatches fine", async () => {
    const { db, insertFn } = makeDb({ issueRows: [{ id: "issue-9" }] });
    const ctx = makeCtx(db);
    const result = await agentDispatchTool.execute(
      { agentId: "agent-target", context: { issueId: "issue-9" } },
      ctx,
    );
    expect(result.success).toBe(true);
    expect(insertFn).toHaveBeenCalledTimes(1);
  });

  it("rejects missing agentId with INVALID_PARAMS", async () => {
    const { db, selectFn, insertFn } = makeDb();
    const ctx = makeCtx(db);
    const result = await agentDispatchTool.execute({}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INVALID_PARAMS");
    expect(selectFn).not.toHaveBeenCalled();
    expect(insertFn).not.toHaveBeenCalled();
  });
});
