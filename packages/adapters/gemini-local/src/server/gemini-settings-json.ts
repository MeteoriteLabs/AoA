import fs from "node:fs/promises";
import path from "node:path";

/**
 * T2.2 — gemini MCP bridge spec writer.
 *
 * Mirrors opencode-config-json.ts but for gemini's `.gemini/settings.json`
 * discovery mechanism. Pre-T2.2 gemini crew agents spawned without MCP
 * tools (the runner passed ctx.mcpBridge but the adapter ignored it).
 * Same failure mode codex had pre-MX2 and opencode had pre-T2.1; this
 * commit closes the parallel gap.
 *
 * SHAPE (claude_desktop_config.json-compatible — gemini's accepted format):
 *
 *   {
 *     "mcpServers": {
 *       "aoa": {
 *         "command": "node",
 *         "args": ["/path/to/mcp-bridge.js"],
 *         "env": { ... }
 *       }
 *     }
 *   }
 *
 * Note: this differs from opencode's shape. opencode wants `command` as a
 * single array (cmd + args together) under `mcp.<name>`; gemini wants the
 * claude-shape with `command: string` + `args: string[]` separately under
 * `mcpServers.<name>`. Bridge spec → schema mapping happens here.
 *
 * DISCOVERY: gemini reads `.gemini/settings.json` from the cwd (workspace
 * scope) and `~/.gemini/settings.json` (user scope). We write to the
 * workspace scope so we never touch the user's global config — keeps the
 * pollution radius bounded to the adapter-controlled workspace.
 *
 * IDEMPOTENT + ERROR-TOLERANT (same policies as opencode T2.1):
 *  - re-running with same spec is byte-identical
 *  - preserves unrelated keys (theme, contextFileName, other mcp servers)
 *  - strips the prior mcpServers.{serverName} before splicing the new one
 *    so spec changes propagate cleanly (no stale env)
 *  - parse-fail on existing file → overwrite with a fresh config containing
 *    just the aoa block. Pinned by tests so a future "preserve" choice is
 *    explicit.
 */

/** Provider-neutral MCP bridge spec — same shape codex/opencode adapters use.
 *  Local copy of the shape; this package must not import from the server. */
export interface GeminiMcpBridgeSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Write/merge `<cwd>/.gemini/settings.json` so gemini discovers the AoA
 * internal-agent MCP bridge. Idempotent. Preserves unrelated keys.
 */
export async function writeGeminiMcpSettingsJson(
  cwd: string,
  spec: GeminiMcpBridgeSpec,
  serverName = "aoa",
): Promise<void> {
  const geminiDir = path.join(cwd, ".gemini");
  await fs.mkdir(geminiDir, { recursive: true });
  const target = path.join(geminiDir, "settings.json");

  let existing: Record<string, unknown> = {};
  try {
    const text = await fs.readFile(target, "utf8");
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or unparseable — treat as empty config (overwrite policy).
    existing = {};
  }

  const existingServers =
    typeof existing.mcpServers === "object"
    && existing.mcpServers !== null
    && !Array.isArray(existing.mcpServers)
      ? { ...(existing.mcpServers as Record<string, unknown>) }
      : {};
  delete existingServers[serverName];

  const nextBlock = {
    // Claude-shape: command as string, args as string[]. (opencode's "command
    // as combined array" shape is the OTHER convention — easy to confuse.)
    command: spec.command,
    args: [...spec.args],
    env: { ...spec.env },
  };

  const next = {
    ...existing,
    mcpServers: {
      ...existingServers,
      [serverName]: nextBlock,
    },
  };

  // 2-space indent + trailing newline (same as opencode T2.1).
  //
  // T2.2.1 (codex finding P1): atomic write. See opencode-config-json.ts
  // for the full rationale — same bug class, same fix. We write into the
  // `.gemini/` dir (already created above) so the temp file is on the same
  // filesystem as the target, which is what fs.rename() needs to be atomic.
  // Windows requires the EPERM/EBUSY retry loop because concurrent renames
  // against the same target briefly fail with the destination locked —
  // POSIX never sees this.
  const body = JSON.stringify(next, null, 2) + "\n";
  const tempName = `settings.json.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const tempPath = path.join(geminiDir, tempName);
  await fs.writeFile(tempPath, body, "utf8");
  try {
    await renameWithRetry(tempPath, target);
  } catch (err) {
    // Best-effort cleanup so a failing rename doesn't leak a temp file.
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
}

/**
 * fs.rename() with retry on Windows EPERM/EBUSY. Identical contract to the
 * opencode adapter's renameWithRetry — POSIX rename is atomic and never
 * throws these codes for same-fs moves, so on Linux/Mac the loop exits on
 * attempt 1. Inlined rather than imported from a shared package because
 * (a) only 2 call sites and (b) this package must not depend on the
 * opencode-local package. If a 3rd call site emerges, factor out to
 * @armyofagents/adapter-utils.
 */
async function renameWithRetry(src: string, dst: string, maxAttempts = 10): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await fs.rename(src, dst);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") {
        throw err;
      }
      // Jittered backoff so retrying writers don't wake in lockstep.
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 10));
    }
  }
  throw lastErr;
}
