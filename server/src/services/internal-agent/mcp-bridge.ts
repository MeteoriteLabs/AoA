import type { AgentTool, ToolContext, ToolResult } from "./types.js";
import type { CommanderToolPermissions } from "@armyofagents/shared";
import { resolveCommanderToolPolicy } from "./authorize-tool.js";
import { filterAuthorizedToolsForContext } from "./tool-registry.js";
import { runtimeApprovalService } from "./runtime-approvals.js";

// ── Tool Call Handler (pure, testable) ──────────────────────────────────────

interface ToolCallHandlerDeps {
  tools: AgentTool[];
  executeTool: (tool: AgentTool, params: unknown, ctx: ToolContext) => Promise<ToolResult>;
  toolContext: ToolContext;
  runtimeApprovals?: Pick<
    ReturnType<typeof runtimeApprovalService>,
    "createPending" | "findTrustedExact"
  >;
}

interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

function normalizeToolArgs(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null
    ? (args as Record<string, unknown>)
    : {};
}

async function executeAndFormat(
  tool: AgentTool,
  args: unknown,
  deps: ToolCallHandlerDeps,
): Promise<McpToolResult> {
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

    const policy = resolveCommanderToolPolicy(tool, deps.toolContext);
    if (!policy.allowed) {
      return {
        content: [{ type: "text", text: policy.summary }],
        isError: true,
      };
    }

    if (!policy.requiresApproval) {
      return executeAndFormat(tool, args, deps);
    }

    const params = normalizeToolArgs(args);
    const approvalSvc = deps.runtimeApprovals ?? runtimeApprovalService(deps.toolContext.db);
    const trusted = await approvalSvc.findTrustedExact({
      companyId: deps.toolContext.companyId,
      userId: deps.toolContext.userId,
      toolName: name,
      params,
    });

    if (trusted) {
      return executeAndFormat(tool, args, deps);
    }

    const approval = await approvalSvc.createPending({
      companyId: deps.toolContext.companyId,
      conversationId: deps.toolContext.conversationId ?? null,
      runId: deps.toolContext.runId ?? null,
      userId: deps.toolContext.userId,
      toolName: name,
      params,
    });

    const marker = `⚡CONFIRM:${JSON.stringify({
      toolName: name,
      params,
      confirmId: approval.id,
      action: "runtime_tool_approval",
      description: tool.description,
    })}⚡ This action requires your approval before I can proceed.`;

    return {
      content: [{ type: "text", text: marker }],
      isError: false,
    };
  };
}

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
  const userRole = process.env.AOA_SESSION_USER_ROLE;
  if (!userRole) {
    process.stderr.write("MCP Bridge: Missing AOA_SESSION_USER_ROLE env var\n");
    process.exit(1);
  }

  if (!companyId || !userId) {
    process.stderr.write("MCP Bridge: Missing AOA_SESSION_COMPANY_ID or AOA_SESSION_USER_ID\n");
    process.exit(1);
  }

  const enabledCapabilities = (process.env.AOA_SESSION_ENABLED_CAPABILITIES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const agentKind = process.env.AOA_AGENT_KIND || undefined;
  const toolAllowlist = (process.env.AOA_TOOL_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const actorType = process.env.AOA_ACTOR_TYPE ?? "board";

  // P2.0: Calling agent's ID and effective autonomy level
  const agentId = process.env.AOA_AGENT_ID || undefined;
  const effectiveAutonomyRaw = process.env.AOA_EFFECTIVE_AUTONOMY;
  const effectiveAutonomy = effectiveAutonomyRaw ? parseInt(effectiveAutonomyRaw, 10) : null;

  const { createDb, internalAgentConfig } = await import("@armyofagents/db");
  const { eq } = await import("drizzle-orm");
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

  const config = await db
    .select()
    .from(internalAgentConfig)
    .where(eq(internalAgentConfig.companyId, companyId))
    .then((rows) => rows[0] ?? null);

  const toolContext: ToolContext = {
    companyId,
    userId,
    userRole,
    enabledCapabilities,
    agentKind,
    toolAllowlist,
    actorType,
    agentId,
    effectiveAutonomy,
    commanderToolPermissions:
      (config?.commanderToolPermissions as CommanderToolPermissions | null | undefined) ?? null,
    runtimeApprovalsEnabled: config?.runtimeApprovalsEnabled ?? true,
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
      const visibleTools = filterAuthorizedToolsForContext(tools, toolContext);
      writeResponse({
        jsonrpc: "2.0",
        result: { tools: buildToolListResponse(visibleTools) },
        id,
      });
    } else if (method === "tools/call") {
      const result = await handleToolCall(params.name, params.arguments ?? {});
      writeResponse({ jsonrpc: "2.0", result, id });
    } else if (method === "notifications/initialized") {
      // No response needed for notifications.
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

const isMainModule = process.argv[1]?.endsWith("mcp-bridge.js") ||
  process.argv[1]?.endsWith("mcp-bridge.ts");
if (isMainModule) {
  startBridge().catch((err) => {
    process.stderr.write(`MCP Bridge fatal: ${err.message}\n`);
    process.exit(1);
  });
}
