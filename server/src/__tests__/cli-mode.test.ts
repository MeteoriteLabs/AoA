import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { execSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

// MX4: the chat writes the claude mcp-config JSON via fs/promises.writeFile
// and (for codex) provisions a managed CODEX_HOME via the MX3 codex helper.
// Mock both so the per-CLI wiring can be asserted without touching disk.
vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
}));

// MX-chatparse: the chat now also parses codex stdout via the REAL
// parseCodexJsonl / isCodexUnknownSessionError from this barrel (pure
// functions — we want their true behavior, not a stub). Only the disk
// writers are stubbed; the parsers come from importOriginal.
//
// MX-chatauth: the codex chat ALSO provisions auth.json into its
// per-session CODEX_HOME via ensureCodexAuthInHome (so `codex exec` is
// authenticated). Stub it too so the wiring can be asserted without
// touching the user's real ~/.codex/auth.json.
vi.mock("@armyofagents/adapter-codex-local/server", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@armyofagents/adapter-codex-local/server")
  >();
  return {
    ...actual,
    writeCodexMcpConfigToml: vi.fn(async () => {}),
    ensureCodexAuthInHome: vi.fn(async () => true),
  };
});

// ── Session Store Tests ─────────────────────────────────────────────────────

describe("CLISessionStore", () => {
  let store: ReturnType<typeof import("../services/internal-agent/cli-session-store.js").createCLISessionStore>;

  beforeEach(async () => {
    const mod = await import("../services/internal-agent/cli-session-store.js");
    store = mod.createCLISessionStore();
  });

  afterEach(() => {
    store.shutdownAll();
  });

  it("creates and retrieves a session by key", () => {
    const mockSession = {
      cliProcess: { kill: vi.fn(), on: vi.fn(), stdin: { write: vi.fn() }, stdout: { on: vi.fn() }, stderr: { on: vi.fn() } },
      mcpProcess: null,
      cliTool: "claude_cli" as const,
      companyId: "comp1",
      userId: "user1",
      userRole: "founder",
      startedAt: new Date(),
      lastMessageAt: new Date(),
      mcpConfigPath: "/tmp/aoa-mcp-comp1:user1.json",
      status: "active" as const,
      messageQueue: [],
      processing: false,
    };
    store.set("comp1:user1", mockSession);
    expect(store.get("comp1:user1")).toBe(mockSession);
  });

  it("returns undefined for non-existent key", () => {
    expect(store.get("no:such")).toBeUndefined();
  });

  it("deletes a session", () => {
    const mockSession = {
      cliProcess: { kill: vi.fn(), on: vi.fn(), stdin: { write: vi.fn() }, stdout: { on: vi.fn() }, stderr: { on: vi.fn() } },
      mcpProcess: null,
      cliTool: "claude_cli" as const,
      companyId: "comp1",
      userId: "user1",
      userRole: "founder",
      startedAt: new Date(),
      lastMessageAt: new Date(),
      mcpConfigPath: "/tmp/test.json",
      status: "active" as const,
      messageQueue: [],
      processing: false,
    };
    store.set("comp1:user1", mockSession);
    store.delete("comp1:user1");
    expect(store.get("comp1:user1")).toBeUndefined();
  });

  it("has() returns correct boolean", () => {
    expect(store.has("comp1:user1")).toBe(false);
    const mockSession = {
      cliProcess: { kill: vi.fn(), on: vi.fn(), stdin: { write: vi.fn() }, stdout: { on: vi.fn() }, stderr: { on: vi.fn() } },
      mcpProcess: null,
      cliTool: "codex" as const,
      companyId: "comp1",
      userId: "user1",
      userRole: "founder",
      startedAt: new Date(),
      lastMessageAt: new Date(),
      mcpConfigPath: "/tmp/test.json",
      status: "active" as const,
      messageQueue: [],
      processing: false,
    };
    store.set("comp1:user1", mockSession);
    expect(store.has("comp1:user1")).toBe(true);
  });

  it("getStale returns sessions older than threshold", () => {
    const old = new Date(Date.now() - 31 * 60 * 1000); // 31 min ago
    const mockSession = {
      cliProcess: { kill: vi.fn(), on: vi.fn(), stdin: { write: vi.fn() }, stdout: { on: vi.fn() }, stderr: { on: vi.fn() } },
      mcpProcess: null,
      cliTool: "claude_cli" as const,
      companyId: "comp1",
      userId: "user1",
      userRole: "founder",
      startedAt: old,
      lastMessageAt: old,
      mcpConfigPath: "/tmp/test.json",
      status: "active" as const,
      messageQueue: [],
      processing: false,
    };
    store.set("comp1:user1", mockSession);
    const stale = store.getStale(30 * 60 * 1000);
    expect(stale).toHaveLength(1);
    expect(stale[0]).toBe("comp1:user1");
  });

  it("getStale ignores recent sessions", () => {
    const mockSession = {
      cliProcess: { kill: vi.fn(), on: vi.fn(), stdin: { write: vi.fn() }, stdout: { on: vi.fn() }, stderr: { on: vi.fn() } },
      mcpProcess: null,
      cliTool: "claude_cli" as const,
      companyId: "comp1",
      userId: "user1",
      userRole: "founder",
      startedAt: new Date(),
      lastMessageAt: new Date(),
      mcpConfigPath: "/tmp/test.json",
      status: "active" as const,
      messageQueue: [],
      processing: false,
    };
    store.set("comp1:user1", mockSession);
    const stale = store.getStale(30 * 60 * 1000);
    expect(stale).toHaveLength(0);
  });

  it("canEnqueue returns false when queue is full", () => {
    const mockSession = {
      cliProcess: { kill: vi.fn(), on: vi.fn(), stdin: { write: vi.fn() }, stdout: { on: vi.fn() }, stderr: { on: vi.fn() } },
      mcpProcess: null,
      cliTool: "claude_cli" as const,
      companyId: "comp1",
      userId: "user1",
      userRole: "founder",
      startedAt: new Date(),
      lastMessageAt: new Date(),
      mcpConfigPath: "/tmp/test.json",
      status: "active" as const,
      messageQueue: Array.from({ length: 5 }, () => ({ resolve: vi.fn(), reject: vi.fn() })),
      processing: false,
    };
    store.set("comp1:user1", mockSession);
    expect(store.canEnqueue("comp1:user1")).toBe(false);
  });

  it("canEnqueue returns true when queue has space", () => {
    const mockSession = {
      cliProcess: { kill: vi.fn(), on: vi.fn(), stdin: { write: vi.fn() }, stdout: { on: vi.fn() }, stderr: { on: vi.fn() } },
      mcpProcess: null,
      cliTool: "claude_cli" as const,
      companyId: "comp1",
      userId: "user1",
      userRole: "founder",
      startedAt: new Date(),
      lastMessageAt: new Date(),
      mcpConfigPath: "/tmp/test.json",
      status: "active" as const,
      messageQueue: [],
      processing: false,
    };
    store.set("comp1:user1", mockSession);
    expect(store.canEnqueue("comp1:user1")).toBe(true);
  });

  it("cleanup kills process and removes session", () => {
    const kill1 = vi.fn();
    const mockSession = {
      cliProcess: { kill: kill1, on: vi.fn(), stdin: { write: vi.fn() }, stdout: { on: vi.fn() }, stderr: { on: vi.fn() } },
      mcpProcess: null,
      cliTool: "claude_cli" as const,
      companyId: "comp1",
      userId: "user1",
      userRole: "founder",
      startedAt: new Date(),
      lastMessageAt: new Date(),
      mcpConfigPath: "/tmp/test.json",
      status: "active" as const,
      messageQueue: [],
      processing: false,
    };
    store.set("comp1:user1", mockSession);
    store.cleanup("comp1:user1");
    expect(kill1).toHaveBeenCalledWith("SIGTERM");
    expect(store.has("comp1:user1")).toBe(false);
  });

  it("shutdownAll kills all processes", () => {
    const kill1 = vi.fn();
    const mockSession = {
      cliProcess: { kill: kill1, on: vi.fn(), stdin: { write: vi.fn() }, stdout: { on: vi.fn() }, stderr: { on: vi.fn() } },
      mcpProcess: null,
      cliTool: "claude_cli" as const,
      companyId: "comp1",
      userId: "user1",
      userRole: "founder",
      startedAt: new Date(),
      lastMessageAt: new Date(),
      mcpConfigPath: "/tmp/test.json",
      status: "active" as const,
      messageQueue: [],
      processing: false,
    };
    store.set("comp1:user1", mockSession);
    store.shutdownAll();
    expect(kill1).toHaveBeenCalled();
    expect(store.has("comp1:user1")).toBe(false);
  });
});

// ── CLI Detection Tests ───────────────────────────────────────────────────────

describe("detectCliTool", () => {
  let detectCliTool: typeof import("../services/internal-agent/cli-mode.js").detectCliTool;
  let mockExecSync: typeof execSync;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // Re-acquire the mock reference after resetModules so it matches
    // the instance that the freshly-imported cli-mode.js receives.
    const cp = await import("node:child_process");
    mockExecSync = cp.execSync;
    const mod = await import("../services/internal-agent/cli-mode.js");
    detectCliTool = mod.detectCliTool;
  });

  it("detects claude_cli when claude binary is in PATH", async () => {
    vi.mocked(mockExecSync).mockReturnValue("/usr/local/bin/claude\n" as any);
    const result = await detectCliTool("claude_cli");
    expect(result.available).toBe(true);
    expect(result.path).toBe("/usr/local/bin/claude");
  });

  it("detects codex when binary is in PATH", async () => {
    vi.mocked(mockExecSync).mockReturnValue("/usr/local/bin/codex\n" as any);
    const result = await detectCliTool("codex");
    expect(result.available).toBe(true);
    expect(result.path).toBe("/usr/local/bin/codex");
  });

  it("detects opencode when binary is in PATH", async () => {
    vi.mocked(mockExecSync).mockReturnValue("/usr/local/bin/opencode\n" as any);
    const result = await detectCliTool("opencode");
    expect(result.available).toBe(true);
    expect(result.path).toBe("/usr/local/bin/opencode");
  });

  it("returns error when CLI tool not found", async () => {
    vi.mocked(mockExecSync).mockImplementation(() => {
      throw new Error("not found");
    });
    const result = await detectCliTool("claude_cli");
    expect(result.available).toBe(false);
    expect(result.error).toContain("not found in PATH");
    expect(result.error).toContain("Install the CLI");
  });

  it("returns error for unknown tool type", async () => {
    const result = await detectCliTool("unknown_tool" as any);
    expect(result.available).toBe(false);
    expect(result.error).toContain("Unsupported");
  });
});

// ── MCP Config Builder Tests ──────────────────────────────────────────────────

describe("buildMcpConfig", () => {
  let buildMcpConfig: typeof import("../services/internal-agent/cli-mode.js").buildMcpConfig;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../services/internal-agent/cli-mode.js");
    buildMcpConfig = mod.buildMcpConfig;
  });

  it("produces valid JSON with mcpServers.aoa structure", () => {
    const config = buildMcpConfig({
      companyId: "comp1",
      userId: "user1",
      userRole: "founder",
      enabledCapabilities: ["discussion_processing", "system_actions"],
      bridgeEntrypoint: "/app/dist/mcp-bridge.js",
    });

    expect(config.mcpServers).toBeDefined();
    expect(config.mcpServers.aoa).toBeDefined();
    expect(config.mcpServers.aoa.command).toBe("node");
    expect(config.mcpServers.aoa.args).toContain("/app/dist/mcp-bridge.js");
    expect(config.mcpServers.aoa.env.AOA_SESSION_COMPANY_ID).toBe("comp1");
    expect(config.mcpServers.aoa.env.AOA_SESSION_USER_ID).toBe("user1");
    expect(config.mcpServers.aoa.env.AOA_SESSION_USER_ROLE).toBe("founder");
    expect(config.mcpServers.aoa.env.AOA_SESSION_ENABLED_CAPABILITIES).toBe(
      "discussion_processing,system_actions",
    );
  });

  it("inherits DATABASE_URL from process.env", () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://test:5432/db";
    const config = buildMcpConfig({
      companyId: "c",
      userId: "u",
      userRole: "founder",
      enabledCapabilities: [],
      bridgeEntrypoint: "/app/bridge.js",
    });
    expect(config.mcpServers.aoa.env.DATABASE_URL).toBe("postgres://test:5432/db");
    process.env.DATABASE_URL = original;
  });
});

// ── Tool Registry Tests ───────────────────────────────────────────────────────

describe("tool registry for MCP bridge", () => {
  it("createToolRegistry returns at least 25 tools", async () => {
    const { createToolRegistry } = await import(
      "../services/internal-agent/tool-registry.js"
    );
    const tools = createToolRegistry();
    expect(tools.length).toBeGreaterThanOrEqual(25);
  });

  it("all tools have required MCP fields (name, description, parameters)", async () => {
    const { createToolRegistry } = await import(
      "../services/internal-agent/tool-registry.js"
    );
    const tools = createToolRegistry();
    for (const tool of tools) {
      expect(tool.name, `tool missing name`).toBeTruthy();
      expect(tool.description, `${tool.name} missing description`).toBeTruthy();
      expect(tool.parameters, `${tool.name} missing parameters`).toBeDefined();
      expect(tool.parameters.type, `${tool.name} parameters.type should be 'object'`).toBe("object");
    }
  });

  it("all tool names are unique", async () => {
    const { createToolRegistry } = await import(
      "../services/internal-agent/tool-registry.js"
    );
    const tools = createToolRegistry();
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("tools can be converted to MCP format", async () => {
    const { createToolRegistry } = await import(
      "../services/internal-agent/tool-registry.js"
    );
    const { toolToMcpFormat } = await import(
      "../services/internal-agent/cli-mode.js"
    );
    const tools = createToolRegistry();
    const mcpTools = tools.map(toolToMcpFormat);
    for (const mcp of mcpTools) {
      expect(mcp).toHaveProperty("name");
      expect(mcp).toHaveProperty("description");
      expect(mcp).toHaveProperty("inputSchema");
    }
  });
});

// ── Output Parsing Tests ──────────────────────────────────────────────────────

describe("parseCliOutput", () => {
  let parseCliOutput: typeof import("../services/internal-agent/cli-mode.js").parseCliOutput;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("../services/internal-agent/cli-mode.js");
    parseCliOutput = mod.parseCliOutput;
  });

  it("converts text line to content chunk", () => {
    const chunks = parseCliOutput("Hello, I can help with that.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: "text", delta: "Hello, I can help with that." });
  });

  it("handles empty line as content", () => {
    const chunks = parseCliOutput("");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ type: "text", delta: "" });
  });

  it("handles multi-byte characters", () => {
    const chunks = parseCliOutput("Tasks: create '\u30C7\u30E2' task");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe("text");
  });
});

// ── MCP Bridge Tests ──────────────────────────────────────────────────────────

describe("MCP bridge tool handler", () => {
  it("handleToolCall routes to executeTool and returns result", async () => {
    const { createToolCallHandler } = await import(
      "../services/internal-agent/mcp-bridge.js"
    );

    const mockExecuteTool = vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: "t1", title: "Test task" }],
      summary: "Found 1 task",
    });

    const handler = createToolCallHandler({
      tools: [
        {
          name: "query_tasks",
          description: "Query tasks",
          parameters: { type: "object" as const, properties: {} },
          category: "query" as const,
          requiredRole: "team_member" as const,
          requiresConfirmation: false,
          execute: vi.fn(),
        },
      ],
      executeTool: mockExecuteTool,
      toolContext: {
        companyId: "comp1",
        userId: "user1",
        userRole: "founder",
        enabledCapabilities: [],
        db: {} as any,
        services: {} as any,
      },
    });

    const result = await handler("query_tasks", { status: "todo" });
    expect(mockExecuteTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "query_tasks" }),
      { status: "todo" },
      expect.objectContaining({ companyId: "comp1" }),
    );
    expect(result.content).toBeDefined();
    expect(result.isError).toBeFalsy();
  });

  it("returns error for unknown tool name", async () => {
    const { createToolCallHandler } = await import(
      "../services/internal-agent/mcp-bridge.js"
    );

    const handler = createToolCallHandler({
      tools: [],
      executeTool: vi.fn(),
      toolContext: {
        companyId: "comp1",
        userId: "user1",
        userRole: "founder",
        enabledCapabilities: [],
        db: {} as any,
        services: {} as any,
      },
    });

    const result = await handler("nonexistent_tool", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown tool");
  });

  it("returns error when executeTool throws", async () => {
    const { createToolCallHandler } = await import(
      "../services/internal-agent/mcp-bridge.js"
    );

    const mockExecuteTool = vi.fn().mockRejectedValue(new Error("DB connection failed"));

    const handler = createToolCallHandler({
      tools: [
        {
          name: "query_tasks",
          description: "Query tasks",
          parameters: { type: "object" as const, properties: {} },
          category: "query" as const,
          requiredRole: "team_member" as const,
          requiresConfirmation: false,
          execute: vi.fn(),
        },
      ],
      executeTool: mockExecuteTool,
      toolContext: {
        companyId: "comp1",
        userId: "user1",
        userRole: "founder",
        enabledCapabilities: [],
        db: {} as any,
        services: {} as any,
      },
    });

    const result = await handler("query_tasks", {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("DB connection failed");
  });
});

describe("buildToolListResponse", () => {
  it("converts AgentTool array to MCP tool list format", async () => {
    const { buildToolListResponse } = await import(
      "../services/internal-agent/mcp-bridge.js"
    );

    const tools = [
      {
        name: "query_tasks",
        description: "Query tasks",
        parameters: { type: "object" as const, properties: { status: { type: "string" } } },
        category: "query" as const,
        requiredRole: "team_member" as const,
        requiresConfirmation: false,
        execute: vi.fn(),
      },
    ];

    const result = buildToolListResponse(tools as any);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "query_tasks",
      description: "Query tasks",
      inputSchema: { type: "object", properties: { status: { type: "string" } } },
    });
  });
});

// ── CLI Mode Service Tests ──────────────────────────────────────────────────

describe("cliModeService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("yields error when CLI tool not in PATH", async () => {
    // Mock execSync to throw (tool not found)
    const cp = await import("node:child_process");
    vi.mocked(cp.execSync).mockImplementation(() => {
      throw new Error("not found");
    });

    const { cliModeService } = await import(
      "../services/internal-agent/cli-mode.js"
    );

    const service = cliModeService({} as any);
    const config = { cliTool: "claude_cli", executionMode: "cli" } as any;
    const params = {
      companyId: "comp1",
      userId: "user1",
      userRole: "founder",
      content: "hello",
    };

    const chunks: any[] = [];
    for await (const chunk of service.chat(params, config)) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === "error")).toBe(true);
    const errChunk = chunks.find((c) => c.type === "error");
    expect(errChunk.message).toContain("not found in PATH");
  });

  it("yields error when cliTool is not configured", async () => {
    const { cliModeService } = await import(
      "../services/internal-agent/cli-mode.js"
    );

    const service = cliModeService({} as any);
    const config = { cliTool: null, executionMode: "cli" } as any;
    const params = {
      companyId: "comp1",
      userId: "user1",
      userRole: "founder",
      content: "hello",
    };

    const chunks: any[] = [];
    for await (const chunk of service.chat(params, config)) {
      chunks.push(chunk);
    }

    expect(chunks.some((c) => c.type === "error")).toBe(true);
    const errChunk = chunks.find((c) => c.type === "error");
    expect(errChunk.message).toContain("No CLI tool configured");
  });

  it("exposes shutdown method", async () => {
    const { cliModeService } = await import(
      "../services/internal-agent/cli-mode.js"
    );
    const service = cliModeService({} as any);
    expect(typeof service.shutdown).toBe("function");
    // Should not throw
    service.shutdown();
  });

  it("exposes getSessionStore method", async () => {
    const { cliModeService } = await import(
      "../services/internal-agent/cli-mode.js"
    );
    const service = cliModeService({} as any);
    const store = service.getSessionStore();
    expect(typeof store.get).toBe("function");
    expect(typeof store.set).toBe("function");
    expect(typeof store.shutdownAll).toBe("function");
  });
});

// ── MX4: per-CLI chat wiring (F-codex-chat) ─────────────────────────────────
//
// The chat must give each CLI its OWN correct invocation:
//  - claude_cli  : write {mcpServers:{aoa}} JSON, spawn `claude` with
//                  ["--mcp-config", <json>, "-p", <content>, "--output-format",
//                  "text"] — BYTE-UNCHANGED from pre-MX4.
//  - codex       : provision a per-session managed CODEX_HOME via the MX3
//                  writeCodexMcpConfigToml(<dir>, <neutral spec>), spawn
//                  `codex` with argv starting ["exec","--json"], NO
//                  --mcp-config, NO -p, and spawn env CODEX_HOME=<dir>.
//  - opencode    : NO spawn — emit an explicit "not yet supported" error.

describe("cliModeService.chat — per-CLI wiring (MX4)", () => {
  function makeFakeProcess() {
    const proc: any = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { writable: true, write: vi.fn() };
    proc.kill = vi.fn();
    // Drive the stream helper to completion once the chat attaches its
    // stdout/exit listeners (streamProcessOutput registers them lazily).
    // Emitting on listener-attach avoids a race where a fixed-timer emit
    // fires before the chat subscribes and the for-await loop hangs.
    let driven = false;
    const drive = () => {
      if (driven) return;
      driven = true;
      setImmediate(() => {
        proc.stdout.emit("data", Buffer.from("ok"));
        proc.emit("exit", 0, null);
      });
    };
    proc.stdout.on("newListener", drive);
    proc.on("newListener", (ev: string) => {
      if (ev === "exit") drive();
    });
    return proc;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  async function runChat(cliTool: string) {
    const cp = await import("node:child_process");
    // CLI detected as available (where/which succeeds).
    vi.mocked(cp.execSync).mockReturnValue(`/usr/local/bin/x\n` as any);
    const fake = makeFakeProcess();
    vi.mocked(cp.spawn).mockReturnValue(fake as any);

    const fsp = await import("node:fs/promises");
    const codexMod = await import("@armyofagents/adapter-codex-local/server");

    const { cliModeService } = await import(
      "../services/internal-agent/cli-mode.js"
    );
    const service = cliModeService({} as any);
    const chunks: any[] = [];
    for await (const chunk of service.chat(
      {
        companyId: "comp1",
        userId: "user1",
        userRole: "founder",
        content: "hello world",
        enabledCapabilities: [],
      } as any,
      { cliTool, executionMode: "cli" } as any,
    )) {
      chunks.push(chunk);
    }
    return {
      chunks,
      spawn: vi.mocked(cp.spawn),
      writeFile: vi.mocked(fsp.writeFile),
      writeCodexMcpConfigToml: vi.mocked(codexMod.writeCodexMcpConfigToml),
      ensureCodexAuthInHome: vi.mocked(codexMod.ensureCodexAuthInHome),
      fake,
    };
  }

  it("claude_cli: spawns `claude` with the exact pre-MX4 --mcp-config/-p args (BYTE-UNCHANGED)", async () => {
    const { spawn, writeFile, writeCodexMcpConfigToml, ensureCodexAuthInHome } =
      await runChat("claude_cli");

    // claude path is byte-unchanged: no codex CODEX_HOME provisioning at
    // all — neither the config.toml writer nor the MX-chatauth auth copy.
    expect(writeCodexMcpConfigToml).not.toHaveBeenCalled();
    expect(ensureCodexAuthInHome).not.toHaveBeenCalled();

    expect(spawn).toHaveBeenCalledTimes(1);
    const [binary, args] = spawn.mock.calls[0];
    expect(binary).toBe("claude");

    // Args: ["--mcp-config", <.json path>, "-p", <content>, "--output-format", "text"]
    expect(args[0]).toBe("--mcp-config");
    expect(typeof args[1]).toBe("string");
    expect(args[1]).toMatch(/\.json$/);
    expect(args[2]).toBe("-p");
    // content (possibly shell-escaped on win32); assert it carries the message
    expect(String(args[3])).toContain("hello world");
    expect(args[4]).toBe("--output-format");
    expect(args[5]).toBe("text");
    expect(args).toHaveLength(6);
    expect(args).not.toContain("exec");

    // claude path writes the {mcpServers:{aoa}} wrapper JSON to a tmp file.
    expect(writeFile).toHaveBeenCalledTimes(1);
    const [jsonPath, jsonBody] = writeFile.mock.calls[0];
    expect(String(jsonPath)).toMatch(/\.json$/);
    const parsed = JSON.parse(String(jsonBody));
    expect(parsed.mcpServers.aoa.command).toBe("node");
  });

  it("codex: provisions managed CODEX_HOME via MX3 helper and spawns `codex exec --json` (no --mcp-config/-p)", async () => {
    const { spawn, writeCodexMcpConfigToml, ensureCodexAuthInHome } =
      await runChat("codex");

    // MX3 helper invoked with (dir, neutral spec).
    expect(writeCodexMcpConfigToml).toHaveBeenCalledTimes(1);
    const [codexDir, spec] = writeCodexMcpConfigToml.mock.calls[0];
    expect(typeof codexDir).toBe("string");
    expect(String(codexDir).length).toBeGreaterThan(0);

    // MX-chatauth: codex auth is provisioned into the SAME per-session
    // CODEX_HOME dir that the config.toml was written into, so `codex
    // exec` is authenticated (no 401).
    expect(ensureCodexAuthInHome).toHaveBeenCalledTimes(1);
    expect(ensureCodexAuthInHome.mock.calls[0][0]).toBe(codexDir);
    // Neutral {command,args,env} bridge spec (NOT the claude wrapper).
    expect(spec).toEqual(
      expect.objectContaining({
        command: "node",
        args: expect.any(Array),
        env: expect.objectContaining({
          AOA_SESSION_COMPANY_ID: "comp1",
          AOA_SESSION_USER_ID: "user1",
          AOA_SESSION_USER_ROLE: "founder",
        }),
      }),
    );
    expect((spec as any).mcpServers).toBeUndefined();

    expect(spawn).toHaveBeenCalledTimes(1);
    const [binary, args, opts] = spawn.mock.calls[0];
    expect(binary).toBe("codex");
    expect(args[0]).toBe("exec");
    expect(args[1]).toBe("--json");
    expect(args).not.toContain("--mcp-config");
    expect(args).not.toContain("-p");

    // Spawn env carries CODEX_HOME = the managed dir, merged over process.env.
    expect((opts as any)?.env?.CODEX_HOME).toBe(codexDir);
  });

  it("opencode: emits an explicit 'not yet supported' error and never spawns", async () => {
    const { chunks, spawn } = await runChat("opencode");

    expect(spawn).not.toHaveBeenCalled();
    const err = chunks.find((c) => c.type === "error");
    expect(err).toBeDefined();
    expect(err.message).toContain("not yet supported");
  });
});

// ── MX-chatparse: per-CLI JSONL parsing + one-shot/resume session ───────────
//
// Live §17 verification found the codex Commander chat invoked correctly
// (MX4) but rendering NOTHING:
//  1. parseLine treated codex's `exec --json` JSONL events as raw text →
//     the SSE stream got garbage JSON, no assistant message.
//  2. The persistent-process session model broke codex's one-shot
//     `codex exec` on multi-turn (turn-2 found stdin closed).
//
// Required per-CLI behavior:
//  - claude_cli : UNCHANGED. Persistent process; turn-1 spawns with `-p`
//                 argv; subsequent turns pipe stdin to the SAME process;
//                 plain-text accumulation via the parseCliOutput stub;
//                 `done` event unchanged.
//  - codex      : parse the full turn stdout via parseCodexJsonl on process
//                 exit (codex exec is one-shot — exit = turn end). Yielded
//                 chat text == parsed `summary` (NOT raw JSON). Store the
//                 codex `sessionId`, NOT a long-lived process. Turn-N spawns
//                 a FRESH `codex exec --json [flags] resume <id> -`.
//                 isCodexUnknownSessionError on a resume → retry fresh (no
//                 `resume`). turn.failed/error → an {type:"error"} chunk.

describe("cliModeService.chat — codex JSONL parse + one-shot/resume (MX-chatparse)", () => {
  // A fake one-shot process: emits its preset stdout/stderr once the chat
  // attaches listeners, then exits with the preset code (mirrors `codex
  // exec`, which runs the turn and exits). Multiple spawns in a turn-chain
  // are served from a queue so turn-2 (resume) gets its own stdout fixture.
  function makeOneShotProcess(opts: {
    stdout: string;
    stderr?: string;
    exitCode?: number;
  }) {
    const proc: any = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { writable: true, write: vi.fn(), end: vi.fn() };
    proc.kill = vi.fn();
    let driven = false;
    const drive = () => {
      if (driven) return;
      driven = true;
      setImmediate(() => {
        if (opts.stdout) proc.stdout.emit("data", Buffer.from(opts.stdout));
        if (opts.stderr) proc.stderr.emit("data", Buffer.from(opts.stderr));
        proc.emit("exit", opts.exitCode ?? 0, null);
      });
    };
    proc.stdout.on("newListener", drive);
    proc.on("newListener", (ev: string) => {
      if (ev === "exit") drive();
    });
    return proc;
  }

  // A claude-style persistent process: never exits on its own; emits
  // plain-text stdout for whatever turn is currently streaming. Each
  // `feed(text)` schedules one stdout burst (no exit) so multi-turn
  // stdin-piping stays on the SAME process.
  function makePersistentProcess() {
    const proc: any = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { writable: true, write: vi.fn() };
    proc.kill = vi.fn();
    proc.feed = (text: string) => {
      setImmediate(() => proc.stdout.emit("data", Buffer.from(text)));
    };
    return proc;
  }

  const CODEX_TURN1_JSONL = [
    JSON.stringify({ type: "thread.started", thread_id: "codex-sess-aaa" }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Hello from codex turn one." },
    }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } }),
  ].join("\n");

  const CODEX_TURN2_JSONL = [
    JSON.stringify({ type: "thread.started", thread_id: "codex-sess-bbb" }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Follow-up answer from codex." },
    }),
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 4, output_tokens: 2 } }),
  ].join("\n");

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // vi.clearAllMocks() clears mock.calls but NOT a queued
    // mockReturnValueOnce implementation chain. Reset spawn's
    // implementation so a prior test's per-turn process queue cannot
    // bleed into the next test (the codex resume/unknown-session tests
    // use mockReturnValueOnce).
    const cp = await import("node:child_process");
    vi.mocked(cp.spawn).mockReset();
    vi.mocked(cp.execSync).mockReset();
  });

  async function drainChat(
    service: any,
    cliTool: string,
    content: string,
  ): Promise<any[]> {
    const chunks: any[] = [];
    for await (const chunk of service.chat(
      {
        companyId: "comp1",
        userId: "user1",
        userRole: "founder",
        content,
        enabledCapabilities: [],
      } as any,
      { cliTool, executionMode: "cli" } as any,
    )) {
      chunks.push(chunk);
    }
    return chunks;
  }

  it("codex turn-1: yields the parsed summary (NOT raw JSON), stores the sessionId, emits done after exit, and writes the per-session CODEX_HOME config.toml", async () => {
    const cp = await import("node:child_process");
    vi.mocked(cp.execSync).mockReturnValue("/usr/local/bin/codex\n" as any);
    const proc = makeOneShotProcess({ stdout: CODEX_TURN1_JSONL });
    vi.mocked(cp.spawn).mockReturnValue(proc as any);
    const codexMod = await import("@armyofagents/adapter-codex-local/server");
    const expectedSummary = "Hello from codex turn one.";

    const { cliModeService } = await import(
      "../services/internal-agent/cli-mode.js"
    );
    const service = cliModeService({} as any);
    const chunks = await drainChat(service, "codex", "hi codex");

    // Assistant text == parsed summary, NOT the raw JSONL.
    const text = chunks
      .filter((c) => c.type === "text")
      .map((c) => c.delta)
      .join("");
    expect(text).toContain(expectedSummary);
    expect(text).not.toContain("thread.started");
    expect(text).not.toContain("agent_message");
    expect(text).not.toContain('"type"');

    // done emitted (after the one-shot process exits).
    expect(chunks.some((c) => c.type === "done")).toBe(true);
    expect(chunks.some((c) => c.type === "error")).toBe(false);

    // The MX4 per-session CODEX_HOME config.toml write still happens.
    expect(vi.mocked(codexMod.writeCodexMcpConfigToml)).toHaveBeenCalledTimes(1);

    // The codex sessionId from the fixture is stored on the session.
    const stored = service.getSessionStore().get("comp1:user1");
    expect(stored).toBeDefined();
    expect(stored.codexSessionId).toBe("codex-sess-aaa");
  });

  it("codex turn-2: a follow-up on the same session spawns a FRESH `codex exec --json … resume <storedId> -` and refreshes the stored sessionId", async () => {
    const cp = await import("node:child_process");
    vi.mocked(cp.execSync).mockReturnValue("/usr/local/bin/codex\n" as any);
    const proc1 = makeOneShotProcess({ stdout: CODEX_TURN1_JSONL });
    const proc2 = makeOneShotProcess({ stdout: CODEX_TURN2_JSONL });
    vi.mocked(cp.spawn)
      .mockReturnValueOnce(proc1 as any)
      .mockReturnValueOnce(proc2 as any);

    const { cliModeService } = await import(
      "../services/internal-agent/cli-mode.js"
    );
    const service = cliModeService({} as any);

    await drainChat(service, "codex", "first message");
    const afterT1 = service.getSessionStore().get("comp1:user1");
    expect(afterT1.codexSessionId).toBe("codex-sess-aaa");

    const chunks2 = await drainChat(service, "codex", "second message");

    // A fresh process was spawned for turn-2 (one-shot model).
    expect(vi.mocked(cp.spawn)).toHaveBeenCalledTimes(2);
    const [binary, args] = vi.mocked(cp.spawn).mock.calls[1];
    expect(binary).toBe("codex");
    expect(args[0]).toBe("exec");
    expect(args[1]).toBe("--json");
    // Continuation argv carries `resume <storedSessionId>` and the `-`
    // stdin-prompt sentinel.
    const resumeIdx = (args as string[]).indexOf("resume");
    expect(resumeIdx).toBeGreaterThan(-1);
    expect(args[resumeIdx + 1]).toBe("codex-sess-aaa");
    expect((args as string[])[args.length - 1]).toBe("-");

    // Turn-2 text == turn-2 summary; sessionId refreshed from the new parse.
    const text2 = chunks2
      .filter((c) => c.type === "text")
      .map((c) => c.delta)
      .join("");
    expect(text2).toContain("Follow-up answer from codex.");
    const afterT2 = service.getSessionStore().get("comp1:user1");
    expect(afterT2.codexSessionId).toBe("codex-sess-bbb");
  });

  it("codex unknown-session: a resume whose output matches isCodexUnknownSessionError retries FRESH (no `resume`), no hang, no 'CLI session ended'", async () => {
    const cp = await import("node:child_process");
    vi.mocked(cp.execSync).mockReturnValue("/usr/local/bin/codex\n" as any);

    const proc1 = makeOneShotProcess({ stdout: CODEX_TURN1_JSONL });
    // Turn-2 resume attempt fails with an unknown-session signal.
    const proc2 = makeOneShotProcess({
      stdout: "",
      stderr: "Error: unknown session codex-sess-aaa",
      exitCode: 1,
    });
    // Fresh retry succeeds.
    const proc3 = makeOneShotProcess({ stdout: CODEX_TURN2_JSONL });
    vi.mocked(cp.spawn)
      .mockReturnValueOnce(proc1 as any)
      .mockReturnValueOnce(proc2 as any)
      .mockReturnValueOnce(proc3 as any);

    const { cliModeService } = await import(
      "../services/internal-agent/cli-mode.js"
    );
    const service = cliModeService({} as any);

    await drainChat(service, "codex", "first message");
    const chunks2 = await drainChat(service, "codex", "second message");

    // 3 spawns total: t1, failed resume, fresh retry.
    expect(vi.mocked(cp.spawn)).toHaveBeenCalledTimes(3);
    const retryArgs = vi.mocked(cp.spawn).mock.calls[2][1] as string[];
    expect(retryArgs).not.toContain("resume");
    expect(retryArgs[retryArgs.length - 1]).toBe("-");

    // No spurious "CLI session ended" error; the retry's summary is yielded.
    const errs = chunks2.filter((c) => c.type === "error");
    expect(errs.some((e) => /CLI session ended/i.test(e.message))).toBe(false);
    const text2 = chunks2
      .filter((c) => c.type === "text")
      .map((c) => c.delta)
      .join("");
    expect(text2).toContain("Follow-up answer from codex.");
    // sessionId refreshed from the successful fresh retry.
    expect(service.getSessionStore().get("comp1:user1").codexSessionId).toBe(
      "codex-sess-bbb",
    );
  });

  it("codex error: a turn.failed / error event yields an {type:'error'} chunk (not silent, not raw JSON)", async () => {
    const cp = await import("node:child_process");
    vi.mocked(cp.execSync).mockReturnValue("/usr/local/bin/codex\n" as any);
    const failJsonl = [
      JSON.stringify({ type: "thread.started", thread_id: "codex-sess-err" }),
      JSON.stringify({
        type: "turn.failed",
        error: { message: "codex model exploded" },
      }),
    ].join("\n");
    const proc = makeOneShotProcess({ stdout: failJsonl, exitCode: 1 });
    vi.mocked(cp.spawn).mockReturnValue(proc as any);

    const { cliModeService } = await import(
      "../services/internal-agent/cli-mode.js"
    );
    const service = cliModeService({} as any);
    const chunks = await drainChat(service, "codex", "make it fail");

    const err = chunks.find((c) => c.type === "error");
    expect(err).toBeDefined();
    expect(err.message).toContain("codex model exploded");
    // The error text is not raw JSONL leaking through as "text".
    const text = chunks
      .filter((c) => c.type === "text")
      .map((c) => c.delta)
      .join("");
    expect(text).not.toContain("turn.failed");
    expect(text).not.toContain('"type"');
  });

  it("claude_cli stays UNCHANGED: persistent-process spawn + `-p` argv (prompt NOT on stdin) + plain-text accumulation + done shape; no codex sessionId", async () => {
    const cp = await import("node:child_process");
    vi.mocked(cp.execSync).mockReturnValue("/usr/local/bin/claude\n" as any);
    // Persistent claude process: streamProcessOutput attaches its listeners
    // lazily; on attach we feed plain text then emit exit so the turn's
    // for-await completes (claude's `--output-format text` prints plain
    // text, NOT JSONL). The persistent-vs-one-shot distinction is proven
    // by the codex tests (which show a FRESH re-spawn per turn); claude
    // must keep the pre-MX-chatparse persistent-process + `-p` argv shape.
    const persistent = makePersistentProcess();
    vi.mocked(cp.spawn).mockReturnValue(persistent as any);
    const fsp = await import("node:fs/promises");

    const { cliModeService } = await import(
      "../services/internal-agent/cli-mode.js"
    );
    const service = cliModeService({} as any);

    let attached = false;
    persistent.stdout.on("newListener", () => {
      if (attached) return;
      attached = true;
      setImmediate(() => {
        persistent.stdout.emit("data", Buffer.from("claude turn one text"));
        persistent.emit("exit", 0, null);
      });
    });

    const chunks1 = await drainChat(service, "claude_cli", "first");

    // Persistent process: claude takes the prompt in `-p` argv and is NOT
    // written to stdin on turn-1.
    expect(persistent.stdin.write).not.toHaveBeenCalled();
    expect(vi.mocked(cp.spawn)).toHaveBeenCalledTimes(1);
    const [binary, args] = vi.mocked(cp.spawn).mock.calls[0];
    expect(binary).toBe("claude");
    expect(args).toEqual([
      "--mcp-config",
      expect.stringMatching(/\.json$/),
      "-p",
      expect.stringContaining("first"),
      "--output-format",
      "text",
    ]);
    // Plain-text accumulation (the parseCliOutput stub), NOT JSONL parsing.
    const text1 = chunks1
      .filter((c) => c.type === "text")
      .map((c) => c.delta)
      .join("");
    expect(text1).toContain("claude turn one text");
    // done shape unchanged.
    const done1 = chunks1.find((c) => c.type === "done");
    expect(done1).toBeDefined();
    expect(done1.summary).toEqual({
      runId: "",
      toolsCalled: [],
      durationMs: 0,
      costCents: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
    });

    // claude must NOT acquire a codex sessionId.
    expect(
      service.getSessionStore().get("comp1:user1")?.codexSessionId,
    ).toBeUndefined();

    // claude writes exactly the {mcpServers:{aoa}} wrapper JSON once.
    expect(vi.mocked(fsp.writeFile)).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(String(vi.mocked(fsp.writeFile).mock.calls[0][1]));
    expect(parsed.mcpServers.aoa.command).toBe("node");
  });
});
