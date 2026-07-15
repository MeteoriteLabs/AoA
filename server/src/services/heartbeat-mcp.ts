import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildMcpBridgeSpec, buildMcpConfig, type McpBridgeSpec, type McpConfigParams } from "./internal-agent/cli-mode.js";

export interface HeartbeatMcpDelivery {
  config: Record<string, unknown>;
  mcpBridge: McpBridgeSpec;
  cleanup: () => Promise<void>;
}

/** Minimum task-work surface exposed to an organization-agent heartbeat run. */
export const ORG_HEARTBEAT_TOOL_ALLOWLIST = [
  "get_task",
  "get_heartbeat_context",
  "post_task_comment",
  "attach_task_artifact",
  "set_task_status",
  "ask_human",
  "ask_founder",
] as const;

export function resolveHeartbeatEffectiveAutonomy(input: {
  companyAutonomyLevel: number | null | undefined;
  discussionAutonomyLevel: number | null | undefined;
}): number {
  const resolved = input.discussionAutonomyLevel ?? input.companyAutonomyLevel ?? 0;
  return resolved === 1 || resolved === 2 ? resolved : 0;
}

export async function prepareHeartbeatMcpDelivery(input: {
  adapterType: string;
  agentId: string;
  runId: string;
  config: Record<string, unknown>;
  params: McpConfigParams;
}): Promise<HeartbeatMcpDelivery> {
  const mcpBridge = buildMcpBridgeSpec(input.params);
  if (input.adapterType !== "claude_local") {
    return {
      config: input.config,
      mcpBridge,
      cleanup: async () => undefined,
    };
  }

  const configPath = path.join(
    tmpdir(),
    `aoa-heartbeat-mcp-${input.agentId}-${input.runId}.json`,
  );
  await fs.writeFile(configPath, JSON.stringify(buildMcpConfig(input.params), null, 2), "utf8");
  const argKey = Array.isArray(input.config.extraArgs) ? "extraArgs" : "args";
  const existingArgs = Array.isArray(input.config[argKey])
    ? input.config[argKey].filter((value): value is string => typeof value === "string")
    : [];

  return {
    config: {
      ...input.config,
      [argKey]: ["--mcp-config", configPath, "--strict-mcp-config", ...existingArgs],
    },
    mcpBridge,
    cleanup: async () => {
      await fs.unlink(configPath).catch(() => undefined);
    },
  };
}
