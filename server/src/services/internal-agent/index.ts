export type {
  AgentTool,
  ToolContext,
  ToolResult,
  ToolCategory,
  ServiceContainer,
  JsonSchema,
} from "./types.js";

export { createServiceContainer } from "./service-container.js";

export {
  createToolRegistry,
  getToolsForMessage,
  toolToAnthropicFormat,
  toolToOpenAIFormat,
  executeTool,
} from "./tool-registry.js";

export {
  blockedTaskScan,
  budgetThresholdAlert,
  staleWorkDetection,
  dependencyChainGaps,
  memoryConflictScan,
  workloadImbalance,
  morningDigest,
  checkReminders,
} from "./proactive.js";

export { createEventListener } from "./event-listener.js";
export type { EventTriggerResult } from "./event-listener.js";
