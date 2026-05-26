import fs from "node:fs/promises";
import path from "node:path";

/**
 * T2.1 — opencode MCP bridge spec writer.
 *
 * Mirrors codex-config-toml.ts but for opencode's `opencode.json` discovery
 * mechanism. Pre-T2.1, opencode crew agents spawned without MCP tools — the
 * runner passed `ctx.mcpBridge` to the adapter but the adapter ignored it,
 * so the LLM ran with no way to call `post_entry` / `submit_extracted_items`
 * / etc. Same failure mode codex had pre-MX2 (resolved by the codex.toml
 * writer); T2.1 closes the parallel gap for opencode.
 *
 * SHAPE (per opencode docs research — v1-completion plan section 2.1):
 *
 *   {
 *     "mcp": {
 *       "aoa": {
 *         "type": "local",
 *         "command": ["node", "/path/to/mcp-bridge.js"],
 *         "environment": { ... }
 *       }
 *     }
 *   }
 *
 * Note: `command` is a SINGLE array containing the command + all args
 * (opencode's shape), unlike codex's separate `command = "..."` +
 * `args = [...]` fields. The bridge spec we receive has them split, so we
 * concatenate here.
 *
 * DISCOVERY: opencode reads opencode.json from the current working
 * directory. The adapter writes to `<cwd>/opencode.json` — same dir
 * opencode spawns in. Pollution risk is low (file is opencode-specific
 * config; users typically gitignore it).
 *
 * IDEMPOTENCE: re-running with the same spec produces byte-identical
 * output. The previous `mcp.aoa` (or matching serverName) block is
 * STRIPPED before splicing the new one — prevents stale env carryover when
 * the spec changes mid-deployment.
 *
 * ERROR TOLERANCE: if opencode.json exists but is unparseable JSON (a user
 * left a trailing comma during hand-editing, etc.), we OVERWRITE it with
 * a fresh config containing just the aoa block. Choice rationale: better
 * to lose hand-edits than to silently orphan our MCP wiring; tests pin
 * this policy so a future "preserve corrupt files" change is explicit.
 */

/** Provider-neutral MCP bridge spec — same shape the codex adapter uses.
 *  Local copy of the shape; this package must not import from the server. */
export interface OpenCodeMcpBridgeSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Write/merge `<cwd>/opencode.json` so that opencode discovers and spawns
 * the AoA internal-agent MCP bridge. Idempotent. Preserves unrelated keys.
 * Strips the previous block for `serverName` before splicing the new one.
 */
export async function writeOpenCodeMcpConfigJson(
  cwd: string,
  spec: OpenCodeMcpBridgeSpec,
  serverName = "aoa",
): Promise<void> {
  await fs.mkdir(cwd, { recursive: true });
  const target = path.join(cwd, "opencode.json");

  let existing: Record<string, unknown> = {};
  try {
    const text = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // Either file doesn't exist or content isn't parseable JSON. Treat as
    // empty config — tests pin this "overwrite-on-parse-fail" policy.
    existing = {};
  }

  // Merge mcp.{serverName}: strip the previous block (no shallow-merge of
  // environment — full replace) and splice the new one.
  const existingMcp =
    typeof existing.mcp === "object" && existing.mcp !== null && !Array.isArray(existing.mcp)
      ? { ...(existing.mcp as Record<string, unknown>) }
      : {};
  delete existingMcp[serverName];

  const nextBlock = {
    type: "local",
    // opencode wants command + args together as a single array.
    command: [spec.command, ...spec.args],
    environment: { ...spec.env },
  };

  const next = {
    ...existing,
    mcp: {
      ...existingMcp,
      [serverName]: nextBlock,
    },
  };

  // 2-space indent matches the codex pattern's readability + makes diffs
  // useful when an operator inspects the file by hand. Trailing newline so
  // POSIX text-file tools don't complain.
  await fs.writeFile(target, JSON.stringify(next, null, 2) + "\n", "utf8");
}
