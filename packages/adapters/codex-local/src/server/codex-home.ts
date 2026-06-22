import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export interface PrepareManagedCodexHomeOptions {
  apiKey?: string | null;
}

export async function writeApiKeyAuthJson(home: string, apiKey: string): Promise<void> {
  await fs.mkdir(home, { recursive: true });
  const target = path.join(home, "auth.json");
  await fs.rm(target, { force: true });
  await fs.writeFile(target, JSON.stringify({ OPENAI_API_KEY: apiKey }), { mode: 0o600 });
}

export function resolveSharedCodexHomeDir(env: NodeJS.ProcessEnv): string {
  return env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}

/**
 * Read the `model` value from the user's SHARED `~/.codex/config.toml`
 * (resolved via {@link resolveSharedCodexHomeDir} — NOT a per-session
 * managed home). Used as a fallback model source for the Commander codex
 * chat spawn when the AoA config has no codex-compatible model.
 *
 * - Matches the first `model = "..."` (or bare `model = x`) line.
 * - Ignores commented (`#`) lines.
 * - Never throws: returns `null` on a missing file or absent key.
 *
 * IMPORTANT: call with the SERVER process env (not the per-session
 * CODEX_HOME), so it reads the shared home, not the bridge-only managed one.
 */
export async function readSharedCodexModel(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const sharedHome = resolveSharedCodexHomeDir(env);
  const target = path.join(sharedHome, "config.toml");
  const content = await fs.readFile(target, "utf8").catch(() => null);
  if (!content) return null;
  // Scan ONLY the top-level section (everything before the first `[table]`
  // header) so a `[profiles.x]`/`[model_providers.x]` `model =` can never be
  // mistaken for the active model (REVIEW FIX C4/S4). Column-0 anchor + single
  // OR double quote handling (REVIEW FIX C5).
  const topLevel = content.split(/^\[/m)[0];
  const m = topLevel.match(/^model\s*=\s*['"]?([^'"\n#]+?)['"]?\s*(?:#.*)?$/m);
  return m ? m[1].trim() : null;
}

/**
 * Copy `<sharedHome>/auth.json` → `<targetHomeDir>/auth.json` when the
 * source exists. Used to provision codex credentials into a managed /
 * per-session CODEX_HOME so `codex exec` run with that home is
 * authenticated (otherwise `codex exec` 401s with no bearer/basic auth).
 *
 * - `targetHomeDir` is created recursively if absent (defensive — the
 *   caller may pass a dir that does not yet exist).
 * - Returns `true` iff a file was copied. Never throws on a missing
 *   source: returns `false` so callers can no-op gracefully (the user
 *   may simply not have a shared codex login).
 * - No-ops to `true` if source and target resolve to the same path
 *   (sharing one home is already self-authenticated).
 *
 * `copySharedAuthJson` (used by `prepareManagedCodexHome`) delegates to
 * this helper so the copy semantics stay single-sourced.
 */
export async function ensureCodexAuthInHome(
  targetHomeDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const sharedHome = resolveSharedCodexHomeDir(env);
  const source = path.join(sharedHome, "auth.json");
  const target = path.join(targetHomeDir, "auth.json");
  if (path.resolve(source) === path.resolve(target)) return true;

  const sourceStat = await fs.stat(source).catch(() => null);
  if (!sourceStat?.isFile()) return false;

  await fs.mkdir(targetHomeDir, { recursive: true });
  await fs.rm(target, { force: true });
  await fs.copyFile(source, target);
  if (process.platform !== "win32") {
    await fs.chmod(target, 0o600).catch(() => {});
  }
  return true;
}

async function copySharedAuthJson(sharedHome: string, managedHome: string): Promise<boolean> {
  return ensureCodexAuthInHome(managedHome, { CODEX_HOME: sharedHome });
}

export function resolveManagedCodexHomeDir(env: NodeJS.ProcessEnv, companyId: string): string {
  const root = resolveSharedCodexHomeDir(env);
  return path.join(root, "aoa-instances", companyId);
}

export async function prepareManagedCodexHome(
  env: NodeJS.ProcessEnv,
  onLog: (msg: string) => void,
  companyId: string,
  opts: PrepareManagedCodexHomeOptions,
): Promise<string> {
  const sharedHome = resolveSharedCodexHomeDir(env);
  const home = resolveManagedCodexHomeDir(env, companyId);
  await fs.mkdir(home, { recursive: true });

  if (opts.apiKey && opts.apiKey.trim().length > 0) {
    await writeApiKeyAuthJson(home, opts.apiKey.trim());
    onLog(`[aoa] Wrote managed Codex auth.json for company ${companyId}`);
  } else {
    const copied = await copySharedAuthJson(sharedHome, home);
    if (copied) {
      onLog(`[aoa] Copied shared Codex auth.json into managed home for company ${companyId}`);
    } else {
      const target = path.join(home, "auth.json");
      try {
        const stat = await fs.lstat(target);
        if (stat.isFile()) {
          await fs.rm(target, { force: true });
          onLog(`[aoa] Removed stale Codex auth.json (no apiKey configured)`);
        }
      } catch {
        // File doesn't exist; nothing to clean.
      }
    }
  }

  return home;
}
