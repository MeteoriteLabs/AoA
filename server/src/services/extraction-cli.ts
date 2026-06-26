/**
 * Server-side ONE-SHOT CLI extractor — the keyless replacement transport for
 * discussion extraction.
 *
 * This is NOT the Commander chat path. It is a fresh, headless, one-shot CLI
 * invocation per extraction:
 *   1. spawn the CLI (claude or codex),
 *   2. feed it (system prompt + entry text),
 *   3. capture the model's TEXT output (a JSON array of extracted items),
 *   4. parse it via parseExtractedItems, and return structured items.
 *
 * There is NO MCP bridge and NO `submit_extracted_items` tool here — the SERVER
 * writes the rows itself (a later task). This deliberately avoids the Decision
 * #100 blockers.
 *
 * Prompt delivery uses stdin (W1 spike: on Windows argv positionals are
 * silently dropped; stdin works). The claude shape mirrors the chat path's
 * stdin+close one-shot pattern; the codex shape delegates to the factored
 * `runCodexExecJson` (which reuses the hardened chat-path codex machinery).
 */

import { spawn } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseExtractedItems, type ExtractedItem } from "./extraction-parser.js";
import { runCodexExecJson } from "./internal-agent/codex-exec.js";
import {
  appendCapped,
  buildScrubbedCliEnv,
  MAX_CLI_STDERR_BYTES,
  MAX_CLI_STDOUT_BYTES,
  newCappedBuffer,
} from "./cli-spawn-safety.js";

export type CliErrorKind =
  | "not_installed"
  | "not_authed"
  | "timeout"
  | "nonzero_exit"
  | "unparseable";

export class CliExtractionError extends Error {
  readonly kind: CliErrorKind;
  constructor(message: string, kind: CliErrorKind) {
    super(message);
    this.name = "CliExtractionError";
    this.kind = kind;
  }
}

// Maps the extraction config value to the binary name. Mirrors cli-mode's
// CLI_BINARY_MAP so the two transports agree on tool naming.
const CLI_BINARY_MAP: Record<string, string> = {
  claude_cli: "claude",
  claude: "claude",
  codex: "codex",
};

/** stderr substrings that indicate an auth/login failure (not a crash). */
const AUTH_STDERR_RE = /auth|login|unauthorized|missing bearer|not logged in/i;

export interface ClassifyCliErrorInput {
  code?: string;
  timedOut?: boolean;
}

/**
 * Classify a CLI failure into one of the structured kinds.
 *
 * Precedence (most specific first):
 *   1. spawnErr.code === "ENOENT"      → not_installed (binary missing)
 *   2. spawnErr.timedOut               → timeout (killed by our timer)
 *   3. stderr matches AUTH_STDERR_RE   → not_authed (login required)
 *   4. exitCode != null && != 0        → nonzero_exit (generic crash)
 *   5. else                            → unparseable (fall-through; the caller
 *      throws this separately when parseExtractedItems fails on exit-0 output)
 */
export function classifyCliError(
  spawnErr: ClassifyCliErrorInput | null,
  stderr: string,
  exitCode: number | null,
): CliErrorKind {
  if (spawnErr?.code === "ENOENT") return "not_installed";
  if (spawnErr?.timedOut) return "timeout";
  if (AUTH_STDERR_RE.test(stderr)) return "not_authed";
  if (exitCode != null && exitCode !== 0) return "nonzero_exit";
  return "unparseable";
}

export interface ExtractViaCliOptions {
  timeoutMs?: number;
  /** internal_agent_config.model — forwarded to the codex model resolver. */
  codexModel?: string | null;
}

/**
 * Run a one-shot CLI extraction and return the parsed items.
 *
 * @param cliTool   "claude" / "claude_cli" or "codex"
 * @param systemPrompt  the extraction instruction (model's system channel)
 * @param content       the raw entry text to extract from
 *
 * @throws CliExtractionError with a classified `kind` on spawn failure, timeout,
 *         auth failure, nonzero exit, or unparseable model output.
 */
export async function extractViaCli(
  cliTool: string,
  systemPrompt: string,
  content: string,
  options: ExtractViaCliOptions = {},
): Promise<ExtractedItem[]> {
  const { timeoutMs = 60_000, codexModel = null } = options;
  const binary = CLI_BINARY_MAP[cliTool];

  if (binary === "codex") {
    // codex one-shot has no separate system channel — prepend the system prompt.
    const prompt = `${systemPrompt}\n\n${content}`;
    const result = await runCodexExecJson(prompt, { timeoutMs, codexModel });

    // Capped output is a runaway/looping failure: killing the child makes `close`
    // report a null exit code, so without this a prompt-injected `[]` + spam that
    // trips the cap could be parsed and marked completed (P2, Codex).
    if (result.outputCapped) {
      throw new CliExtractionError(
        "codex extraction output exceeded the safety size cap (runaway/looping output)",
        "nonzero_exit",
      );
    }

    // Map codex spawn/exit failures to the same CliErrorKind taxonomy.
    if (result.spawnError || result.timedOut || (result.exitCode ?? 0) !== 0) {
      const kind = classifyCliError(
        result.spawnError
          ? { code: result.spawnError.code, timedOut: result.timedOut }
          : { timedOut: result.timedOut },
        result.stderr,
        result.exitCode,
      );
      throw new CliExtractionError(
        codexFailureMessage(kind, result.exitCode, result.stderr),
        kind,
      );
    }

    try {
      return parseExtractedItems(result.text);
    } catch (err) {
      throw new CliExtractionError(
        `codex extraction output was not parseable: ${(err as Error)?.message ?? "unknown"}`,
        "unparseable",
      );
    }
  }

  if (binary === "claude") {
    return extractViaClaude(systemPrompt, content, timeoutMs);
  }

  throw new CliExtractionError(
    `Unsupported CLI tool for extraction: '${cliTool}'. Supported: claude, codex.`,
    "not_installed",
  );
}

/**
 * Minimal one-shot claude invocation:
 *   claude --print --system-prompt-file <tmpfile> --output-format text
 * with the system prompt written to a temp file (cmd.exe can't carry multi-line
 * inline args) and the CONTENT delivered over stdin then closed (W1 fix).
 *
 * No --mcp-config, no stream-json — default text output IS the model's reply.
 */
async function extractViaClaude(
  systemPrompt: string,
  content: string,
  timeoutMs: number,
): Promise<ExtractedItem[]> {
  const isWin = platform() === "win32";

  // Write the system prompt to a temp file — multi-line markdown can't ride a
  // cmd.exe inline arg (newline-truncated). --system-prompt-file sidesteps it.
  // mode 0o600: the file holds company-specific prompt context (P2, Codex).
  const systemPromptPath = join(tmpdir(), `aoa-extract-sys-${randomUUID()}.txt`);
  await writeFile(systemPromptPath, systemPrompt, { encoding: "utf8", mode: 0o600 });
  const safeSystemPromptPath = isWin
    ? `"${systemPromptPath.replace(/"/g, '""')}"`
    : systemPromptPath;

  // Always remove the temp prompt file (P2, Codex) — on success, parse failure,
  // timeout, or spawn error — so company-context artifacts don't accumulate in
  // the shared OS temp dir. Everything from the spawn onward runs inside the try.
  try {
  // SECURITY (P1, Codex): extraction feeds ARBITRARY discussion text into claude
  // as the prompt. Without restricting tools, a prompt-injected entry could make
  // the local claude profile run Read/Bash against the server user's
  // home/temp/env (and exfiltrate creds) and fold the result into the extraction
  // output. Extraction only needs text generation, so disable ALL built-in tools
  // (`--tools ""`). On Windows the value rides through cmd.exe (shell:true), so
  // pass a literal empty-quoted token; on POSIX a bare empty arg is correct.
  //
  // `--tools ""` only disables the BUILT-IN tool set; globally-configured MCP
  // servers (~/.claude.json / user settings) would still load and expose their
  // tools. `--strict-mcp-config` with NO `--mcp-config` ignores all filesystem
  // MCP config, so the headless extractor loads zero MCP servers (audit follow-up).
  const args = [
    "--print",
    "--tools",
    isWin ? '""' : "",
    "--strict-mcp-config",
    "--system-prompt-file",
    safeSystemPromptPath,
    "--output-format",
    "text",
  ];

  // cwd = tmpdir(): keep claude from reading project CLAUDE.md / AGENTS.md
  // (internal "Paperclip" details must not surface) — same as the chat spawns.
  // env: scrubbed of the server's own secrets (embeddings OPENAI_API_KEY,
  // GITHUB_PAT, AOA_*, …) — defense-in-depth so even a tool-bypass can't read
  // them from the environment. KEEP claude's OWN auth env vars so the scrub does
  // not break keyless auth: ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN (the
  // headless subscription-OAuth token — both would otherwise be dropped by the
  // generic api-key/token denylist). File-based OAuth (~/.claude) rides via HOME
  // and is unaffected either way (self-review follow-up).
  const proc = spawn("claude", args, {
    shell: isWin,
    cwd: tmpdir(),
    stdio: ["pipe", "pipe", "pipe"],
    env: buildScrubbedCliEnv(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]),
  });

  const stdoutBuf = newCappedBuffer();
  const stderrBuf = newCappedBuffer();
  let timedOut = false;
  // Annotated via a holder so TS doesn't narrow it to `null` (the callback
  // assignment below is invisible to control-flow analysis across the await).
  const errBox: { value: NodeJS.ErrnoException | null } = { value: null };

  proc.stdout?.on("data", (d: Buffer) => {
    // Bound buffered output: a prompt-injected/looping model could otherwise
    // stream until the server OOMs. On overflow, kill the child and stop reading.
    if (appendCapped(stdoutBuf, d, MAX_CLI_STDOUT_BYTES)) proc.kill();
  });
  proc.stderr?.on("data", (d: Buffer) => {
    appendCapped(stderrBuf, d, MAX_CLI_STDERR_BYTES);
  });

  // Swallow stdin stream errors (P1, Codex): if claude exits before reading
  // stdin (auth failure / unsupported flag) and the entry exceeds the OS pipe
  // buffer, the write raises EPIPE. Without an `error` listener that is an
  // unhandled stream error that crashes the process; the early exit is captured
  // by the close/error handler above and classified as a CLI failure instead.
  proc.stdin?.on("error", () => {});

  // Prompt over stdin (raw, unescaped — stdin never passes through cmd.exe),
  // then close: claude --print is one-shot (reads to EOF, answers, exits).
  if (proc.stdin?.writable) {
    proc.stdin.write(content + "\n");
    proc.stdin.end?.();
  }

  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
    // Short grace, then SIGKILL if the process is still alive.
    setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGKILL");
      }
    }, 2_000).unref?.();
  }, timeoutMs);
  timer.unref?.();

  const exitCode = await new Promise<number | null>((resolveExit) => {
    proc.on("close", (code) => resolveExit(code));
    proc.on("error", (err: NodeJS.ErrnoException) => {
      errBox.value = err;
      resolveExit(null);
    });
  });

  clearTimeout(timer);

  const spawnError = errBox.value;
  if (spawnError || timedOut || (exitCode ?? 0) !== 0) {
    const kind = classifyCliError(
      spawnError ? { code: spawnError.code, timedOut } : { timedOut },
      stderrBuf.text,
      exitCode,
    );
    throw new CliExtractionError(
      claudeFailureMessage(kind, exitCode, stderrBuf.text),
      kind,
    );
  }

  // Capped output is a runaway/looping failure even though killing the child
  // makes `close` report a null exit code (which `(exitCode ?? 0)` above treats
  // as success): a prompt-injected `[]` + spam could trip the cap yet parse
  // clean. Fail explicitly so the truncated prefix is never accepted (P2, Codex).
  if (stdoutBuf.capped) {
    throw new CliExtractionError(
      "claude extraction output exceeded the safety size cap (runaway/looping output)",
      "nonzero_exit",
    );
  }

  try {
    return parseExtractedItems(stdoutBuf.text);
  } catch (err) {
    throw new CliExtractionError(
      `claude extraction output was not parseable: ${(err as Error)?.message ?? "unknown"}`,
      "unparseable",
    );
  }
  } finally {
    // Best-effort cleanup — never mask the real result/error.
    await rm(systemPromptPath, { force: true }).catch(() => {});
  }
}

function claudeFailureMessage(
  kind: CliErrorKind,
  exitCode: number | null,
  stderr: string,
): string {
  switch (kind) {
    case "not_installed":
      return "claude CLI not found on PATH. Install the Claude Code CLI and ensure it is on your PATH.";
    case "not_authed":
      return "claude CLI is not authenticated. Run the CLI's login flow, then retry.";
    case "timeout":
      return "claude CLI extraction timed out.";
    default:
      return `claude CLI exited with code ${exitCode ?? -1}${
        stderr.trim() ? `: ${stderr.trim().slice(0, 500)}` : ""
      }`;
  }
}

function codexFailureMessage(
  kind: CliErrorKind,
  exitCode: number | null,
  stderr: string,
): string {
  switch (kind) {
    case "not_installed":
      return "codex CLI not found on PATH. Install the Codex CLI and ensure it is on your PATH.";
    case "not_authed":
      return "codex CLI is not authenticated. Run `codex login`, then retry.";
    case "timeout":
      return "codex CLI extraction timed out.";
    default:
      return `codex CLI exited with code ${exitCode ?? -1}${
        stderr.trim() ? `: ${stderr.trim().slice(0, 500)}` : ""
      }`;
  }
}
