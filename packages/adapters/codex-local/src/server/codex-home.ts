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
  const home = resolveManagedCodexHomeDir(env, companyId);
  await fs.mkdir(home, { recursive: true });

  if (opts.apiKey && opts.apiKey.trim().length > 0) {
    await writeApiKeyAuthJson(home, opts.apiKey.trim());
    onLog(`[aoa] Wrote managed Codex auth.json for company ${companyId}`);
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

  return home;
}
