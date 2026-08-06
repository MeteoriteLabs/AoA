/**
 * Server-side ONE-SHOT CLI extractor — the keyless transport for ALL extraction.
 *
 * Extraction is CLI-only (Decision #104, amended 2026-06-27): there is no
 * hosted-API fallback. This extractor backs every extraction entry point —
 * discussion extraction, debrief-push, file-import, and the crew memory-extract
 * tools — none of which ever read a hosted provider key.
 *
 * This is NOT the Commander chat path. It is a fresh, headless, one-shot CLI
 * invocation per extraction:
 *   1. spawn the CLI (claude or codex),
 *   2. feed it (system prompt + entry text),
 *   3. capture the model's TEXT output (a JSON array of extracted items),
 *   4. parse it via parseExtractedItems, and return structured items.
 *
 * There is NO MCP bridge and NO `submit_extracted_items` tool here — the SERVER
 * (the calling extraction service) writes the rows itself. This deliberately
 * avoids the Decision #100 blockers.
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
import type { Db } from "@armyofagents/db";
import { parseExtractedItems, type ExtractedItem } from "./extraction-parser.js";
import { runCodexExecJson } from "./internal-agent/codex-exec.js";
import { tenantIsolationEnforced } from "../config/deployment-mode.js";
import {
  appendCapped,
  buildScrubbedCliEnv,
  MAX_CLI_STDERR_BYTES,
  MAX_CLI_STDOUT_BYTES,
  newCappedBuffer,
} from "./cli-spawn-safety.js";
import type { CompanyProviderCredential } from "./one-shot-provider-credential.js";
import {
  runOneShotCliInSandbox,
  OneShotSandboxError,
  type OneShotSandboxHandle,
  type OneShotCliResult,
} from "./one-shot-sandbox-cli.js";

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
  /**
   * The company's own resolved model-provider credential (U13.0). Required
   * (alongside `companyId` + `db`) to route this spawn through the ephemeral
   * sandbox on `cloud_auth` (U13.2) — unused on desktop, where extraction
   * runs via the ambient host CLI login. Callers resolve this via
   * `resolveCliExtractionContext` / the sibling gate in extraction.ts.
   */
  credential?: CompanyProviderCredential | null;
  /** Required alongside `credential`/`db` on cloud — forwarded to
   *  `runOneShotCliInSandbox`. */
  companyId?: string;
  db?: Db;
  /** Pre-acquired batch sandbox lease (U13.3 supplies this so a whole
   *  extract-then-scope pass reuses one sandbox). U13.2 plumbs this through
   *  inert: when omitted, the cloud path self-acquires its own ephemeral
   *  sandbox per call via `runOneShotCliInSandbox`. */
  sandboxHandle?: OneShotSandboxHandle;
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
  const { timeoutMs = 60_000, codexModel = null, credential = null, companyId, db, sandboxHandle } = options;
  const binary = CLI_BINARY_MAP[cliTool];

  if (!binary) {
    throw new CliExtractionError(
      `Unsupported CLI tool for extraction: '${cliTool}'. Supported: claude, codex.`,
      "not_installed",
    );
  }

  // On AoA Cloud (cloud_auth): the shared host's CLI login belongs to the
  // OPERATOR — running tenant content through it would generate under the
  // operator credential (the 4th unsandboxed sink; the other three are refused
  // by the D1 guard). U13 (this wave) fixes that: route the spawn through an
  // EPHEMERAL sandbox authenticated with the COMPANY's own resolved provider
  // key (U13.0/U13.1) instead of refusing outright. This is the single
  // chokepoint for all four extraction sinks (discussion / debrief-push /
  // file-import / crew memory-extract) — every caller now threads
  // `credential`/`companyId`/`db` (extraction.ts, U13.2).
  if (tenantIsolationEnforced()) {
    return extractViaCliSandbox(binary, cliTool, systemPrompt, content, {
      timeoutMs,
      credential,
      companyId,
      db,
      sandboxHandle,
    });
  }

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

  // Unreachable: `binary` was validated against CLI_BINARY_MAP above (only
  // "claude"/"codex" values exist in that map), but TS can't narrow that
  // statically — keep a defensive fallback so every path returns/throws.
  throw new CliExtractionError(
    `Unsupported CLI tool for extraction: '${cliTool}'. Supported: claude, codex.`,
    "not_installed",
  );
}

/**
 * U13.2 — route a one-shot CLI extraction through the ephemeral sandbox on
 * AoA Cloud (`cloud_auth` / tenant isolation) instead of the ambient host CLI
 * login (the operator-cred sink the desktop branch below relies on).
 * Authenticates with the COMPANY's own resolved provider key (U13.0) via the
 * shared sandbox seam (U13.1, `runOneShotCliInSandbox`) — this branch NEVER
 * calls `buildScrubbedCliEnv`; that KEEP-list (`ANTHROPIC_API_KEY`,
 * `CLAUDE_CODE_OAUTH_TOKEN`) is legitimate only for the desktop/local spawn
 * below, where the ambient host login IS the intended auth. The sandbox's env
 * is built entirely inside `runOneShotCliInSandbox` from the company
 * credential + the U5 allowlist — no operator/local credential ever reaches
 * the child.
 *
 * Command/args mirror the desktop spawn's INTENT (claude one-shot
 * text-generation-only / codex `exec --json`), but neither binary can rely on
 * a LOCAL temp file inside the remote sandbox VM: no `--system-prompt-file`
 * (that file lives on THIS host, not the sandbox) and no per-run CODEX_HOME
 * auth-copy (codex's ChatGPT-subscription home-dir dance is a desktop-only
 * concept — the sandbox authenticates via the injected env-var API key, S14).
 * Both the system prompt and the entry content ride over stdin, concatenated
 * — the same "no separate system channel" pattern the desktop codex path
 * already uses. Staging the USER content as a VM file instead of stdin is
 * U13.5; the batch sandbox handle that lets a whole extract-then-scope pass
 * reuse one lease is U13.3 (`sandboxHandle` is plumbed here, inert, until
 * that task's batch acquire supplies it).
 */
async function extractViaCliSandbox(
  binary: string,
  cliTool: string,
  systemPrompt: string,
  content: string,
  opts: {
    timeoutMs: number;
    credential: CompanyProviderCredential | null;
    companyId?: string;
    db?: Db;
    sandboxHandle?: OneShotSandboxHandle;
  },
): Promise<ExtractedItem[]> {
  // Structural guard: every production caller threads credential+companyId+db
  // together (extraction.ts's resolveCliExtractionContext /
  // resolveCliCredentialIfCloud gate feeding extractFromDiscussionEntry,
  // extractFromDebrief, extractFromRawText, extractMemoryCandidates). A
  // direct call missing one of these on cloud cannot route through the
  // sandbox — fail closed rather than call runOneShotCliInSandbox with a
  // missing companyId/db.
  //
  // Kind mapping is TEMPORARY: U13.3 adds a dedicated `sandbox_unavailable`
  // CliErrorKind + cloud-pointing failure copy (see plan U13.3). Deliberately
  // NOT "not_authed" here — DiscussionDetail.extractionFailureMessage has a
  // `multiTenant && kind === "not_authed"` branch that OVERRIDES the message
  // with a hardcoded pre-U13 "extraction isn't available on AoA Cloud yet"
  // copy, which would be actively wrong now that cloud extraction exists.
  // "nonzero_exit" surfaces this error's own real message via the generic
  // "Extraction failed — try Reprocess. <message>" copy instead.
  if (!opts.credential || !opts.companyId || !opts.db) {
    throw new CliExtractionError(
      "Extraction on AoA Cloud requires a resolved company provider key (Settings → Providers) and company context.",
      "nonzero_exit",
    );
  }

  const stdinContent = `${systemPrompt}\n\n${content}`;
  const args =
    binary === "codex"
      ? [
          "exec",
          "--json",
          "--sandbox",
          "read-only",
          "--ask-for-approval",
          "never",
          "--model",
          opts.credential.model,
          "-",
        ]
      : ["--print", "--tools", "", "--strict-mcp-config", "--output-format", "text"];

  let result: OneShotCliResult;
  try {
    result = await runOneShotCliInSandbox({
      db: opts.db,
      companyId: opts.companyId,
      cliTool,
      command: binary,
      args,
      stdinContent,
      timeoutMs: opts.timeoutMs,
      sandboxHandle: opts.sandboxHandle,
    });
  } catch (err) {
    if (err instanceof OneShotSandboxError) {
      // TEMPORARY kind mapping (see comment above) — timeout maps exactly;
      // sandbox_unavailable/nonzero_exit both fall to nonzero_exit pending
      // U13.3's dedicated classification + copy.
      const kind: CliErrorKind = err.kind === "timeout" ? "timeout" : "nonzero_exit";
      throw new CliExtractionError(err.message, kind);
    }
    throw err;
  }

  // codex's `--json` output is a JSONL event stream, not the plain-text model
  // reply — extract the final assistant message the same way the desktop
  // codex path does (runCodexExecJson -> parseCodexJsonl) before parsing it
  // as the extracted-items JSON array. claude's `--output-format text` stdout
  // IS the model's reply already.
  const outputText =
    binary === "codex" ? await extractCodexJsonlSummary(result.stdout) : result.stdout;

  try {
    return parseExtractedItems(outputText);
  } catch (err) {
    throw new CliExtractionError(
      `${binary} extraction (sandbox) output was not parseable: ${(err as Error)?.message ?? "unknown"}`,
      "unparseable",
    );
  }
}

/**
 * Extract the final assistant text from a codex `--json` JSONL stream.
 * Reuses the real parser (`parseCodexJsonl`) the desktop codex path already
 * depends on (`codex-exec.ts`) — dynamically imported to match that module's
 * existing lazy-load pattern for the adapter-codex-local package.
 */
async function extractCodexJsonlSummary(stdout: string): Promise<string> {
  const { parseCodexJsonl } = await import("@armyofagents/adapter-codex-local/server");
  return parseCodexJsonl(stdout).summary ?? "";
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
