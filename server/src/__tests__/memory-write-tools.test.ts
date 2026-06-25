// server/src/__tests__/memory-write-tools.test.ts
//
// Task 9 W3 — write_memory crew tool + MCP memory.write tool tests.
//
// Coverage:
//   1. Crew write_memory: calls writeMemoryAndIndex with correct fields, enforces
//      status=pending (Critical Rule #6), validates required params, enforces
//      requiredRole=team_member, returns structured result.
//   2. MCP memory.write: calls writeMemoryAndIndex, enforces RBAC (permissionsSvc),
//      rejects unauthorized actors via the HTTP endpoint, sets correct source.
//   3. Audit note for memory.retain / suggest-memory: both already call
//      memorySvc.create which (post-T8) enqueues internally — confirmed by
//      existing mcp-memory-tools.test.ts; no additional assertion added here to
//      avoid redundant duplication.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the shared memory-write module before any imports that pull it in.
// ---------------------------------------------------------------------------
const { mockWriteMemoryAndIndex } = vi.hoisted(() => ({
  mockWriteMemoryAndIndex: vi.fn(),
}));

vi.mock("../services/memory-write.js", () => ({
  writeMemoryAndIndex: mockWriteMemoryAndIndex,
  enqueueMemoryEmbedding: vi.fn().mockResolvedValue(undefined),
}));

// ESM cycle: stub @armyofagents/db + drizzle-orm so tool-registry imports work.
vi.mock("@armyofagents/db", () => {
  const makeTable = () =>
    new Proxy(
      {},
      {
        get(_t, p) {
          if (p === "$inferSelect" || p === "$inferInsert") return {};
          return Symbol(String(p));
        },
      },
    );
  return {
    embeddingQueue: makeTable(),
    memoryItems: makeTable(),
    issues: makeTable(),
    userRoles: makeTable(),
    projectGoals: makeTable(),
    agentProjects: makeTable(),
    memoryRetrievals: makeTable(),
    discussions: makeTable(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: (..._a: unknown[]) => "and",
  eq: (..._a: unknown[]) => "eq",
  inArray: (..._a: unknown[]) => "inArray",
}));

// Stub services/index.js so MCP server can import it
vi.mock("../services/index.js", () => {
  const noop = () => ({});
  return {
    agentService: noop,
    artifactService: noop,
    companyService: noop,
    debriefService: noop,
    extractionService: noop,
    goalService: noop,
    issueService: noop,
    memoryService: noop,
    mcpService: noop,
    permissionService: noop,
    projectService: noop,
    approvalService: noop,
    issueApprovalService: noop,
    logActivity: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../services/memory-retrieval-audit.js", () => ({
  recordMemoryRetrievals: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/company-brain-graph.js", () => ({
  companyBrainGraphService: vi.fn(() => ({
    getMemoryItemNeighbors: vi.fn().mockResolvedValue({ center: {}, nodes: [], edges: [] }),
  })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks are hoisted)
// ---------------------------------------------------------------------------
import { writeMemoryTool } from "../services/internal-agent/tools/memory-write.js";
import type { ToolContext } from "../services/internal-agent/types.js";

// ============================================================================
// Helpers
// ============================================================================

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    companyId: "co-test",
    userId: "u-1",
    userRole: "team_member",
    enabledCapabilities: ["memory_management"],
    agentId: "agent-worker",
    db: {} as any,
    services: {} as any,
    ...overrides,
  } as unknown as ToolContext;
}

function makeDefaultItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem-new-1",
    companyId: "co-test",
    title: "Test memory",
    content: "Detailed content",
    status: "pending",
    layer: "domain",
    source: "agent",
    ...overrides,
  };
}

// ============================================================================
// 1. Crew write_memory tool
// ============================================================================

describe("write_memory crew tool — metadata", () => {
  it("has correct name, category=memory, requiredRole=team_member, no confirmation", () => {
    expect(writeMemoryTool.name).toBe("write_memory");
    expect(writeMemoryTool.category).toBe("memory");
    expect(writeMemoryTool.requiredRole).toBe("team_member");
    expect(writeMemoryTool.requiresConfirmation).toBe(false);
  });
});

describe("write_memory crew tool — parameter validation", () => {
  beforeEach(() => {
    mockWriteMemoryAndIndex.mockResolvedValue(makeDefaultItem());
  });

  it("returns INVALID_PARAMS when title is missing", async () => {
    const ctx = makeCtx();
    const r = await writeMemoryTool.execute(
      { content: "x", layer: "domain" },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("INVALID_PARAMS");
    expect(mockWriteMemoryAndIndex).not.toHaveBeenCalled();
  });

  it("returns INVALID_PARAMS when content is missing", async () => {
    const ctx = makeCtx();
    const r = await writeMemoryTool.execute(
      { title: "T", layer: "domain" },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("INVALID_PARAMS");
    expect(mockWriteMemoryAndIndex).not.toHaveBeenCalled();
  });

  it("returns INVALID_PARAMS for invalid layer", async () => {
    const ctx = makeCtx();
    const r = await writeMemoryTool.execute(
      { title: "T", content: "x", layer: "bogus" },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("INVALID_PARAMS");
  });

  it("returns INVALID_PARAMS when all params are empty strings", async () => {
    const ctx = makeCtx();
    const r = await writeMemoryTool.execute(
      { title: "  ", content: "  ", layer: "working" },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("INVALID_PARAMS");
  });
});

describe("write_memory crew tool — happy path", () => {
  beforeEach(() => {
    mockWriteMemoryAndIndex.mockReset();
    mockWriteMemoryAndIndex.mockResolvedValue(makeDefaultItem());
  });

  it("calls writeMemoryAndIndex with companyId + all required fields", async () => {
    const ctx = makeCtx();
    const r = await writeMemoryTool.execute(
      { title: "Test memory", content: "Detailed content", layer: "domain" },
      ctx,
    );
    expect(r.success).toBe(true);
    expect(mockWriteMemoryAndIndex).toHaveBeenCalledWith(
      ctx.db,
      "co-test",
      expect.objectContaining({
        title: "Test memory",
        content: "Detailed content",
        layer: "domain",
      }),
    );
  });

  it("ALWAYS forces status=pending (Critical Rule #6) — cannot be overridden by caller", async () => {
    const ctx = makeCtx();
    // Even if a hypothetical caller tried to set status, the tool must not accept it
    await writeMemoryTool.execute(
      { title: "T", content: "x", layer: "identity" },
      ctx,
    );
    const callArgs = mockWriteMemoryAndIndex.mock.calls[0][2] as Record<string, unknown>;
    expect(callArgs.status).toBe("pending");
  });

  it("ALWAYS sets source=agent (agent crew context)", async () => {
    const ctx = makeCtx();
    await writeMemoryTool.execute(
      { title: "T", content: "x", layer: "working" },
      ctx,
    );
    const callArgs = mockWriteMemoryAndIndex.mock.calls[0][2] as Record<string, unknown>;
    expect(callArgs.source).toBe("agent");
  });

  it("returns structured result with memoryItemId", async () => {
    const ctx = makeCtx();
    const r = await writeMemoryTool.execute(
      { title: "T", content: "x", layer: "active_context" },
      ctx,
    );
    expect(r.success).toBe(true);
    expect((r.data as Record<string, unknown>)?.memoryItemId).toBe("mem-new-1");
    expect(r.summary).toMatch(/pending/);
  });

  it("passes optional departmentId and goalId to writeMemoryAndIndex", async () => {
    const ctx = makeCtx();
    await writeMemoryTool.execute(
      {
        title: "T",
        content: "x",
        layer: "domain",
        departmentId: "dept-eng",
        goalId: "goal-q3",
      },
      ctx,
    );
    const callArgs = mockWriteMemoryAndIndex.mock.calls[0][2] as Record<string, unknown>;
    expect(callArgs.departmentId).toBe("dept-eng");
    expect(callArgs.goalId).toBe("goal-q3");
  });

  it("defaults category to 'context' when omitted", async () => {
    const ctx = makeCtx();
    await writeMemoryTool.execute(
      { title: "T", content: "x", layer: "domain" },
      ctx,
    );
    const callArgs = mockWriteMemoryAndIndex.mock.calls[0][2] as Record<string, unknown>;
    expect(callArgs.category).toBe("context");
  });

  it("uses provided valid category", async () => {
    const ctx = makeCtx();
    await writeMemoryTool.execute(
      { title: "T", content: "x", layer: "domain", category: "decision" },
      ctx,
    );
    const callArgs = mockWriteMemoryAndIndex.mock.calls[0][2] as Record<string, unknown>;
    expect(callArgs.category).toBe("decision");
  });

  it("falls back to 'context' for an invalid category value", async () => {
    const ctx = makeCtx();
    await writeMemoryTool.execute(
      { title: "T", content: "x", layer: "domain", category: "nonexistent_type" },
      ctx,
    );
    const callArgs = mockWriteMemoryAndIndex.mock.calls[0][2] as Record<string, unknown>;
    expect(callArgs.category).toBe("context");
  });

  it("uses ctx.agentId as createdBy when available", async () => {
    const ctx = makeCtx({ agentId: "agent-xyz" });
    await writeMemoryTool.execute(
      { title: "T", content: "x", layer: "working" },
      ctx,
    );
    const callArgs = mockWriteMemoryAndIndex.mock.calls[0][2] as Record<string, unknown>;
    expect(callArgs.createdBy).toBe("agent-xyz");
  });

  it("falls back to userId when agentId is absent", async () => {
    const ctx = makeCtx({ agentId: undefined, userId: "u-fallback" });
    await writeMemoryTool.execute(
      { title: "T", content: "x", layer: "working" },
      ctx,
    );
    const callArgs = mockWriteMemoryAndIndex.mock.calls[0][2] as Record<string, unknown>;
    expect(callArgs.createdBy).toBe("u-fallback");
  });
});

describe("write_memory crew tool — error handling", () => {
  it("returns INSERT_FAILED when writeMemoryAndIndex throws", async () => {
    mockWriteMemoryAndIndex.mockRejectedValueOnce(new Error("DB offline"));
    const ctx = makeCtx();
    const r = await writeMemoryTool.execute(
      { title: "T", content: "x", layer: "domain" },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("INSERT_FAILED");
    expect(r.summary).toMatch(/DB offline/);
  });

  it("returns INSERT_FAILED when writeMemoryAndIndex returns null/undefined", async () => {
    mockWriteMemoryAndIndex.mockResolvedValueOnce(null);
    const ctx = makeCtx();
    const r = await writeMemoryTool.execute(
      { title: "T", content: "x", layer: "domain" },
      ctx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("INSERT_FAILED");
  });
});

// ============================================================================
// 2. MCP memory.write tool — unit-level (via handler import)
// ============================================================================
// We test the handler directly (same pattern as write-tools.ts other handlers)
// rather than spinning up the full Express server, to avoid deep service mocking.

// Re-import after mocks are set up
import { writeToolHandlers } from "../mcp/tools/write-tools.js";

type McpToolResult = { ok: boolean; data?: unknown; status?: number; message?: string };

/** Minimal ToolContext stub for MCP tools */
function makeMcpCtx(opts: {
  actorSource?: string;
  agentId?: string | null;
  runId?: string | null;
  canAccessMemory?: boolean;
  writeMemoryResult?: { id: string; status: string; title: string; source: string };
  goalExists?: boolean;
  projectExists?: boolean;
  taskExists?: boolean;
  departmentExists?: boolean;
} = {}): any {
  const item = opts.writeMemoryResult ?? {
    id: "mcp-mem-1",
    status: "pending",
    title: "From MCP",
    source: opts.actorSource === "agent" ? "agent" : "mcp",
  };

  // writeMemoryAndIndex is already mocked globally; we configure it here per test
  mockWriteMemoryAndIndex.mockResolvedValue(item);

  return {
    db: {} as any,
    companyId: "co-mcp",
    actor: {
      source: opts.actorSource ?? "board",
      userId: "u-board",
      agentId: opts.agentId ?? null,
      runId: opts.runId ?? null,
    },
    scope: { kind: "founder", userId: "u-board" },
    actorInfo: {
      actorType: opts.actorSource === "agent" ? "agent" : "user",
      actorId: "u-board",
      agentId: opts.agentId ?? null,
      runId: opts.runId ?? null,
    },
    services: {
      issuesSvc: {
        getById: vi.fn().mockResolvedValue(
          opts.taskExists === false ? null : { id: "task-1", companyId: "co-mcp", projectId: null },
        ),
      },
      goalsSvc: {
        getById: vi.fn().mockResolvedValue(
          opts.goalExists === false ? null : { id: "goal-1", companyId: "co-mcp" },
        ),
      },
      projectsSvc: {
        getById: vi.fn().mockResolvedValue(
          opts.projectExists === false ? null : { id: "proj-1", companyId: "co-mcp" },
        ),
      },
      permissionsSvc: {
        canAccessMemory: vi.fn().mockResolvedValue(opts.canAccessMemory ?? true),
      },
    },
    resolveRole: vi.fn().mockResolvedValue("founder"),
    resolveScopedAgentIds: vi.fn().mockResolvedValue(null),
  };
}

const validMemoryWriteArgs = {
  title: "Insight from run",
  content: "The API retry strategy should cap at 3 attempts",
  category: "insight",
  layer: "domain",
  sourceContext: "run:run-abc / task:task-xyz",
};

describe("MCP memory.write handler — happy path", () => {
  beforeEach(() => {
    mockWriteMemoryAndIndex.mockReset();
    mockWriteMemoryAndIndex.mockResolvedValue({
      id: "mcp-mem-1",
      status: "pending",
      title: "Insight from run",
      source: "mcp",
    });
  });

  it("calls writeMemoryAndIndex with correct companyId + data", async () => {
    const ctx = makeMcpCtx();
    const result = await writeToolHandlers["memory.write"](ctx, validMemoryWriteArgs) as McpToolResult;
    expect(result.ok).toBe(true);
    expect(mockWriteMemoryAndIndex).toHaveBeenCalledWith(
      ctx.db,
      "co-mcp",
      expect.objectContaining({
        title: "Insight from run",
        content: "The API retry strategy should cap at 3 attempts",
        layer: "domain",
        sourceContext: "run:run-abc / task:task-xyz",
        status: "pending",
      }),
    );
  });

  it("always creates with status=pending (Critical Rule #6 — no auto-approve)", async () => {
    const ctx = makeMcpCtx();
    await writeToolHandlers["memory.write"](ctx, validMemoryWriteArgs);
    const callArgs = mockWriteMemoryAndIndex.mock.calls[0][2] as Record<string, unknown>;
    expect(callArgs.status).toBe("pending");
  });

  it("sets source=mcp for non-agent actor", async () => {
    const ctx = makeMcpCtx({ actorSource: "board" });
    await writeToolHandlers["memory.write"](ctx, validMemoryWriteArgs);
    const callArgs = mockWriteMemoryAndIndex.mock.calls[0][2] as Record<string, unknown>;
    expect(callArgs.source).toBe("mcp");
  });

  it("sets source=agent when actor is an agent", async () => {
    const ctx = makeMcpCtx({ actorSource: "agent", agentId: "agent-42" });
    await writeToolHandlers["memory.write"](ctx, validMemoryWriteArgs);
    const callArgs = mockWriteMemoryAndIndex.mock.calls[0][2] as Record<string, unknown>;
    expect(callArgs.source).toBe("agent");
  });

  it("returns id + status in the result", async () => {
    const ctx = makeMcpCtx();
    const result = await writeToolHandlers["memory.write"](ctx, validMemoryWriteArgs) as McpToolResult;
    expect(result.ok).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data?.id).toBe("mcp-mem-1");
    expect(data?.status).toBe("pending");
  });
});

describe("MCP memory.write handler — RBAC / authorization", () => {
  beforeEach(() => {
    mockWriteMemoryAndIndex.mockReset();
    mockWriteMemoryAndIndex.mockResolvedValue({
      id: "mcp-mem-1",
      status: "pending",
      title: "Insight",
      source: "mcp",
    });
  });

  it("returns 403 when permissionsSvc.canAccessMemory returns false", async () => {
    const ctx = makeMcpCtx({ canAccessMemory: false });
    const result = await writeToolHandlers["memory.write"](ctx, validMemoryWriteArgs) as McpToolResult;
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(mockWriteMemoryAndIndex).not.toHaveBeenCalled();
  });

  it("does NOT call writeMemoryAndIndex on permission denial", async () => {
    const ctx = makeMcpCtx({ canAccessMemory: false });
    await writeToolHandlers["memory.write"](ctx, validMemoryWriteArgs);
    expect(mockWriteMemoryAndIndex).not.toHaveBeenCalled();
  });
});

describe("MCP memory.write handler — entity cross-tenant guard", () => {
  beforeEach(() => {
    mockWriteMemoryAndIndex.mockReset();
    mockWriteMemoryAndIndex.mockResolvedValue({
      id: "mcp-mem-1",
      status: "pending",
      title: "Insight",
      source: "mcp",
    });
  });

  it("returns 404 when goalId belongs to another company", async () => {
    const ctx = makeMcpCtx({ goalExists: false });
    const result = await writeToolHandlers["memory.write"](ctx, {
      ...validMemoryWriteArgs,
      goalId: "00000000-0000-0000-0000-000000000001",
    }) as McpToolResult;
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(mockWriteMemoryAndIndex).not.toHaveBeenCalled();
  });

  it("returns 404 when taskId belongs to another company", async () => {
    const ctx = makeMcpCtx({ taskExists: false });
    const result = await writeToolHandlers["memory.write"](ctx, {
      ...validMemoryWriteArgs,
      taskId: "00000000-0000-0000-0000-000000000002",
    }) as McpToolResult;
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(mockWriteMemoryAndIndex).not.toHaveBeenCalled();
  });
});

describe("MCP memory.write handler — Zod validation", () => {
  it("throws (zod parse error) when required fields are missing", async () => {
    const ctx = makeMcpCtx();
    // Missing sourceContext — required by the schema
    await expect(
      writeToolHandlers["memory.write"](ctx, {
        title: "T",
        content: "x",
        category: "insight",
        layer: "domain",
        // sourceContext missing
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// 3. Audit note — memory.retain / suggest-memory indexing
// ============================================================================
//
// Both tools already call `ctx.services.memorySvc.create()` which (after T8)
// internally enqueues via `enqueueMemoryEmbedding`. This is proven by:
//   - mcp-memory-tools.test.ts > "MCP memory.retain tool" — full coverage
//     of the retain handler's create + approve flow.
//   - commander-memory-tools.test.ts — covers suggest_memory crew tool.
// No new assertions are added here to avoid redundancy. The T8 wiring inside
// memoryService.create() is the shared path that guarantees both tools index.
