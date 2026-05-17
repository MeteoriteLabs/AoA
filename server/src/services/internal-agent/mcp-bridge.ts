// server/src/services/internal-agent/mcp-bridge.ts
//
// Standalone MCP stdio server for CLI execution mode.
// Spawned by CLI tools via MCP config. Exposes all internal agent tools.

import type { AgentTool, ToolContext, ToolResult } from "./types.js";

// ── Tool Call Handler (pure, testable) ──────────────────────────────────────

interface ToolCallHandlerDeps {
  tools: AgentTool[];
  executeTool: (tool: AgentTool, params: unknown, ctx: ToolContext) => Promise<ToolResult>;
  toolContext: ToolContext;
}

interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export function createToolCallHandler(deps: ToolCallHandlerDeps) {
  return async function handleToolCall(
    name: string,
    args: unknown,
  ): Promise<McpToolResult> {
    const tool = deps.tools.find((t) => t.name === name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: '${name}'. Available: ${deps.tools.map((t) => t.name).join(", ")}` }],
        isError: true,
      };
    }

    try {
      const result = await deps.executeTool(tool, args, deps.toolContext);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: result.success,
              data: result.data,
              summary: result.summary,
              ...(result.error ? { error: result.error } : {}),
            }),
          },
        ],
        isError: !result.success,
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Tool execution error: ${err?.message ?? "Unknown"}` }],
        isError: true,
      };
    }
  };
}

// ── MCP Protocol Helpers ────────────────────────────────────────────────────

export function buildToolListResponse(tools: AgentTool[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }));
}

// ── Main (runs when executed as script) ─────────────────────────────────────

export async function startBridge(): Promise<void> {
  const readline = await import("node:readline");

  const companyId = process.env.AOA_SESSION_COMPANY_ID;
  const userId = process.env.AOA_SESSION_USER_ID;
  // C13: fail closed if the bridge is spawned without an explicit role
  // env var. Defaulting to "founder" here previously meant any direct
  // CLI invocation that forgot to set the env got founder-level access.
  const userRole = process.env.AOA_SESSION_USER_ROLE;
  if (!userRole) {
    process.stderr.write("MCP Bridge: Missing AOA_SESSION_USER_ROLE env var\n");
    process.exit(1);
  }

  if (!companyId || !userId) {
    process.stderr.write("MCP Bridge: Missing AOA_SESSION_COMPANY_ID or AOA_SESSION_USER_ID\n");
    process.exit(1);
  }

  // C13: capability set is comma-separated. Empty string → empty array
  // (which means every capability-gated tool will reject).
  const enabledCapabilitiesRaw = process.env.AOA_SESSION_ENABLED_CAPABILITIES ?? "";
  const enabledCapabilities = enabledCapabilitiesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // D2: AoA agent kind + tool allowlist. Absent → undefined (non-AoA path).
  const agentKind = process.env.AOA_AGENT_KIND || undefined;
  const toolAllowlistRaw = process.env.AOA_TOOL_ALLOWLIST ?? "";
  const toolAllowlist = toolAllowlistRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const { createDb } = await import("@armyofagents/db");
  const { createServiceContainer } = await import("./service-container.js");
  const { createToolRegistry, executeTool } = await import("./tool-registry.js");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    process.stderr.write("MCP Bridge: Missing DATABASE_URL\n");
    process.exit(1);
  }
  const db = createDb(dbUrl);
  const services = createServiceContainer(db);
  const tools = createToolRegistry();

  const toolContext: ToolContext = {
    companyId,
    userId,
    userRole,
    enabledCapabilities,
    agentKind,
    toolAllowlist,
    db,
    services,
  };
  const handleToolCall = createToolCallHandler({ tools, executeTool, toolContext });

  const rl = readline.createInterface({ input: process.stdin });

  rl.on("line", async (line: string) => {
    let request: any;
    try {
      request = JSON.parse(line);
    } catch {
      writeResponse({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
      return;
    }

    const { method, params, id } = request;

    if (method === "initialize") {
      writeResponse({
        jsonrpc: "2.0",
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: { listChanged: false }, resources: { subscribe: false } },
          serverInfo: { name: "aoa-mcp-bridge", version: "1.0.0" },
        },
        id,
      });
    } else if (method === "tools/list") {
      writeResponse({
        jsonrpc: "2.0",
        result: { tools: buildToolListResponse(tools) },
        id,
      });
    } else if (method === "tools/call") {
      const result = await handleToolCall(params.name, params.arguments ?? {});
      writeResponse({ jsonrpc: "2.0", result, id });
    } else if (method === "notifications/initialized") {
      // No response needed for notifications
    } else {
      writeResponse({
        jsonrpc: "2.0",
        error: { code: -32601, message: `Method not found: ${method}` },
        id,
      });
    }
  });

  rl.on("close", () => {
    process.exit(0);
  });

  function writeResponse(response: unknown): void {
    process.stdout.write(JSON.stringify(response) + "\n");
  }
}

// Auto-start if run as script
const isMainModule = process.argv[1]?.endsWith("mcp-bridge.js") ||
  process.argv[1]?.endsWith("mcp-bridge.ts");
if (isMainModule) {
  startBridge().catch((err) => {
    process.stderr.write(`MCP Bridge fatal: ${err.message}\n`);
    process.exit(1);
  });
}
