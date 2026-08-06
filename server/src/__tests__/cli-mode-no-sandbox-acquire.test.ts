// FIX 2 (Wave 2 adversarial review, MEDIUM/LOW — dead sandbox acquire): U4 had
// added `acquireExecutionContext` calls in Commander's codex branch (cli-mode.ts,
// the `config.cliTool === "codex"` branch) and claude branch (the `!session`
// first-message branch), but Commander's spawn was never rerouted through the
// sandbox (deferred — a persistent-session decision is pending). The acquired
// lease was consumed by nothing (`acquired`/`claudeAcquired` had no downstream
// reader), never fed `mcpParams.brokered`, and — worse — was never released,
// so every cloud Commander turn leaked an orphaned E2B VM for zero benefit.
//
// Fix: both dead acquire calls (and their `acquired`/`claudeAcquired`
// bindings) were deleted from cli-mode.ts, along with the now-unused
// `acquireExecutionContext` import.
//
// This suite proves the negative directly: it drives a REAL Commander turn
// (mirrors cli-mode.test.ts's own `runChat` harness — same mocks, same
// dynamic-import-after-vi.resetModules pattern) through `cliModeService.chat`
// for BOTH the claude_cli and codex branches, with `acquireExecutionContext`
// mocked to a spy, and asserts the spy is called ZERO times. Before this fix,
// this test would have failed (the spy would have recorded exactly one call
// per turn on each branch).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

// Simulate production layout: mcp-bridge.js exists → command = 'node' (not 'tsx').
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, statSync: vi.fn() }; // never throws → .js "exists"
});

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
}));

vi.mock("@armyofagents/adapter-codex-local/server", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@armyofagents/adapter-codex-local/server")
  >();
  return {
    ...actual,
    writeCodexMcpConfigToml: vi.fn(async () => {}),
    ensureCodexAuthInHome: vi.fn(async () => true),
    readSharedCodexModel: vi.fn(async () => null),
  };
});

vi.mock("../services/mcp-connectors-loader.js", () => ({
  resolveAgentConnectors: vi.fn(async () => ({ extraMcpServers: {}, connectorEnv: {} })),
}));

// FIX 2: the seam under test. If cli-mode.ts still called
// acquireExecutionContext anywhere on the Commander turn path, this spy would
// record it.
const acquireExecutionContextMock = vi.fn().mockResolvedValue({ sandbox: null, lease: null, warmResolved: false });
vi.mock("../services/acquire-execution-context.js", () => ({
  acquireExecutionContext: acquireExecutionContextMock,
}));

function makeFakeProcess() {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { writable: true, write: vi.fn(), end: vi.fn(), on: vi.fn() };
  proc.kill = vi.fn();
  let driven = false;
  const drive = () => {
    if (driven) return;
    driven = true;
    setImmediate(() => {
      proc.stdout.emit("data", Buffer.from("ok"));
      proc.emit("exit", 0, null);
      proc.emit("close", 0, null);
    });
  };
  proc.stdout.on("newListener", drive);
  proc.on("newListener", (ev: string) => {
    if (ev === "exit") drive();
  });
  return proc;
}

async function runChat(cliTool: string, configOverrides: Record<string, unknown> = {}) {
  const cp = await import("node:child_process");
  vi.mocked(cp.execSync).mockReturnValue(`/usr/local/bin/x\n` as any);
  const fake = makeFakeProcess();
  vi.mocked(cp.spawn).mockReturnValue(fake as any);

  const { cliModeService } = await import("../services/internal-agent/cli-mode.js");
  const service = cliModeService({} as any);
  const chunks: any[] = [];
  for await (const chunk of service.chat(
    {
      companyId: "comp1",
      userId: "user1",
      userRole: "founder",
      content: "hello world",
      enabledCapabilities: [],
      conversationId: "conversation-a",
    } as any,
    { cliTool, executionMode: "cli", ...configOverrides } as any,
  )) {
    chunks.push(chunk);
  }
  return { chunks, spawn: vi.mocked(cp.spawn) };
}

describe("FIX 2: Commander turns never call acquireExecutionContext (dead sandbox acquire removed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    acquireExecutionContextMock.mockClear();
  });

  it("claude_cli: a full Commander turn spawns the CLI without ever calling acquireExecutionContext", async () => {
    const { spawn } = await runChat("claude_cli");

    // Sanity: the turn actually ran the real spawn path (not an early bail).
    expect(spawn).toHaveBeenCalledTimes(1);

    // FIX 2's core assertion: zero sandbox-lease acquire calls on the
    // Commander path.
    expect(acquireExecutionContextMock).not.toHaveBeenCalled();
  });

  it("codex: a full Commander turn provisions CODEX_HOME + spawns codex exec without ever calling acquireExecutionContext", async () => {
    const { spawn } = await runChat("codex");

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(acquireExecutionContextMock).not.toHaveBeenCalled();
  });
});
