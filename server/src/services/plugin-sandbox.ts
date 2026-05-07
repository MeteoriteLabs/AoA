import path from "node:path";
import os from "node:os";
import type { PluginCapability, PluginTrustTier } from "@armyofagents/shared";

export interface SandboxOptions {
  pluginId: string;
  trustTier: PluginTrustTier;
  capabilities: PluginCapability[];
}

export function buildSandboxExecArgv(opts: SandboxOptions): string[] {
  const { pluginId, trustTier, capabilities } = opts;

  if (trustTier === "core") {
    return [];
  }

  const scratchDir = path.join(os.homedir(), ".aoa", "plugins", pluginId, "scratch");
  const args: string[] = [
    "--permission",
    `--allow-fs-read=${scratchDir}`,
    `--allow-fs-write=${scratchDir}`,
  ];

  if (capabilities.includes("http.outbound")) {
    args.push("--allow-net");
  }

  return args;
}

export function pluginScratchDir(pluginId: string): string {
  return path.join(os.homedir(), ".aoa", "plugins", pluginId, "scratch");
}
