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

const mockGetProviderApiKey = vi.fn();
const mockCreateProvider = vi.fn();
vi.mock("../services/internal-agent/providers/index.js", () => ({
  getProviderApiKey: (...args: unknown[]) => mockGetProviderApiKey(...args),
  createProvider: (...args: unknown[]) => mockCreateProvider(...args),
}));

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
  {
    name: "query_memory",
    description: "Query memory",
    parameters: { type: "object" as const, properties: {} },
    category: "memory" as const,
    requiredRole: "team_member" as const,
    requiresConfirmation: false,
    execute: vi.fn().mockResolvedValue({ success: true, data: [], summary: "No memory found" }),
  },
  {
    name: "query_goals",
    description: "Query goals",
    parameters: { type: "object" as const, properties: {} },
    category: "query" as const,
    requiredRole: "team_member" as const,
    requiresConfirmation: false,
    execute: vi.fn().mockResolvedValue({ success: true, data: [], summary: "No goals found" }),
  },
];

vi.mock("../services/internal-agent/tool-registry.js", () => ({
  createToolRegistry: () => mockTools,
  getToolsForMessage: () => mockTools,
  toolToAnthropicFormat: (t: any) => ({ name: t.name, description: t.description, input_schema: t.parameters }),
  executeTool: (tool: any, params: any, ctx: any) => tool.execute(params, ctx),
}));

vi.mock("../services/internal-agent/context-assembly.js", () => ({
  contextAssemblyService: () => ({
    assembleContext: vi.fn().mockResolvedValue({
      systemPrompt: "You are an AI assistant.",
      estimatedTokens: 100,
    }),
  }),
}));

vi.mock("../services/internal-agent/service-container.js", () => ({
  createServiceContainer: () => ({}),
}));

vi.mock("../services/live-events.js", () => ({
  publishLiveEvent: vi.fn(),
}));

vi.mock("../services/internal-agent/cli-mode.js", () => ({
  cliModeService: () => ({ chat: vi.fn() }),
}));

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

import { agentLoopService, type AgentStreamChunk } from "../services/internal-agent/agent-loop.js";
import { createAgentDb, collectChunks, createMockProvider } from "./helpers/mock-db.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Helper: provider yields a single tool_call then text on next round */
function toolThenTextResponse(toolName: string, toolInput: unknown, finalText: string) {
  return [
    (async function* () {
      yield { type: "tool_call" as const, id: "tc-1", name: toolName, input: toolInput };
      yield { type: "done" as const, usage: { inputTokens: 100, outputTokens: 50 } };
    })(),
    (async function* () {
      yield { type: "text" as const, delta: finalText };
      yield { type: "done" as const, usage: { inputTokens: 150, outputTokens: 60 } };
    })(),
  ];
}

/** Helper: provider yields two tool_calls in one round, then text */
function multiToolThenTextResponse(
  tools: Array<{ name: string; input: unknown }>,
  finalText: string,
) {
  return [
    (async function* () {
      for (let i = 0; i < tools.length; i++) {
        yield { type: "tool_call" as const, id: `tc-${i + 1}`, name: tools[i].name, input: tools[i].input };
      }
      yield { type: "done" as const, usage: { inputTokens: 200, outputTokens: 80 } };
    })(),
    (async function* () {
      yield { type: "text" as const, delta: finalText };
      yield { type: "done" as const, usage: { inputTokens: 250, outputTokens: 100 } };
    })(),
  ];
}

/** Helper: provider yields only text (no tools) */
function textOnlyResponse(text: string, usage = { inputTokens: 100, outputTokens: 50 }) {
  return [
    (async function* () {
      yield { type: "text" as const, delta: text };
      yield { type: "done" as const, usage };
    })(),
  ];
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const agentConfig = {
  id: "cfg-1",
  companyId: "co-1",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  autonomyLevel: 0,
  contextTokenBudget: 8000,
  budgetMonthlyCents: 10000,
  spentMonthlyCents: 0,
  enabledCapabilities: [],
};

const baseChatInput = {
  companyId: "co-1",
  userId: "user-1",
  userRole: "founder",
  content: "show my tasks",
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("v2.5 Agent Panel QA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderApiKey.mockResolvedValue("sk-test-key");
    mockConversationService.getOrCreateActive.mockResolvedValue(mockConversation);
    mockConversationService.getRecentMessages.mockResolvedValue([]);
    mockConversationService.appendMessage.mockImplementation((_convId: string, msg: any) =>
      Promise.resolve({ id: `msg-${Date.now()}`, ...msg }),
    );
    mockConversationService.summarizeIfNeeded.mockResolvedValue(undefined);
    // Reset tool mocks
    for (const tool of mockTools) {
      (tool.execute as any).mockClear();
    }
  });

  // ── 1. Simple query ────────────────────────────────────────────────────

  it("simple query: user asks 'show my tasks' -> tool_call(query_tasks) -> text response", async () => {
    const responses = toolThenTextResponse("query_tasks", {}, "Here are your tasks: Test task.");
    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createAgentDb({
      selects: [[agentConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({ ...baseChatInput, content: "show my tasks" }),
    );

    const types = chunks.map((c) => c.type);
    expect(types).toContain("tool_call");
    expect(types).toContain("tool_result");
    expect(types).toContain("text");
    expect(types).toContain("done");

    // Verify the tool_call chunk references query_tasks
    const toolCallChunk = chunks.find((c) => c.type === "tool_call") as Extract<AgentStreamChunk, { type: "tool_call" }>;
    expect(toolCallChunk.name).toBe("query_tasks");

    // Verify text chunk has the expected content
    const textChunk = chunks.find((c) => c.type === "text") as Extract<AgentStreamChunk, { type: "text" }>;
    expect(textChunk.delta).toBe("Here are your tasks: Test task.");

    // Verify query_tasks.execute was actually called
    expect(mockTools[0].execute).toHaveBeenCalled();
  });

  // ── 2. Multi-tool query ────────────────────────────────────────────────

  it("multi-tool query: user asks 'show tasks and goals' -> two tool_call chunks -> combined text", async () => {
    const responses = multiToolThenTextResponse(
      [
        { name: "query_tasks", input: {} },
        { name: "query_goals", input: {} },
      ],
      "Here are your tasks and goals summary.",
    );
    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createAgentDb({
      selects: [[agentConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({ ...baseChatInput, content: "show tasks and goals" }),
    );

    // Should have two tool_call chunks
    const toolCalls = chunks.filter((c) => c.type === "tool_call") as Array<Extract<AgentStreamChunk, { type: "tool_call" }>>;
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].name).toBe("query_tasks");
    expect(toolCalls[1].name).toBe("query_goals");

    // Should have two tool_result chunks
    const toolResults = chunks.filter((c) => c.type === "tool_result");
    expect(toolResults).toHaveLength(2);

    // Should have text after tools
    const textChunks = chunks.filter((c) => c.type === "text");
    expect(textChunks.length).toBeGreaterThanOrEqual(1);

    // Done at end
    expect(chunks[chunks.length - 1].type).toBe("done");
  });

  // ── 3. Action with confirmation ────────────────────────────────────────

  it("action with confirmation: autonomy=0, create_task -> action_confirmation chunk, then pauses", async () => {
    const responses = [
      (async function* () {
        yield { type: "tool_call" as const, id: "tc-1", name: "create_task", input: { title: "New task" } };
        yield { type: "done" as const, usage: { inputTokens: 100, outputTokens: 50 } };
      })(),
    ];

    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createAgentDb({
      selects: [[{ ...agentConfig, autonomyLevel: 0 }]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const gen = svc.chat({
      ...baseChatInput,
      content: "Create a task called New task",
    });

    const collectedChunks: AgentStreamChunk[] = [];
    for await (const chunk of gen) {
      collectedChunks.push(chunk);
      // Break as soon as we get confirmation — the generator is paused waiting for the Promise
      if (chunk.type === "action_confirmation") break;
    }

    const confirmChunk = collectedChunks.find((c) => c.type === "action_confirmation") as
      Extract<AgentStreamChunk, { type: "action_confirmation" }>;
    expect(confirmChunk).toBeDefined();
    expect(confirmChunk.toolName).toBe("create_task");
    expect(confirmChunk.params).toEqual({ title: "New task" });
    expect(confirmChunk.runId).toBe("run-1");

    // create_task.execute should NOT have been called yet (still waiting for confirmation)
    expect(mockTools[1].execute).not.toHaveBeenCalled();
  });

  // ── 4. RBAC enforcement ────────────────────────────────────────────────

  it("RBAC enforcement: team_member tries founder-only tool -> FORBIDDEN tool_result", async () => {
    const responses = [
      (async function* () {
        yield { type: "tool_call" as const, id: "tc-1", name: "create_task", input: { title: "Forbidden task" } };
        yield { type: "done" as const, usage: { inputTokens: 100, outputTokens: 50 } };
      })(),
      // After RBAC rejection, provider gives text response
      (async function* () {
        yield { type: "text" as const, delta: "Sorry, you don't have permission to create tasks." };
        yield { type: "done" as const, usage: { inputTokens: 150, outputTokens: 60 } };
      })(),
    ];

    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    // Use autonomyLevel > 0 to skip confirmation, so RBAC check is reached
    const configHighAutonomy = { ...agentConfig, autonomyLevel: 2 };
    const db = createAgentDb({
      selects: [[configHighAutonomy]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({
        ...baseChatInput,
        userRole: "team_member",
        content: "Create a task",
      }),
    );

    // Should have a tool_result with FORBIDDEN error
    const toolResult = chunks.find((c) => c.type === "tool_result") as
      Extract<AgentStreamChunk, { type: "tool_result" }>;
    expect(toolResult).toBeDefined();
    expect(toolResult.result.success).toBe(false);
    expect(toolResult.result.error).toBe("FORBIDDEN");
    expect(toolResult.result.summary).toContain("Permission denied");
    expect(toolResult.result.summary).toContain("founder");

    // create_task.execute should NOT have been called
    expect(mockTools[1].execute).not.toHaveBeenCalled();
  });

  // ── 5. Conversation persistence ────────────────────────────────────────

  it("conversation persistence: multiple messages -> appendMessage called each time", async () => {
    const responses = textOnlyResponse("Response 1");
    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createAgentDb({
      selects: [[agentConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    await collectChunks(svc.chat({ ...baseChatInput, content: "First message" }));

    // appendMessage should have been called for the user message + assistant message
    const appendCalls = mockConversationService.appendMessage.mock.calls;
    expect(appendCalls.length).toBeGreaterThanOrEqual(2);

    // First call: user message
    expect(appendCalls[0][1].role).toBe("user");
    expect(appendCalls[0][1].content).toBe("First message");

    // Last call: assistant message
    const lastCall = appendCalls[appendCalls.length - 1];
    expect(lastCall[1].role).toBe("assistant");
    expect(lastCall[1].content).toBe("Response 1");

    // Send a second message
    vi.clearAllMocks();
    mockGetProviderApiKey.mockResolvedValue("sk-test-key");
    mockConversationService.getOrCreateActive.mockResolvedValue(mockConversation);
    mockConversationService.getRecentMessages.mockResolvedValue([]);
    mockConversationService.appendMessage.mockImplementation((_convId: string, msg: any) =>
      Promise.resolve({ id: `msg-${Date.now()}`, ...msg }),
    );
    mockConversationService.summarizeIfNeeded.mockResolvedValue(undefined);

    const responses2 = textOnlyResponse("Response 2");
    const mockProvider2 = createMockProvider(responses2);
    mockCreateProvider.mockReturnValue(mockProvider2);

    const db2 = createAgentDb({
      selects: [[agentConfig]],
      inserts: [[{ id: "run-2" }]],
      updates: [[{}], [{}]],
    });

    const svc2 = agentLoopService(db2 as any);
    await collectChunks(svc2.chat({ ...baseChatInput, content: "Second message" }));

    const appendCalls2 = mockConversationService.appendMessage.mock.calls;
    expect(appendCalls2.length).toBeGreaterThanOrEqual(2);
    expect(appendCalls2[0][1].content).toBe("Second message");
  });

  // ── 6. Conversation reset ─────────────────────────────────────────────

  it("conversation reset: getOrCreateActive returns fresh conversation after reset", async () => {
    const freshConversation = {
      id: "conv-2",
      companyId: "co-1",
      userId: "user-1",
      status: "active",
      messageCount: 0,
      summarizedContext: null,
    };
    mockConversationService.getOrCreateActive.mockResolvedValue(freshConversation);

    const responses = textOnlyResponse("Hello from new conversation!");
    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createAgentDb({
      selects: [[agentConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({ ...baseChatInput, content: "Hello" }),
    );

    // Verify conversation service was called with the right company/user
    expect(mockConversationService.getOrCreateActive).toHaveBeenCalledWith("co-1", "user-1");

    // Verify the response came through
    const textChunk = chunks.find((c) => c.type === "text") as Extract<AgentStreamChunk, { type: "text" }>;
    expect(textChunk).toBeDefined();
    expect(textChunk.delta).toBe("Hello from new conversation!");

    // appendMessage calls should reference the new conversation id
    const appendCalls = mockConversationService.appendMessage.mock.calls;
    expect(appendCalls[0][0]).toBe("conv-2");
  });

  // ── 7. Budget warning at 80% ──────────────────────────────────────────

  it("budget warning at 80%: spend at 79% -> no error; spend at 81% -> still runs (warning is UI-side)", async () => {
    // At 79% of budget (7900/10000) - should work fine
    const config79 = { ...agentConfig, spentMonthlyCents: 7900 };
    const responses = textOnlyResponse("Still under budget.");
    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createAgentDb({
      selects: [[config79]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({ ...baseChatInput, content: "Hello" }),
    );

    // No error chunk
    const errorChunks = chunks.filter((c) => c.type === "error");
    expect(errorChunks).toHaveLength(0);

    // Has text + done
    expect(chunks.some((c) => c.type === "text")).toBe(true);
    expect(chunks[chunks.length - 1].type).toBe("done");

    // At 81% of budget (8100/10000) - should also work (budget check is >= 100%)
    vi.clearAllMocks();
    mockGetProviderApiKey.mockResolvedValue("sk-test-key");
    mockConversationService.getOrCreateActive.mockResolvedValue(mockConversation);
    mockConversationService.getRecentMessages.mockResolvedValue([]);
    mockConversationService.appendMessage.mockImplementation((_convId: string, msg: any) =>
      Promise.resolve({ id: `msg-${Date.now()}`, ...msg }),
    );
    mockConversationService.summarizeIfNeeded.mockResolvedValue(undefined);

    const config81 = { ...agentConfig, spentMonthlyCents: 8100 };
    const responses2 = textOnlyResponse("Approaching budget limit.");
    const mockProvider2 = createMockProvider(responses2);
    mockCreateProvider.mockReturnValue(mockProvider2);

    const db2 = createAgentDb({
      selects: [[config81]],
      inserts: [[{ id: "run-2" }]],
      updates: [[{}], [{}]],
    });

    const svc2 = agentLoopService(db2 as any);
    const chunks2 = await collectChunks(
      svc2.chat({ ...baseChatInput, content: "Hello again" }),
    );

    // Should still succeed at 81% - budget check only triggers at >= 100%
    const errors2 = chunks2.filter((c) => c.type === "error");
    expect(errors2).toHaveLength(0);
    expect(chunks2.some((c) => c.type === "text")).toBe(true);
  });

  // ── 8. Budget exceeded ─────────────────────────────────────────────────

  it("budget exceeded: spend at 100% -> error chunk + done chunk", async () => {
    const overBudgetConfig = { ...agentConfig, spentMonthlyCents: 10000 };

    const db = createAgentDb({
      selects: [[overBudgetConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({ ...baseChatInput, content: "Hello" }),
    );

    // Should have an error chunk about budget
    const errorChunk = chunks.find((c) => c.type === "error") as
      Extract<AgentStreamChunk, { type: "error" }>;
    expect(errorChunk).toBeDefined();
    expect(errorChunk.message.toLowerCase()).toContain("budget");

    // Should still end with done
    const doneChunk = chunks.find((c) => c.type === "done") as
      Extract<AgentStreamChunk, { type: "done" }>;
    expect(doneChunk).toBeDefined();
    expect(doneChunk.summary.costCents).toBe(0);
    expect(doneChunk.summary.toolsCalled).toEqual([]);
  });

  // ── 9. Streaming order ─────────────────────────────────────────────────

  it("streaming order: chunks come in order (tool_call -> tool_result -> text -> done)", async () => {
    const responses = toolThenTextResponse("query_tasks", {}, "Here are your tasks.");
    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createAgentDb({
      selects: [[agentConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({ ...baseChatInput, content: "show tasks" }),
    );

    const types = chunks.map((c) => c.type);

    // Find indices
    const toolCallIdx = types.indexOf("tool_call");
    const toolResultIdx = types.indexOf("tool_result");
    const textIdx = types.indexOf("text");
    const doneIdx = types.indexOf("done");

    // All should exist
    expect(toolCallIdx).toBeGreaterThanOrEqual(0);
    expect(toolResultIdx).toBeGreaterThanOrEqual(0);
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThanOrEqual(0);

    // Order: tool_call before tool_result before text before done
    expect(toolCallIdx).toBeLessThan(toolResultIdx);
    expect(toolResultIdx).toBeLessThan(textIdx);
    expect(textIdx).toBeLessThan(doneIdx);

    // done is always last
    expect(doneIdx).toBe(types.length - 1);
  });

  // ── 10. Token tracking ─────────────────────────────────────────────────

  it("token tracking: done.summary.tokenUsage accumulates across rounds", async () => {
    // Two rounds: tool call round (100 in / 50 out) + text round (150 in / 60 out)
    const responses = toolThenTextResponse("query_tasks", {}, "Summary.");
    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createAgentDb({
      selects: [[agentConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({ ...baseChatInput, content: "show tasks" }),
    );

    const doneChunk = chunks.find((c) => c.type === "done") as
      Extract<AgentStreamChunk, { type: "done" }>;
    expect(doneChunk).toBeDefined();

    // toolThenTextResponse yields 100+150=250 input, 50+60=110 output
    expect(doneChunk.summary.tokenUsage.inputTokens).toBe(250);
    expect(doneChunk.summary.tokenUsage.outputTokens).toBe(110);
  });

  // ── 11. Cost calculation ───────────────────────────────────────────────

  it("cost calculation: done.summary.costCents is calculated correctly for claude-sonnet-4-6", async () => {
    // claude-sonnet-4-6 pricing: input=300, output=1500 (per 1M tokens)
    // Usage: 500 input + 100 output
    // Cost = ceil((500 * 300 + 100 * 1500) / 1_000_000) = ceil((150000 + 150000) / 1_000_000)
    //      = ceil(300000 / 1_000_000) = ceil(0.3) = 1 cent
    const responses = [
      (async function* () {
        yield { type: "text" as const, delta: "Hello!" };
        yield { type: "done" as const, usage: { inputTokens: 500, outputTokens: 100 } };
      })(),
    ];

    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createAgentDb({
      selects: [[agentConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({ ...baseChatInput, content: "Hello" }),
    );

    const doneChunk = chunks.find((c) => c.type === "done") as
      Extract<AgentStreamChunk, { type: "done" }>;
    expect(doneChunk).toBeDefined();
    // ceil((500*300 + 100*1500) / 1_000_000) = ceil(0.3) = 1
    expect(doneChunk.summary.costCents).toBe(1);
    expect(doneChunk.summary.tokenUsage).toEqual({ inputTokens: 500, outputTokens: 100 });
  });

  // ── 12. Provider error recovery ────────────────────────────────────────

  it("provider error recovery: provider throws mid-stream -> error chunk + done chunk", async () => {
    const responses = [
      (async function* () {
        yield { type: "text" as const, delta: "Partial response..." };
        throw new Error("API rate limit exceeded");
      })(),
    ];

    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createAgentDb({
      selects: [[agentConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({ ...baseChatInput, content: "Tell me about goals" }),
    );

    const types = chunks.map((c) => c.type);

    // Should have partial text
    expect(types).toContain("text");
    const textChunk = chunks.find((c) => c.type === "text") as Extract<AgentStreamChunk, { type: "text" }>;
    expect(textChunk.delta).toBe("Partial response...");

    // Should have error chunk
    const errorChunk = chunks.find((c) => c.type === "error") as
      Extract<AgentStreamChunk, { type: "error" }>;
    expect(errorChunk).toBeDefined();
    expect(errorChunk.message).toContain("API rate limit exceeded");

    // Should still end with done
    expect(chunks[chunks.length - 1].type).toBe("done");

    // Done summary should have the runId
    const doneChunk = chunks[chunks.length - 1] as Extract<AgentStreamChunk, { type: "done" }>;
    expect(doneChunk.summary.runId).toBe("run-1");

    // Partial text should have been saved (appendMessage called for assistant)
    const assistantSaves = mockConversationService.appendMessage.mock.calls.filter(
      (call: any[]) => call[1].role === "assistant",
    );
    expect(assistantSaves.length).toBeGreaterThanOrEqual(1);
    expect(assistantSaves[0][1].content).toBe("Partial response...");
  });

  // ── 13. Max tool rounds ────────────────────────────────────────────────

  it("max tool rounds: 11+ tool calls -> stops at 10 + final forced text", async () => {
    // Create exactly 10 tool_call responses (one per MAX_TOOL_ROUNDS iteration)
    // followed by 1 text response for the forced final call after the loop
    const providerResponses: Array<AsyncIterable<any>> = Array.from({ length: 10 }, (_, i) =>
      (async function* () {
        yield { type: "tool_call" as const, id: `tc-${i}`, name: "query_tasks", input: {} };
        yield { type: "done" as const, usage: { inputTokens: 50, outputTokens: 30 } };
      })(),
    );
    // 11th call: forced text response (provider.chat called with tools: [])
    providerResponses.push(
      (async function* () {
        yield { type: "text" as const, delta: "Here is my final summary." };
        yield { type: "done" as const, usage: { inputTokens: 50, outputTokens: 30 } };
      })(),
    );

    const mockProvider = createMockProvider(providerResponses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createAgentDb({
      selects: [[agentConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({ ...baseChatInput, content: "Do a complex analysis" }),
    );

    // Should have at most 10 tool_call chunks
    const toolCalls = chunks.filter((c) => c.type === "tool_call");
    expect(toolCalls.length).toBeLessThanOrEqual(10);

    // Should have text (from the forced final call)
    const textChunks = chunks.filter((c) => c.type === "text");
    expect(textChunks.length).toBeGreaterThanOrEqual(1);

    // Should end with done
    expect(chunks[chunks.length - 1].type).toBe("done");

    // The final provider.chat call should have been called with empty tools array
    // (forcing text-only response)
    const lastChatCall = mockProvider.chat.mock.calls[mockProvider.chat.mock.calls.length - 1];
    expect(lastChatCall[0].tools).toEqual([]);
  });

  // ── 14. Empty conversation history ─────────────────────────────────────

  it("empty conversation history: first message in new conversation works", async () => {
    // Ensure conversation has no prior messages
    mockConversationService.getRecentMessages.mockResolvedValue([]);
    mockConversationService.getOrCreateActive.mockResolvedValue({
      ...mockConversation,
      messageCount: 0,
      summarizedContext: null,
    });

    const responses = textOnlyResponse("Welcome! How can I help?");
    const mockProvider = createMockProvider(responses);
    mockCreateProvider.mockReturnValue(mockProvider);

    const db = createAgentDb({
      selects: [[agentConfig]],
      inserts: [[{ id: "run-1" }]],
      updates: [[{}], [{}]],
    });

    const svc = agentLoopService(db as any);
    const chunks = await collectChunks(
      svc.chat({ ...baseChatInput, content: "Hello, this is my first message" }),
    );

    // Should work fine with no errors
    const errors = chunks.filter((c) => c.type === "error");
    expect(errors).toHaveLength(0);

    // Should have text response
    const textChunk = chunks.find((c) => c.type === "text") as Extract<AgentStreamChunk, { type: "text" }>;
    expect(textChunk).toBeDefined();
    expect(textChunk.delta).toBe("Welcome! How can I help?");

    // Should end with done
    const doneChunk = chunks[chunks.length - 1] as Extract<AgentStreamChunk, { type: "done" }>;
    expect(doneChunk.type).toBe("done");
    expect(doneChunk.summary.runId).toBe("run-1");

    // Provider should have received empty messages array (plus user's current message via conversation service)
    const chatCall = mockProvider.chat.mock.calls[0][0];
    expect(chatCall.messages).toBeDefined();
    expect(chatCall.systemPrompt).toBe("You are an AI assistant.");
  });
});
