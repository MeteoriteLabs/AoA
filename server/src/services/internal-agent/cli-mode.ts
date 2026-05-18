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
  /** D2: kind of the calling agent ('aoa' triggers tool allowlist gate) */
  agentKind?: string;
  /** D2: explicit tool allowlist for AoA agents (comma-separated when passed via env) */
  toolAllowlist?: readonly string[];
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

/**
 * Provider-neutral inner MCP server spec ({command,args,env}). This shape is
 * already provider-agnostic; later milestones reuse it to wire codex/opencode
 * MCP bridges without going through claude's mcpServers.aoa envelope.
 */
export interface McpBridgeSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Build the provider-neutral MCP bridge spec. The env construction is the
 * canonical AoA bridge contract (session identity + capability gate + D2
 * tool allowlist + DATABASE_URL inheritance). buildMcpConfig wraps this in
 * the claude-shaped {mcpServers:{aoa:...}} envelope.
 */
export function buildMcpBridgeSpec(params: McpConfigParams): McpBridgeSpec {
  return {
    command: "node",
    args: [params.bridgeEntrypoint],
    env: {
      AOA_SESSION_COMPANY_ID: params.companyId,
      AOA_SESSION_USER_ID: params.userId,
      AOA_SESSION_USER_ROLE: params.userRole,
      // C13: thread capability set into the bridge so executeTool can
      // gate on it. Comma-separated; bridge parses on the other side.
      AOA_SESSION_ENABLED_CAPABILITIES: params.enabledCapabilities.join(","),
      // D2: per-agent tool allowlist for AoA agents. agentKind='aoa'
      // activates default-deny; toolAllowlist is the explicit permit set.
      ...(params.agentKind ? { AOA_AGENT_KIND: params.agentKind } : {}),
      ...(params.toolAllowlist && params.toolAllowlist.length > 0
        ? { AOA_TOOL_ALLOWLIST: params.toolAllowlist.join(",") }
        : {}),
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
    },
  };
}

export function buildMcpConfig(params: McpConfigParams): McpConfig {
  return {
    mcpServers: {
      aoa: buildMcpBridgeSpec(params),
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

/**
 * Result of resolving a CLI's chat invocation. Each provider gets its OWN
 * correct wiring: binary + argv + pre-spawn side effects (writing the MCP
 * config in the shape that provider's CLI actually reads) + any extra spawn
 * env. `mcpArtifactPath` is the per-session temp artifact recorded on the
 * session so the existing lifecycle cleanup (cli-session-store.killSession →
 * unlink) reaps it, mirroring the pre-MX4 claude behavior.
 */
interface CliInvocation {
  binary: string;
  args: string[];
  /** Extra env merged over process.env at spawn time (e.g. CODEX_HOME). */
  spawnEnv?: Record<string, string>;
  /** Primary temp artifact to record as session.mcpConfigPath for cleanup. */
  mcpArtifactPath: string;
}

/**
 * Per-CLI chat invocation translator. claude_cli is kept BYTE-IDENTICAL to
 * pre-MX4 (write the {mcpServers:{aoa}} wrapper JSON, spawn `claude
 * --mcp-config <json> -p <msg> --output-format text`). codex gets a correct
 * `codex exec --json -` invocation: codex has no --mcp-config flag and reads
 * `-p` as --profile, so the bridge is delivered via a per-session managed
 * CODEX_HOME/config.toml ([mcp_servers.aoa]) written by the MX3 helper, and
 * the prompt is streamed over stdin (the `-` PROMPT arg) — matching the
 * chat's persistent stdin-piping multi-turn model. opencode's real form
 * (`opencode run …` + its own MCP config) is not yet wired; returning null
 * makes the caller emit an explicit "not yet supported" error instead of
 * spawning a broken `opencode --mcp-config -p` process.
 *
 * Returns null for an unsupported CLI (caller emits the error).
 */
async function resolveCliInvocation(
  cliTool: string,
  params: McpConfigParams,
  safeContent: string,
): Promise<CliInvocation | null> {
  switch (cliTool) {
    case "claude_cli": {
      // BYTE-UNCHANGED from pre-MX4: claude {mcpServers:{aoa:spec}} wrapper
      // written to a tmp .json, passed via --mcp-config.
      const mcpConfig = buildMcpConfig(params);
      const configPath = join(
        tmpdir(),
        `aoa-mcp-${`${params.companyId}:${params.userId}`.replace(":", "-")}.json`,
      );
      await writeFile(configPath, JSON.stringify(mcpConfig, null, 2));
      return {
        binary: "claude",
        args: ["--mcp-config", configPath, "-p", safeContent, "--output-format", "text"],
        mcpArtifactPath: configPath,
      };
    }
    case "codex": {
      // codex discovers MCP from $CODEX_HOME/config.toml [mcp_servers.<name>];
      // it has no --mcp-config flag and treats -p as --profile. Provision a
      // per-session managed CODEX_HOME and write the neutral bridge spec
      // there via the MX3 writer. Prompt is delivered over stdin: `codex
      // exec --json -` reads instructions from stdin (matches the chat's
      // persistent stdin-piping model for multi-turn).
      const { writeCodexMcpConfigToml } = await import(
        "@armyofagents/adapter-codex-local/server"
      );
      const codexHomeDir = join(
        tmpdir(),
        `aoa-codex-chat-${`${params.companyId}:${params.userId}`.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
      );
      await writeCodexMcpConfigToml(codexHomeDir, buildMcpBridgeSpec(params));
      return {
        binary: "codex",
        args: ["exec", "--json", "-"],
        spawnEnv: { CODEX_HOME: codexHomeDir },
        // Record the config.toml so the existing best-effort unlink cleanup
        // (cli-session-store.killSession) reaps the primary artifact, the
        // same way it reaps claude's tmp .json. Parity, no new machinery.
        mcpArtifactPath: join(codexHomeDir, "config.toml"),
      };
    }
    default:
      // opencode (and any future/unknown tool): not yet wired.
      return null;
  }
}

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

          // Per-CLI wiring: each provider gets its OWN correct invocation.
          // claude_cli stays BYTE-IDENTICAL (mcpServers wrapper JSON +
          // --mcp-config/-p); codex uses `codex exec --json -` with the
          // bridge delivered via a managed CODEX_HOME/config.toml; opencode
          // is not yet wired → explicit error (no broken spawn).
          const invocation = await resolveCliInvocation(
            config.cliTool,
            {
              companyId: params.companyId,
              userId: params.userId,
              userRole: params.userRole,
              enabledCapabilities: params.enabledCapabilities,
              bridgeEntrypoint: bridgePath,
            },
            safeContent,
          );
          if (!invocation) {
            yield {
              type: "error",
              message:
                "opencode is not yet supported for the Commander chat (MCP wiring pending — MX-followup). Use claude or codex.",
            };
            return;
          }

          const cliProcess = spawn(invocation.binary, invocation.args, {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, ...invocation.spawnEnv },
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
            mcpConfigPath: invocation.mcpArtifactPath,
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

          // codex receives its prompt over stdin (the `-` PROMPT arg →
          // instructions read from stdin), matching the chat's persistent
          // stdin-piping multi-turn model. claude takes the prompt in argv
          // (`-p <msg>`) and is NOT written to here — pre-MX4 behavior.
          if (config.cliTool === "codex" && cliProcess.stdin?.writable) {
            cliProcess.stdin.write(params.content + "\n");
          }

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
