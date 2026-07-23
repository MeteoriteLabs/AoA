import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "@armyofagents/db";
import type { HumanQuestionRuntimeCapabilities } from "@armyofagents/adapter-utils";
import type { AgentTool } from "./types.js";
import type { AgentStreamChunk, ChatInput } from "./agent-loop.js";
import { createCLISessionStore } from "./cli-session-store.js";
import type { CLISession } from "./cli-session-store.js";
import {
  normalizeCommanderContextScope,
  type NormalizedCommanderContextScope,
} from "./context-scope.js";
import { StreamJsonParser } from "./parse-stream-json.js";
import { COMMANDER_MAX_THINKING_TOKENS } from "./thinking-config.js";
import {
  resolveCodexChatModel,
  COMMANDER_CODEX_REASONING_EFFORT,
  SAFE_MODEL_RE,
} from "./codex-model.js";
import { logger } from "../../middleware/logger.js";
import { redactSecretsInString } from "../../redaction.js";

const require = createRequire(import.meta.url);

/** claude CLI: pass --model only for a shell-safe non-empty model; else nothing,
 *  so the default path's argv stays byte-identical. */
export function claudeModelArgs(model: string | null | undefined): string[] {
  const m = model?.trim() ?? "";
  return m && SAFE_MODEL_RE.test(m) ? ["--model", m] : [];
}

function normalizeCliContextScope(
  scope: ChatInput["contextScope"] | undefined,
): NormalizedCommanderContextScope | null {
  return scope ? normalizeCommanderContextScope({ contextScope: scope }) : null;
}

// ── Session ID Validation ─────────────────────────────────────────────────────

// Validate session IDs from external process output before using them as spawn args.
// On Windows, spawn uses shell:true so metacharacters in args execute as shell commands.
const SAFE_SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export function validateSessionId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return SAFE_SESSION_ID_RE.test(raw) ? raw : null;
}

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

export interface McpConfigParams {
  companyId: string;
  userId: string;
  userRole: string;
  enabledCapabilities: readonly string[];
  bridgeEntrypoint: string;
  /** D2: kind of the calling agent ('aoa' triggers tool allowlist gate) */
  agentKind?: string;
  /** D2: explicit tool allowlist for AoA agents (comma-separated when passed via env) */
  toolAllowlist?: readonly string[];
  /** Actor type threaded into the bridge: "commander" when spawned via Commander. */
  actorType?: string;
  /** Agent DB ID — set as AOA_AGENT_ID in the bridge so tools can stamp authorAgentId. */
  agentId?: string;
  runId?: string | null;
  humanQuestionCapabilities?: HumanQuestionRuntimeCapabilities;
  discussionRunMode?: "direct" | "controller_action_gate" | null;
  threadFreshness?: {
    startEpoch?: number;
    latestHumanSeq?: number;
    entrySeq?: number;
    latestScopeVersionId?: string | null;
    latestScopeVersionStatus?: string | null;
  } | null;
  /** Resolved effective autonomy (D10: threadLevel ?? companyLevel). Absent → bridge uses null. */
  effectiveAutonomy?: number | null;
  /** Normalized structured Commander scope for memory/tool policy. */
  contextScope?: NormalizedCommanderContextScope | null;
}

interface McpConfig {
  mcpServers: {
    aoa: {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
    playwright?: {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
  };
}

export const PLAYWRIGHT_MCP_PACKAGE = "@playwright/mcp@0.0.75";

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
 *
 * In dev mode (tsx, no compiled output) getBridgeEntrypoint returns a .ts
 * file. Plain `node` cannot execute TypeScript, so we use `tsx` as the
 * runner. In production the .js is used with plain node (unchanged behavior).
 */
export function buildMcpBridgeSpec(params: McpConfigParams): McpBridgeSpec {
  const isTsBridge = params.bridgeEntrypoint.endsWith(".ts");
  const tsxCliPath = isTsBridge
    ? join(dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs")
    : null;
  return {
    command: isTsBridge ? process.execPath : "node",
    args: isTsBridge && tsxCliPath
      ? [tsxCliPath, params.bridgeEntrypoint]
      : [params.bridgeEntrypoint],
    env: {
      // The bridge owns stdout for JSON-RPC frames. Force its pino logger to
      // stderr (see middleware/logger.ts) so a stray log (e.g. the embeddings
      // "OPENAI_API_KEY is not set" WARN fired by createServiceContainer at
      // bridge boot when the key is absent) can never land on stdout ahead of
      // the JSON-RPC initialize response and break the MCP client with
      // "Transport closed". Covers every codex/opencode/gemini bridge spawn.
      AOA_LOG_STDOUT: "0",
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
      ...(params.actorType ? { AOA_ACTOR_TYPE: params.actorType } : {}),
      ...(params.agentId ? { AOA_AGENT_ID: params.agentId } : {}),
      ...(params.runId ? { AOA_RUN_ID: params.runId } : {}),
      ...(params.humanQuestionCapabilities
        ? { AOA_HUMAN_QUESTION_CAPABILITIES: JSON.stringify(params.humanQuestionCapabilities) }
        : {}),
      ...(params.discussionRunMode ? { AOA_DISCUSSION_RUN_MODE: params.discussionRunMode } : {}),
      ...(params.threadFreshness ? { AOA_THREAD_FRESHNESS: JSON.stringify(params.threadFreshness) } : {}),
      ...(params.effectiveAutonomy != null
        ? { AOA_EFFECTIVE_AUTONOMY: String(params.effectiveAutonomy) }
        : {}),
      ...(params.contextScope
        ? { AOA_COMMANDER_CONTEXT_SCOPE: JSON.stringify(params.contextScope) }
        : {}),
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
    },
  };
}

export function buildMcpConfig(params: McpConfigParams): McpConfig {
  const config: McpConfig = {
    mcpServers: {
      aoa: buildMcpBridgeSpec(params),
    },
  };

  if (params.enabledCapabilities?.includes("browser_use")) {
    config.mcpServers.playwright = {
      command: "npx",
      args: [PLAYWRIGHT_MCP_PACKAGE, "--headless"],
      env: {},
    };
  }

  return config;
}

export function toolToMcpFormat(tool: AgentTool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  };
}

// ── Output Parsing ────────────────────────────────────────────────────────────

const CONFIRM_RE = /⚡CONFIRM:(.*?)⚡/;
const OPTIONS_RE = /⚡OPTIONS:(.*?)⚡/;

export function parseCliOutput(line: string): AgentStreamChunk[] {
  // OPTIONS marker — structured multiple-choice question
  const optMatch = line.match(OPTIONS_RE);
  if (optMatch) {
    try {
      const payload = JSON.parse(optMatch[1]) as {
        question?: string;
        options?: unknown;
      };
      if (
        typeof payload.question !== "string" || payload.question.trim() === "" ||
        !Array.isArray(payload.options) || payload.options.length === 0
      ) {
        throw new Error("invalid OPTIONS payload");
      }
      return [
        {
          type: "options_prompt",
          question: payload.question,
          options: payload.options as string[],
          promptId: crypto.randomUUID(),
        },
      ];
    } catch {
      // Malformed JSON or invalid payload — fall through to plain text
    }
  }

  // CONFIRM marker — action approval gate
  const confirmMatch = line.match(CONFIRM_RE);
  if (confirmMatch) {
    try {
      const payload = JSON.parse(confirmMatch[1]) as { toolName?: string; params?: unknown; confirmId?: string };
      if (typeof payload.toolName !== "string" || payload.toolName.length === 0) {
        // Missing or invalid toolName — treat as malformed marker
        throw new Error("missing toolName");
      }
      return [
        {
          type: "action_confirmation",
          toolName: payload.toolName,
          params: payload.params,
          runId: payload.confirmId ?? crypto.randomUUID(),
        },
      ];
    } catch {
      // Malformed JSON or missing toolName — fall through to plain text
    }
  }

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
  /** Resolved model actually used for this invocation (for provenance, not cost). */
  resolvedModel?: string;
  /**
   * RAW (UNESCAPED) user prompt to write to the child's stdin after spawn.
   * stdin does NOT pass through cmd.exe, so this is the unescaped content —
   * the Windows argv-positional path drops the prompt (cmd.exe mangling),
   * while stdin delivers it intact. The spawn block writes this then closes
   * stdin (claude `--print` is one-shot). Absent ⇒ nothing is written.
   */
  stdinPrompt?: string;
}

/**
 * Per-session managed CODEX_HOME directory. Single source of truth so the
 * codex invocation, the config.toml write, and the session's cleanup
 * `mcpConfigPath` all point at the SAME path (MX-chatparse).
 */
function codexHomeDirFor(companyId: string, userId: string): string {
  return join(
    tmpdir(),
    `aoa-codex-chat-${`${companyId}:${userId}`.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
  );
}

/** The config.toml inside the per-session managed CODEX_HOME. */
function codexConfigTomlPath(companyId: string, userId: string): string {
  return join(codexHomeDirFor(companyId, userId), "config.toml");
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
 *
 * `resumeCodexSessionId` (MX-chatparse): codex `exec` is ONE-SHOT — multi-
 * turn continuity is not a persistent process but a re-spawn with `resume
 * <sessionId> -` (mirrors the codex-local adapter convention). null/absent ⇒
 * a fresh turn-1 `codex exec --json -`. Ignored for non-codex CLIs.
 */
/**
 * C-systemsplit args for the claude_cli path.
 * rawSystemContext is written to a temp file and passed via --system-prompt-file
 * to avoid Windows cmd.exe newline-truncation of multi-line inline arg values.
 * rawContent is the RAW (unescaped) user message — delivered to claude over
 * stdin (W1 fix), never as a shell-escaped argv positional.
 */
interface SystemSplitArgs {
  /** Unescaped system context — written to a temp file, never passed inline. */
  rawSystemContext: string;
  /**
   * RAW (UNESCAPED) user message. Delivered to claude over stdin (which does
   * NOT pass through cmd.exe), so it must NOT be shell-escaped. On Windows the
   * argv-positional form silently dropped the prompt — stdin fixes that.
   */
  rawContent: string;
}

export async function resolveCliInvocation(
  cliTool: string,
  params: McpConfigParams,
  safeContent: string,
  resumeCodexSessionId?: string | null,
  // C-systemsplit: when provided, claude_cli uses --system + stdin split
  // instead of the legacy single -p path.  Strings carry raw (unescaped) user
  // text — claude's prompt is delivered over stdin, not argv.
  systemSplitArgs?: SystemSplitArgs,
  vendorCliBypassEnabled = true,
  codexModel?: string | null,
  // RAW (unescaped) user prompt for the claude plain (non-systemSplit) path.
  // Threaded from the caller (params.content). claude delivers the prompt over
  // stdin so it must be the raw text, never the cmd-escaped safeContent.
  rawContent?: string,
  // claude_cli Commander model (internal_agent_config.model). Emitted as a
  // shell-safe `--model <m>` only when set; null/empty keeps the argv
  // byte-identical to the pre-model default path. Threaded from chat(). Kept LAST
  // in the param list so existing positional callers passing `rawContent` are
  // unaffected (string is assignable to the prior commanderModel slot, so a
  // mid-list insert mis-bound rawContent without a typecheck error).
  commanderModel?: string | null,
): Promise<CliInvocation | null> {
  const isWin = platform() === "win32";
  const claudeBypassArgs = vendorCliBypassEnabled
    ? ["--dangerously-skip-permissions"]
    : [];
  const codexBypassArgs = vendorCliBypassEnabled
    ? ["--dangerously-bypass-approvals-and-sandbox"]
    : [];
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

      // C-systemsplit: when the assembled system context is available, pass it
      // via --system-prompt-file so the model treats it as its system prompt.
      // The raw user input goes over stdin (W1 fix).  This prevents the user's
      // global CLAUDE.md (which may carry gstack routing rules that cause the
      // model to echo skill text) from being applied to what would otherwise
      // look like instruction content inside a user message.  When
      // systemSplitArgs is absent (assembly failed or not applicable) we fall
      // back to the plain path — which also delivers the prompt over stdin.
      //
      // C-systemsplit (corrected): use --system-prompt-file (not inline --system-prompt)
      // to avoid Windows cmd.exe newline-truncation: the system context is multi-line
      // markdown and cmd.exe terminates the argument at the first embedded newline.
      // Writing to a temp file sidesteps the shell quoting problem entirely.
      if (systemSplitArgs) {
        const systemPromptPath = join(
          tmpdir(),
          `aoa-sysprompt-${`${params.companyId}:${params.userId}`.replace(":", "-")}.txt`,
        );
        await writeFile(systemPromptPath, systemSplitArgs.rawSystemContext, "utf8");
        const safeSystemPromptPath = isWin
          ? `"${systemPromptPath.replace(/"/g, '""')}"`
          : systemPromptPath;
        // W1 stdin fix: the user prompt is NO LONGER an argv positional. On
        // Windows the positional rode through cmd.exe and was silently dropped
        // (the "empty/garbage Commander turn" bug). It is delivered over stdin
        // (raw, unescaped) by the spawn block, which then closes stdin —
        // claude `--print` is one-shot. See keyless-cli-spike-findings.md.
        return {
          binary: "claude",
          args: [
            "--mcp-config", configPath,
            "--system-prompt-file", safeSystemPromptPath,
            ...claudeModelArgs(commanderModel),
            ...claudeBypassArgs,
            "--print",
            "--output-format", "stream-json",
            "--include-partial-messages",
            "--verbose",
          ],
          spawnEnv: { MAX_THINKING_TOKENS: String(COMMANDER_MAX_THINKING_TOKENS) },
          mcpArtifactPath: configPath,
          stdinPrompt: systemSplitArgs.rawContent,
        };
      }

      // W1 stdin fix (plain path): same as above — prompt over stdin, not argv.
      return {
        binary: "claude",
        args: [
          "--mcp-config", configPath,
          ...claudeModelArgs(commanderModel),
          ...claudeBypassArgs,
          "--print",
          "--output-format", "stream-json",
          "--include-partial-messages",
          "--verbose",
        ],
        spawnEnv: { MAX_THINKING_TOKENS: String(COMMANDER_MAX_THINKING_TOKENS) },
        mcpArtifactPath: configPath,
        // Prefer the explicit raw prompt; fall back to safeContent only if the
        // caller didn't thread rawContent (defensive — the chat caller always
        // passes it). safeContent may be win32-escaped, but on the non-win
        // path it equals the raw content anyway.
        stdinPrompt: rawContent ?? safeContent,
      };
    }
    case "codex": {
      // codex discovers MCP from $CODEX_HOME/config.toml [mcp_servers.<name>];
      // it has no --mcp-config flag and treats -p as --profile. Provision a
      // per-session managed CODEX_HOME and write the neutral bridge spec
      // there via the MX3 writer. Prompt is delivered over stdin: `codex
      // exec --json -` reads instructions from stdin (matches the chat's
      // persistent stdin-piping model for multi-turn).
      const { writeCodexMcpConfigToml, ensureCodexAuthInHome, readSharedCodexModel } =
        await import("@armyofagents/adapter-codex-local/server");
      const codexHomeDir = codexHomeDirFor(params.companyId, params.userId);
      await writeCodexMcpConfigToml(codexHomeDir, buildMcpBridgeSpec(params));
      // MX-chatauth: the per-session CODEX_HOME has config.toml but no
      // credentials, so `codex exec` run with it 401s ("Missing bearer or
      // basic authentication"). Provision auth.json into the SAME dir by
      // copying the user's shared ~/.codex/auth.json (no-op if absent).
      // Session-isolated: this home/config.toml encodes THIS chat
      // session's identity and must not be shared with the agent path.
      await ensureCodexAuthInHome(codexHomeDir);
      // MX-chatmodel: pin a subscription-supported model + effort. The
      // per-session CODEX_HOME has no `model` line, so without --model codex
      // falls back to its default (gpt-5.3-codex), which a ChatGPT-account
      // codex rejects with a 400 → empty turn. effort=high is REQUIRED for
      // codex to emit reasoning summaries (medium emits none). The summary
      // flag stays BARE (quoted emits nothing). See codex-model.ts + the plan.
      const sharedCodexModel = await readSharedCodexModel(); // shared ~/.codex, NOT the per-session home
      const resolvedCodexModel = resolveCodexChatModel(codexModel, sharedCodexModel);
      const modelArgs = ["--model", resolvedCodexModel];
      const reasoningArgs = [
        "-c",
        `model_reasoning_effort=${COMMANDER_CODEX_REASONING_EFFORT}`,
        "-c",
        "model_reasoning_summary=detailed",
      ];
      const codexArgs = resumeCodexSessionId
        ? ["exec", "--json", ...codexBypassArgs, ...modelArgs, ...reasoningArgs, "resume", resumeCodexSessionId, "-"]
        : ["exec", "--json", ...codexBypassArgs, ...modelArgs, ...reasoningArgs, "-"];
      return {
        binary: "codex",
        args: codexArgs,
        spawnEnv: { CODEX_HOME: codexHomeDir },
        // Record the config.toml so the existing best-effort unlink cleanup
        // (cli-session-store.killSession) reaps the primary artifact, the
        // same way it reaps claude's tmp .json. Parity, no new machinery.
        mcpArtifactPath: codexConfigTomlPath(params.companyId, params.userId),
        resolvedModel: resolvedCodexModel,
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
    const jsPath = resolve(thisDir, "mcp-bridge.js");
    // In production (after `pnpm build`), the compiled .js exists and plain
    // node can run it. In dev mode (tsx), only the .ts source exists — return
    // the .ts path so buildMcpBridgeSpec can select tsx as the runner.
    try { statSync(jsPath); return jsPath; } catch { /* dev mode — fall through */ }
    return resolve(thisDir, "mcp-bridge.ts");
  }

  return {
    async *chat(
      params: ChatInput,
      config: {
        cliTool: string | null;
        executionMode: string;
        vendorCliBypassEnabled?: boolean;
        /** internal_agent_config.model — used (validated) for the codex spawn. */
        model?: string | null;
      },
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

      // Provider sessions must follow the persisted Commander conversation.
      // Keying only by company + user resumes the previous provider thread
      // after the user switches conversations, leaking context across chats.
      const conversationId =
        params.conversationId ?? normalizeCliContextScope(params.contextScope)?.conversationId;
      if (!conversationId) {
        yield {
          type: "error",
          message: "Commander conversation context is required for CLI execution.",
        };
        return;
      }
      const sessionKey = `${params.companyId}:${params.userId}:${conversationId}`;
      let session = sessionStore.get(sessionKey);

      try {
        let sawRealDone = false;
        if (config.cliTool === "codex") {
          // ── codex: ONE-SHOT per turn + resume continuity ──────────────
          // codex `exec` is one-shot (runs the turn, exits). So there is
          // NO persistent process: the conversation is carried by the
          // codex sessionId. Each turn re-spawns; turn-N appends `resume
          // <id> -`. stdout is buffered for the whole turn and parsed via
          // parseCodexJsonl on exit (exit == turn end). The assistant text
          // is the parsed `summary` (NOT raw JSONL — the pre-MX-chatparse
          // bug). claude is UNTOUCHED (the else-branch below).
          const isWin = platform() === "win32";
          const bridgePath = getBridgeEntrypoint();
          const mcpParams: McpConfigParams = {
            companyId: params.companyId,
            userId: params.userId,
            userRole: params.userRole,
            enabledCapabilities: params.enabledCapabilities,
            bridgeEntrypoint: bridgePath,
            actorType: "commander",
            contextScope: normalizeCliContextScope(params.contextScope),
          };

          if (session) session.lastMessageAt = new Date();

          for await (const chunk of runCodexTurn({
            mcpParams,
            prompt: params.content,
            isWin,
            resumeSessionId: session?.codexSessionId ?? null,
            vendorCliBypassEnabled: config.vendorCliBypassEnabled ?? true,
            codexModel: config.model ?? null,
            onSessionId: (sid) => {
              const existing = sessionStore.get(sessionKey);
              if (existing) {
                // Refresh the codex sessionId from this turn's parse.
                existing.codexSessionId = sid ?? existing.codexSessionId;
                existing.lastMessageAt = new Date();
              } else {
                // First turn: create a PROCESS-LESS session (cliProcess
                // null — codex has no long-lived process; killSession
                // guards on null).
                const fresh: CLISession = {
                  cliProcess: null,
                  mcpProcess: null,
                  cliTool: "codex",
                  ...(sid ? { codexSessionId: sid } : {}),
                  companyId: params.companyId,
                  userId: params.userId,
                  userRole: params.userRole,
                  startedAt: new Date(),
                  lastMessageAt: new Date(),
                  // config.toml path recorded so the existing best-effort
                  // unlink cleanup reaps it (parity with claude's tmp .json).
                  mcpConfigPath: codexConfigTomlPath(params.companyId, params.userId),
                  status: "active",
                  messageQueue: [],
                  processing: false,
                };
                sessionStore.set(sessionKey, fresh);
                session = fresh;
              }
            },
          })) {
            if (chunk.type === "done") sawRealDone = true;
            yield chunk;
          }

          // Fallback only — runCodexTurn now emits a real-usage done.
          if (!sawRealDone) {
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
          }
          return;
        }

        if (!session) {
          // 3. First message — spawn new session
          const bridgePath = getBridgeEntrypoint();

          // Windows note: CLI tools like `claude`, `codex`, `opencode` are
          // installed as .cmd wrappers. Node's `spawn` can only launch
          // .bat/.cmd files with `shell: true` (direct spawn raises
          // EINVAL). `shell: true` invokes cmd.exe which forwards args to
          // the shell — so any user-controlled content placed in ARGV must
          // be escaped to prevent cmd injection. claude no longer takes the
          // prompt in argv (it rides stdin — see below), but safeContent is
          // still threaded for the non-systemSplit fallback + codex. Other
          // args (config path, flag literals) come from constants and tmpdir.
          const isWin = platform() === "win32";
          const safeContent = isWin
            ? `"${params.content.replace(/"/g, '""').replace(/%/g, "%%").replace(/\^/g, "^^")}"`
            : params.content;

          // Per-CLI wiring: each provider gets its OWN correct invocation.
          // claude_cli stays BYTE-IDENTICAL (mcpServers wrapper JSON +
          // --mcp-config/-p); codex uses `codex exec --json -` with the
          // bridge delivered via a managed CODEX_HOME/config.toml; opencode
          // is not yet wired → explicit error (no broken spawn).
          // C-systemsplit: build args for the --system-prompt-file split when
          // both systemContext and rawContent were assembled by agent-loop.
          // rawSystemContext is written to a temp file by resolveCliInvocation
          // to avoid Windows cmd.exe newline-truncation of multi-line contexts.
          // W1 stdin fix: claude's prompt is delivered over stdin (raw,
          // unescaped) — NOT argv. So rawContent (the raw user message) is
          // threaded straight through; no per-platform argv escaping.
          const systemSplitArgs: SystemSplitArgs | undefined =
            params.systemContext !== undefined && params.rawContent !== undefined
              ? {
                  rawSystemContext: params.systemContext,
                  rawContent: params.rawContent,
                }
              : undefined;

          const invocation = await resolveCliInvocation(
            config.cliTool,
            {
              companyId: params.companyId,
              userId: params.userId,
              userRole: params.userRole,
              enabledCapabilities: params.enabledCapabilities,
              bridgeEntrypoint: bridgePath,
              actorType: "commander",
              contextScope: normalizeCliContextScope(params.contextScope),
            },
            safeContent,
            undefined,        // resumeCodexSessionId (N/A for the persistent-claude path)
            systemSplitArgs,
            config.vendorCliBypassEnabled ?? true,
            undefined,        // codexModel (codex routes through runCodexTurn, not here)
            params.content,   // rawContent — raw prompt for claude's stdin (plain-path fallback)
            config.model,     // commanderModel — shell-safe --model for claude_cli (LAST param)
          );
          if (!invocation) {
            yield {
              type: "error",
              message:
                "opencode is not yet supported for the Commander chat (MCP wiring pending — MX-followup). Use claude or codex.",
            };
            return;
          }

          // cwd = tmpdir() prevents the CLI from walking up and reading the
          // project's CLAUDE.md (which mentions "Paperclip" — an internal
          // implementation detail that must never surface to users).
          const cliProcess = spawn(invocation.binary, invocation.args, {
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, ...invocation.spawnEnv },
            shell: isWin,
            cwd: tmpdir(),
          });

          // Swallow stdin stream errors (P1, Codex): if the CLI exits before
          // reading stdin (auth/flag/config error) and the assembled prompt
          // exceeds the OS pipe buffer, the write below (turn 1 and every
          // subsequent persistent-session turn) raises EPIPE. Without an `error`
          // listener that is an unhandled stream error that crashes the server;
          // the dead process is otherwise handled by the stream-end / cleanup path.
          cliProcess.stdin?.on("error", () => {});

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

          // Prompt delivery over stdin.
          //
          // claude (W1 stdin fix): the prompt is written to stdin (raw,
          // unescaped — stdin never passes through cmd.exe) and stdin is then
          // CLOSED. claude `--print` is one-shot: it reads the prompt to EOF,
          // answers, and exits. The Windows argv-positional form silently
          // dropped the prompt (the empty/garbage Commander turn). Because the
          // process exits per turn, every claude turn re-spawns here — so this
          // spawn-time stdin write covers all claude turns. (Codex never
          // reaches this branch: it returns earlier via runCodexTurn.)
          //
          // Note: opencode is the only non-claude CLI that could fall through
          // here, and it's rejected above (invocation === null). So in practice
          // this branch runs for claude only — but we key off invocation.stdinPrompt
          // (present iff the provider wants stdin delivery) rather than the CLI
          // name, keeping it provider-neutral.
          if (
            invocation.stdinPrompt !== undefined &&
            cliProcess.stdin?.writable
          ) {
            cliProcess.stdin.write(invocation.stdinPrompt + "\n");
            cliProcess.stdin.end?.();
          }

          // Stream stdout — collect text for persistence.
          // claude_cli uses stream-json; codex/opencode use the text parser.
          const useStreamJson = config.cliTool === "claude_cli";
          for await (const chunk of streamProcessOutput(cliProcess, useStreamJson)) {
            if (chunk.type === "done") sawRealDone = true;
            yield chunk;
          }
        } else {
          // Subsequent message — pipe to existing process stdin.
          // (claude only: codex returned above. cliProcess is non-null on
          // the persistent claude path; the local narrows the now-nullable
          // type — a null process is treated exactly like a dead stdin,
          // i.e. the pre-existing "session ended" path. Runtime behavior
          // for claude is UNCHANGED — MX-chatparse.)
          session.lastMessageAt = new Date();
          const cliProc = session.cliProcess;
          if (cliProc && cliProc.stdin?.writable) {
            // C-systemsplit: for persistent claude sessions, the system context
            // was already set via --system on turn 1.  Subsequent turns should
            // send ONLY the raw user input so the model doesn't see the full
            // assembled context (including history) as a user message — which
            // would cause double-history and re-trigger any CLAUDE.md routing
            // rules.  rawContent is the pre-assembly user text; fall back to
            // params.content when absent (codex or legacy path).
            const turnInput = params.rawContent ?? params.content;
            cliProc.stdin.write(turnInput + "\n");
            const useStreamJsonCont = config.cliTool === "claude_cli";
            for await (const chunk of streamProcessOutput(cliProc, useStreamJsonCont)) {
              if (chunk.type === "done") sawRealDone = true;
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

        // Fallback only — handleResultEvent emits the real done from the
        // stream-json `result` event. This covers the plain-text MCP-tool turn
        // (no result event) so the route always sees exactly one done.
        if (!sawRealDone) {
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
        }
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

/**
 * How long to keep reading stdout after `exit` when `close` never arrives.
 *
 * `close` is the correct terminal signal (it fires only once stdio has
 * drained), but a grandchild that inherited the stdout pipe — an MCP server or
 * a bash tool the CLI spawned — can hold it open indefinitely. This bounds
 * that wait. 2s is far longer than a pipe flush of an already-exited process
 * needs (sub-millisecond in practice) while staying well inside any user's
 * patience for a turn that has, by definition, already failed.
 */
const STDIO_DRAIN_GRACE_MS = 2000;

async function* streamProcessOutput(
  proc: import("node:child_process").ChildProcess,
  useStreamJson = false,
): AsyncGenerator<AgentStreamChunk> {
  const pending: AgentStreamChunk[] = [];
  let done = false;
  let resolve: (() => void) | null = null;
  let leftover = "";
  // Failure surfacing (see `finish` below): a CLI that dies without emitting a
  // parseable result must not render as an empty reply.
  //   sawContent — a real assistant text chunk (non-empty delta) reached the
  //                client, so the turn produced something meaningful.
  //   sawError   — an explicit error chunk was already emitted (e.g. a `result`
  //                event carrying is_error), so don't double-report.
  // Deliberately NOT "any chunk": a system/init/progress chunk followed by
  // exit 1 must still surface an error.
  let sawContent = false;
  let sawError = false;
  let finished = false;
  let graceTimer: NodeJS.Timeout | null = null;

  if (!proc.stdout) {
    // No stdout pipe at all — nothing can ever be parsed, whatever the exit
    // code. Report that specifically: the process was NOT terminated, and
    // guessing at a signal from a null `exitCode` (which is simply what a
    // still-running process reports) would misattribute the cause.
    yield { type: "error", message: "The CLI produced no output stream." };
    return;
  }

  function record(chunk: AgentStreamChunk) {
    if (chunk.type === "text" && chunk.delta.length > 0) sawContent = true;
    else if (chunk.type === "error") sawError = true;
    pending.push(chunk);
  }

  // Branch parser: claude_cli uses the structured stream-json parser;
  // codex / opencode stay on the existing text-format marker-in-prose path.
  const streamParser = useStreamJson ? new StreamJsonParser() : null;
  function processLines(text: string) {
    if (streamParser) {
      // StreamJsonParser handles its own internal buffering — just push text.
      for (const chunk of streamParser.push(text)) {
        record(chunk);
      }
    } else {
      const lines = (leftover + text).split("\n");
      leftover = lines.pop() ?? "";          // last segment is incomplete
      for (const line of lines) {
        for (const chunk of parseCliOutput(line)) {
          record(chunk);
        }
      }
    }
  }

  function flushLeftover() {
    if (streamParser) {
      for (const chunk of streamParser.flush()) {
        record(chunk);
      }
    } else if (leftover.length > 0) {
      for (const chunk of parseCliOutput(leftover)) {
        record(chunk);
      }
      leftover = "";
    }
  }

  function notify() {
    if (resolve) { resolve(); resolve = null; }
  }

  /**
   * Terminal transition. A child can emit BOTH `error` (spawn failure) and
   * `close`, so this is idempotent — a second call would double-flush the parser
   * and could push a second error chunk.
   *
   * This never emits a `done` chunk: the caller owns the single-done invariant
   * (`sawRealDone` + fallback). A failure error chunk here leaves that logic
   * untouched, so the caller still emits exactly one done.
   */
  function finish(code: number | null, signalled: boolean) {
    if (finished) return;
    finished = true;

    if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; }

    flushLeftover();

    const failed = signalled || (code ?? 0) !== 0;
    if (failed && !sawError && !sawContent) {
      pending.push({
        type: "error",
        message: signalled
          ? "The CLI was terminated before it produced a response."
          : `The CLI exited with code ${code ?? -1} without producing output.`,
      });
    }

    done = true;
    notify();
  }

  proc.stdout.on("data", (data: Buffer) => {
    processLines(data.toString());
    notify();
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    if (text.trim().length > 0) {
      // stderr is raw CLI output and can echo tokens/keys from the environment.
      logger.warn(
        { service: "commander-cli", stderr: redactSecretsInString(text).slice(0, 2000) },
        "CLI subprocess stderr",
      );
    }
  });

  // `exit` fires while stdout may still hold buffered data — Node calls
  // flushStdio() AFTER emitting `exit`. Terminating on `exit` alone destroys
  // output the CLI already wrote, which is the common case for a fast-failing
  // `claude --print --output-format stream-json`: it writes its whole result
  // (including the is_error/auth reason) in one small buffer microseconds
  // before exiting nonzero. `close` fires only once every stdio stream has
  // drained, so it is the correct terminal signal.
  //
  // `close` alone would hang forever if a grandchild (MCP server, bash tool)
  // inherited the stdout pipe and outlives the CLI, so `exit` arms a bounded
  // grace window as a backstop.
  proc.on("exit", (code: number | null) => {
    graceTimer = setTimeout(() => finish(code, code === null), STDIO_DRAIN_GRACE_MS);
    graceTimer.unref?.();
  });
  proc.on("close", (code: number | null) => finish(code, code === null));
  proc.on("error", () => finish(null, true));

  while (true) {
    while (pending.length > 0) {
      yield pending.shift()!;
    }
    if (done) break;
    await new Promise<void>((r) => { resolve = r; });
  }
}

// ── codex one-shot turn helper (MX-chatparse) ───────────────────────────────
//
// `codex exec` is ONE-SHOT: it runs the turn and exits. There is no
// persistent process and no per-line text; codex emits JSONL events on
// stdout. So: spawn fresh, pipe the prompt over stdin, buffer the WHOLE
// turn's stdout+stderr, and on exit run parseCodexJsonl. The assistant
// reply is the parsed `summary` (NOT raw JSON — the pre-MX-chatparse bug).
// Continuity is via codex's `resume <sessionId> -`; an unknown-session
// resume retries once FRESH (mirrors the codex-local adapter). claude is
// NOT routed here — its persistent-process/plain-text path is unchanged.
//
// Token-by-token streaming for codex is an explicit deferred polish: v1
// emits the full `summary` as a single text chunk on turn completion.

interface RunCodexTurnArgs {
  mcpParams: McpConfigParams;
  prompt: string;
  isWin: boolean;
  resumeSessionId: string | null;
  vendorCliBypassEnabled: boolean;
  /** internal_agent_config.model (validated downstream) — pins the codex model. */
  codexModel?: string | null;
  /** Called with the parsed codex sessionId so the caller can persist it. */
  onSessionId: (sessionId: string | null) => void;
}

async function* runCodexTurn(
  args: RunCodexTurnArgs,
): AsyncGenerator<AgentStreamChunk> {
  const { parseCodexJsonl, isCodexUnknownSessionError } = await import(
    "@armyofagents/adapter-codex-local/server"
  );

  // Buffer the full stdout+stderr of one codex process to completion.
  // Returns the collected output AND the resolved model string from the
  // invocation (for provenance reporting — F1).
  async function spawnAndCollect(
    resume: string | null,
  ): Promise<{ stdout: string; stderr: string; exitCode: number | null; resolvedModel: string | undefined }> {
    // Shell-boundary re-validation: validateSessionId() strips metacharacters
    // that would execute as shell commands on Windows (spawn uses shell:true).
    // The primary validation runs at onSessionId (store time); this is
    // defense-in-depth so the shell boundary is safe even if a future write
    // path bypasses the callback.
    const safeResume = resume ? validateSessionId(resume) : null;

    // resolveCliInvocation writes the per-session CODEX_HOME/config.toml
    // (the bridge must be present on EVERY spawn — MX4 parity) and builds
    // the argv (`exec --json [resume <id>] -`).
    const invocation = await resolveCliInvocation(
      "codex",
      args.mcpParams,
      args.prompt, // codex prompt is delivered over stdin, NOT argv
      safeResume,
      undefined,
      args.vendorCliBypassEnabled,
      args.codexModel ?? null,
    );
    if (!invocation) {
      // codex is a wired CLI — resolveCliInvocation never returns null for
      // it. Defensive: surface rather than spawn garbage.
      throw new Error("codex invocation could not be resolved");
    }

    // cwd = tmpdir() — same reasoning as the claude_cli spawn above: keeps
    // the subprocess from reading project CLAUDE.md / AGENTS.md files that
    // contain internal implementation details (e.g. "Paperclip") not meant
    // to surface to users.
    const proc = spawn(invocation.binary, invocation.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...invocation.spawnEnv },
      shell: args.isWin,
      cwd: tmpdir(),
    });

    // Swallow stdin stream errors (P1, Codex): an early CLI exit + a prompt
    // larger than the OS pipe buffer makes the write below raise EPIPE; without
    // an `error` listener that's an unhandled stream error that crashes the
    // server. The early exit is captured by the close/exit handling instead.
    proc.stdin?.on("error", () => {});

    // codex reads the prompt from stdin (the `-` PROMPT arg) until EOF, so
    // the stream MUST be closed for the one-shot turn to proceed. Raw
    // content (NOT the win32 argv-escaped form) — codex never sees a shell.
    if (proc.stdin?.writable) {
      proc.stdin.write(args.prompt + "\n");
      proc.stdin.end?.();
    }

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    const exitCode = await new Promise<number | null>((resolveExit) => {
      proc.on("exit", (code) => resolveExit(code));
      proc.on("error", () => resolveExit(-1));
    });

    return { stdout, stderr, exitCode, resolvedModel: invocation.resolvedModel };
  }

  let result = await spawnAndCollect(args.resumeSessionId);

  // Unknown/stale resume session ⇒ retry ONCE fresh (no `resume`), so the
  // turn renders instead of hanging or surfacing "CLI session ended".
  if (
    args.resumeSessionId &&
    (result.exitCode ?? 0) !== 0 &&
    isCodexUnknownSessionError(result.stdout, result.stderr)
  ) {
    result = await spawnAndCollect(null);
  }

  const parsed = parseCodexJsonl(result.stdout);
  const toolsCalled = Array.from(
    new Set(
      (parsed.chunks ?? [])
        .filter((chunk) => chunk.type === "tool_call" || chunk.type === "tool_result")
        .map((chunk) => chunk.name)
        .filter(Boolean),
    ),
  );

  // Persist/refresh the codex sessionId for the NEXT turn's `resume`.
  // Validate against safe-char allowlist before storing — on Windows, spawn
  // uses shell:true so metacharacters in args execute as shell commands (C2).
  args.onSessionId(validateSessionId(parsed.sessionId));

  const errorMessage =
    parsed.errorMessage ??
    ((result.exitCode ?? 0) !== 0 && !parsed.summary
      ? isCodexUnknownSessionError(result.stdout, result.stderr)
        ? "codex session could not be resumed and a fresh attempt failed."
        : `codex exited with code ${result.exitCode ?? -1}`
      : null);

  if (errorMessage) {
    yield { type: "error", message: errorMessage };
    return;
  }

  for (const chunk of parsed.chunks ?? []) {
    yield chunk;
  }

  // v1: emit the full parsed assistant reply as a single text chunk
  // (token-by-token codex streaming is a deferred polish). NEVER the raw
  // JSONL — that was the rendered-nothing bug.
  if (parsed.summary) {
    yield { type: "text", delta: parsed.summary };
  }

  // Real-usage done (cost left 0 — codex subscription has no per-run billing;
  // the route estimates from tokens via computeCostCents).
  // Carry the resolved model + provider for F1 provenance columns in the DB.
  yield {
    type: "done",
    summary: {
      runId: "",
      toolsCalled,
      durationMs: 0,
      costCents: 0,
      tokenUsage: {
        inputTokens: parsed.usage?.inputTokens ?? 0,
        outputTokens: parsed.usage?.outputTokens ?? 0,
        cachedInputTokens: parsed.usage?.cachedInputTokens ?? 0,
      },
      ...(result.resolvedModel
        ? { model: result.resolvedModel, provider: "openai" }
        : {}),
    },
  };
}

// ── Test seam ───────────────────────────────────────────────────────────────
// streamProcessOutput is internal to the chat pipeline; exported here so its
// process-failure handling can be exercised against a fake ChildProcess.
export const __testables = { streamProcessOutput, STDIO_DRAIN_GRACE_MS };
