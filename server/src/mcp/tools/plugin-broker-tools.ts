// server/src/mcp/tools/plugin-broker-tools.ts
//
// U10 (Cloud Execution Isolation / E2B, Wave 5) — plugin tool descriptors
// for the HTTP MCP broker (mcp/server.ts).
//
// Plugin tools run on a HOST-resident worker process — a forked child
// process on the control-plane host, never inside an E2B-sandboxed VM. A
// sandboxed (or any other) agent run discovers them here (tools/list) and
// calls them (tools/call, U10-c) ONLY through this broker's authz-gated
// path — strictly agent-actor-only.
import type { AgentToolDescriptor, PluginToolDispatcher } from "../../services/plugin-tool-dispatcher.js";
import { logger } from "../../middleware/logger.js";

const log = logger.child({ service: "plugin-broker-tools" });

function readPluginDispatcher(): PluginToolDispatcher | undefined {
  return (globalThis as { __paperclipPluginToolDispatcher?: PluginToolDispatcher })
    .__paperclipPluginToolDispatcher;
}

/**
 * List a company's plugin tools in MCP tool-definition shape, for the
 * broker's `tools/list` response.
 *
 * Best-effort — mirrors the existing plugin-tool-injection try/catch in
 * heartbeat.ts (~4494-4511): a dispatcher error degrades the tool list
 * (yields `[]`), it never breaks the broker's `tools/list` response.
 */
export function readPluginToolDefinitions(
  companyId: string,
): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  try {
    const dispatcher = readPluginDispatcher();
    if (!dispatcher) return [];
    const descriptors: AgentToolDescriptor[] = dispatcher.listToolsForAgent({ companyId });
    return descriptors.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parametersSchema,
    }));
  } catch (err) {
    log.warn(
      { companyId, err },
      "failed to read plugin tool definitions for broker tools/list; continuing without plugin tools",
    );
    return [];
  }
}
