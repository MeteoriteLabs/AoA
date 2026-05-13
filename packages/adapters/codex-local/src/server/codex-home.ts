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

async function copySharedAuthJson(sharedHome: string, managedHome: string): Promise<boolean> {
  const source = path.join(sharedHome, "auth.json");
  const target = path.join(managedHome, "auth.json");
  if (path.resolve(source) === path.resolve(target)) return true;

  const sourceStat = await fs.stat(source).catch(() => null);
  if (!sourceStat?.isFile()) return false;

  await fs.rm(target, { force: true });
  await fs.copyFile(source, target);
  if (process.platform !== "win32") {
    await fs.chmod(target, 0o600).catch(() => {});
  }
  return true;
}

export function resolveSharedCodexHomeDir(env: NodeJS.ProcessEnv): string {
  return env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
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
