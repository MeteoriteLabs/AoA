import type { AgentTool, ToolContext, ToolResult } from "./types.js";
import { authorizeToolInvocation } from "./authorize-tool.js";
import { createQueryTools } from "./tools/query-tools.js";
import { createActionTools } from "./tools/action-tools.js";
import { createMemoryTools } from "./tools/memory-tools.js";
import { createDiscussionTools } from "./tools/discussion-tools.js";
import { createWorkflowTools } from "./tools/workflow-tools.js";
import { createFileTools } from "./tools/file-tools.js";
import { createCoordinationTools } from "./tools/coordination-tools.js";
import { createAnalysisTools } from "./tools/analysis-tools.js";
import { submitExtractedItemsTool } from "./tools/submit-extracted-items.js";
import { delegateToSubagentTool } from "./tools/delegate-to-subagent.js";
import { useSkillTool } from "./tools/skill-tools.js";

export function createToolRegistry(): AgentTool[] {
  return [
    ...createQueryTools(),
    ...createActionTools(),
    ...createMemoryTools(),
    ...createDiscussionTools(),
    submitExtractedItemsTool,
    ...createWorkflowTools(),
    ...createFileTools(),
    ...createCoordinationTools(),
    delegateToSubagentTool,
    ...createAnalysisTools(),
    useSkillTool,
  ];
}

export function filterAuthorizedToolsForContext(
  tools: AgentTool[],
  ctx: Pick<ToolContext, "userRole" | "enabledCapabilities" | "agentKind" | "toolAllowlist">,
): AgentTool[] {
  return tools.filter((tool) =>
    authorizeToolInvocation(
      tool,
      ctx.userRole,
      ctx.enabledCapabilities,
      { agentKind: ctx.agentKind, toolAllowlist: ctx.toolAllowlist },
    ).allowed,
  );
}

const CORE_TOOLS = new Set(["query_tasks", "query_memory", "query_goals", "use_skill", "query_company"]);

const INTENT_KEYWORDS: Record<string, string[]> = {
  action: ["create", "add", "new", "make", "assign", "wake", "wakeup", "trigger"],
  memory: ["memory", "remember", "knowledge", "recall", "forget"],
  workflow: ["workflow", "pipeline", "template", "step", "process"],
  discussion: ["discussion", "debrief", "extract", "conversation", "transcript"],
  analysis: ["workload", "suggest", "improve", "analyze", "balance", "optimize"],
  coordination: ["dependency", "dependencies", "blocking", "blocked", "depends", "chain"],
  file: ["artifact", "file", "document", "version", "read_file"],
};

const MAX_TOOLS = 15;

export function getToolsForMessage(message: string, allTools: AgentTool[]): AgentTool[] {
  const lower = message.toLowerCase();
  const selected = new Set<string>();

  for (const name of CORE_TOOLS) {
    selected.add(name);
  }

  const matchedCategories = new Set<string>();
  for (const [category, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      matchedCategories.add(category);
    }
  }

  for (const tool of allTools) {
    if (matchedCategories.has(tool.category)) {
      selected.add(tool.name);
    }
  }

  if (matchedCategories.size === 0) {
    for (const tool of allTools) {
      if (tool.category === "query") {
        selected.add(tool.name);
      }
    }
  }

  const result: AgentTool[] = [];
  for (const tool of allTools) {
    if (selected.has(tool.name) && result.length < MAX_TOOLS) {
      result.push(tool);
    }
  }
  return result;
}

export function toolToAnthropicFormat(tool: AgentTool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

export function toolToOpenAIFormat(tool: AgentTool) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

export async function executeTool(
  tool: AgentTool,
  params: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  // Role + capability gate (closes C13) + D2 AoA tool allowlist gate
  const decision = authorizeToolInvocation(
    tool,
    ctx.userRole,
    ctx.enabledCapabilities,
    { agentKind: ctx.agentKind, toolAllowlist: ctx.toolAllowlist },
  );
  if (!decision.allowed) {
    return {
      success: false,
      data: null,
      summary: decision.summary,
      error: decision.error,
    };
  }

  try {
    return await tool.execute(params, ctx);
  } catch (error: any) {
    if (error?.status === 403) {
      return {
        success: false,
        data: null,
        summary: `Permission denied: ${error.message}`,
        error: "FORBIDDEN",
      };
    }
    return {
      success: false,
      data: null,
      summary: error?.message ?? "Unknown error",
      error: "INTERNAL",
    };
  }
}
