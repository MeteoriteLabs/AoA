// server/src/services/internal-agent/types.ts
import type { Db } from "@armyofagents/db";
import type { CommanderToolPermissions } from "@armyofagents/shared";
import type { issueService } from "../issues.js";
import type { goalService } from "../goals.js";
import type { agentService } from "../agents.js";
import type { projectService } from "../projects.js";
import type { memoryService } from "../memory.js";
import type { costService } from "../costs.js";
import type { activityService } from "../activity.js";
import type { heartbeatService } from "../heartbeat.js";
import type { suggestionService } from "../suggestions.js";
import type { artifactService } from "../artifacts.js";
import type { dependencyService } from "../dependencies.js";
import type { secretService } from "../secrets.js";
import type { notificationService } from "../notifications.js";
import type { discussionService } from "../discussions.js";
import type { threadService } from "../threads.js";
import type { EmbeddingService } from "../embeddings.js";

// JSON Schema type for tool parameter definitions
export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export type ToolCategory =
  | "discussion"
  | "query"
  | "action"
  | "memory"
  | "workflow"
  | "file"
  | "coordination"
  | "analysis";

export interface ToolResult {
  success: boolean;
  data: unknown;
  summary: string;
  error?: string;
}

export interface ToolContext {
  companyId: string;
  userId: string;
  userRole: string;
  enabledCapabilities: readonly string[];   // from internal_agent_config
  /** D2: kind of the calling agent. 'aoa' triggers per-agent tool allowlist gate. */
  agentKind?: string;
  /** D2: explicit tool allowlist for AoA agents. Absent/empty = default-deny. */
  toolAllowlist?: readonly string[];
  /** Actor type: "commander" when invoked via Commander; "board" otherwise. */
  actorType?: string;
  /** Calling agent's ID — exported as AOA_AGENT_ID by the runner. Absent in Commander runs. */
  agentId?: string;
  /** Resolved effective autonomy level (0/1/2). Absent → treat as 0 (fail-closed). */
  effectiveAutonomy?: number | null;
  /** Current Commander conversation id, when available. */
  conversationId?: string | null;
  /** Current internal agent run id, when available. */
  runId?: string | null;
  /** Commander per-tool policy overrides from internal_agent_config. */
  commanderToolPermissions?: CommanderToolPermissions | null;
  /** Company-level switch for AoA runtime approval prompts. */
  runtimeApprovalsEnabled?: boolean;
  db: Db;
  services: ServiceContainer;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: JsonSchema;
  category: ToolCategory;
  /** When set, the caller's role must be at least this level. Absent = open to all roles. */
  requiredRole?: "founder" | "team_lead" | "team_member";
  requiresConfirmation: boolean;
  execute: (params: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ServiceContainer {
  issues: ReturnType<typeof issueService>;
  goals: ReturnType<typeof goalService>;
  agents: ReturnType<typeof agentService>;
  projects: ReturnType<typeof projectService>;
  memory: ReturnType<typeof memoryService>;
  costs: ReturnType<typeof costService>;
  activity: ReturnType<typeof activityService>;
  heartbeat: ReturnType<typeof heartbeatService>;
  suggestions: ReturnType<typeof suggestionService>;
  artifacts: ReturnType<typeof artifactService>;
  dependencies: ReturnType<typeof dependencyService>;
  secrets: ReturnType<typeof secretService>;
  notifications: ReturnType<typeof notificationService>;
  discussions: ReturnType<typeof discussionService>;
  threads: ReturnType<typeof threadService>;
  companies: {
    get: (id: string) => Promise<{ name: string | null; vision: string | null; mission: string | null; issuePrefix: string | null; stage: string | null } | null>;
    update: (id: string, data: Partial<{ vision: string; mission: string }>) => Promise<{ id: string; name: string | null; vision: string | null; mission: string | null }>;
  };
  workflows: null; // Placeholder — workflow service not yet implemented
  /**
   * Optional embedding service — present when the embedding worker has been
   * started (see `startEmbeddingWorker` in embeddings-worker.ts). Tools that
   * need synchronous embedding (e.g. find_similar_threads) should check for
   * presence and fall back gracefully when absent (e.g. in tests or when the
   * worker has not been wired up yet).
   */
  embeddings?: EmbeddingService;
}
