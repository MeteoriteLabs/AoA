import fs from "node:fs/promises";
import path from "node:path";

/**
 * Tools that require a permission decision from AoA before the CLI can
 * proceed.  Benign read-only tools (Read, Grep, Glob, LS, TodoWrite, …)
 * are intentionally omitted so they never trigger a prompt.
 */
export const PERMISSION_REQUIRING_TOOLS = [
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
] as const;

/** Pipe-separated regex matcher used in the Claude settings `hooks` block. */
const SCOPED_MATCHER = PERMISSION_REQUIRING_TOOLS.join("|");

export interface PreToolUseHook {
  type: "command";
  command: string;
  timeout: number;
}

export interface PreToolUseEntry {
  matcher: string;
  hooks: [PreToolUseHook];
}

export interface PreToolUseSettings {
  hooks: {
    PreToolUse: [PreToolUseEntry];
  };
}

/**
 * Build a Claude CLI `--settings` JSON object that wires the PreToolUse hook
 * to the AoA permission bridge forwarder.
 *
 * Design constraints:
 * - Returns ONLY the `hooks` key — no `permissions`, `mcpServers`, or `env`
 *   top-level keys — so the object can't clobber other run config when
 *   `--settings` replaces rather than merges.
 * - The endpoint URL and auth token are NOT embedded here; they travel via
 *   `AOA_RUNTIME_HOOK_URL` / `AOA_RUNTIME_HOOK_TOKEN` env vars injected when
 *   the CLI subprocess is spawned (Task 6).
 * - Transport is `type:"command"` (fail-CLOSED) — not native http which is
 *   fail-OPEN.
 */
export function buildPreToolUseSettings(input: {
  endpointUrl: string;
  timeoutSec: number;
  forwarderPath: string;
}): PreToolUseSettings {
  const { timeoutSec, forwarderPath } = input;

  const hook: PreToolUseHook = {
    type: "command",
    // node "<path>" — env vars carry the URL and token; nothing sensitive here
    command: `node "${forwarderPath}"`,
    timeout: timeoutSec,
  };

  const entry: PreToolUseEntry = {
    matcher: SCOPED_MATCHER,
    hooks: [hook],
  };

  return {
    hooks: {
      PreToolUse: [entry],
    },
  };
}

/**
 * Write `settings` as JSON to a file inside `dir` and return the full path.
 */
export async function writeRuntimeHookSettingsFile(
  dir: string,
  settings: PreToolUseSettings,
): Promise<string> {
  const filePath = path.join(dir, "aoa-runtime-hook-settings.json");
  await fs.writeFile(filePath, JSON.stringify(settings, null, 2), "utf-8");
  return filePath;
}
