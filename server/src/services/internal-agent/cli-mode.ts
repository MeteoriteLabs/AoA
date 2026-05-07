import { execSync, spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "@armyofagents/db";
import type { AgentTool } from "./types.js";
import type { AgentStreamChunk, ChatInput } from "./agent-loop.js";
import { createCLISessionStore } from "./cli-session-store.js";
import type { CLISession } from "./cli-session-store.js";

// ── CLI Detection ─────────────────────────────────────────────────────────────

// Maps config values (from DB/constants) to binary names
const CLI_BINARY_MAP: Record<string, string> = {
  claude_cli: "claude",
  codex: "codex",
  opencode: "opencode",
};

export interface CLIDetectionResult {
  available: boolean;
  path?: string;
  error?: string;
}

export async function detectCliTool(tool: string): Promise<CLIDetectionResult> {
  const binary = CLI_BINARY_MAP[tool];
  if (!binary) {
    return {
      available: false,
      error: `Unsupported CLI tool: '${tool}'. Supported: ${Object.keys(CLI_BINARY_MAP).join(", ")}`,
    };
  }

  const cmd = platform() === "win32" ? `where ${binary}` : `which ${binary}`;

  try {
    const result = execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim();
    const firstLine = result.split("\n")[0].trim();
    return { available: true, path: firstLine };
  } catch {
    return {
      available: false,
      error: `CLI tool '${tool}' (binary: '${binary}') not found in PATH. Install the CLI and ensure it's on your PATH, then try again.`,
    };
  }
}

// ── MCP Config Builder ────────────────────────────────────────────────────────

interface McpConfigParams {
  companyId: string;
  userId: string;
  userRole: string;
  enabledCapabilities: readonly string[];
  bridgeEntrypoint: string;
}

interface McpConfig {
  mcpServers: {
    aoa: {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
  };
}

export function buildMcpConfig(params: McpConfigParams): McpConfig {
  return {
    mcpServers: {
      aoa: {
        command: "node",
        args: [params.bridgeEntrypoint],
        env: {
          AOA_SESSION_COMPANY_ID: params.companyId,
          AOA_SESSION_USER_ID: params.userId,
          AOA_SESSION_USER_ROLE: params.userRole,
          // C13: thread capability set into the bridge so executeTool can
          // gate on it. Comma-separated; bridge parses on the other side.
          AOA_SESSION_ENABLED_CAPABILITIES: params.enabledCapabilities.join(","),
          ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
        },
      },
    },
  };
}

export function toolToMcpFormat(tool: AgentTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  };
}

// ── Output Parsing ────────────────────────────────────────────────────────────

// Initial implementation: all stdout is treated as text content.
export function parseCliOutput(line: string): AgentStreamChunk[] {
  return [{ type: "text", delta: line }];
}

// ── Constants ───────────────────────────────────────────────────────────────

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const IDLE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 min

const CLI_SPAWN_ARGS: Record<string, (mcpConfigPath: string, message: string) => string[]> = {
  claude_cli: (mcp, msg) => ["--mcp-config", mcp, "-p", msg, "--output-format", "text"],
  codex: (mcp, msg) => ["--mcp-config", mcp, "-p", msg],
  opencode: (mcp, msg) => ["--mcp-config", mcp, "-p", msg],
};

// ── Service ─────────────────────────────────────────────────────────────────

export function cliModeService(db: Db) {
  const sessionStore = createCLISessionStore();

  // Idle timeout sweep
  const idleTimer = setInterval(() => {
    const stale = sessionStore.getStale(IDLE_TIMEOUT_MS);
    for (const key of stale) {
      sessionStore.cleanup(key);
    }
  }, IDLE_CHECK_INTERVAL_MS);

  // Unref so it doesn't prevent process exit
  if (idleTimer.unref) idleTimer.unref();

  function getBridgeEntrypoint(): string {
    const thisDir = typeof __dirname !== "undefined"
      ? __dirname
      : fileURLToPath(new URL(".", import.meta.url));
    return resolve(thisDir, "mcp-bridge.js");
  }

  return {
    async *chat(
      params: ChatInput,
      config: { cliTool: string | null; executionMode: string },
    ): AsyncGenerator<AgentStreamChunk> {
      // 1. Validate CLI tool config
      if (!config.cliTool) {
        yield {
          type: "error",
          message: "No CLI tool configured. Go to Settings → Commander and select a CLI tool (claude, codex, or opencode).",
        };
        return;
      }

      // 2. Detect CLI availability
      const detection = await detectCliTool(config.cliTool);
      if (!detection.available) {
        yield { type: "error", message: detection.error! };
        return;
      }

      const sessionKey = `${params.companyId}:${params.userId}`;
      let session = sessionStore.get(sessionKey);
      let accumulatedText = "";

      try {
        if (!session) {
          // 3. First message — spawn new session
          const bridgePath = getBridgeEntrypoint();
          const mcpConfig = buildMcpConfig({
            companyId: params.companyId,
            userId: params.userId,
            userRole: params.userRole,
            enabledCapabilities: params.enabledCapabilities,
            bridgeEntrypoint: bridgePath,
          });

          const configPath = join(tmpdir(), `aoa-mcp-${sessionKey.replace(":", "-")}.json`);
          await writeFile(configPath, JSON.stringify(mcpConfig, null, 2));

          const binary = CLI_BINARY_MAP[config.cliTool];
          const argsBuilder = CLI_SPAWN_ARGS[config.cliTool];
          if (!binary || !argsBuilder) {
            yield { type: "error", message: `Unsupported CLI tool: ${config.cliTool}` };
            return;
          }

          // Windows note: CLI tools like `claude`, `codex`, `opencode` are
          // installed as .cmd wrappers. Node's `spawn` can only launch
          // .bat/.cmd files with `shell: true` (direct spawn raises
          // EINVAL). `shell: true` invokes cmd.exe which forwards args to
          // the shell — so user-controlled content (params.content) must
          // be escaped to prevent cmd injection. Other args (config path,
          // flag literals) come from constants and tmpdir, not user input.
          const isWin = platform() === "win32";
          const safeContent = isWin
            ? `"${params.content.replace(/"/g, '""').replace(/%/g, "%%").replace(/\^/g, "^^")}"`
            : params.content;
          const args = argsBuilder(configPath, safeContent);
          const cliProcess = spawn(binary, args, {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env },
            shell: isWin,
          });

          session = {
            cliProcess,
            mcpProcess: null,
            cliTool: config.cliTool as CLISession["cliTool"],
            companyId: params.companyId,
            userId: params.userId,
            userRole: params.userRole,
            startedAt: new Date(),
            lastMessageAt: new Date(),
            mcpConfigPath: configPath,
            status: "active",
            messageQueue: [],
            processing: true,
          };

          sessionStore.set(sessionKey, session);

          // Handle crash
          cliProcess.on("exit", () => {
            if (session?.status === "active") {
              sessionStore.delete(sessionKey);
            }
          });

          // Stream stdout — collect text for persistence
          for await (const chunk of streamProcessOutput(cliProcess)) {
            if (chunk.type === "text") accumulatedText += chunk.delta;
            yield chunk;
          }
        } else {
          // Subsequent message — pipe to existing process stdin
          session.lastMessageAt = new Date();
          if (session.cliProcess.stdin?.writable) {
            session.cliProcess.stdin.write(params.content + "\n");
            for await (const chunk of streamProcessOutput(session.cliProcess)) {
              if (chunk.type === "text") accumulatedText += chunk.delta;
              yield chunk;
            }
          } else {
            // Process stdin closed — session is dead, clean up
            sessionStore.cleanup(sessionKey);
            yield {
              type: "error",
              message: "CLI session ended unexpectedly. Please try again.",
            };
          }
        }

        // Done event
        yield {
          type: "done",
          summary: {
            runId: "",
            toolsCalled: [],
            durationMs: 0,
            costCents: 0,
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
          },
        };
      } catch (err: any) {
        sessionStore.cleanup(sessionKey);
        yield {
          type: "error",
          message: `CLI mode error: ${err?.message ?? "Unknown error"}`,
        };
      }
    },

    getSessionStore() {
      return sessionStore;
    },

    shutdown() {
      clearInterval(idleTimer);
      sessionStore.shutdownAll();
    },
  };
}

// ── Stream Helper ───────────────────────────────────────────────────────────

async function* streamProcessOutput(
  proc: import("node:child_process").ChildProcess,
): AsyncGenerator<AgentStreamChunk> {
  if (!proc.stdout) return;

  const pending: AgentStreamChunk[] = [];
  let done = false;
  let resolve: (() => void) | null = null;

  function notify() {
    if (resolve) { resolve(); resolve = null; }
  }

  proc.stdout.on("data", (data: Buffer) => {
    const text = data.toString();
    for (const chunk of parseCliOutput(text)) {
      pending.push(chunk);
    }
    notify();
  });

  proc.stderr?.on("data", () => {
    // Log stderr but don't stream to user
  });

  proc.on("exit", () => { done = true; notify(); });
  proc.on("error", () => { done = true; notify(); });

  while (true) {
    while (pending.length > 0) {
      yield pending.shift()!;
    }
    if (done) break;
    await new Promise<void>((r) => { resolve = r; });
  }
}
