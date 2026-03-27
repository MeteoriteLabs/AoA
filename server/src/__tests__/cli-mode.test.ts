import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

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
    expect(result.error).toContain("API mode");
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
      bridgeEntrypoint: "/app/dist/mcp-bridge.js",
    });

    expect(config.mcpServers).toBeDefined();
    expect(config.mcpServers.aoa).toBeDefined();
    expect(config.mcpServers.aoa.command).toBe("node");
    expect(config.mcpServers.aoa.args).toContain("/app/dist/mcp-bridge.js");
    expect(config.mcpServers.aoa.env.AOA_SESSION_COMPANY_ID).toBe("comp1");
    expect(config.mcpServers.aoa.env.AOA_SESSION_USER_ID).toBe("user1");
    expect(config.mcpServers.aoa.env.AOA_SESSION_USER_ROLE).toBe("founder");
  });

  it("inherits DATABASE_URL from process.env", () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://test:5432/db";
    const config = buildMcpConfig({
      companyId: "c",
      userId: "u",
      userRole: "founder",
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
