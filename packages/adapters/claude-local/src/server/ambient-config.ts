import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Ambient Claude-config isolation (D9) — the strip list claude_local applies to
 * CREW runs (`kind='aoa'`).
 *
 * A crew run used to inherit the operator's entire environment, so the host
 * machine's `~/.claude` bled straight into the agent: SessionStart hooks,
 * third-party skills, plugins — observed live hijacking a crew run. It also
 * handed the child the server's ambient `ANTHROPIC_API_KEY`, which flips the
 * CLI from subscription auth to API-key auth behind the founder's back.
 *
 * Mechanism is `mergeChildEnv`'s `unsetEnvPrefixes` (adapter-utils), NOT a
 * parallel env builder — so the "overlay wins" and Windows case-folding rules
 * are the SAME ones codex's `unsetEnvKeys` strip has been using.
 *
 * This module holds the strip list, the keep-list, and the per-run config-home
 * factory the local execute path uses.
 */

/**
 * Host-config classes a crew run must not inherit. A PREFIX class rather than an
 * enumerated key list: an enumeration silently leaks every variable Claude Code
 * introduces after we wrote it down, and D9 is that crew agents see *nothing*
 * from the host config.
 *
 * `CLAUDE_CONFIG_DIR` needs no exception here — the caller pins it in the
 * overlay env, and an overlay-set key always survives the strip.
 *
 * That same overlay-wins rule is how an env-based auth mode is kept for a crew
 * agent: set it on the agent's `adapterConfig.env` (e.g. `CLAUDE_CODE_USE_BEDROCK`,
 * `ANTHROPIC_BEDROCK_BASE_URL`, `ANTHROPIC_BASE_URL`, or a dedicated
 * `CLAUDE_CONFIG_DIR`) and it survives while the ambient copy is dropped.
 * Deliberate: an operator's per-agent choice is explicit, the host machine's is not.
 */
export const CLAUDE_AMBIENT_CONFIG_UNSET_PREFIXES: readonly string[] = [
  "CLAUDE_",
  "ANTHROPIC_",
];

/**
 * Variables that MUST survive the strip. None of them match the prefixes above,
 * so this list is a regression guard, not a filter: it fails loudly if the
 * prefix list is ever widened into something that would take the agent's ability
 * to do real work with it.
 *
 * 🚨 `HOME` / `USERPROFILE` are never relocated or stripped — git, SSH and npm
 * all resolve through them for the tools the agent launches — and `PATH` is how
 * the CLI is found at all. Isolating the Claude CONFIG is not the same as
 * sandboxing the process, and conflating the two breaks every agent run.
 */
export const CLAUDE_AMBIENT_CONFIG_KEEP_KEYS: readonly string[] = [
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "SystemRoot",
  "COMSPEC",
  "SHELL",
  "TMP",
  "TEMP",
];

/**
 * Create the per-run directory `CLAUDE_CONFIG_DIR` is pinned to, so the CLI
 * reads its config from a location the operator's `~/.claude` cannot reach.
 *
 * This task only PINS the directory. Provisioning what lives inside it
 * (credentials) is T3 — until then the directory is empty by design.
 */
export async function createIsolatedClaudeConfigDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "aoa-claude-config-"));
}
