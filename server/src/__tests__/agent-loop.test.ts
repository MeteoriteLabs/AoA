import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  desc: vi.fn((a: unknown) => ({ desc: a })),
  sql: Object.assign(
    vi.fn((strings: unknown, ...values: unknown[]) => ({ sql: strings, values })),
    { raw: vi.fn((s: unknown) => s) },
  ),
  count: vi.fn(() => Symbol("count")),
}));

vi.mock("@paperclipai/db", () => {
  const makeTable = (name: string) => {
    const cols: Record<string, symbol> = {};
    return new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        if (prop === "_") return { name };
        if (prop === "$inferSelect" || prop === "$inferInsert") return {};
        if (typeof prop === "string") {
          if (!cols[prop]) cols[prop] = Symbol(prop);
          return cols[prop];
        }
        return undefined;
      },
    });
  };
  return {
    companies: makeTable("companies"),
    memoryItems: makeTable("memory_items"),
    projects: makeTable("projects"),
    internalAgentConfig: makeTable("internal_agent_config"),
    internalAgentConversations: makeTable("internal_agent_conversations"),
    internalAgentMessages: makeTable("internal_agent_messages"),
    internalAgentRuns: makeTable("internal_agent_runs"),
  };
});

vi.mock("../middleware/logger.js", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// Mock the providers module
const mockGetProviderApiKey = vi.fn();
const mockCreateProvider = vi.fn();
vi.mock("../services/internal-agent/providers/index.js", () => ({
  getProviderApiKey: (...args: unknown[]) => mockGetProviderApiKey(...args),
  createProvider: (...args: unknown[]) => mockCreateProvider(...args),
}));

// Mock tool registry
const mockTools = [
  {
    name: "query_tasks",
    description: "Query tasks",
    parameters: { type: "object" as const, properties: {} },
    category: "query" as const,
    requiredRole: "team_member" as const,
    requiresConfirmation: false,
    execute: vi.fn().mockResolvedValue({ success: true, data: [{ id: "t-1", title: "Test task" }], summary: "Found 1 task" }),
  },
  {
    name: "create_task",
    description: "Create a task",
    parameters: { type: "object" as const, properties: { title: { type: "string" } }, required: ["title"] },
    category: "action" as const,
    requiredRole: "founder" as const,
    requiresConfirmation: true,
    execute: vi.fn().mockResolvedValue({ success: true, data: { id: "t-new" }, summary: "Created task" }),
  },
];

vi.mock("../services/internal-agent/tool-registry.js", () => ({
  createToolRegistry: () => mockTools,
  getToolsForMessage: () => mockTools,
  toolToAnthropicFormat: (t: any) => ({ name: t.name, description: t.description, input_schema: t.parameters }),
  executeTool: (tool: any, params: any, ctx: any) => tool.execute(params, ctx),
}));

// Mock context assembly
vi.mock("../services/internal-agent/context-assembly.js", () => ({
  contextAssemblyService: () => ({
    assembleContext: vi.fn().mockResolvedValue({
      systemPrompt: "You are an AI assistant.",
      estimatedTokens: 100,
    }),
  }),
}));

// Mock service container
vi.mock("../services/internal-agent/service-container.js", () => ({
  createServiceContainer: () => ({}),
}));

// Mock conversation service
const mockConversation = {
  id: "conv-1",
  companyId: "co-1",
  userId: "user-1",
  status: "active",
  messageCount: 0,
  summarizedContext: null,
};

const mockConversationService = {
  getOrCreateActive: vi.fn().mockResolvedValue(mockConversation),
  appendMessage: vi.fn().mockImplementation((_convId: string, msg: any) =>
    Promise.resolve({ id: `msg-${Date.now()}`, ...msg }),
  ),
  getRecentMessages: vi.fn().mockResolvedValue([]),
  summarizeIfNeeded: vi.fn().mockResolvedValue(undefined),
  reset: vi.fn(),
};

vi.mock("../services/internal-agent/conversation.js", () => ({
  conversationService: () => mockConversationService,
}));

import { agentLoopService, buildMessagesForProvider, type AgentStreamChunk } from "../services/internal-agent/agent-loop.js";

// ── Helpers ────────────────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

function createSequenceDb(config: {
  selects?: MockRow[][];
  updates?: MockRow[][];
  inserts?: MockRow[][];
} = {}) {
  let selectIdx = 0;
  let updateIdx = 0;
  let insertIdx = 0;
  const selects = config.selects ?? [];
  const updates = config.updates ?? [];
  const inserts = config.inserts ?? [];

  function makeChain(getResult: () => MockRow[]) {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "set", "values", "returning", "innerJoin", "leftJoin", "orderBy", "limit"]) {
      chain[m] = (..._args: unknown[]) => chain;
    }
    chain.then = (resolve: (v: MockRow[]) => unknown) =>
      Promise.resolve(resolve(getResult()));
    return chain;
  }

  return {
    select: () => makeChain(() => selects[selectIdx++] ?? []),
    update: (table: unknown) => makeChain(() => updates[updateIdx++] ?? []),
    insert: (table: unknown) => makeChain(() => inserts[insertIdx++] ?? []),
  };
}

/** Collect all chunks from the agent loop generator */
async function collectChunks(gen: AsyncGenerator<AgentStreamChunk>): Promise<AgentStreamChunk[]> {
  const chunks: AgentStreamChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

/** Create a mock LLM provider that yields given chunks */
function createMockProvider(responses: Array<AsyncIterable<any>>) {
  let callIdx = 0;
  return {
    name: "anthropic",
    chat: vi.fn().mockImplementation(() => responses[callIdx++] ?? responses[responses.length - 1]),
  };
}

function toolThenTextResponse(toolName: string, toolInput: unknown, finalText: string) {
  return [
    // First call: tool_call
    (async function* () {
      yield { type: "tool_call" as const, id: "tc-1", name: toolName, input: toolInput };
      yield { type: "done" as const, usage: { inputTokens: 100, outputTokens: 50 } };
    })(),
    // Second call: text
    (async function* () {
      yield { type: "text" as const, delta: finalText };
      yield { type: "done" as const, usage: { inputTokens: 150, outputTokens: 60 } };
    })(),
  ];
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("buildMessagesForProvider", () => {
  it("maps DB message roles to ChatMessage format", () => {
    const dbMessages = [
      { role: "user", content: "Hello", toolCalls: null, toolResults: null },
      { role: "assistant", content: "Hi there!", toolCalls: null, toolResults: null },
      { role: "tool_call", content: null, toolCalls: [{ id: "tc-1", name: "query_tasks", input: {} }], toolResults: null },
      { role: "tool_result", content: "Found tasks", toolCalls: null, toolResults: [{ toolCallId: "tc-1", name: "query_tasks", result: '{"success":true}' }] },
      { role: "system", content: "System message", toolCalls: null, toolResults: null },
    ];

    const result = buildMessagesForProvider(dbMessages, null);

    expect(result).toHaveLength(4); // system skipped
    expect(result[0]).toEqual({ role: "user", content: "Hello" });
    expect(result[1]).toEqual({ role: "assistant", content: "Hi there!" });
    expect(result[2]).toEqual({ role: "assistant", content: "", toolCalls: [{ id: "tc-1", name: "query_tasks", input: {} }] });
    expect(result[3]).toEqual({ role: "user", content: "", toolResults: [{ toolCallId: "tc-1", name: "query_tasks", result: '{"success":true}' }] });
  });

  it("prepends summarized context as assistant message", () => {
    const dbMessages = [
      { role: "user", content: "What next?", toolCalls: null, toolResults: null },
    ];

    const result = buildMessagesForProvider(dbMessages, "Previously discussed tasks and goals.");

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("assistant");
    expect(result[0].content).toContain("Previously discussed tasks and goals.");
    expect(result[1].role).toBe("user");
  });
});

describe("agentLoopService", () => {
  const agentConfig = {
    id: "cfg-1",
    companyId: "co-1",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    autonomyLevel: 0,
    contextTokenBudget: 8000,
    budgetMonthlyCents: 10000, // $100
    spentMonthlyCents: 0,
    enabledCapabilities: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderApiKey.mockResolvedValue("sk-test-key");
    mockConversationService.getOrCreateActive.mockResolvedValue(mockConversation);
    mockConversationService.getRecentMessages.mockResolvedValue([]);
    mockConversationService.appendMessage.mockImplementation((_convId: string, msg: any) =>
      Promise.resolve({ id: `msg-${Date.now()}`, ...msg }),
    );
  });

  it("executes tool call and yields text response", async () => {
    const responses = toolThenTextResponse("query_tasks", {}, "Found 1 task.");
    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createSequenceDb({
      selects: [[agentConfig]], // config lookup
      inserts: [[{ id: "run-1" }]], // run creation
      updates: [
        [{}], // run update (finalize)
        [{}], // config spent update
      ],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({
        companyId: "co-1",
        userId: "user-1",
        userRole: "founder",
        content: "Show me my tasks",
      }),
    );

    const types = chunks.map((c) => c.type);
    expect(types).toContain("tool_call");
    expect(types).toContain("tool_result");
    expect(types).toContain("text");
    expect(types).toContain("done");
  });

  it("stops at max 10 tool rounds", async () => {
    // Provider always returns tool_call, never text
    const infiniteToolCalls = Array.from({ length: 12 }, () =>
      (async function* () {
        yield { type: "tool_call" as const, id: `tc-${Math.random()}`, name: "query_tasks", input: {} };
        yield { type: "done" as const, usage: { inputTokens: 50, outputTokens: 30 } };
      })(),
    );
    // Final call (after limit message) should return text
    infiniteToolCalls.push(
      (async function* () {
        yield { type: "text" as const, delta: "Here's what I found." };
        yield { type: "done" as const, usage: { inputTokens: 50, outputTokens: 30 } };
      })(),
    );

    const mockProvider = createMockProvider(infiniteToolCalls);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createSequenceDb({
      selects: [[agentConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({
        companyId: "co-1",
        userId: "user-1",
        userRole: "founder",
        content: "Do a complex analysis",
      }),
    );

    // Should have at most 10 tool_call chunks
    const toolCalls = chunks.filter((c) => c.type === "tool_call");
    expect(toolCalls.length).toBeLessThanOrEqual(10);

    // Should end with done
    expect(chunks[chunks.length - 1].type).toBe("done");
  });

  it("halts with error when budget exceeded", async () => {
    const overBudgetConfig = { ...agentConfig, spentMonthlyCents: 10000 }; // at budget limit

    const db = createSequenceDb({
      selects: [[overBudgetConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}]], // run marked failed
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({
        companyId: "co-1",
        userId: "user-1",
        userRole: "founder",
        content: "Hello",
      }),
    );

    const errorChunk = chunks.find((c) => c.type === "error");
    expect(errorChunk).toBeDefined();
    expect((errorChunk as any).message).toContain("budget");
  });

  it("yields action_confirmation for write tools at autonomy level 0", async () => {
    const responses = [
      (async function* () {
        yield { type: "tool_call" as const, id: "tc-1", name: "create_task", input: { title: "New task" } };
        yield { type: "done" as const, usage: { inputTokens: 100, outputTokens: 50 } };
      })(),
    ];

    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createSequenceDb({
      selects: [[agentConfig]], // autonomyLevel: 0
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks: AgentStreamChunk[] = [];

    // Only collect until we get confirmation (generator will be paused)
    const gen = svc.chat({
      companyId: "co-1",
      userId: "user-1",
      userRole: "founder",
      content: "Create a task called New task",
    });

    for await (const chunk of gen) {
      chunks.push(chunk);
      if (chunk.type === "action_confirmation") break;
    }

    const confirmChunk = chunks.find((c) => c.type === "action_confirmation");
    expect(confirmChunk).toBeDefined();
    expect((confirmChunk as any).toolName).toBe("create_task");
  });

  it("tracks cost and writes to run record", async () => {
    const responses = [
      (async function* () {
        yield { type: "text" as const, delta: "Hello!" };
        yield { type: "done" as const, usage: { inputTokens: 500, outputTokens: 100 } };
      })(),
    ];

    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createSequenceDb({
      selects: [[agentConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]], // run update, config spent update
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({
        companyId: "co-1",
        userId: "user-1",
        userRole: "founder",
        content: "Hello",
      }),
    );

    const doneChunk = chunks.find((c) => c.type === "done") as any;
    expect(doneChunk).toBeDefined();
    expect(doneChunk.summary.tokenUsage.inputTokens).toBe(500);
    expect(doneChunk.summary.tokenUsage.outputTokens).toBe(100);
    expect(doneChunk.summary.costCents).toBeGreaterThanOrEqual(0);
  });

  it("handles provider error mid-stream gracefully", async () => {
    const responses = [
      (async function* () {
        yield { type: "text" as const, delta: "Partial " };
        throw new Error("API rate limit exceeded");
      })(),
    ];

    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createSequenceDb({
      selects: [[agentConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({
        companyId: "co-1",
        userId: "user-1",
        userRole: "founder",
        content: "Tell me about my goals",
      }),
    );

    const errorChunk = chunks.find((c) => c.type === "error");
    expect(errorChunk).toBeDefined();
    // Should still have a done chunk
    expect(chunks[chunks.length - 1].type).toBe("done");
  });
});
