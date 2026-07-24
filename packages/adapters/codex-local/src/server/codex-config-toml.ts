import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Serialize ALL config.toml mutations for a given managed home. The home is
 * per-AGENT (`prepareManagedCodexHome(..., companyId, agentId, ...)`), so two
 * agents no longer share a file — but one agent can still have concurrent runs
 * (and the model writer + MCP writer both touch the same file within a single
 * run). Both writers here do read-strip-rewrite; without serialization a concurrent
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
 * Ownership fence (Plan 2b B5). AoA's `[mcp_servers.*]` tables live between
 * these two sentinel comment lines, so a later run can remove ALL previously
 * AoA-owned server blocks without knowing the names it wrote. Without the fence
 * there is no way to enumerate prior writes: once a connector block is written,
 * disabling or deleting the connector would leave its `[mcp_servers.<name>]`
 * table in the file forever and the agent would keep the tool. Content OUTSIDE
 * the fence is user-authored and is never touched.
 *
 * EXCEPTION: the top-level `model = "..."` line written by
 * {@link writeCodexModelConfigToml} is deliberately kept OUTSIDE (above) the
 * fence — TOML requires top-level keys to precede the first table header, and
 * the fence opens immediately before a table. That line is AoA-owned too, but it
 * is managed by its own strip (`stripTopLevelModelLine`), not by the fence.
 *
 * The PREFIXES are the persisted on-disk contract — changing them orphans the
 * fenced content in every already-written config.toml. The human-facing tail of
 * each line is cosmetic: detection matches the prefix plus a terminator, so the
 * wording can be reworded later without stranding existing files.
 */
const AOA_MANAGED_FENCE_START_PREFIX = "# >>> aoa-managed";
const AOA_MANAGED_FENCE_END_PREFIX = "# <<< aoa-managed";
export const AOA_MANAGED_FENCE_START = `${AOA_MANAGED_FENCE_START_PREFIX} (do not edit below; regenerated each run)`;
// Self-describing on purpose: a bare `# <<< aoa-managed` reads like a stray
// comment, and a user tidying the file who deletes it would orphan the start
// fence. (An orphan start is now inert — see findFencedRegions — but the file
// would still silently stop being cleaned.)
export const AOA_MANAGED_FENCE_END = `${AOA_MANAGED_FENCE_END_PREFIX} (end of AoA-managed block; do not remove this line)`;

/**
 * A fence line is the prefix followed by a TERMINATOR — end-of-line, a space, or
 * `(`. Without this, `startsWith(prefix)` also swallows a user comment such as
 * `# >>> aoa-managed-notes for myself`, which would make the rest of their file
 * look AoA-owned.
 */
function isFenceLine(trimmed: string, prefix: string): boolean {
  if (!trimmed.startsWith(prefix)) return false;
  const rest = trimmed.slice(prefix.length);
  return rest.length === 0 || rest.startsWith(" ") || rest.startsWith("(");
}

/**
 * Locate MATCHED fence regions as inclusive `[startIdx, endIdx]` line ranges.
 *
 * An UNMATCHED start fence is NOT a fence: it is left in place along with
 * everything after it. A user comment that happens to look like a start fence
 * (or a start fence whose closing line someone deleted while tidying the file)
 * must never cause the remainder of their config to be deleted — data loss is a
 * far worse failure than leaving a stale AoA block behind, and the legacy
 * per-name strip still cleans the unfenced `[mcp_servers.aoa]` block anyway.
 *
 * Pairing is NEAREST-start-wins: a second start before any end supersedes the
 * first, so at worst we strip the smallest plausible region. The writer only
 * ever emits one matched pair; this only matters for hand-edited files.
 */
function findFencedRegions(lines: string[]): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  let openIdx: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (isFenceLine(trimmed, AOA_MANAGED_FENCE_START_PREFIX)) {
      openIdx = i;
      continue;
    }
    if (openIdx !== null && isFenceLine(trimmed, AOA_MANAGED_FENCE_END_PREFIX)) {
      regions.push([openIdx, i]);
      openIdx = null;
    }
  }
  // openIdx !== null here == unmatched start: intentionally dropped, not stripped.
  return regions;
}

/**
 * Remove every MATCHED fenced AoA-managed region (fence lines inclusive) from
 * existing TOML text, preserving all other content verbatim. Multiple regions
 * are handled (defensive — the writer emits one).
 */
function stripAoaManagedFencedRegions(existing: string): string {
  const lines = existing.split(/\r?\n/);
  const regions = findFencedRegions(lines);
  if (regions.length === 0) return trimTrailingBlankLines(lines).join("\n");

  const dropped = new Set<number>();
  for (const [start, end] of regions) {
    for (let i = start; i <= end; i++) dropped.add(i);
  }
  const kept = lines.filter((_line, idx) => !dropped.has(idx));
  return trimTrailingBlankLines(kept).join("\n");
}

/**
 * Collapse trailing blank lines so re-appended blocks are separated by exactly
 * one blank line each run (idempotent output). Mutates + returns the array.
 */
function trimTrailingBlankLines(lines: string[]): string[] {
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

/**
 * The strippers work in LF internally (they split on `/\r?\n/`). Detect the
 * file's existing convention so a CRLF config.toml — the norm when a Windows
 * user has edited it — is written back as CRLF rather than silently rewritten
 * to LF. A file with no newline at all (or a brand-new file) uses LF.
 */
function detectEol(existing: string): "\r\n" | "\n" {
  return existing.includes("\r\n") ? "\r\n" : "\n";
}

function applyEol(body: string, eol: "\r\n" | "\n"): string {
  return eol === "\n" ? body : body.replace(/\r?\n/g, eol);
}

/**
 * Write `contents` to `target` atomically: write a unique sibling temp file,
 * then `rename` it over the destination. A rename is atomic on both POSIX and
 * NTFS, so a crashed/killed run can never leave a half-written config.toml —
 * a reader sees either the old file or the new one, never a truncated fence.
 * The temp file is always removed on failure.
 *
 * Windows retry: an antivirus/indexer/editor holding a transient handle on the
 * destination makes `rename` fail with EPERM/EACCES/EBUSY. Those are momentary,
 * so retry a few times with a short backoff before surfacing the error.
 */
async function writeFileAtomically(target: string, contents: string): Promise<void> {
  const tempPath = `${target}.tmp-${process.pid}-${randomUUID()}`;
  const handle = await fs.open(tempPath, "wx");
  try {
    await handle.writeFile(contents, "utf8");
    await handle.close();
  } catch (err) {
    await handle.close().catch(() => {});
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw err;
  }

  const retryableCodes = new Set(["EPERM", "EACCES", "EBUSY"]);
  const maxAttempts = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(tempPath, target);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code ?? "";
      if (attempt >= maxAttempts || !retryableCodes.has(code)) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    }
  }
}

/** Wrap AoA-owned body text in the ownership fence. */
function fenceAoaManaged(body: string): string {
  return `${AOA_MANAGED_FENCE_START}\n${body}\n${AOA_MANAGED_FENCE_END}`;
}

/**
 * Write/merge `<managedHomeDir>/config.toml` so that codex (run with
 * `CODEX_HOME` pointed at `managedHomeDir`) discovers and spawns the AoA
 * internal-agent MCP bridge.
 *
 * The managed CODEX_HOME is adapter-owned and holds only `auth.json` + this
 * file. To stay safe and idempotent we read any existing `config.toml`, strip
 * every AoA-managed fenced region (plus a legacy unfenced
 * `[mcp_servers.<serverName>]` (+ `.env`) block), preserve everything else
 * verbatim, then append a freshly-rendered, fenced block. `auth.json` is never
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

    // Two-pass strip:
    //  1. the ownership fence removes EVERYTHING a previous run wrote (incl.
    //     blocks whose names this run knows nothing about), and
    //  2. the legacy per-name pass removes an UNFENCED `[mcp_servers.<name>]`
    //     left by a pre-fence writer, so an existing file upgrades on the first
    //     write instead of ending up with two `aoa` blocks.
    const preserved = stripAoaMcpBlocks(stripAoaManagedFencedRegions(existing), serverName);
    const block = fenceAoaManaged(renderMcpBlock(spec, serverName));
    const body = preserved.trim().length > 0 ? `${preserved}\n\n${block}\n` : `${block}\n`;

    await writeFileAtomically(target, applyEol(body, detectEol(existing)));
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

    await writeFileAtomically(target, applyEol(body, detectEol(existing)));
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
    await writeFileAtomically(
      target,
      applyEol(preserved.trim().length > 0 ? `${preserved}\n` : "", detectEol(existing)),
    );
  });
}
