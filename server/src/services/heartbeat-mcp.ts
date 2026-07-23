import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { McpServerSpec } from "@armyofagents/adapter-utils";
import { buildMcpBridgeSpec, buildMcpConfig, type McpBridgeSpec, type McpConfigParams } from "./internal-agent/cli-mode.js";
import { stripUserMcpArgs } from "./mcp-arg-sanitize.js";

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
  /**
   * External MCP connector specs (server name -> spec), spliced into the
   * generated `--mcp-config` file alongside `aoa`. Built by `buildConnectorSpecs`
   * at the heartbeat call site. Reserved-name + null-prototype safe: the actual
   * merge is `mergeExternalMcpServers` inside `buildMcpConfig`.
   */
  extraMcpServers?: Record<string, McpServerSpec>;
  /**
   * `AOA_MCP_<NAME>_TOKEN -> real secret` map from `buildConnectorSpecs`. Merged
   * into the DELIVERED `config.env` (never into the config FILE) so the spawned
   * `claude` process env carries the tokens the config file references as
   * `${AOA_MCP_*_TOKEN}` placeholders.
   */
  connectorEnv?: Record<string, string>;
}): Promise<HeartbeatMcpDelivery> {
  const mcpBridge = buildMcpBridgeSpec(input.params);
  if (input.adapterType !== "claude_local") {
    // NOTE: connectorEnv is intentionally NOT merged here. This early return is
    // the non-`claude_local` path, which delivers `input.config` untouched.
    // Plan 1 is claude-only; non-claude adapters receiving no connector env is
    // acceptable for now. Plan 2 wires connectors into non-claude adapters via
    // `ctx.mcpServers`, not through this delivery function. Do not merge
    // connectorEnv into this return without also delivering the specs.
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
  await fs.writeFile(
    configPath,
    JSON.stringify(
      buildMcpConfig({ ...input.params, extraMcpServers: input.extraMcpServers }),
      null,
      2,
    ),
    "utf8",
  );
  const argKey = Array.isArray(input.config.extraArgs) ? "extraArgs" : "args";
  const existingArgs = Array.isArray(input.config[argKey])
    ? input.config[argKey].filter((value): value is string => typeof value === "string")
    : [];

  const deliveredConfig: Record<string, unknown> = {
    ...input.config,
    // Strip any user-typed --mcp-config/--strict-mcp-config from the user tail
    // ONLY (Task 12). AoA's own flags below are prepended AFTER the strip and
    // must never pass through stripUserMcpArgs — doing so would delete AoA's own
    // config and break every claude_local MCP run.
    [argKey]: ["--mcp-config", configPath, "--strict-mcp-config", ...stripUserMcpArgs(existingArgs)],
  };

  // REGRESSION GUARD: only touch `config.env` when connectors actually exist.
  // The no-connectors path must deliver a config byte-identical to before this
  // task — spreading an absent/undefined `config.env` would coerce it to `{}`
  // and change the shape. Connector secrets ride in the spawn env (execute.ts
  // merges config.env into the child process env), NOT in the config FILE,
  // which only holds `${AOA_MCP_*_TOKEN}` placeholders. Merge AFTER config.env
  // so a connector token can never be shadowed by an existing key of the same
  // name.
  if (input.connectorEnv && Object.keys(input.connectorEnv).length > 0) {
    deliveredConfig.env = {
      ...(input.config.env as Record<string, string> | undefined),
      ...input.connectorEnv,
    };
  }

  return {
    config: deliveredConfig,
    mcpBridge,
    cleanup: async () => {
      await fs.unlink(configPath).catch(() => undefined);
    },
  };
}
