import fs from "node:fs/promises";
import path from "node:path";

/**
 * Serialize ALL config.toml mutations for a given managed home. The home is
 * per-COMPANY (`prepareManagedCodexHome(..., companyId, ...)`, execute.ts:318),
 * so concurrent heartbeat runs in one company share `<home>/config.toml`. Both
 * writers here do read-strip-rewrite; without serialization a concurrent
 * MCP-write + model-write can each read before the other's write lands and drop
 * the other's section — dropping the `model =` line silently re-introduces BUG-6
 * under concurrency (Decision #5 allows up to 50 concurrent runs). This is an
 * in-process, per-managed-home promise chain keyed by the resolved absolute path.
 * The stored tail swallows errors so one failed write never wedges the chain; the
 * caller still receives the real (possibly rejecting) promise.
 */
const configTomlWriteChains = new Map<string, Promise<unknown>>();
function withCodexHomeConfigLock<T>(
  managedHomeDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(managedHomeDir);
  const prev = configTomlWriteChains.get(key) ?? Promise.resolve();
  // Run fn AFTER prev settles (success OR failure): `.then(fn, fn)`.
  const run = prev.then(fn, fn);
  configTomlWriteChains.set(
    key,
    run.then(
      () => {},
      () => {},
    ),
  );
  return run;
}

/**
 * Provider-neutral MCP bridge spec (same shape as the server's
 * buildMcpBridgeSpec / adapter-utils McpBridgeSpec). Local copy of the shape —
 * this package must not import from the server.
 */
export interface CodexMcpBridgeSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Escape a string for a TOML basic (double-quoted) string. TOML requires
 * backslash and the surrounding quote to be escaped, and disallows raw
 * control characters — escape the common ones (and any remaining control
 * char as a \uXXXX sequence) so the emitted file always parses.
 */
function escapeTomlBasicString(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    switch (ch) {
      case "\\":
        out += "\\\\";
        break;
      case '"':
        out += '\\"';
        break;
      case "\b":
        out += "\\b";
        break;
      case "\t":
        out += "\\t";
        break;
      case "\n":
        out += "\\n";
        break;
      case "\f":
        out += "\\f";
        break;
      case "\r":
        out += "\\r";
        break;
      default:
        if (code < 0x20 || code === 0x7f) {
          out += "\\u" + code.toString(16).padStart(4, "0").toUpperCase();
        } else {
          out += ch;
        }
        break;
    }
  }
  return out;
}

function tomlString(value: string): string {
  return `"${escapeTomlBasicString(value)}"`;
}

function tomlStringArray(values: string[]): string {
  return `[${values.map((v) => tomlString(v)).join(", ")}]`;
}

/**
 * Render the codex `[mcp_servers.<name>]` (+ nested `.env`) block. This mirrors
 * the exact structure codex itself writes via `codex mcp add` and reads back
 * via `codex mcp list`:
 *
 *   [mcp_servers.aoa]
 *   command = "node"
 *   args = ["/path/to/mcp-bridge.js"]
 *
 *   [mcp_servers.aoa.env]
 *   KEY = "value"
 *
 * stdio is codex's default transport — no explicit `transport` key is needed.
 */
function renderMcpBlock(spec: CodexMcpBridgeSpec, serverName: string): string {
  const lines: string[] = [];
  lines.push(`[mcp_servers.${serverName}]`);
  lines.push(`command = ${tomlString(spec.command)}`);
  lines.push(`args = ${tomlStringArray(spec.args)}`);
  lines.push("");
  lines.push(`[mcp_servers.${serverName}.env]`);
  for (const [key, value] of Object.entries(spec.env)) {
    lines.push(`${key} = ${tomlString(value)}`);
  }
  return lines.join("\n");
}

/**
 * Strip any prior `[mcp_servers.<serverName>]` and
 * `[mcp_servers.<serverName>.env]` blocks from existing TOML text, leaving all
 * other content untouched. A "block" runs from its table header up to (but not
 * including) the next top-level `[` table header or end-of-file. This keeps the
 * regenerate idempotent and never touches unrelated tables (e.g. `[profiles.*]`,
 * `[other]`) or sibling files such as `auth.json`.
 */
function stripAoaMcpBlocks(existing: string, serverName: string): string {
  const targetHeaders = new Set([
    `[mcp_servers.${serverName}]`,
    `[mcp_servers.${serverName}.env]`,
  ]);
  const lines = existing.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const isTableHeader = /^\[[^\]]+\]$/.test(trimmed);
    if (isTableHeader) {
      skipping = targetHeaders.has(trimmed);
      if (skipping) continue;
    }
    if (skipping) continue;
    kept.push(line);
  }
  // Collapse trailing blank lines so re-appended blocks are separated by
  // exactly one blank line each run (idempotent output).
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") {
    kept.pop();
  }
  return kept.join("\n");
}

/**
 * Write/merge `<managedHomeDir>/config.toml` so that codex (run with
 * `CODEX_HOME` pointed at `managedHomeDir`) discovers and spawns the AoA
 * internal-agent MCP bridge.
 *
 * The managed CODEX_HOME is adapter-owned and holds only `auth.json` + this
 * file. To stay safe and idempotent we read any existing `config.toml`, strip
 * a prior `[mcp_servers.<serverName>]` (+ `.env`) block, preserve everything
 * else verbatim, then append a freshly-rendered block. `auth.json` is never
 * touched.
 */
export async function writeCodexMcpConfigToml(
  managedHomeDir: string,
  spec: CodexMcpBridgeSpec,
  serverName = "aoa",
): Promise<void> {
  return withCodexHomeConfigLock(managedHomeDir, async () => {
    await fs.mkdir(managedHomeDir, { recursive: true });
    const target = path.join(managedHomeDir, "config.toml");

    let existing = "";
    try {
      existing = await fs.readFile(target, "utf8");
    } catch {
      existing = "";
    }

    const preserved = stripAoaMcpBlocks(existing, serverName);
    const block = renderMcpBlock(spec, serverName);
    const body = preserved.trim().length > 0 ? `${preserved}\n\n${block}\n` : `${block}\n`;

    await fs.writeFile(target, body, "utf8");
  });
}

/**
 * Strip any existing top-level `model = ...` line(s) from the config.toml body,
 * BEFORE the first `[table]` header so we never touch a `[profiles.x]` /
 * `[model_providers.x]` model key (mirrors readSharedCodexModel's top-level-only
 * scan in codex-home.ts). Lines inside/after any table header are preserved.
 */
function stripTopLevelModelLine(existing: string): string {
  const lines = existing.split(/\r?\n/);
  const kept: string[] = [];
  let inTable = false;
  for (const line of lines) {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) inTable = true;
    if (!inTable && /^\s*model\s*=/.test(line)) continue;
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();
  return kept.join("\n");
}

/**
 * Write/merge a top-level `model = "<model>"` line into
 * `<managedHomeDir>/config.toml` so a supervised `codex app-server` run (which
 * has no per-turn --model CLI surface) uses the resolved chat model instead of
 * codex's compiled-in default (gpt-5.3-codex, which 400s on a ChatGPT login).
 *
 * Idempotent + non-destructive: reads any existing config.toml, strips a prior
 * top-level `model =` line, preserves everything else (incl. the MCP bridge
 * block written by writeCodexMcpConfigToml), then prepends the fresh model line.
 * auth.json is never touched.
 */
export async function writeCodexModelConfigToml(
  managedHomeDir: string,
  model: string,
): Promise<void> {
  return withCodexHomeConfigLock(managedHomeDir, async () => {
    await fs.mkdir(managedHomeDir, { recursive: true });
    const target = path.join(managedHomeDir, "config.toml");

    let existing = "";
    try {
      existing = await fs.readFile(target, "utf8");
    } catch {
      existing = "";
    }

    const preserved = stripTopLevelModelLine(existing);
    const modelLine = `model = ${tomlString(model)}`;
    const body =
      preserved.trim().length > 0 ? `${modelLine}\n\n${preserved}\n` : `${modelLine}\n`;

    await fs.writeFile(target, body, "utf8");
  });
}

/**
 * Remove a stale top-level `model = ...` line from managed CODEX_HOME while
 * preserving all other config, notably the AoA MCP bridge block. Used by
 * API-key auth mode where the adapter intentionally does not force a
 * subscription-safe chat model.
 */
export async function clearCodexModelConfigToml(
  managedHomeDir: string,
): Promise<void> {
  return withCodexHomeConfigLock(managedHomeDir, async () => {
    const target = path.join(managedHomeDir, "config.toml");
    const existing = await fs.readFile(target, "utf8").catch(() => "");
    if (!existing) return;

    const preserved = stripTopLevelModelLine(existing);
    await fs.writeFile(
      target,
      preserved.trim().length > 0 ? `${preserved}\n` : "",
      "utf8",
    );
  });
}
