import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
