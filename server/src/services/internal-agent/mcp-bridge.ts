import type { AgentTool, ToolContext, ToolResult } from "./types.js";
import type { CommanderToolPermissions, CommanderOutputRef } from "@armyofagents/shared";
// Type-only import (erased at compile time → no runtime side effect, preserves
// the side-effect-free module load for consumers of the tool-layer exports).
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { buildOutputRefs } from "./output-refs.js";
import { resolveCommanderToolPolicy } from "./authorize-tool.js";
import { parseCommanderContextScopeJson } from "./context-scope.js";
import { filterAuthorizedToolsForContext } from "./tool-registry.js";

// Re-export so consumers (and existing tests) can import this from mcp-bridge
// where the function used to live before it moved to tool-registry.
export { filterAuthorizedToolsForContext };
import { runtimeApprovalService } from "./runtime-approvals.js";
import { createInFlightCounter, startParentWatchdog } from "./bridge-lifecycle.js";

export function parseCommanderContextScopeEnv() {
  return parseCommanderContextScopeJson(process.env.AOA_COMMANDER_CONTEXT_SCOPE);
}

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
    let outputRefs: CommanderOutputRef[] = [];
    try {
      outputRefs = buildOutputRefs(tool.name, args, result);
    } catch {
      outputRefs = []; // ref extraction must never fail the tool call
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: result.success,
            data: result.data,
            summary: result.summary,
            ...(result.error ? { error: result.error } : {}),
            ...(outputRefs.length > 0 ? { outputRefs } : {}),
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
      // Include both the error code (e.g., NOT_IN_ALLOWLIST, FORBIDDEN_ROLE,
      // CAPABILITY_DISABLED) and the human-readable summary so callers/tests
      // can parse the failure type and humans see the explanation.
      return {
        content: [{ type: "text", text: policy.error ? `${policy.error}: ${policy.summary}` : policy.summary }],
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

// ── Stdout Guard ─────────────────────────────────────────────────────────────

/**
 * Reroute console.* (which writes to stdout) to stderr. The SDK StdioServerTransport
 * owns process.stdout for protocol frames; a stray console.log would inject a
 * non-JSON line and corrupt framing. Returns a restore fn (used only in tests;
 * the bridge process keeps the guard for its whole lifetime).
 */
export function installStdoutGuard(): () => void {
  const orig = { log: console.log, info: console.info, debug: console.debug, warn: console.warn };
  const toErr = (...a: unknown[]) => { process.stderr.write(a.map(String).join(" ") + "\n"); };
  console.log = toErr; console.info = toErr; console.debug = toErr; console.warn = toErr;
  return () => { Object.assign(console, orig); };
}

// ── Main (runs when executed as script) ─────────────────────────────────────

export async function startBridge(): Promise<void> {
  installStdoutGuard();

  // ── Global fatal handlers (loud, not silent) ──────────────────────────────
  // Per-tool errors are already isolated in executeAndFormat — a process-level
  // unhandledRejection or uncaughtException is genuinely unexpected. Log loudly
  // to stderr so it appears in the parent CLI's process log; do NOT swallow it.
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(`MCP Bridge fatal unhandledRejection: ${String((reason as any)?.stack ?? reason)}\n`);
    // A process-level rejection is genuinely unexpected (per-tool errors are
    // isolated in executeAndFormat). Fail LOUD: exit so the parent CLI sees the
    // bridge die and the loud-failure detector marks the run failed, rather than
    // limping on in an undefined state. Distinct from the watchdog (exit 0).
    process.exit(1);
  });
  process.on("uncaughtException", (err) => {
    process.stderr.write(`MCP Bridge fatal uncaughtException: ${(err as any)?.stack ?? err}\n`);
    process.exit(1);
  });

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
  const contextScope = parseCommanderContextScopeEnv();

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
    contextScope,
    db,
    services,
  };
  const handleToolCall = createToolCallHandler({ tools, executeTool, toolContext });

  const inFlight = createInFlightCounter();

  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { CallToolRequestSchema, ListToolsRequestSchema } = await import(
    "@modelcontextprotocol/sdk/types.js"
  );

  const server = new Server(
    { name: "aoa-mcp-bridge", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const visibleTools = filterAuthorizedToolsForContext(tools, toolContext);
    return { tools: buildToolListResponse(visibleTools) };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    inFlight.enter();
    try {
      // handleToolCall already returns { content, isError } and never throws.
      // That shape IS a valid CallToolResult at runtime (the SDK validates it
      // against CallToolResultSchema). The cast pins it to that union member
      // (vs. the task-creation branch) and bridges the named-interface →
      // index-signature gap; it is sound, not a widening lie.
      const result = await handleToolCall(req.params.name, req.params.arguments ?? {});
      return result as CallToolResult;
    } finally {
      inFlight.leave();
    }
  });

  const transport = new StdioServerTransport();
  // Wire transport-level errors to stderr for observability. These are malformed/
  // partial frames, EPIPE, etc. — not tool errors, which are isolated separately.
  // Do NOT call process.exit here: a parse error carries id:null so a JSON-RPC
  // reply is useless to the client; logging is the right response level.
  transport.onerror = (err) => {
    process.stderr.write(`MCP Bridge transport error: ${(err as any)?.stack ?? String(err)}\n`);
  };
  await server.connect(transport);

  // LIFECYCLE (branch B): do NOT exit on stdin EOF. The parent-liveness watchdog
  // is the SOLE terminator — it fires only when the spawning provider CLI is gone,
  // and never while a tool call is in flight. This survives a client half-closing
  // stdin per request-batch and avoids any SDK "response flushed after handler
  // returns" race: the process stays alive long enough to send the response.
  // Intentionally NO transport.onclose -> process.exit.
  startParentWatchdog({
    getInFlight: () => inFlight.count,
    onDead: () => {
      // inFlight covers handler execution, but the SDK sends the JSON-RPC
      // response AFTER the handler returns (its protocol layer). Flush any
      // pending stdout — a response frame still mid-write — before exiting, so a
      // watchdog fire (esp. a false-dead PPID probe) can't drop an in-flight
      // response. Fallback timeout so we never hang if the reader is truly gone
      // (a dead parent's pipe never drains).
      let exited = false;
      const exit = () => { if (!exited) { exited = true; process.exit(0); } };
      process.stdout.write("", exit);
      setTimeout(exit, 1000).unref();
    },
  });
}

const isMainModule = process.argv[1]?.endsWith("mcp-bridge.js") ||
  process.argv[1]?.endsWith("mcp-bridge.ts");
if (isMainModule) {
  startBridge().catch((err) => {
    process.stderr.write(`MCP Bridge fatal: ${err.message}\n`);
    process.exit(1);
  });
}
