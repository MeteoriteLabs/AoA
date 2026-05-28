import type { AgentTool, ToolContext, ToolResult } from "./types.js";
import {
  authorizeToolInvocation,
  resolveCommanderToolPolicy,
} from "./authorize-tool.js";
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
import { createThreadTools } from "./tools/thread-tools.js";
import { createPostEntryTool } from "./tools/post-entry-tool.js";
import { createAdvancePhaseTool } from "./tools/advance-phase-tool.js";
import { createNotifyOwnerTool } from "./tools/notify-owner-tool.js";
import { createArtifactTool } from "./tools/create-artifact-tool.js";
// Task C2 batch 1 — 7 thread + query tools (T15)
import { threadListEntriesTool } from "./tools/thread-list-entries.js";
import { threadSetIntentTool } from "./tools/thread-set-intent.js";
import { threadPostScopeProposalTool } from "./tools/thread-post-scope-proposal.js";
import { threadUpdateSummaryTool } from "./tools/thread-update-summary.js";
import { threadCreateLinkTool } from "./tools/thread-create-link.js";
import { getThreadSummaryTool } from "./tools/thread-get-summary.js";
import { findSimilarThreadsTool } from "./tools/thread-find-similar.js";
// Task C2 batch 2 — 5 navigator + artifact + workspace tools (T15)
import { attachToThreadTool } from "./tools/inbox-attach-to-thread.js";
import { spinOffThreadTool } from "./tools/thread-spin-off.js";
import { createArtifactVersionTool } from "./tools/artifact-create-version.js";
import { queryArtifactsTool } from "./tools/artifact-query.js";
import { requestThreadWorkspaceTool } from "./tools/workspace-request-for-thread.js";
// Task C2 batch 3 — 7 memory tools (T15)
// Extraction wrappers (4) call into C1's named exports (extractMemoryCandidates
// + filtered helpers in server/src/services/extraction.ts). The HNSW search
// tool uses direct pgvector (mirrors find_similar_threads). propose_memory_from_thread
// + archive_stale_memory are new memory-management operations.
import { extractMemoryCandidatesTool } from "./tools/memory-extract-candidates.js";
import { extractDecisionsTool } from "./tools/memory-extract-decisions.js";
import { extractInsightsTool } from "./tools/memory-extract-insights.js";
import { extractReferencesTool } from "./tools/memory-extract-references.js";
import { findSimilarMemoryHnswTool } from "./tools/memory-find-similar.js";
import { proposeMemoryFromThreadTool } from "./tools/memory-propose.js";
import { archiveStaleMemoryTool } from "./tools/memory-archive-stale.js";
// Task C2 batch 4 — agent.dispatch (T15)
// Lower-level sibling to delegate_to_subagent. Inserts wakeup rows with
// dedup + hop-count cap. Kept alongside delegate_to_subagent — they target
// different ergonomics (founder approval vs collaborative crew dispatch).
import { agentDispatchTool } from "./tools/agent-dispatch.js";

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
    // P2 crew collaboration tools
    ...createThreadTools(),
    createPostEntryTool(),
    createAdvancePhaseTool(),
    createNotifyOwnerTool(),
    createArtifactTool(),
    // Task C2 batch 1 — 7 thread + query tools (T15)
    threadListEntriesTool,
    threadSetIntentTool,
    threadPostScopeProposalTool,
    threadUpdateSummaryTool,
    threadCreateLinkTool,
    getThreadSummaryTool,
    findSimilarThreadsTool,
    // Task C2 batch 2 — 5 navigator + artifact + workspace tools (T15)
    // attach_to_thread, spin_off_thread → Navigator (Router) allowlist (see
    // ensure-command-staff.ts roleToolAllowlist['router']).
    // TODO(Phase D): create_artifact_version, query_artifacts,
    //   request_thread_workspace must be added to the Engineer agent's
    //   toolAllowlist when ensure-engineer.ts lands in Phase D. Until then,
    //   only the founder or a hand-rolled per-agent allowlist can invoke them.
    attachToThreadTool,
    spinOffThreadTool,
    createArtifactVersionTool,
    queryArtifactsTool,
    requestThreadWorkspaceTool,
    // Task C2 batch 3 — 7 memory tools (T15)
    // Memory Keeper allowlist (ensure-command-staff.ts roleToolAllowlist['memory_keeper'])
    // is extended to cover all 7 of these. extract_memory_candidates is also
    // added to the Adjutant allowlist so it can extract mid-discussion when
    // checking phase readiness.
    extractMemoryCandidatesTool,
    extractDecisionsTool,
    extractInsightsTool,
    extractReferencesTool,
    findSimilarMemoryHnswTool,
    proposeMemoryFromThreadTool,
    archiveStaleMemoryTool,
    // Task C2 batch 4 — agent.dispatch (T15)
    // Coordination-category tool that queues a wakeup row for a target AoA
    // agent with hop-count cap + dedup. Added to the Adjutant allowlist so
    // it can hand off to another role mid-thread. delegate_to_subagent
    // remains as the founder-only, name-targeted, confirmation-gated
    // alternative — both serve distinct ergonomics.
    agentDispatchTool,
  ];
}

export function filterAuthorizedToolsForContext(
  tools: AgentTool[],
  ctx: Pick<
    ToolContext,
    | "userRole"
    | "enabledCapabilities"
    | "agentKind"
    | "toolAllowlist"
    | "actorType"
    | "commanderToolPermissions"
    | "runtimeApprovalsEnabled"
  >,
): AgentTool[] {
  return tools.filter((tool) => {
    if (ctx.actorType === "commander") {
      return resolveCommanderToolPolicy(tool, ctx).allowed;
    }

    return authorizeToolInvocation(
      tool,
      ctx.userRole,
      ctx.enabledCapabilities,
      { agentKind: ctx.agentKind, toolAllowlist: ctx.toolAllowlist },
    ).allowed;
  });
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
  if (ctx.actorType === "commander") {
    const commanderPolicy = resolveCommanderToolPolicy(tool, ctx);
    if (!commanderPolicy.allowed) {
      return {
        success: false,
        data: null,
        summary: commanderPolicy.summary,
        error: commanderPolicy.error,
      };
    }
  }

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
