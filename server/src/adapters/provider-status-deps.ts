/**
 * Real (production) dependencies for getProviderStatus (Unit A).
 *
 * Wires the pure provider-status.ts to the actual codex-local adapter helpers
 * so the crew runner gets live auth-mode detection instead of test stubs.
 *
 * Import pattern: resolveManagedCodexHomeDir is imported statically (sync fn);
 * readSharedCodexModel mirrors the dynamic-import pattern in cli-mode.ts:444
 * to stay consistent with how that file consumes the same package entrypoint.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveManagedCodexHomeDir } from "@armyofagents/adapter-codex-local/server";
import type { ProviderStatusDeps } from "./provider-status.js";

/**
 * Read <homeDir>/auth.json and return the parsed object.
 * Returns null on ANY error (missing file, bad JSON) — never throws.
 */
async function readAuthJson(homeDir: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(homeDir, "auth.json"), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Production ProviderStatusDeps wired to the real codex-local helpers.
 *
 * isInstalled: resolveModel never reads status.installed in the current
 * provider-switching engine (Phase 1). A real probe lands with Unit D.
 * // installed not consumed by resolveModel; real detection lands with the Unit D probe.
 */
export const realProviderStatusDeps: ProviderStatusDeps = {
  resolveManagedCodexHomeDir: (env: NodeJS.ProcessEnv, companyId: string): string =>
    resolveManagedCodexHomeDir(env, companyId),

  readAuthJson,

  readSharedCodexModel: async (): Promise<string | null> => {
    // Mirror cli-mode.ts:444 — dynamic import from the package's server entry.
    const { readSharedCodexModel } =
      await import("@armyofagents/adapter-codex-local/server");
    return readSharedCodexModel();
  },

  // installed not consumed by resolveModel; real detection lands with the Unit D probe.
  isInstalled: async () => true,
};
