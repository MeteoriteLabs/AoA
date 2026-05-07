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
  // os.tmpdir() is needed for tsx's compile cache when workers are TypeScript.
  // Node v24+ requires separate --allow-fs-write flags per path (comma lists removed).
  const tmpDir = os.tmpdir();
  const args: string[] = [
    "--permission",
    "--allow-fs-read=*",
    `--allow-fs-write=${scratchDir}`,
    `--allow-fs-write=${tmpDir}`,
    "--allow-worker",    // plugins may use Worker threads internally
  ];

  // Node.js --permission model does not have a --allow-net flag (that's Deno).
  // Network access is unrestricted in the Node permission model; the capability
  // is tracked in the manifest for future enforcement at the RPC layer.
  void capabilities;

  return args;
}

export function pluginScratchDir(pluginId: string): string {
  return path.join(os.homedir(), ".aoa", "plugins", pluginId, "scratch");
}
