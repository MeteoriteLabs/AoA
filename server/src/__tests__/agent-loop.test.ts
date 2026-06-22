import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────
//
// agent-loop.ts depends on:
//  - drizzle-orm `eq` (only used to build the config WHERE clause)
//  - @armyofagents/db `internalAgentConfig` (a table object passed to
//    db.select().from(...).where(...))
//  - ./conversation.js `conversationService` — getOrCreateActive + appendMessage
//  - ./cli-mode.js `cliModeService` — the streamed CLI turn
//
// MX-chatpersist asserts the agent-loop layer (which OWNS the conversation)
// persists the assistant turn. We mock conversationService + cliModeService
// and drive scripted streams; the DB is a tiny sequence stub for the config
// SELECT only.

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ eq: [a, b] })),
  and: vi.fn((...args: unknown[]) => args),
  ne: vi.fn((a: unknown, b: unknown) => ({ ne: [a, b] })),
  sql: Object.assign(
    vi.fn((strings: any, ...values: any[]) => ({ sql: strings, values })),
    { raw: vi.fn((input: any) => input) },
  ),
}));

vi.mock("@armyofagents/db", () => ({
  internalAgentConfig: { __table: "internal_agent_config", companyId: Symbol("companyId") },
  agents: { __table: "agents", id: "id", companyId: "companyId", name: "name", adapterConfig: "adapterConfig" },
}));

const appendMessage = vi.fn(async () => ({ id: "msg" }));
const getOrCreateActive = vi.fn(async () => ({ id: "conv-1" }));
vi.mock("../services/internal-agent/conversation.js", () => ({
  conversationService: vi.fn(() => ({ getOrCreateActive, appendMessage })),
}));

const cliChat = vi.fn();
vi.mock("../services/internal-agent/cli-mode.js", () => ({
  cliModeService: vi.fn(() => ({ chat: cliChat })),
}));

// ── Sprint 1 additions — mock to prevent company-skills → projects → heartbeat chain ──
vi.mock("../services/company-skills.js", () => ({
  companySkillService: vi.fn(() => ({
    listCompactSkillEntries: vi.fn(async () => []),
  })),
}));
vi.mock("../services/internal-agent/commander-skills.js", () => ({
  buildCompactSkillList: vi.fn(async () => null),
}));

// ── Pre-Sprint-1 services added to agent-loop.ts but not mocked in this test ──
vi.mock("../services/internal-agent/context-assembly.js", () => ({
  contextAssemblyService: vi.fn(() => ({
    assembleContext: vi.fn(async () => ({ systemPrompt: "" })),
  })),
}));
vi.mock("../services/internal-agent/commander-context.js", () => ({
  loadCommanderPersona: vi.fn(async () => null),
}));
vi.mock("../services/internal-agent/aoa-agents/ensure-commander.js", () => ({
  ensureCommanderAgent: vi.fn(async () => "commander-id"),
}));
vi.mock("../services/internal-agent/cli-summarizer.js", () => ({
  summarizeViaCli: vi.fn(async () => ""),
}));
vi.mock("../services/memory.js", () => ({
  memoryService: vi.fn(() => ({
    searchSemantic: vi.fn(async () => []),
  })),
}));
vi.mock("../services/agent-instructions.js", () => ({
  agentInstructionsService: vi.fn(() => ({})),
}));

import { agentLoopService } from "../services/internal-agent/agent-loop.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/** A db stub whose select()...where() resolves to the configured config row. */
function dbWithConfig(configRow: unknown) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown[]) => unknown) =>
    Promise.resolve(resolve(configRow == null ? [] : [configRow]));
  return { select: () => chain } as any;
}

function scriptStream(chunks: unknown[]) {
  cliChat.mockImplementation(async function* () {
    for (const c of chunks) yield c;
  });
}

const BASE_PARAMS = {
  companyId: "co-1",
  userId: "user-1",
  userRole: "founder",
  enabledCapabilities: [] as string[],
  content: "what is up",
};

async function drain(svc: ReturnType<typeof agentLoopService>) {
  const out: any[] = [];
  for await (const chunk of svc.chat({ ...BASE_PARAMS } as any)) out.push(chunk);
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  getOrCreateActive.mockResolvedValue({ id: "conv-1" });
  appendMessage.mockResolvedValue({ id: "msg" });
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("agentLoopService.chat — assistant persistence (MX-chatpersist)", () => {
  it("persists the user message (existing behavior, role:user, content=params.content)", async () => {
    scriptStream([
      { type: "text", delta: "Hi" },
      { type: "done", summary: {} },
    ]);
    const svc = agentLoopService(dbWithConfig({ cliTool: "claude_cli", executionMode: "cli" }));
    await drain(svc);

    expect(appendMessage).toHaveBeenCalledWith(
      "conv-1",
      expect.objectContaining({ role: "user", content: "what is up" }),
    );
  });

  it("appends the assistant message exactly once after a clean stream with content == accumulated text", async () => {
    scriptStream([
      { type: "text", delta: "Hello " },
      { type: "text", delta: "world" },
      { type: "done", summary: { runId: "", toolsCalled: [], durationMs: 0, costCents: 0, tokenUsage: { inputTokens: 0, outputTokens: 0 } } },
    ]);
    const svc = agentLoopService(dbWithConfig({ cliTool: "claude_cli", executionMode: "cli" }));
    await drain(svc);

    const assistantCalls = appendMessage.mock.calls.filter(
      (c) => (c[1] as any).role === "assistant",
    );
    expect(assistantCalls).toHaveLength(1);
    expect(assistantCalls[0][0]).toBe("conv-1");
    expect((assistantCalls[0][1] as any).content).toBe("Hello world");

    // user message persisted before the assistant message.
    const roles = appendMessage.mock.calls.map((c) => (c[1] as any).role);
    expect(roles).toEqual(["user", "assistant"]);
  });

  it("forwards every chunk to the caller in order (streaming byte-unchanged)", async () => {
    const scripted = [
      { type: "text", delta: "Hello " },
      { type: "text", delta: "world" },
      { type: "done", summary: { runId: "r", toolsCalled: [], durationMs: 1, costCents: 2, tokenUsage: { inputTokens: 3, outputTokens: 4 } } },
    ];
    scriptStream(scripted);
    const svc = agentLoopService(dbWithConfig({ cliTool: "codex", executionMode: "cli" }));
    const out = await drain(svc);

    // The agent-loop must yield EXACTLY the scripted chunks, unchanged & in order.
    expect(out).toEqual(scripted);
  });

  it("appends NO assistant message when the stream yields only an error + done (no text)", async () => {
    scriptStream([
      { type: "error", message: "boom" },
      { type: "done", summary: {} },
    ]);
    const svc = agentLoopService(dbWithConfig({ cliTool: "codex", executionMode: "cli" }));
    const out = await drain(svc);

    const roles = appendMessage.mock.calls.map((c) => (c[1] as any).role);
    expect(roles).toEqual(["user"]); // user only — no assistant
    // the error + done still streamed through unchanged.
    expect(out).toEqual([
      { type: "error", message: "boom" },
      { type: "done", summary: {} },
    ]);
  });

  it("does NOT persist a partial assistant message when the stream throws mid-way (catch yields error+done)", async () => {
    cliChat.mockImplementation(async function* () {
      yield { type: "text", delta: "partial..." };
      throw new Error("stream blew up");
    });
    const svc = agentLoopService(dbWithConfig({ cliTool: "claude_cli", executionMode: "cli" }));
    const out = await drain(svc);

    const roles = appendMessage.mock.calls.map((c) => (c[1] as any).role);
    expect(roles).toEqual(["user"]); // user only — NO partial assistant

    // catch path: an error chunk then a done chunk.
    expect(out.some((c) => c.type === "error" && /stream blew up/.test(c.message))).toBe(true);
    expect(out[out.length - 1].type).toBe("done");
  });

  it("does NOT persist an empty/whitespace-only assistant message", async () => {
    scriptStream([
      { type: "text", delta: "   " },
      { type: "text", delta: "\n" },
      { type: "done", summary: {} },
    ]);
    const svc = agentLoopService(dbWithConfig({ cliTool: "claude_cli", executionMode: "cli" }));
    await drain(svc);

    const roles = appendMessage.mock.calls.map((c) => (c[1] as any).role);
    expect(roles).toEqual(["user"]); // whitespace-only ⇒ no assistant append
  });

  it("does NOT append an assistant message when the company has no config (not-configured error path)", async () => {
    const svc = agentLoopService(dbWithConfig(null));
    const out = await drain(svc);

    const roles = appendMessage.mock.calls.map((c) => (c[1] as any).role);
    expect(roles).toEqual(["user"]); // user persisted, then config error — no assistant
    expect(out.some((c) => c.type === "error" && /not configured/i.test(c.message))).toBe(true);
    // cli-mode is never even invoked when unconfigured.
    expect(cliChat).not.toHaveBeenCalled();
  });

  it("defaults legacy null cliTool configs to claude_cli before dispatch", async () => {
    scriptStream([
      { type: "text", delta: "Hi" },
      { type: "done", summary: { runId: "", toolsCalled: [], durationMs: 0, costCents: 0, tokenUsage: { inputTokens: 0, outputTokens: 0 } } },
    ]);
    const svc = agentLoopService(dbWithConfig({ cliTool: null, executionMode: "cli" }));
    await drain(svc);

    expect(cliChat).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.any(String) }),
      expect.objectContaining({ cliTool: "claude_cli" }),
    );
  });
});
